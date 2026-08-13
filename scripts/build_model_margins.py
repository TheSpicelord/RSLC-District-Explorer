"""Compute per-district model margins directly from SQL Server and patch the chamber JSONs.

Replaces the old workflow of hand-copying modeling numbers into the Excel workbook.

    python scripts/build_model_margins.py --states ALL
    python scripts/build_model_margins.py --states NV,PA,GA
    python scripts/build_model_margins.py --states MI --dry-run

Run this AFTER generate_chamber_jsons.py — the generator rebuilds chamber files from the
workbook and will drop anything written here.

Margin convention: every model stores GOP framework % minus Dem framework %, as a share of
ALL modeled voters in the district. app.js negates the rslc/rga/lombardo families on display
to reach the Dem-positive convention used everywhere else.

Aggregation is entirely server-side (GROUP BY in SQL); only district-level counts come back,
so no individual voter records leave the server.

Join note: dbo.voterfile_2026 is a view over DTODD_Staging2.dbo.Voterfile_2026, created with
SELECT * before that table's DT_Regid column was renamed — so the view still exposes it as
RNC_Regid (uniqueidentifier). The supporting index is (State, DT_Regid), so we must convert
the *model* side to uniqueidentifier. Converting the voterfile side to varchar instead makes
the index unusable and turns a 0.4s query into a 10+ minute scan of 231M rows.

VPN required. Read-only against the database.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from db import connect, load_config

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"

# Chamber files are <abbr>_house/senate.json except MI and MN, which spell the state out.
FILE_STEM = {"MI": "michigan", "MN": "minnesota"}

JOIN = "TRY_CONVERT(uniqueidentifier, m.[{col}]) = v.RNC_Regid"

# Position of each chamber's district value in the fetched rows.
CHAMBER_IDX = {"senate": 0, "house": 1}


def seg_key(label):
    """'Governor Drop-off Republicans' -> 'governor_dropoff_republicans'"""
    s = re.sub(r"[^a-z0-9]+", "_", str(label).strip().lower())
    return s.strip("_") or "segment"


# ---------------------------------------------------------------------------
# Model configuration
#
# mode "universe": count voters per universenumber; bases are universe ranges.
# mode "flags":    base membership comes from 0/1 (or '0'/'1') flag columns.
# mode "score":    no audiences — average a continuous support score instead.
#
# PA note: the spec said bases 1-2 vs 4-5, which described the OLD 5-segment HRCC
# model. In the 7-universe PA_RSLC table, 4-5 are "Stubborn Middle"/"Dem Peel" and
# the Dem base is 6-7. Using 6-7 reproduces the prior HRCC values almost exactly.
# ---------------------------------------------------------------------------
MODELS = {
    "NV": dict(
        mode="universe", table="NV_GOV_IE_R1_Exchange_20260105",
        family="lombardo", family_label="Lombardo",
        univ_col="universenumber", name_col="universename",
        gop=[1, 2], dem=[6, 7],
        turnout_col="bin_turnout", hm_values=["H", "M"],
    ),
    "PA": dict(
        mode="universe", table="PA_RSLC_R1_Exchange_20260418",
        family="rslc", family_label="RSLC",
        univ_col="UniverseNumber", name_col="UniverseName",
        gop=[1, 2], dem=[6, 7],
        turnout_col="bin_turnout", hm_values=["H", "M"],
        drop_families=["hrcc"],
    ),
    "AZ": dict(
        mode="universe", table="RGA_AZ_R2_Exchange_20260121",
        family="rga", family_label="RGA",
        univ_col="universenumber", name_col="universename",
        gop=[1, 2], dem=[6, 7],
    ),
    "GA": dict(
        # Replaces the older RGA_GA_R1 model; 9 universes rather than 7, so the Dem base
        # is 8-9. "All" deliberately excludes the 'A' bin (and the residual I/N bins).
        mode="universe", table="RSLC_GA_Exchange_20260721",
        family="rslc", family_label="RSLC",
        univ_col="universenumber", name_col="universename",
        gop=[1, 2], dem=[8, 9],
        turnout_col="bin_turnout", all_values=["L", "M", "H"], hm_values=["H", "M"],
        drop_families=["rga"],
    ),
    "WI": dict(
        mode="universe", table="RGA_WI_ExchangeData_20260131",
        family="rga", family_label="RGA",
        univ_col="universenumber", name_col="universename",
        gop=[1, 2], dem=[7, 8],
    ),
    "MI": dict(
        # Vote Intent was modeled separately and is NOT reproducible from universe counts,
        # so model_rslc_vi is preserved from the workbook. Only H+M is built from SQL.
        mode="universe", table="RSLC_MI_R1_Exchange_20260304",
        family="rslc", family_label="RSLC",
        univ_col="universenumber", name_col="Universename",
        gop=[1, 2, 3], dem=[7, 8, 9],
        turnout_col="bin_turnout", hm_values=["H", "M"],
        variants=["hm"], preserve=["model_rslc_vi"],
    ),
    "NJ": dict(
        mode="universe", table="RSLC_NJ_Transfer_20250712",
        family="rslc", family_label="RSLC",
        univ_col="universenumber", name_col=None,   # universename is blank in this table
        gop=[1, 2, 3], dem=[7, 8, 9],
        turnout_col="TurnoutBin", hm_values=["H", "M"],
    ),
    "VA": dict(
        mode="flags", table="RSLC_VA_R2_Exchange_20250804",
        family="rslc", family_label="RSLC",
        gop_cols=["RepublicanFramework_Flag"], dem_cols=["DemocratFramework_Flag"],
        flag_true="1", flag_quoted=False,
        turnout_cols=["HighTurnout_Flag", "MidTurnout_Flag"], turnout_quoted=False,
    ),
    "TX": dict(
        mode="flags", table="RSLC_TX_Scores_TurnoutSupportAudiences_20260601",
        family="rslc", family_label="RSLC",
        gop_cols=["RSLC TX Strong Republican Supporters", "RSLC TX Soft Republican Supporters"],
        dem_cols=["RSLC TX Strong Democrat Supporters", "RSLC TX Soft Democrat Supporters"],
        flag_true="1", flag_quoted=True,
        turnout_cols=["RSLC TX High Turnout Voters", "RSLC TX Mid Turnout Voters"],
        turnout_quoted=True,
    ),
    "IA": dict(
        mode="flags", table="ia_scores_audiences_20260731",
        family="rga", family_label="RGA",
        gop_cols=["framework_lahn"], dem_cols=["framework_sand"],
        flag_true="1", flag_quoted=False,
        turnout_cols=["turnout_high", "turnout_mid"], turnout_quoted=False,
        all_cols=["turnout_high", "turnout_mid", "turnout_low"],
    ),
    # Oregon carries two models side by side rather than two variants of one: the
    # legislative ballot and the governor ballot are different questions, so they get
    # their own families and appear as separate columns.
    "OR": [
        dict(
            mode="flags", table="or_audience_flags_20200727", regid_col="DT_REGID",
            family="rslcleg", family_label="RSLC Leg",
            gop_cols=["state_leg_ballot_rep_audience"],
            dem_cols=["state_leg_ballot_dem_audience"],
            flag_true="1", flag_quoted=False,
        ),
        dict(
            mode="flags", table="or_audience_flags_20200727", regid_col="DT_REGID",
            family="rslcgov", family_label="RSLC Gov",
            gop_cols=["gov_ballot_drazan_audience"],
            dem_cols=["gov_ballot_kotek_audience"],
            flag_true="1", flag_quoted=False,
        ),
    ],
}

# States configured but deliberately not built. Their existing values are left untouched.
# (IA and OR were both here; each now has a real audience-based source.)
ON_HOLD = set()

# States whose model does not come from SQL at all, so build_national_margins must still
# skip them. Kansas is supplied as a dropped-in workbook (see build_kansas_margins.py).
EXTERNAL_MODELS = {"KS"}

VARIANT_LABEL = {"all": "All", "hm": "H+M"}


# ---------------------------------------------------------------------------
# Fetch: one query per state, covering both chambers and both variants at once.
# ---------------------------------------------------------------------------

def fetch_universe(cur, state, cfg):
    # Models without a turnout bin get only the "All" variant, so there is nothing to
    # group by — a literal NULL in GROUP BY is a SQL Server error.
    has_turnout = bool(cfg.get("turnout_col"))
    turnout = f"m.[{cfg['turnout_col']}]" if has_turnout else "NULL"
    group_extra = f", {turnout}" if has_turnout else ""
    sql = f"""
        SELECT v.StateLegUpperDistrict, v.StateLegLowerDistrict,
               m.[{cfg['univ_col']}] AS u, {turnout} AS tb,
               {f"MIN(m.[{cfg['name_col']}])" if cfg.get('name_col') else "''"} AS nm,
               COUNT(*) AS cnt
        FROM voterfile_2026 v
        JOIN [{cfg['table']}] m ON {JOIN.format(col=cfg.get('regid_col', 'dt_regid'))}
        WHERE v.State = ?
        GROUP BY v.StateLegUpperDistrict, v.StateLegLowerDistrict,
                 m.[{cfg['univ_col']}]{group_extra}
    """
    cur.execute(sql, state)
    return cur.fetchall()


def fetch_flags(cur, state, cfg):
    q = "'1'" if cfg["flag_quoted"] else "1"
    tq = "'1'" if cfg.get("turnout_quoted") else "1"
    gop = " OR ".join(f"m.[{c}] = {q}" for c in cfg["gop_cols"])
    dem = " OR ".join(f"m.[{c}] = {q}" for c in cfg["dem_cols"])

    def flag_expr(cols):
        if not cols:
            return None
        return " OR ".join(f"m.[{c}] = {tq}" for c in cols)

    hm = flag_expr(cfg.get("turnout_cols"))
    # Iowa's "All" is the union of its high/mid/low turnout flags, not every row in the
    # table — 71k rows carry no turnout flag at all and must stay out of the denominator.
    av = flag_expr(cfg.get("all_cols"))

    hm_sel = f"CASE WHEN {hm} THEN 1 ELSE 0 END" if hm else "0"
    av_sel = f"CASE WHEN {av} THEN 1 ELSE 0 END" if av else "1"
    group_extra = "".join(f",\n                 {e}" for e in (hm_sel, av_sel)
                          if e not in ("0", "1"))

    sql = f"""
        SELECT v.StateLegUpperDistrict, v.StateLegLowerDistrict,
               CASE WHEN {gop} THEN 1 ELSE 0 END AS g,
               CASE WHEN {dem} THEN 1 ELSE 0 END AS d,
               {hm_sel} AS tb,
               {av_sel} AS av,
               COUNT(*) AS cnt
        FROM voterfile_2026 v
        JOIN [{cfg['table']}] m ON {JOIN.format(col=cfg.get('regid_col', 'dt_regid'))}
        WHERE v.State = ?
        GROUP BY v.StateLegUpperDistrict, v.StateLegLowerDistrict,
                 CASE WHEN {gop} THEN 1 ELSE 0 END,
                 CASE WHEN {dem} THEN 1 ELSE 0 END{group_extra}
    """
    cur.execute(sql, state)
    return cur.fetchall()


def fetch_score(cur, state, cfg):
    sql = f"""
        SELECT v.StateLegUpperDistrict, v.StateLegLowerDistrict, COUNT(*) AS cnt,
               SUM(CAST(m.[{cfg['rep_col']}] AS float)) AS r,
               SUM(CAST(m.[{cfg['dem_col']}] AS float)) AS d
        FROM voterfile_2026 v
        JOIN [{cfg['table']}] m ON {JOIN.format(col=cfg.get('regid_col', 'dt_regid'))}
        WHERE v.State = ?
        GROUP BY v.StateLegUpperDistrict, v.StateLegLowerDistrict
    """
    cur.execute(sql, state)
    return cur.fetchall()


FETCHERS = {"universe": fetch_universe, "flags": fetch_flags, "score": fetch_score}


# ---------------------------------------------------------------------------
# Aggregate: roll the single result set up per chamber and variant.
# ---------------------------------------------------------------------------

def district_of(row, idx):
    """District number, or None for unassigned voters (NULL or 0)."""
    try:
        d = int(row[idx])
    except (TypeError, ValueError):
        return None
    return d if d > 0 else None


def variant_bins(cfg, variant):
    """Turnout bins a variant counts, or None for 'everything in the table'.

    "All" is not always the whole file: Georgia's All is L+M+H only (its 'A' bin, and the
    residual I/N bins, are excluded), so all_values narrows the denominator.
    """
    key = "hm_values" if variant == "hm" else "all_values"
    vals = cfg.get(key)
    return set(str(v) for v in vals) if vals else None


def agg_universe(rows, chamber, variant, cfg):
    idx = CHAMBER_IDX[chamber]
    allowed = variant_bins(cfg, variant)
    counts, labels = {}, {}
    for row in rows:
        d, u, tb, nm, cnt = district_of(row, idx), row[2], row[3], row[4], row[5]
        if d is None or u is None:
            continue
        if allowed is not None and str(tb) not in allowed:
            continue
        u = int(u)
        counts.setdefault(d, {})[u] = counts.setdefault(d, {}).get(u, 0) + int(cnt)
        nm = (str(nm).strip() if nm else "") or f"Universe {u}"
        labels.setdefault(u, nm)

    out = {}
    for d, c in counts.items():
        total = sum(c.values())
        if not total:
            continue
        segments = [
            {"key": seg_key(labels[u]), "label": labels[u],
             "value": round(100.0 * c.get(u, 0) / total, 1)}
            for u in sorted(labels)
        ]
        gop = sum(100.0 * c.get(u, 0) / total for u in cfg["gop"])
        dem = sum(100.0 * c.get(u, 0) / total for u in cfg["dem"])
        out[d] = (segments, round(gop - dem, 1), total)
    return out


def agg_flags(rows, chamber, variant, cfg):
    # Row layout: 0 upper, 1 lower, 2 gop, 3 dem, 4 hm flag, 5 all flag, 6 count
    idx = CHAMBER_IDX[chamber]
    tally = {}
    for row in rows:
        d, g, dm, tb, av, cnt = (district_of(row, idx), row[2], row[3],
                                 row[4], row[5], row[6])
        if d is None:
            continue
        if variant == "hm" and not tb:
            continue
        if variant == "all" and not av:
            continue
        t = tally.setdefault(d, [0, 0, 0])
        t[0] += int(cnt)
        if g:
            t[1] += int(cnt)
        if dm:
            t[2] += int(cnt)

    out = {}
    for d, (n, g, dm) in tally.items():
        if not n:
            continue
        gp, dp = 100.0 * g / n, 100.0 * dm / n
        segments = [
            {"key": "gop_framework", "label": "GOP Framework", "value": round(gp, 1)},
            {"key": "unaligned", "label": "Unaligned", "value": round(max(0.0, 100 - gp - dp), 1)},
            {"key": "dem_framework", "label": "Dem Framework", "value": round(dp, 1)},
        ]
        out[d] = (segments, round(gp - dp, 1), n)
    return out


def agg_score(rows, chamber, variant, cfg):
    idx = CHAMBER_IDX[chamber]
    tally = {}
    for row in rows:
        d, cnt, r, dm = district_of(row, idx), row[2], row[3], row[4]
        if d is None or r is None or dm is None:
            continue
        t = tally.setdefault(d, [0, 0.0, 0.0])
        t[0] += int(cnt)
        t[1] += float(r)
        t[2] += float(dm)

    out = {}
    for d, (n, r, dm) in tally.items():
        if not n:
            continue
        rp, dp = 100.0 * r / n, 100.0 * dm / n
        segments = [
            {"key": "state_leg_rep", "label": "State Leg R Ballot", "value": round(rp, 1)},
            {"key": "undecided", "label": "Undecided", "value": round(max(0.0, 100 - rp - dp), 1)},
            {"key": "state_leg_dem", "label": "State Leg D Ballot", "value": round(dp, 1)},
        ]
        out[d] = (segments, round(rp - dp, 1), n)
    return out


AGGREGATORS = {"universe": agg_universe, "flags": agg_flags, "score": agg_score}


# ---------------------------------------------------------------------------
# Write back into the chamber JSONs
# ---------------------------------------------------------------------------

def models_for(state):
    """A state's model configs. Most states have one; Oregon has two (Leg and Gov)."""
    cfg = MODELS[state]
    return cfg if isinstance(cfg, list) else [cfg]


def chamber_path(state, chamber):
    return DATA_DIR / f"{FILE_STEM.get(state, state.lower())}_{chamber}.json"


def patch_chamber(state, chamber, cfg, results, dry_run=False):
    path = chamber_path(state, chamber)
    recs = json.loads(path.read_text(encoding="utf-8"))
    family = cfg["family"]
    preserve = set(cfg.get("preserve", []))
    produced = {f"model_{family}_{v}" for v in results}
    drop_prefixes = [f"model_{family}_"] + [f"model_{f}_" for f in cfg.get("drop_families", [])]

    def stale(key):
        return (any(key.startswith(p) for p in drop_prefixes)
                and key not in preserve and key not in produced)

    hits = 0
    for rec in recs:
        try:
            d = int(rec["district_id"])
        except (KeyError, ValueError, TypeError):
            continue

        vm = rec.setdefault("view_margins", {})
        models = rec.setdefault("models", {})
        for key in [k for k in vm if stale(k)]:
            vm.pop(key)
        for key in [k for k in models if stale(k)]:
            models.pop(key)

        matched = False
        for variant, table in results.items():
            if d not in table:
                continue
            segments, margin, _n = table[d]
            view = f"model_{family}_{variant}"
            affinity = {"segments": segments, "margin": margin}
            for s in segments:
                affinity[s["key"]] = s["value"]
            vm[view] = margin
            models[view] = {
                "label": f"{cfg['family_label']} ({VARIANT_LABEL[variant]})",
                "family": cfg["family_label"],
                "variant": VARIANT_LABEL[variant],
                "affinity": affinity,
            }
            matched = True
        if matched:
            hits += 1
        if not models:
            rec.pop("models", None)

    if not dry_run:
        path.write_text(json.dumps(recs, indent=1, ensure_ascii=False), encoding="utf-8")

    sample = sorted(results[list(results)[0]].items())[:3]
    detail = ", ".join(f"{d}:{m:+.1f}" for d, (_s, m, _n) in sample)
    print(f"    {chamber:<7} {hits:>3}/{len(recs):<4} districts   {detail}"
          + ("   (dry run)" if dry_run else ""))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default="ALL", help="Comma list of state abbreviations, or ALL")
    ap.add_argument("--dry-run", action="store_true", help="Compute but do not write files")
    args = ap.parse_args()

    requested = args.states.strip().upper()
    if requested == "ALL":
        states = [s for s in MODELS if s not in ON_HOLD]
    else:
        states = [s.strip().upper() for s in requested.split(",") if s.strip()]
        held = [s for s in states if s in ON_HOLD]
        if held:
            print(f"On hold, skipping: {', '.join(held)}")
        unknown = [s for s in states if s not in MODELS and s not in ON_HOLD]
        if unknown:
            sys.exit(f"No model configured for: {', '.join(unknown)}")
        states = [s for s in states if s in MODELS]

    with connect(load_config()) as conn:
        cur = conn.cursor()
        for state in states:
            for cfg in models_for(state):
                variants = cfg.get("variants") or (
                    ["all", "hm"] if (cfg.get("turnout_col") or cfg.get("turnout_cols"))
                    else ["all"]
                )
                print(f"\n{state}  {cfg['family_label']}  [{cfg['table']}]  "
                      f"variants={','.join(variants)}")
                rows = FETCHERS[cfg["mode"]](cur, state, cfg)
                agg = AGGREGATORS[cfg["mode"]]
                for chamber in ("house", "senate"):
                    if not chamber_path(state, chamber).exists():
                        continue
                    results = {v: agg(rows, chamber, v, cfg) for v in variants}
                    patch_chamber(state, chamber, cfg, results, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
