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
  // New York also permits fusion voting; Yeger is a Democrat cross-endorsed by
  // the GOP and has no major-party opponent.
  "36|041|house": "Yeger holds both major-party nominations under New York's fusion voting; he faces no major-party opponent.",
  "02|00C|senate": "AK's top-four primary and ranked-choice general left only Republicans on the ballot; also running: Heath Smith, Louise Stutes.",
  "02|00E|senate": "AK's top-four primary and ranked-choice general left only Republicans on the ballot; also running: Gretchen Stoddard, Jason White.",
  "02|024|house": "AK's top-four primary and ranked-choice general left only Republicans on the ballot; also running: Gina Wall.",
  "02|025|house": "AK's top-four primary and ranked-choice general left only Republicans on the ballot; also running: Michael Bowles.",
  "02|027|house": "AK's top-four primary and ranked-choice general left only Republicans on the ballot; also running: David Eastman.",
  "02|033|house": "AK's top-four primary and ranked-choice general left only Republicans on the ballot; also running: Barbara Haney.",
  "02|040|house": "AK's top-four primary and ranked-choice general left only Democrats on the ballot; also running: Saima Chase.",
  "53|008|senate": "WA's top-two primary left only Republicans on the ballot; also running: Gabe Galbraith.",
  "53|029|senate": "WA's top-two primary left only Democrats on the ballot; also running: Sharlett Mena.",
  "53|032|senate": "WA's top-two primary left only Democrats on the ballot; also running: Cindy Ryu.",
  "53|037|senate": "WA's top-two primary left only Democrats on the ballot; also running: Chipalo Street.",
  "53|043|senate": "WA's top-two primary left only Democrats on the ballot; also running: Hannah Sabio-Howell.",
  "53|004|house": "WA's top-two primary left only Republicans on the ballot in Position 1; also running: Hillary Pham.",
  "53|011|house": "WA's top-two primary left only Democrats on the ballot in Position 1; also running: Ashley Fedan.",
  "53|013|house": "WA's top-two primary left only Republicans on the ballot in Position 2; also running: Joshua Thompson.",
  "53|021|house": "WA's top-two primary left only Democrats on the ballot in Position 1; also running: Jason Moon.",
  "53|022|house": "WA's top-two primary left only Democrats on the ballot in Position 2; also running: Jamie Keenan-deVargas.",
  "53|023|house": "WA's top-two primary left only Democrats on the ballot in Position 1; also running: Daria Ilgen.",
  "53|029|house": "WA's top-two primary left only Democrats on the ballot in both positions; also running: Krista Perez (Position 1), Patrick Stickney (Position 2).",
  "53|032|house": "WA's top-two primary left only Democrats on the ballot in both positions; also running: Keith Scully (Position 1), Imraan Siddiqi (Position 2).",
  "53|034|house": "WA's top-two primary left only Democrats on the ballot in Position 2; also running: Mary Anito.",
  "53|037|house": "WA's top-two primary left only Democrats on the ballot in Position 1; also running: Kelabe Tewolde.",
  "53|043|house": "WA's top-two primary left only Democrats on the ballot in Position 1; also running: Alby Clendennin.",
  "53|046|house": "WA's top-two primary left only Democrats on the ballot in Position 1; also running: Will Dreher.",
  "53|048|house": "WA's top-two primary left only Democrats on the ballot in Position 2; also running: Jessica Forsythe.",
  "46|027|house": "Only one major-party candidate for two seats; independents also on the ballot: Joe Flood, Elizabeth Lone Eagle, Evangeline Poor Bear, Jay Yohner.",
  "50|E-C|house": "Kascenska holds both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|F-5|house": "Hango and Laroche each hold both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|F-6|house": "Gregoire holds both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|F-7|house": "Demar holds both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|O-L|house": "Higley and Menon each hold both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|WA1|house": "Goslant and Herring each hold both major-party nominations. Independent incumbent Anne Donahue did not make the ballot.",
  "50|ESX|senate": "Ingalls holds both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|LAM|senate": "Westman holds both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|ORL|senate": "Morley holds both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|RUT|senate": "Collamore, Weeks and Williams each hold both major-party nominations. Vermont candidates can win the other party's primary on write-ins.",
  "50|C15|house": "Independent incumbent Troy Headrick is seeking re-election outside both major parties, so he appears in neither column.",
  "50|L-1|house": "Independent incumbent Jed Lipsky is the only candidate on the ballot; no major-party candidate filed.",
  "50|W-2|house": "Independent incumbent Laura Sibilia is the only candidate on the ballot; no major-party candidate filed.",
  "25|043|house": "Independent incumbent Susannah Whipps is the only candidate on the ballot; no major-party candidate filed.",
  "33|108|house": "Citizens Count reports that George Randell won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|206|house": "Citizens Count reports that Sean Graves won the Republican nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|301|house": "Citizens Count reports that Jay Ennis won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|304|house": "Citizens Count reports that David Holmander won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|307|house": "Citizens Count reports that Corinne E. Cascadden won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|501|house": "Citizens Count reports that Noah Lamoureaux won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|513|house": "Citizens Count reports that Don Staveley won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|538|house": "Citizens Count reports that Heidi Jakoby won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|540|house": "Citizens Count reports that Robert Richard-Snipes won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|609|house": "Citizens Count reports that John F. Martin and Matthew Poulin won the Republican nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|702|house": "Citizens Count reports that Kendra Cohen and Robert Prieto won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|709|house": "Citizens Count reports that Benjamin Sharpe won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|716|house": "Citizens Count reports that Neil Marceau won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|718|house": "Citizens Count reports that Beth M. Cacciotti won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|730|house": "Citizens Count reports that Bob Albright won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|732|house": "Citizens Count reports that Kaley Dvorak won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|801|house": "Republican primary result still pending on Ballotpedia; unofficial results from Citizens Count show W. Packy Campbell and Andy Dow winning.",
  "33|802|house": "Citizens Count reports that Dwight Harvey won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|805|house": "Citizens Count reports that William F. Fessenden won the Democratic nomination; Ballotpedia does not list them yet, so they are not shown above.",
  "33|806|house": "Democratic primary result still pending on Ballotpedia; unofficial results from Citizens Count show Daniel Fitzpatrick winning.",
  "33|812|house": "Citizens Count reports that Omero N. Ambriz won the Republican nomination; Ballotpedia does not list them yet, so they are not shown above.",
  // California's top-two primary can send two candidates of the SAME party to
  // the general, leaving the other party genuinely empty. The workbook has one
  // slot per party, so the second same-party candidate lives in these notes.
  "06|003|house": "California's top-two primary sent two Republicans to the general: Dom Belza and James Johansson.",
  "06|006|house": "California's top-two primary sent two Democrats to the general: Maggy Krell and Jagtar Singh.",
  "06|012|house": "California's top-two primary sent two Democrats to the general: Jackie Elward and Eric Lucan.",
  "06|018|house": "California's top-two primary sent two Democrats to the general: Mia Bonta and Andre Sandford.",
  "06|024|senate": "California's top-two primary sent two Democrats to the general: John Erickson and Brian Goldsmith.",
  "06|026|senate": "California's top-two primary sent two Democrats to the general: Sara Hernandez and Sarah Rascón.",
  "06|038|house": "California's top-two primary sent two Democrats to the general: Steve Bennett and Michael MacDonald.",
  "06|051|house": "California's top-two primary sent two Democrats to the general: Rick Chavez Zbur and Colin Hernandez.",
  "06|055|house": "California's top-two primary sent two Democrats to the general: Isaac Bryan and Ashley Brown.",
  "06|066|house": "California's top-two primary sent two Democrats to the general: Sara Deen and Paul Seo.",
  "06|068|house": "California's top-two primary sent two Democrats to the general: Jessie Lopez and David Penaloza.",
  "06|069|house": "California's top-two primary sent two Democrats to the general: Josh Lowenthal and Carolyn Essex.",
};

export const OVERSEAS_TERRITORY_FIPS = new Set(["60", "66", "69", "72", "78"]);
export const OVERSEAS_TERRITORY_ABBR = new Set(["AS", "GU", "MP", "PR", "VI"]);
