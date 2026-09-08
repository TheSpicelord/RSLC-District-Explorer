# RSLC District Explorer

Interactive web app for exploring U.S. state legislative districts — built for RSLC (Republican State Leadership Committee) political research and campaign strategy.

## Running & Deployment

- **No build step** — pure ES6 modules, serve directly from any static host
- Open `index.html` in a browser or serve via a local HTTP server (required for module loading)
- Cache busting: `?v=BUILD_VERSION` in **three** places, all of which must be bumped together — `index.html`'s CSS/JS tags, the `BUILD_VERSION` constant in `app.js`, and **`app.js`'s own `./modules/*.js` import specifiers**
  - **The module specifiers are the easy one to forget, and forgetting it is fatal, not cosmetic.**
    `index.html` busts `app.js`, but a bare `import ... from "./modules/config.js"` is a
    *separate* URL with no version on it, so the browser happily pairs a fresh `app.js`
    with a cached `modules/*.js`. If that release added a new export, the import fails,
    `app.js` never parses, and its imports are never even fetched — the page renders
    blank, with no partial degradation to hint at what happened. That is exactly what
    `STATE_DATA_NOTES` did on 2026-09-08: the request log showed `index.html`, `style.css`,
    `app.js`, and then nothing at all.
  - Diagnosis is quick: if the server log stops after `app.js` and never requests
    `modules/config.js`, it is this. A hard refresh clears it locally, but shipping the
    fix requires a **version bump**, because the broken `app.js` is itself cached under
    the old version and would otherwise keep being served.

- Hosted on GitHub Pages (see `CNAME`)

## Data Pipeline

Source data lives in `data/State Legislative Election History.xlsx`. To regenerate chamber JSON files:

```bash
# Regenerate all states
python scripts/generate_chamber_jsons.py --states ALL

# Regenerate specific states
python scripts/generate_chamber_jsons.py --states TX,FL,GA

# Validate output
python scripts/validate_chamber_jsons.py
```

The generator and validator use only built-in libraries. The model builders need
`pyodbc` (SQL Server) and `openpyxl` (workbook-sourced models).

**`--states` regenerates only those files, and wipes their model margins** — the
generator rebuilds a chamber from the workbook, which has no modeling in it. Always
follow a partial regeneration with whichever model builder owns those states (for a
fallback state, `build_national_margins.py --states NC`), or they silently lose their
`model_*` view margins. Re-running the national builder moves a few districts by 0.1-0.2
at the rounding boundary; that is noise, not a real shift.

### Retired district lines (`LEG_REDISTRICTED`)

`LEG_REDISTRICTED` in `generate_chamber_jsons.py` drops a state/year pair of

**`LEG_REDISTRICTED` is all-or-nothing per year, so it is the wrong tool for a PARTIAL redraw.** Michigan is the cautionary case: an `"MI": {2022}` entry on 2026-09-05 blanked `leg_2022` for all 110 house and 38 senate districts, including the 96 and 24 the *Agee v. Benson* remedy never touched. Michigan is deliberately absent from the list now - the workbook itself carries `leg_2022` only for the seats that survived, which is more precise than this mechanism can be. Before adding a state here, check whether the redraw actually reached every district; if it did not, let the workbook's own per-district coverage do the work and mirror it in the ABEV Tracker's `HISTORY_STALE_DISTRICTS`.
**legislative** results — both the `leg_<year>` margin and that year's entry in
`elections`, so it also stays out of `latest_leg`.

The distinction that matters: a *statewide* race can be re-aggregated onto any map from
precinct results, so `gov_2022` / `ussen_2022` / `pres_2024` survive a redraw and are
kept. A *legislative* race cannot — those candidates ran in districts that no longer
exist, so the number would be attached to a district number that now means something
else entirely.

Currently `NC: {2022}` (2022 ran on the SL 2022-2 / SL 2022-4 interim maps, replaced
2023-10-25 by SL 2023-146 / SL 2023-149 — the lines used in 2024 and again in 2026),
`MT: {2022}` (Montana's commission did not adopt its post-2020-census maps until
2023-02-22, too late for that cycle, so 2022 ran on the old 2013 districts and 2024 was
the first vote on the current lines — note the district *numbers* are identical either
way, 100 house / 50 senate, so a stale 2022 row looks perfectly normal), and `WI: {2022}`
as a no-op guard, since the workbook happens to carry no 2022 WI legislative data today.

Dropping a year can leave a district with **no** legislative margin at all where terms are
staggered: Montana's senate elects half its seats each cycle, so removing 2022 left the 25
districts last up that year with neither `leg_2022` nor `leg_2024`, and no `latest_leg`.
That is correct — their only result belongs to a different map — and it is what the
generator's "N rows with no latest legislative margin" warning is reporting. WI senate (17
rows) and Michigan senate (14) are the same situation. A state left with a single leg year renders that year as an explicit N/A
column plus a footnote in the ABEV Tracker, driven by its `LEG_REDISTRICTING_NOTES` entry
in that project's `modules/config.js` — **keep the two in sync**, or the dropped year
just quietly disappears with no explanation on screen.

## Model Margins

Modeling numbers are **not** in the election workbook — they are built straight into the
chamber JSONs by three scripts, all of which must run **after**
`generate_chamber_jsons.py` (it rebuilds chamber files from the workbook and drops
anything they wrote).

```bash
python scripts/build_model_margins.py --states ALL   # dedicated state models (SQL, VPN)
python scripts/build_national_margins.py             # DR Natl fallback for the rest
python scripts/build_michigan_vi.py                  # MI Vote Intent (workbook)
```

**A partial regeneration needs the same full set, not just `build_model_margins.py`.**
`generate_chamber_jsons.py --states MI` drops *every* `model_*` key for that state and
refills it from the election workbook's modeling sheet, which carries stale hand-copied
numbers. Re-running only `build_model_margins.py` restores `model_rslc_all` /
`model_rslc_hm` and leaves the workbook's stale value sitting in `model_rslc_vi`, which
looks plausible and is wrong - this happened on 2026-09-05 and shifted all 148 MI
districts (HD 001 read -57.0 against the correct -61.3) until `build_michigan_vi.py` was
run. **Michigan needs `build_michigan_vi.py` and Kansas needs `build_kansas_margins.py`
every time either is regenerated.** The source of truth for MI Vote Intent is
`data/Michigan Vote Intent District Margins.xlsx`, sheet `VoteIntent2026`, column
`netframework` (GOP minus Dem as a fraction, scaled to points); it is modelled separately
and is NOT reproducible from the universe counts in the exchange table. To verify a
regeneration, diff `model_rslc_vi` against that sheet rather than eyeballing samples.

Every model stores **GOP minus Dem** as a share of all modeled voters in the district;
`app.js` negates the families listed in `MODEL_GOP_POSITIVE_PREFIXES` on display to reach
the Dem-positive convention used everywhere else. **Adding a family without adding it to
that list silently inverts its sign.** A new family also needs a `MODEL_VIEW_META` entry
(column header + ordering) and, if its ladder is not 3 or 9 buckets,
`MODEL_SEGMENT_COLOR_CLASSES`.

Dedicated models live in `MODELS` in `build_model_margins.py`, in three modes:

| Mode | Margin from | Used by |
|---|---|---|
| `universe` | universe ranges (`gop=[..]`, `dem=[..]`) — or `framework_col` when set | NV, PA, AZ, GA, **KS**, **WI**, **MI**, NJ, **AK**, **IA** |
| `flags` | 0/1 audience columns | VA, TX, OR |
| `score` | continuous support scores | (none currently) |

- **Bucket ranges are per-model, not conventional.** Most run 1–2 rep / 6–7 dem, but GA
  and **IA** run to 9 universes (Dem base 8–9) and NJ/MI use three-deep bases (1–3 / 7–9).
  **KS is the one asymmetric ladder**: 1–2 GOP against 7–9 Dem, as specified by the model's
  owner. Universe 7 "Available Democrats" counts as Dem while its mirror, universe 3
  "Trump 2024 Overperform", counts as neither — worth roughly 1.6 points of margin toward
  the Dem side against a symmetric split. Deliberate, not a typo; see the IA note above for
  the version of this that *was* a bug.
- **IA moved from `flags` to `universe` on 2026-09-05** with the `_V2` refresh
  (`vs.IA_scores_audiences_20260731_V2`), and from the `rga` family to `rslc`. V1 was a
  persuasion subset — 354,382 rows to V2's 2,148,056, one per `dt_regid`, against roughly
  2.2M registered Iowans. **Do not bucket IA on its `framework_*` flags** even though V2
  still carries them beside the ladder: they are asymmetric, `framework_lahn` covering
  universe 1 alone (Lahn Base) while `framework_sand` spans 7–9, so they drop universe 2
  "Republican Targets" (262,135 voters) into persuasion while keeping the mirror-image Dem
  universe. On the 2024 absentee feed that is worth 7.9 points of margin. The ladder's
  names mirror cleanly (1 Lahn Base / 2 Republican Targets … 8 Democrat Targets / 9 Sand
  Base), so IA takes GA's 1–2 / 8–9 split. `drop_families=["rga"]` clears the stale V1
  `model_rga_*` keys. Shared with the ABEV Tracker's `STATE_MODELS["IA"]`.
- **`framework_col` beats a universe range.** The Aug 2026 WI/MI refreshes and the AK
  model carry an explicit framework column beside the ladder. WI and MI do *not* number
  their universes the same way — "Available Dems" is 7 (Pers) in WI, 6 (Dem) in MI — so a
  range right for one mis-buckets the other. The ladder still drives the affinity
  breakdown; the aggregator warns if a universe ever spans two frameworks.
- **Turnout variants** come either from a bin column (`turnout_col`, with `all_values` /
  `hm_values`) or from flag columns (`turnout_cols` / `all_cols`). "All" is rarely the
  whole table: GA and WI/MI use H/M/L only, and IA/AK exclude rows carrying no turnout
  flag at all.
- **`resolve_names`** routes a state through the shared resolver in `district_ids.py`
  instead of the integer district path. Alaska needs it: its senate districts are letters
  the voter file only spells out ("DISTRICT A" → `00A`).
- **`EXTERNAL_MODELS`** and `ON_HOLD` are both treated as "has a dedicated model" by
  `build_national_margins.py`, so the fallback never overwrites them. Omitting a state
  there is how it silently inherits national numbers. `EXTERNAL_MODELS` is **empty** since
  2026-09-08 — Kansas was its only member — but the mechanism stays, because it is the
  only thing standing between a workbook-sourced state and the national fallback.

### Kansas moved from workbook to SQL (2026-09-08)

`build_kansas_margins.py` is **deleted** and `data/Kansas Model.xlsx` is out of the
pipeline; KS is now a normal `MODELS` entry reading `RAGA_KS_Exchange_20260708`. Same
9-universe RAGA ladder, same `model_raga_all` / `model_raga_hm` view keys, same two
variants — so nothing in `app.js` changed.

**The numbers moved, and by a lot.** The SQL model runs about **10 points more Republican**
than the workbook did (house mean +10.1 "All" / +10.6 "H+M"; senate +10.2 / +10.5; range
−2.8 to +22.3). It is not a reformatting of the same cut: no `bin_turnout` subset
reproduces the workbook, and neither does weighting by `turnout2026score` (the gap only
narrows to ~8). District *ranking* is nearly identical (r = 0.99) — only the level differs,
so these are two vintages of one model. The builder was deleted rather than left in place
because re-running it would silently walk every Kansas district back ~10 points.
- **`NATIONAL_EXCLUDE`** = AK, HI: the national audiences carry a ~47 point systematic
  bias in states with unusual party registration, so the number is left blank rather than
  shown. AK now has a dedicated model, so this is only a second guard for it.

## Architecture

```
index.html          # Entry point
app.js              # Main logic (~5000 lines) — all map/UI behavior
style.css           # All styles — CSS variables for theming
modules/
  config.js         # Constants: URLs, state abbreviations, zoom levels
  dom.js            # DOM element references
  state.js          # Global state object (single source of truth)
data/
  [state]_[house|senate].json   # Per-chamber district records (~102 files)
  chamber_files.json            # Index of all chamber files
  target_districts.json         # Strategic target district tiers
  shapes/                       # ZIP shapefiles (Leaflet/shpjs)
scripts/
  generate_chamber_jsons.py     # Excel → JSON (run first; drops model data)
  validate_chamber_jsons.py     # Validation
  db.py                         # SQL Server connection helper (VPN required)
  db_probe.py                   # Connection test / table + column listing
  district_ids.py               # Voter-file district → chamber district_id resolver
  build_model_margins.py        # Dedicated state models from SQL
  build_national_margins.py     # DR Natl fallback for states without one
  build_michigan_vi.py          # MI Vote Intent from workbook
  build_kansas_margins.py       # KS from workbook
```

## Key Concepts

**Join Keys** — districts identified throughout as `"${stateFips}|${districtId}"` (e.g., `"26|001"`). Used to index records and match GeoJSON features to data. Don't change this format.

**State Object** — all UI/app state lives in `modules/state.js`. Mutate directly; call relevant render functions after. No framework — just vanilla JS.

**Margins** — stored as DEM_MARGIN (positive = D advantage, negative = R advantage). Some model views (RSLC, RGA) store negated values and flip on display.

**Render Tokens** — async operations use tokens (e.g., `state.detailsRenderToken`) to cancel stale renders. Increment token before async work, check on completion.

## Shapefiles

`data/shapes/senate.zip` is **not** a stock Census file. It is
`cb_2024_us_sldu_500k` with Michigan's 38 districts replaced by the **Crane A1**
remedial plan - the map the MICRC adopted 2024-06-26 and the federal court
approved 2024-07-26 in *Agee v. Benson*, first used in the **2026** election.

Census cannot supply this yet. Its SLDU files are keyed to the legislative
session in effect (`LSY`), and Michigan senators elected in 2022 sit through
2026 under the old *Linden* map, so `cb_2024`, `cb_2025` and `tl_2025` all still
carry Linden. Crane A1 should appear in the 2027-session vintage.

Michigan geometry comes from the state's own Michigan Geographic Framework
layer, `Remedial_State_Senate_2021` (ArcGIS org `dxRQUfTDNtfqZ301`, owner
`michigan_admin`), pulled in NAD83 to match the Census `.prj` and simplified
with `mapshaper -simplify 8% keep-shapes` to ~20.4k vertices - the Census 500k
level (20.6k). Simplification is topology-aware, so shared borders stay
coincident: the 38 districts still tile with zero overlap.

Every non-Michigan feature is byte-identical to the Census original, and all
attributes are untouched, so `GEOID`/`SLDUST`/`NAMELSAD` joins are unaffected -
district *numbers* did not change, only boundaries. `ALAND`/`AWATER` are now
stale for Michigan; nothing reads them.

Rebuild only matters if the underlying Census file is refreshed - re-splice
rather than dropping in a new `cb_*` wholesale, or Michigan silently reverts to
Linden. To confirm which map a file holds: Crane A1 differs from Linden in
exactly 14 districts (1, 2, 3, 5-11, 13, 23, 24, 38); the other 24 are identical.

## Special Cases to Know

| Case | Behavior |
|---|---|
| **Nebraska** | Unicameral — only Senate exists; code guards `if (chamber === "house" && stateAbbr === "NE")` |
| **NH Floterial seats** | Separate shapefile (`nh_house_floterial.zip`), special rendering logic |
| **Multi-member districts** | AZ, NJ, ND, SD (2 members); ID, WA, WV (explicit seat labels) |
| **Variable-member** | MD, VT, NH House — up to 10 members per district |

## Chamber JSON Record Shape

```json
{
  "state_fips": "26",
  "district_id": "001",
  "members": [
    {
      "seat": 1,
      "seat_label": "",
      "incumbent": { "name": "...", "party": "R" },
      "candidates": { "rep": "...", "dem": "..." }
    }
  ],
  "next_election": 2026,
  "demographics": { "population": 0, "rural_pct": 0, ... },
  "elections": [{ "year": 2024, "dem_pct": 0, "rep_pct": 0, "winner": "R" }],
  "view_margins": {
    "leg_2022": 0, "leg_2024": 0, "latest_leg": 0,
    "pres_2024": 0, "gov_2022": 0,
    "model_hrcc_hm": 0, "model_rslc_all": 0
  }
}
```

## Map Layers (Leaflet Panes)

Multiple panes with explicit z-indexes handle layering:
- States outline → Districts fill → Counties overlay → Labels → Hover/Selection overlays

## Libraries (CDN, no npm)

- **Leaflet.js** v1.9.4 — mapping
- **shpjs** — shapefile ZIP parsing
- **XLSX** v0.18.5 — Excel parsing (loaded on demand for data generation)
- CartoDB dark basemap tiles
