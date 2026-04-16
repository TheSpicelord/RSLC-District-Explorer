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

Python scripts use only built-in libraries — no pip installs needed.

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
  generate_chamber_jsons.py     # Excel → JSON
  validate_chamber_jsons.py     # Validation
```

## Key Concepts

**Join Keys** — districts identified throughout as `"${stateFips}|${districtId}"` (e.g., `"26|001"`). Used to index records and match GeoJSON features to data. Don't change this format.

**State Object** — all UI/app state lives in `modules/state.js`. Mutate directly; call relevant render functions after. No framework — just vanilla JS.

**Margins** — stored as DEM_MARGIN (positive = D advantage, negative = R advantage). Some model views (RSLC, RGA) store negated values and flip on display.

**Render Tokens** — async operations use tokens (e.g., `state.detailsRenderToken`) to cancel stale renders. Increment token before async work, check on completion.

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
