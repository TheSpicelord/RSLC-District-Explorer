# RSLC District Explorer

Interactive map and district-level sidebar for all U.S. state legislative chambers. The app combines shapefiles with per-chamber JSON data to show election margins, incumbents/candidates, demographics, chamber composition, and target district workflows.

## Quick Use

1. Run a local server from the repo root:
   - `python -m http.server 8000`
2. Open `http://localhost:8000` in your browser.
3. Select a state, chamber, and election view from the top controls.
4. Click any district (or table row) to open district detail.

## State Chamber JSON Model

Each `data/*_house.json` / `data/*_senate.json` file is an array of district records:

```json
{
  "state_fips": "26",
  "district_id": "001",
  "district_name": "State House District 1",
  "incumbent": { "name": "Jane Doe", "party": "R" },
  "members": [
    {
      "seat": 1,
      "seat_label": "",
      "incumbent": { "name": "Jane Doe", "party": "R" },
      "candidates": { "rep": "Jane Doe", "dem": "John Smith" }
    }
  ],
  "candidate_seats_up": 1,
  "demographics": {
    "population": 100000,
    "rural_pct": 10.0,
    "town_pct": 20.0,
    "suburban_pct": 30.0,
    "urban_pct": 40.0,
    "income_brackets": {
      "lt_50k": 25.0,
      "between_50_100k": 35.0,
      "gt_150k": 15.0,
      "unknown_pct": 25.0
    },
    "college_pct": 20.0,
    "post_grad_pct": 10.0,
    "education_unknown_pct": 15.0,
    "white_pct": 60.0,
    "hispanic_pct": 20.0,
    "black_pct": 10.0,
    "asian_pct": 5.0,
    "other_pct": 5.0
  },
  "elections": [
    { "year": 2022, "dem_pct": 48.0, "rep_pct": 52.0, "winner": "R" },
    { "year": 2024, "dem_pct": 49.0, "rep_pct": 51.0, "winner": "R" }
  ],
  "view_margins": {
    "leg_2022": -4.0,
    "leg_2024": -2.0,
    "latest_leg": -2.0,
    "pres_2024": -1.5,
    "gov_2022": null
  },
  "pres_2024_margin": -1.5,
  "gov_2022_margin": null,
  "top_ticket_totals": {
    "pres_2024": 75000,
    "gov_2022": 0
  },
  "candidates_2026": { "rep": "Jane Doe", "dem": "John Smith" }
}
```

Notes:
- `members` is the authoritative seat-level structure for incumbents/candidates.
- `incumbent` and `candidates_2026` are retained as legacy single-seat shortcuts.
- `candidate_seats_up` controls how many seat lines are shown for 2026 candidate display in seat-numbered chambers.
- `null` margins mean no election data for that view.

## Chamber Exceptions

- `NE House`: no lower chamber file (Nebraska is unicameral). App prompts users to switch to Senate.
- `AZ House`, `NJ House`, `ND House`, `SD House`: multi-member districts (typically 2 members per district).
- `ID House`, `WA House`: 2 members per district with explicit `Seat 1` / `Seat 2` labels.
- `WV Senate`: 2-seat districts with staggered terms; only one seat is up per cycle (`candidate_seats_up: 1`).
- `MD House`, `VT House`, `VT Senate`: variable-member districts (districts may have different seat counts).
- `NH House`: highly variable-member districts (up to 10 members) plus floterial seats; composition totals come from chamber data, not shapefile feature counts alone.
- `ND House` district `4A/4B` and `SD House` districts `26A/26B`, `28A/28B`: split single-member subdistricts handled as one seat each.
