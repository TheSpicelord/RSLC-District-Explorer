# State Legislative District Map

## Project Structure

- `index.html` - app UI
- `style.css` - page + map styling
- `app.js` - map logic, shapefile loading, data joins, popups
- `data/mock_michigan_house.json` - fake House records
- `data/mock_michigan_senate.json` - fake Senate records

## Data Format Expected

Each record in data files should look like this:

```json
{
  "state_fips": "26",
  "district_id": "001",
  "district_name": "House 1",
  "incumbent": { "name": "Alex Doe", "party": "D" },
  "candidates_2026": { "rep": "Casey Roe", "dem": "Taylor Poe" },
  "view_margins": {
    "latest_leg": -2.4,
    "leg_2022": -1.1,
    "leg_2023": -2.0,
    "leg_2024": -2.7,
    "leg_2025": -1.8,
    "pres_2024": -3.4
  },
  "demographics": {
    "population": 92000,
    "rural_pct": 12.4,
    "town_pct": 14.1,
    "suburban_pct": 41.3,
    "urban_pct": 32.2,
    "income_brackets": {
      "lt_50k": 29.8,
      "between_50_100k": 44.6,
      "gt_150k": 12.9
    },
    "college_pct": 28.1,
    "white_pct": 58.4,
    "black_pct": 21.2,
    "hispanic_pct": 12.5,
    "asian_pct": 4.1
  },
  "elections": [
    { "year": 2022, "dem_pct": 49.8, "rep_pct": 50.2, "winner": "R" },
    { "year": 2024, "dem_pct": 52.0, "rep_pct": 48.0, "winner": "D" }
  ]
}
```

