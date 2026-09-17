export const NATIONAL_CENTER = [39.5, -98.35];
export const NATIONAL_ZOOM = 4;
export const COUNTY_LABEL_MIN_ZOOM = 8;
export const BASE_WHEEL_PX_PER_ZOOM_LEVEL = 60;
export const CTRL_WHEEL_ZOOM_SLOW_FACTOR = 5;
export const BASE_ZOOM_SNAP = 1;
export const CTRL_FINE_ZOOM_SNAP = 0.2;

export const AUTO_SHAPE_URLS = {
  states: "data/shapes/states.zip",
  house: "data/shapes/house.zip",
  senate: "data/shapes/senate.zip",
  counties: "data/shapes/counties.zip",
  nh_house_floterial: "data/shapes/nh_house_floterial.zip",
};

export const TARGET_DISTRICTS_JSON_URLS = ["data/target_districts.json"];
export const CD_TARGETS_JSON_URL = "data/congressional_targets.json";
export const STATEWIDES_JSON_URL = "data/statewides.json";
export const POLLING_JSON_URL = "data/polling.json";
export const CHAMBER_INDEX_URLS = ["data/chamber_files.json"];
export const STATE_CHAMBER_NAMES_URLS = ["data/state_chamber_names.json"];
export const WORKBOOK_URLS = [
  "data/State Legislative Election History - Copy.xlsx",
  "data/State Legislative Election History.xlsx",
];
export const XLSX_CDN_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

export const MAP_VIEW_TYPE_PRIORITY = {
  gov: 0,
  ussen: 1,
  pres: 2,
  leg: 3,
};

export const STATE_NAME_TO_ABBR = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

// Per-district footnotes, shown as an {i} marker beside the 2026 candidate rows.
// Keyed "stateFips|districtId|chamber". The chamber matters: a bare join key
// would put Merski's PA HD-2 note on PA SENATE district 2 as well, since both
// chambers number from 1.
// For the rare case a candidate list is accurate but misleading on its face; keep
// each note to one sentence.
export const DISTRICT_NOTES = {
  // Merski, the Democratic incumbent, also won the Republican nomination on
  // write-in votes. Listing him in both columns would read as a two-party field
  // and suppress his incumbent asterisk on the R side, so the GOP column is left
  // empty and this note carries the explanation.
  "42|002|house": "Merski won the GOP nomination as a write-in candidate, but remains primarily a Democrat.",
  // Two AR HD-8 races share the Nov 3 ballot: a special for the rest of Austin
  // McCollum's term, and the regular election for the next full term. Kara Armas
  // holds the seat by appointment and is running in the special; her husband
  // Brian is the Republican nominee for the full term, which is what this row
  // records. Parker Stohlton (D) appears only in the special.
  "05|008|house": "Brian Armas is the nominee for the full term; Kara Armas holds the seat by appointment and is running in the concurrent special election.",
  // Oregon permits fusion voting, so one candidate can hold both major-party
  // nominations. Each of these six won the Democratic AND Republican primary and
  // faces no major-party opponent. They are listed under the party they actually
  // belong to; the other column reads "No candidate" so the incumbent asterisk
  // still fires and the race does not look two-sided.
  "41|002|house": "Osborne holds both major-party nominations under Oregon's fusion voting; he faces no major-party opponent.",
  "41|010|house": "Gomberg holds both major-party nominations under Oregon's fusion voting; he faces no major-party opponent.",
  "41|016|house": "Finger McDonald holds both major-party nominations under Oregon's fusion voting; she faces no major-party opponent.",
  "41|038|house": "Nguyen holds both major-party nominations under Oregon's fusion voting; he faces no major-party opponent.",
  "41|039|house": "Dobson holds both major-party nominations under Oregon's fusion voting; she faces no major-party opponent.",
  "41|004|senate": "Prozanski holds both major-party nominations under Oregon's fusion voting; he faces no major-party opponent.",
};

export const OVERSEAS_TERRITORY_FIPS = new Set(["60", "66", "69", "72", "78"]);
export const OVERSEAS_TERRITORY_ABBR = new Set(["AS", "GU", "MP", "PR", "VI"]);
