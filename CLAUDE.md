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

**A candidate-only edit no longer needs the model builders (changed 2026-09-16).**
`generate_chamber_jsons.py` now reads the chamber JSON already on disk and puts its
`model_*` margins and `models` block back after rebuilding from the workbook, so the
normal loop is just *edit workbook → regenerate → done*. It reports `models-preserved=N`
per file, and warns if any district has no preserved data (a genuinely new district, which
does need a builder run).

Preservation **replaces** rather than merges, which matters: the workbook's Modeling sheet
still supplies its own stale `model_*` values, and a state whose family has changed (PA
moved `hrcc` → `rslc`) would otherwise end up carrying both, the dead family looking every
bit as real as the live one.

Pass **`--models-from-workbook`** to get the old behaviour — take the Modeling sheet's
numbers and drop what is on disk. That is a deliberate reset, not a routine option: those
numbers are hand-copied and usually months stale.

You still need the builders when the *modelling itself* should change — a refreshed vendor
table, a new model family, a new district. Re-running the national builder moves a few
districts by 0.1-0.2 at the rounding boundary; that is noise, not a real shift.

All three writers now emit `indent=1, ensure_ascii=False` plus a trailing newline. Before
they agreed, the generator's `indent=2` reformatted every line, so a one-candidate edit
produced a 38,000-line diff that buried the actual change.

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

## Polling

`data/polling.json` feeds the district detail panel's Polling section (left half of the
split row; districts without an entry show "No polling data."). It is built by
`scripts/build_polling_json.py` from `data/2025-26 Polling Tracker.xlsx` — an internal
workbook that is **deliberately untracked** (like `scripts/db_config.ini`): only the
published MI toplines in polling.json go to the public repo, not the full multi-state
tracker. Keys are the app's join keys (`"26|044"`) under `house` / `senate`; each district
holds a list of poll entries (ballot toplines R/D/L/U, candidate/Trump images, top issue).
Margin-only mentions that live outside the tracker's table (the SRCC SD-35 note) are kept
in the script's `EXTRA_ENTRIES` by hand. Currently MI only — 14 tier-1 battlegrounds
polled Aug 2026 plus the SD-35 note; add a per-tab builder to the script for new states.

Both panel tables borrow `.target-table`'s chrome and the overview margin cells, so the
ballot margins use the shared `marginColor` scale (R-positive, saturating at ±10) and read
identically to a chamber overview row. **Image margins deliberately do NOT**: a red image
bar would collide with Republican red, so `pollingImageMarginColor` runs green-to-maroon
over ±20 instead. Toplines are rounded to whole numbers and only margins keep a decimal.
A polled district also widens the left half of the split row (`.split-two-col-polling`),
because the tables overflow the divider at the default 50/50.

### Michigan 2026 candidates (post-primary)

The workbook's MI candidate columns (SLDL/SLDU `BT`/`BU`) were filled 2026-09-11 with the
certified general-election field from the Aug 4 primary — Ballotpedia lists cross-checked
against the polling tracker's battleground names (all 14 agreed). All 148 districts are
R-vs-D contested. Incumbent nominees are written with the incumbent column's exact string
(`BS`), because the asterisk in the app's candidate display comes from a case-insensitive
**exact** name match between the two columns — 102 districts carry it. SD-35's incumbent
was updated from "Vacant" to Chedrick Greene (D), who won the May 2026 special.

### Per-district notes (`DISTRICT_NOTES`)

`DISTRICT_NOTES` in `modules/config.js` maps a join key (`"42|002"`) to a one-sentence
footnote, rendered by `districtNoteHtml()` as a circled **i** beneath the 2026 candidate
rows. It exists for the case where a candidate list is *accurate but misleading on its
face*. The founding example is **PA HD-2**: Robert Merski, the Democratic incumbent, also
won the **Republican** nomination on write-in votes. Listing him in both columns read as a
two-party field and suppressed his incumbent asterisk on the R side (the asterisk test is
`incumbent.party === party`), so the GOP column is deliberately left empty and the note
carries the explanation. Keep notes to one sentence.

### Committed model margins can go STALE, not just missing

The documented risk of a partial regeneration is *losing* model data. The mirror case bit
on 2026-09-16: **Texas's committed margins were years-stale and materially wrong**, because
nothing re-runs a builder when the vendor table changes underneath. `tx_house.json` had not
been rebuilt since `36a50c5`, so rebuilding moved **84 house and 22 senate districts** -
HD-98 from GOP+7.7 to GOP+30.0 in a seat Trump carried by 26.1 and the 2024 leg race by
31.4, and HD-129 from GOP**-**4.3 (i.e. reading Dem-leaning) to GOP+5.6 in a seat Trump won
by 17.7. The new numbers are the correct ones; the old ones had been on the site for months.
Diffing a rebuild against a pre-regeneration snapshot is what caught it, so **take that
snapshot before any regeneration and check the tail, not just the count** - GA drifted 11
districts by at most 0.40 (ordinary rounding) while TX's median was a similar 0.65 but with
a 22-point maximum. A periodic `build_model_margins.py --states ALL` would catch the rest.

### Candidate name spelling is load-bearing

The app's incumbent asterisk comes from a **case-insensitive exact string match** between
the workbook's Incumbent column (`BS`) and its candidate columns (`BT`/`BU`) - see
`memberIsIncumbentNominee()`. A spelling variant silently demotes a sitting member to
"challenger". When importing a certified candidate list, write the **workbook's** incumbent
spelling rather than the ballot name wherever they denote the same person. The 2026-09-15
MN/WI/PA import found four live cases already in the file (PA HD-15 Josh/Joshua Kail, HD-53
Steve/Steven Malagari, HD-55 Jill N./Jill Cooper, HD-86 Perry A./Perry Stambaugh) and would
have introduced three more from ballot names (PA HD-127 Manuel vs Manny Guzman Jr., HD-160
Craig vs Wendell Craig Williams, MN SD-39 Mary Kunesh vs Mary Kunesh-Podein). Audit after
any import by re-deriving the match rather than spot-checking.

A third class beyond spelling: **the workbook's incumbent itself goes stale.** The
2026-09-16 six-state import found four, each verified against the *chamber's own roster*
rather than Ballotpedia - NC HD-119 (Clampitt deceased 3/18/26, Ferguson appointed 4/16/26),
NC SD-18 (Everitt resigned, Fatmi appointed), NC SD-23 (Meyer resigned, Garson appointed)
and SC HD-57 (Lucas Atkinson switched D->R, per scstatehouse.gov). Ballotpedia signals these
by marking the *new* person `(i)` while listing the old one under "Did not make the ballot".
Left alone, three sitting members and a party-switcher would all have rendered as
challengers. `INCUMBENT_UPDATES` in the import script records each with its reason.

**Two Ballotpedia parsing traps**, both of which produce plausible-looking wrong nominees:
*write-ins* are marked `(Write-in)` inside the candidate span and must be dropped (WI SD-27
and PA HD-11 each had one that would otherwise have become the nominee), and *"Did not make
the ballot"* names sit in a sibling `<div>`, not a `<span class="candidate">` - but that
phrase also appears in the **primary** table lower down the page, so scope any check to the
general-election table or legitimate nominees get falsely flagged. A third: the heading is
inconsistent across pages - some read "general election 2026", others "general election,
2026" - so match both or four states silently parse as zero districts. Lettered districts
(MN house 1A/1B) need `([0-9]+[A-Z]?)`, not `(\d+)`.

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

**This USED to be the main footgun and is now handled**: `generate_chamber_jsons.py
--states MI` once dropped every `model_*` key and refilled it from the workbook's stale
modeling sheet, so re-running only `build_model_margins.py` restored `model_rslc_all` /
`model_rslc_hm` while leaving a stale `model_rslc_vi` behind - plausible-looking and wrong.
That shifted all 148 MI districts on 2026-09-05 (HD 001 read -57.0 against the correct
-61.3). The generator now preserves what is on disk, so a regeneration keeps all three MI
families intact; verified by regenerating MI/PA/TX/MN/NH and diffing every `model_*` value
bit-for-bit. Run the builders when the modelling should actually change. **Michigan needs `build_michigan_vi.py` and Kansas needs `build_kansas_margins.py`
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
| `universe` | universe ranges (`gop=[..]`, `dem=[..]`) — or `framework_col` when set | NV, PA, AZ, GA, **KS**, **WI**, **MI**, NJ, **AK**, **IA**, **MN** |
| `flags` | 0/1 audience columns | VA, TX, OR, **NH** |
| `score` | continuous support scores | (none currently) |

- **Bucket ranges are per-model, not conventional.** Most run 1–2 rep / 6–7 dem, but GA
  and **IA** run to 9 universes (Dem base 8–9) and NJ/MI use three-deep bases (1–3 / 7–9).
  **KS and NV are asymmetric ladders**: both run a two-deep GOP base against a three-deep
  Dem base (KS 1–2 / 7–9, NV 1–2 / 6–8), as specified by each model's owner. In KS,
  universe 7 "Available Democrats" counts as Dem while its mirror, universe 3
  "Trump 2024 Overperform", counts as neither — worth roughly 1.6 points of margin toward
  the Dem side against a symmetric split. NV's R2 ladder does the same with its own
  universe 3, "Trump/Vance Voters". Deliberate, not a typo; see the IA note above for
  the version of this that *was* a bug.
  - **This is the easiest thing to get wrong on these two**, and it is silent: folding
    universe 3 into the GOP base looks like tidying up an off-by-one and produces perfectly
    plausible numbers. It was caught on NV on 2026-09-19 *before* the values shipped —
    re-deriving HD-1 straight from SQL gave −4.8 against the −0.9 the wrong split
    produced, a 2–4 point GOP overstatement across every district. Verify a new asymmetric
    ladder by recomputing one district outside the builder, not by eyeballing the config.
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
- **MN and NV, added 2026-09-19.** Minnesota gets its **first dedicated model**
  (`MN_Exchange_20260831`, published as the **ROU** column): 8 universes, GOP base 1–3
  (Demuth Base, Republican Voters, 2024 Trump Voters) against Dem base 7–8 (Vulnerable
  Dems, Klobuchar Base), with 4–6 persuasion. It was on the national fallback, so
  `drop_families=["drnatl"]` clears the stale `model_drnatl_all`, and `resolve_names=True`
  routes it through `district_ids.py` — MN house ids are lettered (`01A`), which the
  integer path cannot produce. Nevada moved to `NV_R2_Exchange_20260708`, replacing the
  7-universe R1 table; it keeps the `lombardo` family and both view keys, so nothing in
  `app.js` changed but the segment ladder. **Note the capitalised `UniverseNumber` /
  `UniverseName` in the NV table** — the R1 table was lowercase.
  Both share their bucket definitions with the ABEV Tracker's `STATE_MODELS`.

- **`framework_col` beats a universe range.** The Aug 2026 WI/MI/**AZ** refreshes and the AK
  model carry an explicit framework column beside the ladder. **Arizona is the sharpest
  example of why it matters**: it moved to `RSLC_AZ_Exchange_20260819` on 2026-09-09 from a
  config that used universes 6–7 for Dem, but the new ladder puts "Available Dems" at 7 and
  the Democrat base at **9**, so that range would have dropped universes 8 and 9 — over 2.2M
  Democrat-framework voters — into persuasion. It also changed family (`rga` → `rslc`), so
  `drop_families=["rga"]` clears the stale keys. WI and MI do *not* number
  their universes the same way — "Available Dems" is 7 (Pers) in WI, 6 (Dem) in MI — so a
  range right for one mis-buckets the other. The ladder still drives the affinity
  breakdown; the aggregator warns if a universe ever spans two frameworks.
- **Turnout variants** come either from a bin column (`turnout_col`, with `all_values` /
  `hm_values`) or from flag columns (`turnout_cols` / `all_cols`). "All" is rarely the
  whole table: GA and WI/MI use H/M/L only, and IA/AK exclude rows carrying no turnout
  flag at all.
### Ohio: three races off one file ("OH")

Same shape as NH and Oregon — `VS.OH_Audiences_20260812`, one table, three *families*:
`model_ohsen_all` ("OH / US Sen", Husted vs Brown), `model_ohgov_all` ("OH / Gov",
Ramaswamy vs Acton) and `model_ohcon_all` ("OH / Con", the generic congressional ballot).

- **The governor columns have no `named_` infix** — they are `gov_ballot_ramaswamy_audience`
  and `gov_ballot_acton_audience`, unlike the senate pair's `sen_ballot_named_*`. The file
  also carries `cong_ballot_combined_rep/dem` beside the generic pair; **generic** is what
  both projects use.
- All three pairs are mutually exclusive (zero rows carry both) and none is exhaustive:
  7.9% are in neither senate audience, 7.9% neither governor, 9.4% neither congressional.
  Those land in "Unaligned".
- Same `VS` schema, `rnc_reg_id` join column and `nvarchar(MAX)` index problem as NH. Joins
  **7,882,801 of 7,962,550** Ohio voters (99.0%). 99/99 house and 33/33 senate.
- **The ABEV Tracker buckets Ohio on the CONGRESSIONAL ballot**, so an Ohio lean there
  matches this project's "OH Con" column, not its Sen or Gov ones.

### New Hampshire: two races off one file ("SUN")

NH follows the **Oregon** pattern — one audience table, two *families* rather than two
turnout variants of one, so the races sit side by side as columns and the "variant" slot
names the race: `model_sunsen_all` ("SUN / US Sen") and `model_sungov_all` ("SUN / Gov").

- Senate ballot: `sen_ballot_named_sununu_audience` vs `sen_ballot_named_pappas_audience`.
  Governor: `gov_ballot_named_ayotte_audience` vs `gov_ballot_named_dem_audience`.
- The pairs are mutually exclusive (**zero** rows carry both) but **not exhaustive**:
  **9.2%** of voters are in neither Senate audience and **9.7%** in neither Governor one.
  Those land in "Unaligned", which is what `agg_flags` already does with a row that is
  neither, so the margin is unaffected — but do not describe this model as having no
  persuasion bucket. The affinity bar is GOP Framework / Unaligned / Dem Framework.
- **The regid column is `rnc_reg_id`, not `dt_regid`,** and the table lives in the **`VS`**
  schema. It is the first flags-mode model outside `dbo`, which exposed a real gap:
  `fetch_flags` and `fetch_score` hardcoded `JOIN [{table}]` and never honoured `schema`
  (only `fetch_universe` went through `table_ref()`, which is why AK worked). Both now use
  `table_ref()`. It joins **100%** of the NH voter file, 916,682 of 916,682.
- **Floterial districts are COMPUTED, so the house is complete at 203/203.** A floterial has
  no territory of its own — it overlays whole base districts and elects extra members across
  them — and `voterfile_2026.StateLegLowerDistrict` holds one value per voter, so it can
  never be read directly. `scripts/nh_floterials.py` holds the mapping and synthesises them
  from their constituents; the builder calls it for NH house only. Margin and each segment
  share are **n-weighted means**, which is exact rather than approximate: those numbers are
  already per-voter shares, so `sum(n_k * x_k) / sum(n_k)` equals pooling the voters and
  recomputing. A floterial is only built when **every** constituent is present.
  - The mapping was derived **geometrically**, not typed: the state's floterial boundaries
    reprojected onto the Census base districts, taking a base district as a constituent at
    >=80% area containment. Four checks had to agree before it was used — all 39 ids exist
    in `nh_house.json`; no base district is claimed twice; **seats reconcile exactly at
    342 + 58 = 400**, the true size of the NH House; and each floterial's constituents cover
    98.3–100% of its polygon (median 99.9%) with <=0.7% spill. Re-run the module as a script
    to regenerate after a redraw, and re-copy it to the ABEV Tracker, which keeps its own
    identical copy rather than importing across projects.
  - Verified after building: every floterial margin lies inside its constituents' min/max,
    which is the invariant an n-weighted mean must satisfy, and segment shares sum to 100.
  - Senate is complete at 24/24 and needs none of this — NH floterials are house-only.
- Sanity check that held: the mean across senate districts (Sen −4.3, Gov +6.1) reproduces
  the statewide net computed straight off the table (−4.2, +6.4).
- `drop_families=["drnatl"]` clears the national fallback NH used to carry. **No state
  carries both a dedicated model and `drnatl`** — all 26 dedicated-model files drop it —
  so leaving it would have shown a third column only New Hampshire has.
- **The ABEV Tracker deliberately does NOT have this model yet.** Which of the two races
  should classify absentee ballots is an open decision; add it to `STATE_MODELS` there once
  it is made.

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
