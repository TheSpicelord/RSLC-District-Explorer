"""National fallback model: every state without a dedicated model gets "DR Natl".

    python scripts/build_national_margins.py                 # all fallback states
    python scripts/build_national_margins.py --states MA,VT  # specific states
    python scripts/build_national_margins.py --dry-run

Source: dbo.[RSLC DRA June National Audiences and Scores], 227M rows keyed on dt_regid.
Bases are the "RSLC Republican/Democratic Legislative Voters" audience flags. Margin is
GOP% minus Dem% of all modeled voters in the district — the same convention as
build_model_margins.py, which app.js negates on display.

States that HAVE a dedicated model (including ones on hold) are skipped, so this never
overwrites a state-specific model.

District IDs are the tricky part. Most chambers use zero-padded integers, but eight do not,
so each voterfile row is resolved against the IDs the chamber file actually contains:
  ak_senate                            DISTRICT A -> 00A
  ma_senate                            integer    -> D01
  md/mn/nd/sd house                    district + subdistrict -> 01A
  vt_house                             matched via district_name ("Addison-1" -> A-1)
  vt_senate                            explicit county crosswalk (Windsor -> WSR)
Anything that fails to resolve is reported rather than silently dropped.

VPN required. Read-only; aggregation happens server-side.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

from db import connect, load_config
from build_model_margins import (MODELS, ON_HOLD, EXTERNAL_MODELS, FILE_STEM, JOIN,
                                 chamber_path, DATA_DIR)

# A state with a dedicated model never takes the national fallback — including one whose
# dedicated build is paused (ON_HOLD) and one whose model comes from a workbook rather than
# SQL (EXTERNAL_MODELS, i.e. Kansas). Anything omitted here silently inherits national
# numbers, which is how Iowa nearly picked them up while it was on hold.
DEDICATED = set(MODELS) | set(ON_HOLD) | set(EXTERNAL_MODELS)

# States where the national model does not describe the electorate and is left blank rather
# than shown. Both have unusual party identification — Alaska's plurality-undeclared
# registration, Hawaii's absence of party registration — so the audiences carry a ~47 point
# systematic bias and never place a district on the other side:
#   AK  model mean R+58.8 vs presidential R+11.3; no district reads Democratic, though
#       several are (presidential range runs to D+37).
#   HI  model mean D+68.7 vs presidential D+21.2; nothing below D+35, though some are R+13.
# Correlation alone does not catch this — Alaska ranks districts fine (r=+0.90); it is the
# offset that makes the number unusable.
NATIONAL_EXCLUDE = {"AK", "HI"}

TABLE = "RSLC DRA June National Audiences and Scores"
GOP_COL = "RSLC Republican Legislative Voters"
DEM_COL = "RSLC Democratic Legislative Voters"

FAMILY = "drnatl"
FAMILY_LABEL = "DR Natl"
VIEW = f"model_{FAMILY}_all"

# Vermont senate districts are county-based; the app uses 3-letter codes.
VT_SENATE = {
    "ADDISON": "ADD", "BENNINGTON": "BEN", "CALEDONIA": "CAL",
    "CHITTENDEN CENTRAL": "CHC", "CHITTENDEN NORTH": "CHN",
    "CHITTENDEN SOUTHEAST": "CHS", "ESSEX": "ESX", "FRANKLIN": "FRA",
    "GRAND ISLE": "GRI", "LAMOILLE": "LAM", "ORANGE": "ORA", "ORLEANS": "ORL",
    "RUTLAND": "RUT", "WASHINGTON": "WAS", "WINDHAM": "WDH", "WINDSOR": "WSR",
}

NAME_SUFFIX = re.compile(
    r"\s+STATE\s+(HOUSE|SENATE|LEGISLATIVE)\s+DISTRICT$|\s+DISTRICT$", re.I)

# Massachusetts writes house districts as ordinal words in the voter file ("EIGHTEENTH
# ESSEX") but as numerals in the app ("18th Essex"). Worse, the two sources number the
# districts on entirely different schemes — the voter file alphabetically, the app by
# county — so an integer join silently pairs unrelated districts. Names are the only
# reliable key, which means both spellings have to reduce to the same canonical form.
_UNITS = {"FIRST": 1, "SECOND": 2, "THIRD": 3, "FOURTH": 4, "FIFTH": 5, "SIXTH": 6,
          "SEVENTH": 7, "EIGHTH": 8, "NINTH": 9}
_TEENS = {"TENTH": 10, "ELEVENTH": 11, "TWELFTH": 12, "THIRTEENTH": 13, "FOURTEENTH": 14,
          "FIFTEENTH": 15, "SIXTEENTH": 16, "SEVENTEENTH": 17, "EIGHTEENTH": 18,
          "NINETEENTH": 19}
_TENS = {"TWENTY": 20, "THIRTY": 30, "FORTY": 40}
# Standalone tens ordinals — "TWENTIETH MIDDLESEX", not "TWENTY FIRST MIDDLESEX".
_TENS_ORDINAL = {"TWENTIETH": 20, "THIRTIETH": 30, "FORTIETH": 40}


def _ordinal_tokens(tokens):
    """Fold ordinal words/numerals into bare digits: EIGHTEENTH -> 18, 18TH -> 18."""
    out, i = [], 0
    while i < len(tokens):
        t = tokens[i]
        if t in _TENS_ORDINAL:
            out.append(str(_TENS_ORDINAL[t]))
        elif t in _TENS:
            val = _TENS[t]
            if i + 1 < len(tokens) and tokens[i + 1] in _UNITS:
                val += _UNITS[tokens[i + 1]]
                i += 1
            out.append(str(val))
        elif t in _TEENS:
            out.append(str(_TEENS[t]))
        elif t in _UNITS:
            out.append(str(_UNITS[t]))
        else:
            m = re.fullmatch(r"(\d+)(ST|ND|RD|TH)", t)
            out.append(m.group(1) if m else t)
        i += 1
    return out


def normalize_name(s):
    s = str(s or "").strip().upper()
    s = NAME_SUFFIX.sub("", s)
    s = s.replace("-", " ").replace(",", " ")
    tokens = [t for t in s.split() if t and t != "AND"]
    return " ".join(_ordinal_tokens(tokens)).strip()


def make_resolver(state, chamber, recs):
    """Map a voterfile (district, proper, subdistrict) tuple to this chamber's district_id."""
    ids = {str(r.get("district_id")) for r in recs}
    by_name = {}
    for r in recs:
        nm = normalize_name(r.get("district_name"))
        if nm:
            by_name.setdefault(nm, str(r.get("district_id")))

    def resolve(n, proper, sub):
        p = normalize_name(proper)
        s = str(sub or "").strip().upper()

        # 1. Descriptive name match — VT house ("ADDISON-1" -> "A-1").
        if p and p in by_name:
            return by_name[p]
        # 2. Explicit crosswalks.
        if state == "VT" and chamber == "senate":
            cand = VT_SENATE.get(p)
            if cand and cand in ids:
                return cand
        m = re.fullmatch(r"DISTRICT\s+([A-Z0-9]+)", p)
        if m and f"00{m.group(1)}" in ids:
            return f"00{m.group(1)}"
        # 3. Mechanical integer forms.
        if n:
            cands = ([f"{n:02d}{s}"] if s else []) + [f"{n:03d}", f"D{n:02d}", str(n)]
            for c in cands:
                if c in ids:
                    return c
        return None

    return resolve


def fetch_state(cur, state):
    sql = f"""
        SELECT v.StateLegUpperDistrict, v.StateLegUpperDistrict_Proper,
               v.StateLegLowerDistrict, v.StateLegLowerDistrict_Proper,
               v.StateLegLowerSubDistrict,
               CASE WHEN m.[{GOP_COL}] = '1' THEN 1 ELSE 0 END AS g,
               CASE WHEN m.[{DEM_COL}] = '1' THEN 1 ELSE 0 END AS d,
               COUNT(*) AS cnt
        FROM voterfile_2026 v
        JOIN [{TABLE}] m ON {JOIN.format(col='dt_regid')}
        WHERE v.State = ?
        GROUP BY v.StateLegUpperDistrict, v.StateLegUpperDistrict_Proper,
                 v.StateLegLowerDistrict, v.StateLegLowerDistrict_Proper,
                 v.StateLegLowerSubDistrict,
                 CASE WHEN m.[{GOP_COL}] = '1' THEN 1 ELSE 0 END,
                 CASE WHEN m.[{DEM_COL}] = '1' THEN 1 ELSE 0 END
    """
    cur.execute(sql, state)
    return cur.fetchall()


def aggregate(rows, chamber, resolve):
    """(district_id -> (segments, margin, n), unresolved_count)"""
    # Row layout: 0 upper_int, 1 upper_proper, 2 lower_int, 3 lower_proper,
    #             4 lower_sub, 5 gop, 6 dem, 7 count
    if chamber == "senate":
        icol, pcol, scol = 0, 1, None
    else:
        icol, pcol, scol = 2, 3, 4

    tally, unresolved = {}, 0
    for row in rows:
        try:
            n = int(row[icol])
        except (TypeError, ValueError):
            n = 0
        sub = row[scol] if scol is not None else ""
        key = resolve(n if n > 0 else 0, row[pcol], sub)
        if key is None:
            unresolved += int(row[7])
            continue
        t = tally.setdefault(key, [0, 0, 0])
        t[0] += int(row[7])
        if row[5]:
            t[1] += int(row[7])
        if row[6]:
            t[2] += int(row[7])

    out = {}
    for key, (n, g, d) in tally.items():
        if not n:
            continue
        gp, dp = 100.0 * g / n, 100.0 * d / n
        segments = [
            {"key": "gop_legislative", "label": "GOP Legislative", "value": round(gp, 1)},
            {"key": "unaligned", "label": "Unaligned", "value": round(max(0.0, 100 - gp - dp), 1)},
            {"key": "dem_legislative", "label": "Dem Legislative", "value": round(dp, 1)},
        ]
        out[key] = (segments, round(gp - dp, 1), n)
    return out, unresolved


def patch(state, chamber, table, dry_run=False):
    path = chamber_path(state, chamber)
    recs = json.loads(path.read_text(encoding="utf-8"))
    hits = 0
    for rec in recs:
        key = str(rec.get("district_id"))
        if key not in table:
            # Drop any stale value: a district that resolved on a previous run but not on
            # this one must not keep the old number (this is how the bad Massachusetts
            # integer join would otherwise survive a corrected rebuild).
            (rec.get("view_margins") or {}).pop(VIEW, None)
            (rec.get("models") or {}).pop(VIEW, None)
            continue
        segments, margin, _n = table[key]
        affinity = {"segments": segments, "margin": margin}
        for s in segments:
            affinity[s["key"]] = s["value"]
        rec.setdefault("view_margins", {})[VIEW] = margin
        rec.setdefault("models", {})[VIEW] = {
            "label": f"{FAMILY_LABEL} (All)",
            "family": FAMILY_LABEL,
            "variant": "All",
            "affinity": affinity,
        }
        hits += 1
    if not dry_run:
        path.write_text(json.dumps(recs, indent=1, ensure_ascii=False), encoding="utf-8")
    return hits, len(recs)


def fallback_states():
    """Every state with chamber files that has no dedicated model."""
    found = set()
    for p in DATA_DIR.glob("*_house.json"):
        found.add(p.name[: -len("_house.json")])
    for p in DATA_DIR.glob("*_senate.json"):
        found.add(p.name[: -len("_senate.json")])
    stem_to_abbr = {v: k for k, v in FILE_STEM.items()}
    states = set()
    for stem in found:
        states.add(stem_to_abbr.get(stem, stem.upper()))
    return sorted(states - DEDICATED - NATIONAL_EXCLUDE)


def already_done(state):
    """True when every district in every chamber file already carries the national view."""
    seen = False
    for chamber in ("house", "senate"):
        p = chamber_path(state, chamber)
        if not p.exists():
            continue
        seen = True
        recs = json.loads(p.read_text(encoding="utf-8"))
        if any((r.get("view_margins") or {}).get(VIEW) is None for r in recs):
            return False
    return seen


def fetch_with_retry(state, attempts=3, backoff=15):
    """A full pass takes ~45 minutes, long enough that a dropped link is likely.

    Each state gets its own short-lived connection so one broken socket costs a single
    state instead of the whole run.
    """
    import pyodbc
    last = None
    for attempt in range(1, attempts + 1):
        try:
            with connect(load_config(), timeout=60) as conn:
                return fetch_state(conn.cursor(), state)
        except pyodbc.Error as exc:
            last = exc
            if attempt < attempts:
                print(f"    {state}: connection lost (attempt {attempt}/{attempts}), "
                      f"retrying in {backoff}s", flush=True)
                time.sleep(backoff)
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default="ALL")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--resume", action="store_true",
                    help="Skip states already fully populated (safe to re-run after a drop)")
    args = ap.parse_args()

    if args.states.strip().upper() == "ALL":
        states = fallback_states()
    else:
        states = [s.strip().upper() for s in args.states.split(",") if s.strip()]
        clash = [s for s in states if s in DEDICATED]
        if clash:
            sys.exit(f"These states have a dedicated model, refusing to overwrite: {clash}")
        excluded = [s for s in states if s in NATIONAL_EXCLUDE]
        if excluded:
            sys.exit(f"The national model is a poor fit for {excluded}; see NATIONAL_EXCLUDE.")

    if args.resume:
        skipped = [s for s in states if already_done(s)]
        states = [s for s in states if s not in skipped]
        if skipped:
            print(f"Already complete, skipping {len(skipped)}: {', '.join(skipped)}")

    print(f"{len(states)} fallback states: {', '.join(states)}\n")
    total_unresolved, failed = {}, []

    for state in states:
        try:
            rows = fetch_with_retry(state)
        except Exception as exc:
            failed.append(state)
            print(f"{state}:  FAILED — {str(exc).splitlines()[0][:120]}", flush=True)
            continue

        line = [f"{state}:"]
        for chamber in ("house", "senate"):
            p = chamber_path(state, chamber)
            if not p.exists():
                continue
            recs = json.loads(p.read_text(encoding="utf-8"))
            resolve = make_resolver(state, chamber, recs)
            table, unresolved = aggregate(rows, chamber, resolve)
            hits, total = patch(state, chamber, table, dry_run=args.dry_run)
            flag = "" if hits == total else "  <-- INCOMPLETE"
            line.append(f"  {chamber} {hits}/{total}{flag}")
            if unresolved:
                total_unresolved[f"{state} {chamber}"] = unresolved
        print("".join(line) + ("   (dry run)" if args.dry_run else ""), flush=True)

    if total_unresolved:
        print("\nVoters whose district could not be resolved:")
        for k, v in sorted(total_unresolved.items(), key=lambda kv: -kv[1]):
            print(f"    {k:<20} {v:>10,}")

    if failed:
        print(f"\n{len(failed)} states failed: {', '.join(failed)}")
        print("Re-run with --resume to pick up only what is missing.")
        sys.exit(1)


if __name__ == "__main__":
    main()
