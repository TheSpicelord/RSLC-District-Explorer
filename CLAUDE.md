# RSLC District Explorer

Interactive web app for exploring U.S. state legislative districts — built for RSLC (Republican State Leadership Committee) political research and campaign strategy.

## Running & Deployment

- **No build step** — pure ES6 modules, serve directly from any static host
- Open `index.html` in a browser or serve via a local HTTP server (required for module loading)
- Cache busting: HTML uses `?v=BUILD_VERSION` query params on JS/CSS imports — bump when deploying
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

## Model Margins

Modeling numbers are **not** in the election workbook — they are built straight into the
chamber JSONs by three scripts, all of which must run **after**
`generate_chamber_jsons.py` (it rebuilds chamber files from the workbook and drops
anything they wrote).

```bash
python scripts/build_model_margins.py --states ALL   # dedicated state models (SQL, VPN)
python scripts/build_national_margins.py             # DR Natl fallback for the rest
python scripts/build_michigan_vi.py                  # MI Vote Intent (workbook)
python scripts/build_kansas_margins.py               # KS (workbook)
```

Every model stores **GOP minus Dem** as a share of all modeled voters in the district;
`app.js` negates the families listed in `MODEL_GOP_POSITIVE_PREFIXES` on display to reach
the Dem-positive convention used everywhere else. **Adding a family without adding it to
that list silently inverts its sign.** A new family also needs a `MODEL_VIEW_META` entry
(column header + ordering) and, if its ladder is not 3 or 9 buckets,
`MODEL_SEGMENT_COLOR_CLASSES`.

Dedicated models live in `MODELS` in `build_model_margins.py`, in three modes:

| Mode | Margin from | Used by |
|---|---|---|
| `universe` | universe ranges (`gop=[..]`, `dem=[..]`) — or `framework_col` when set | NV, PA, AZ, GA, **WI**, **MI**, NJ, **AK** |
| `flags` | 0/1 audience columns | VA, TX, IA, OR |
| `score` | continuous support scores | (none currently) |

- **Bucket ranges are per-model, not conventional.** Most run 1–2 rep / 6–7 dem, but GA
  runs to 9 universes (Dem base 8–9) and NJ/MI use three-deep bases (1–3 / 7–9).
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
- **`EXTERNAL_MODELS`** (Kansas) and `ON_HOLD` are both treated as "has a dedicated
  model" by `build_national_margins.py`, so the fallback never overwrites them. Omitting a
  state there is how it silently inherits national numbers.
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
