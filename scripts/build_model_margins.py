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
from district_ids import make_resolver

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
    # Wisconsin and Michigan share the Aug 2026 refresh format: a Framework column
    # ("Rep"/"Pers"/"Dem") alongside the universe ladder. The margin comes from
    # Framework rather than a universe range, because the two tables do NOT number
    # their universes the same way — WI puts "Available Dems" at 7 (Pers), MI at 6
    # (Dem) — so a hardcoded gop/dem range that is right for one is wrong for the
    # other. Framework is nested exactly inside universenumber in both tables
    # (verified: every universe maps to a single Framework value), so the ladder
    # still drives the affinity breakdown.
    "WI": dict(
        mode="universe", table="RSLC_WI_Exchange_20260819",
        family="rslc", family_label="RSLC",
        univ_col="universenumber", name_col="universename",
        framework_col="Framework", framework_gop=["Rep"], framework_dem=["Dem"],
        turnout_col="bin_turnout", all_values=["H", "M", "L"], hm_values=["H", "M"],
        drop_families=["rga"],
    ),
    "MI": dict(
        # Vote Intent is modeled separately and is NOT reproducible from universe
        # counts, so model_rslc_vi is preserved here and built by
        # build_michigan_vi.py from the Vote Intent workbook.
        mode="universe", table="RSLC_MI_R2_Exchange_20260805",
        family="rslc", family_label="RSLC",
        univ_col="universenumber", name_col="universename",
        framework_col="Framework", framework_gop=["Rep"], framework_dem=["Dem"],
        turnout_col="bin_turnout", all_values=["H", "M", "L"], hm_values=["H", "M"],
        preserve=["model_rslc_vi"],
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
    # Alaska's DSP model for the 2026 U.S. Senate race, shared with the ABEV Tracker.
    # Same nine-universe ladder as WI/MI but with a framework column named for the
    # candidates, and turnout as three flag columns rather than a bin. resolve_names
    # is required: AK senate districts are letters ("DISTRICT A" -> "00A"), which the
    # integer district path cannot produce.
    "AK": dict(
        mode="universe", table="ak_scores_audiences_20260721", schema="vs",
        family="rslcak", family_label="RSLC AK",
        univ_col="universenumber", name_col="universename",
        framework_col="framework", framework_gop=["Sullivan"], framework_dem=["Peltola"],
        turnout_cols=["flag_turnout_high", "flag_turnout_mid"],
        all_cols=["flag_turnout_high", "flag_turnout_mid", "flag_turnout_low"],
        turnout_quoted=False,
        resolve_names=True,
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

def table_ref(cfg):
    """Bracketed table name, with a non-dbo schema when the model declares one (AK)."""
    schema = cfg.get("schema")
    return f"[{schema}].[{cfg['table']}]" if schema else f"[{cfg['table']}]"


def flag_or(cols, quoted):
    """`m.[a] = 1 OR m.[b] = 1` for a list of flag columns, or None if there are none."""
    if not cols:
        return None
    lit = "'1'" if quoted else "1"
    return " OR ".join(f"m.[{c}] = {lit}" for c in cols)


def fetch_universe(cur, state, cfg):
    """One row per district x universe x turnout x framework, as dicts.

    Turnout arrives either as a single bin column (`turnout_col`, e.g. bin_turnout) or
    as separate 0/1 flag columns (`turnout_cols` / `all_cols`, which is how the Alaska
    model carries it). Both are reduced here to `tb` (H+M member) and `av` (All member)
    so the aggregator has one shape to read.
    """
    # Models without any turnout split get only the "All" variant, so there is nothing
    # to group by — a literal NULL in GROUP BY is a SQL Server error.
    bin_col = cfg.get("turnout_col")
    tq = cfg.get("turnout_quoted", False)
    hm_expr = flag_or(cfg.get("turnout_cols"), tq)
    av_expr = flag_or(cfg.get("all_cols"), tq)

    if bin_col:
        tb_sel, av_sel = f"m.[{bin_col}]", "NULL"
    else:
        tb_sel = f"CASE WHEN {hm_expr} THEN 1 ELSE 0 END" if hm_expr else "NULL"
        av_sel = f"CASE WHEN {av_expr} THEN 1 ELSE 0 END" if av_expr else "NULL"

    fw_col = cfg.get("framework_col")
    fw_sel = f"m.[{fw_col}]" if fw_col else "NULL"

    # Only real column expressions may appear in GROUP BY; NULL placeholders may not.
    group_extra = "".join(f", {e}" for e in (tb_sel, av_sel, fw_sel) if e != "NULL")

    resolving = bool(cfg.get("resolve_names"))
    name_cols = (""", v.StateLegUpperDistrict_Proper, v.StateLegLowerDistrict_Proper,
               v.StateLegLowerSubDistrict""" if resolving else "")

    sql = f"""
        SELECT v.StateLegUpperDistrict, v.StateLegLowerDistrict{name_cols},
               m.[{cfg['univ_col']}] AS u, {tb_sel} AS tb, {av_sel} AS av,
               {fw_sel} AS fw,
               {f"MIN(m.[{cfg['name_col']}])" if cfg.get('name_col') else "''"} AS nm,
               COUNT(*) AS cnt
        FROM voterfile_2026 v
        JOIN {table_ref(cfg)} m ON {JOIN.format(col=cfg.get('regid_col', 'dt_regid'))}
        WHERE v.State = ?
        GROUP BY v.StateLegUpperDistrict, v.StateLegLowerDistrict{name_cols},
                 m.[{cfg['univ_col']}]{group_extra}
    """
    cur.execute(sql, state)

    out = []
    for r in cur.fetchall():
        i = 5 if resolving else 2
        out.append({
            "upper_n": r[0], "lower_n": r[1],
            "upper_proper": r[2] if resolving else "",
            "lower_proper": r[3] if resolving else "",
            "lower_sub": r[4] if resolving else "",
            "u": r[i], "tb": r[i + 1], "av": r[i + 2],
            "fw": r[i + 3], "nm": r[i + 4], "cnt": r[i + 5],
        })
    return out


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


def resolve_district(row, chamber, resolve):
    """Dict-row district key: an int for the usual zero-padded chambers, or the chamber
    file's own district_id string when the model asked for name resolution (AK senate,
    whose districts are letters the voter file only spells out as "DISTRICT A")."""
    n_key = "upper_n" if chamber == "senate" else "lower_n"
    try:
        n = int(row[n_key])
    except (TypeError, ValueError):
        n = 0
    if resolve is None:
        return n if n > 0 else None
    proper = row["upper_proper"] if chamber == "senate" else row["lower_proper"]
    sub = "" if chamber == "senate" else row["lower_sub"]
    return resolve(n, proper, sub)


def variant_bins(cfg, variant):
    """Turnout bins a variant counts, or None for 'everything in the table'.

    "All" is not always the whole file: Georgia's All is L+M+H only (its 'A' bin, and the
    residual I/N bins, are excluded), so all_values narrows the denominator.
    """
    key = "hm_values" if variant == "hm" else "all_values"
    vals = cfg.get(key)
    return set(str(v) for v in vals) if vals else None


def universe_row_passes(row, variant, cfg):
    """Is this row inside the variant's turnout subset?"""
    if cfg.get("turnout_cols") or cfg.get("all_cols"):
        # Flag-carried turnout: tb marks H+M membership, av marks All membership.
        # A model with no all_cols treats every row as in "All".
        if variant == "hm":
            return bool(row["tb"])
        return bool(row["av"]) if cfg.get("all_cols") else True
    allowed = variant_bins(cfg, variant)
    return allowed is None or str(row["tb"]) in allowed


def agg_universe(rows, chamber, variant, cfg, resolve=None):
    """district -> (segments, margin, n).

    The universe ladder always drives the affinity breakdown. The margin comes from
    the Framework column when the model has one, and from the gop/dem universe ranges
    otherwise — see the WI/MI note in MODELS for why the newer tables need Framework.
    """
    fw_gop = set(cfg.get("framework_gop") or [])
    fw_dem = set(cfg.get("framework_dem") or [])
    use_framework = bool(cfg.get("framework_col"))

    counts, labels = {}, {}
    fw_counts = {}          # district -> {"gop": n, "dem": n}
    univ_frameworks = {}    # universe -> set of framework values seen (consistency check)

    for row in rows:
        d = resolve_district(row, chamber, resolve)
        u = row["u"]
        if d is None or u is None:
            continue
        if not universe_row_passes(row, variant, cfg):
            continue
        u, cnt = int(u), int(row["cnt"])
        counts.setdefault(d, {})[u] = counts.setdefault(d, {}).get(u, 0) + cnt
        nm = (str(row["nm"]).strip() if row["nm"] else "") or f"Universe {u}"
        labels.setdefault(u, nm)

        if use_framework:
            fw = str(row["fw"]).strip() if row["fw"] is not None else ""
            univ_frameworks.setdefault(u, set()).add(fw)
            side = "gop" if fw in fw_gop else "dem" if fw in fw_dem else None
            if side:
                fw_counts.setdefault(d, {"gop": 0, "dem": 0})[side] += cnt

    # The affinity ladder is only a faithful picture of the margin while each universe
    # sits wholly inside one framework. Say so loudly rather than shipping a breakdown
    # that disagrees with the number beside it.
    mixed = sorted(u for u, fws in univ_frameworks.items() if len(fws) > 1)
    if mixed:
        print(f"    WARNING: universes span multiple frameworks: {mixed} "
              f"(margin still taken from {cfg['framework_col']})")

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
        if use_framework:
            f = fw_counts.get(d, {"gop": 0, "dem": 0})
            gop, dem = 100.0 * f["gop"] / total, 100.0 * f["dem"] / total
        else:
            gop = sum(100.0 * c.get(u, 0) / total for u in cfg["gop"])
            dem = sum(100.0 * c.get(u, 0) / total for u in cfg["dem"])
        out[d] = (segments, round(gop - dem, 1), total)
    return out


def agg_flags(rows, chamber, variant, cfg, resolve=None):
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


def agg_score(rows, chamber, variant, cfg, resolve=None):
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


def record_keys(rec):
    """The keys a results table might hold this district under: the raw district_id
    string (name-resolved models, e.g. AK senate "00A") and its integer form (every
    other chamber, whose aggregators key on int)."""
    raw = rec.get("district_id")
    if raw is None:
        return []
    keys = [str(raw)]
    try:
        keys.append(int(raw))
    except (ValueError, TypeError):
        pass
    return keys


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
        keys = record_keys(rec)
        if not keys:
            continue

        vm = rec.setdefault("view_margins", {})
        models = rec.setdefault("models", {})
        for key in [k for k in vm if stale(k)]:
            vm.pop(key)
        for key in [k for k in models if stale(k)]:
            models.pop(key)

        matched = False
        for variant, table in results.items():
            hit = next((k for k in keys if k in table), None)
            if hit is None:
                continue
            segments, margin, _n = table[hit]
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

    sample = sorted(results[list(results)[0]].items(), key=lambda kv: str(kv[0]))[:3]
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
                    path = chamber_path(state, chamber)
                    if not path.exists():
                        continue
                    resolve = None
                    if cfg.get("resolve_names"):
                        recs = json.loads(path.read_text(encoding="utf-8"))
                        resolve = make_resolver(state, chamber, recs)
                    results = {v: agg(rows, chamber, v, cfg, resolve) for v in variants}
                    patch_chamber(state, chamber, cfg, results, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
