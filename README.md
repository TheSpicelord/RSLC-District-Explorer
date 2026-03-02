# State Legislative District Map Starter

This starter app gives you:
- An interactive map for district boundaries
- A `House` / `Senate` chamber switch
- Popups for incumbent, demographics, and election history
- Mock Michigan test data so you can develop before loading real data
- Automatic shapefile loading from local project files

## What This Version Does

- Auto-loads shapefiles from:
  - `data/shapes/house.zip`
  - `data/shapes/senate.zip`
- Optional county overlay from:
  - `data/shapes/counties.zip`
- Lets you switch between House and Senate layers
- Joins each district feature to data by `State FIPS + chamber district code`
  - House district field is auto-read from `SLDLST`
  - Senate district field is auto-read from `SLDUST`
- Supports alphanumeric district codes (for states that use lettered districts)
- Map View options:
  - Latest State Leg Margin
  - 2022 State Leg Elections
  - 2023 State Leg Elections
  - 2024 State Leg Election
  - 2025 State Leg Election
  - 2024 Presidential Election

## Project Structure

- `index.html` - app UI
- `style.css` - page + map styling
- `app.js` - map logic, shapefile loading, data joins, popups
- `data/mock_michigan_house.json` - fake House records
- `data/mock_michigan_senate.json` - fake Senate records

## Run Locally

Because browsers block `fetch()` from local files, run a tiny local server in this folder.

### Option A (Python, usually easiest)

```powershell
python -m http.server 8000
```

Then open: `http://localhost:8000`

### Option B (VS Code Live Server extension)

Right-click `index.html` and choose "Open with Live Server".

## How To Use

1. Put your nationwide House ZIP at `data/shapes/house.zip`.
2. Put your nationwide Senate ZIP at `data/shapes/senate.zip`.
3. Optional: put county ZIP at `data/shapes/counties.zip`.
4. Refresh the app.
5. Use `Switch Chamber` and `Map View`.
6. Turn on `County Overlay` when needed.

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


## GitHub Basics (Beginner Workflow)

1. Create a GitHub repository (empty repo, no files).
2. In this folder:

```powershell
git init
git add .
git commit -m "Initial map prototype"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

3. Every time you make progress:

```powershell
git add .
git commit -m "Describe what changed"
git push
```

## Sharing with Other Computers

Short-term (prototype):
- Push to GitHub.
- Others clone and run a local server.

Production path:
- Frontend: host on GitHub Pages, Netlify, or Vercel.
- Data/API: move data to a shared database + API service (later step).
- Keep a stable district ID key so map shapes always join to data correctly.

## Next Build Steps

- Add charts in side panel (vote trend, demographic bars)
- Add filters (year, party, competitiveness)
- Add statewide model outputs (probability, expected margin)
- Add district search and click-to-zoom list
