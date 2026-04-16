"""
Generate data/statewides.json from the Statewides tab in the workbook.

Usage:
  python scripts/generate_statewides_json.py --workbook "data/State Legislative Election History.xlsx"
  python scripts/generate_statewides_json.py --workbook "data/State Legislative Election History.xlsx" --out data/statewides.json
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

# Column indices (0-based) for the Statewides tab:
#   A(0)=FIPS, B(1)=State, C(2)=Office
#   2022 block cols 3-10: D=GOP V, E=Dem V, F=Other V, G=Tot V, H=GOP%, I=Dem%, J=Other%, K=Mar%
#   2023 block cols 11-18: same pattern offset by 8
#   2024 block cols 19-26: same pattern offset by 16
#   2025 block cols 27-34: same pattern offset by 24
#   AJ(35)=Party, AK(36)=Incumbent, AL(37)=GOP Candidate, AM(38)=Dem Candidate, AN(39)=Next Election

COL_FIPS = 0
COL_STATE = 1
COL_OFFICE = 2
COL_PARTY = 35
COL_INCUMBENT = 36
COL_GOP_CANDIDATE = 37
COL_DEM_CANDIDATE = 38
COL_NEXT_ELECTION = 39

ELECTION_YEARS = [
    {"year": 2022, "block_start": 3},
    {"year": 2023, "block_start": 11},
    {"year": 2024, "block_start": 19},
    {"year": 2025, "block_start": 27},
]

# Within each 8-column block:
#   +4 = GOP%, +5 = Dem%, +7 = Margin (R-positive decimal)
BLOCK_GOP_PCT_OFFSET = 4
BLOCK_DEM_PCT_OFFSET = 5
BLOCK_MARGIN_OFFSET = 7


def col_to_idx(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def normalize_state_fips(value: str) -> str:
    digits = "".join(ch for ch in str(value or "").strip() if ch.isdigit())
    return digits.zfill(2) if digits else ""


def normalize_party(value: str) -> str:
    v = str(value or "").strip().upper()
    if v in ("GOP", "REP", "REPUBLICAN", "R"):
        return "R"
    if v in ("DEM", "DEMOCRAT", "DEMOCRATIC", "D"):
        return "D"
    return v


def parse_float(value: str) -> Optional[float]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except (ValueError, TypeError):
        return None


def parse_int(value: str) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    m = re.search(r"(20\d{2})", text)
    if m:
        return int(m.group(1))
    try:
        v = float(text)
        return int(v)
    except (ValueError, TypeError):
        return None


def load_workbook_rows(path: Path) -> Dict[str, List]:
    with zipfile.ZipFile(path) as z:
        sst = []
        try:
            sst_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sst_root.findall("m:si", NS):
                sst.append("".join((t.text or "") for t in si.findall(".//m:t", NS)))
        except KeyError:
            pass

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall("p:Relationship", NS)
        }

        sheets = {}
        for sh in wb.findall("m:sheets/m:sheet", NS):
            name = sh.attrib["name"]
            rid = sh.attrib[
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            ]
            target = "xl/" + rid_to_target[rid]
            root = ET.fromstring(z.read(target))
            rows = []
            for r in root.findall("m:sheetData/m:row", NS):
                rid_num = int(r.attrib["r"])
                cells: Dict[int, str] = {}
                for c in r.findall("m:c", NS):
                    ref = c.attrib.get("r", "A1")
                    col = "".join(ch for ch in ref if ch.isalpha())
                    ci = col_to_idx(col)
                    t = c.attrib.get("t")
                    v = c.find("m:v", NS)
                    if v is None or v.text is None:
                        continue
                    if t == "s":
                        idx = int(v.text)
                        cells[ci] = sst[idx] if 0 <= idx < len(sst) else ""
                    else:
                        cells[ci] = v.text
                rows.append((rid_num, cells))
            sheets[name] = rows
    return sheets


def parse_statewides_tab(rows: List) -> Dict[str, List[Dict[str, Any]]]:
    """Parse the Statewides tab rows and return dict keyed by state FIPS."""
    # First two rows are headers (row 1 = year headers, row 2 = column headers)
    # Data starts at row 3
    by_fips: Dict[str, List] = {}

    for row_num, cells in rows:
        # Skip header rows
        fips_raw = cells.get(COL_FIPS, "")
        if not fips_raw or not any(ch.isdigit() for ch in str(fips_raw)):
            continue

        fips = normalize_state_fips(fips_raw)
        if not fips:
            continue

        state_abbr = str(cells.get(COL_STATE, "")).strip().upper()
        office = str(cells.get(COL_OFFICE, "")).strip()
        if not office:
            continue

        party = normalize_party(cells.get(COL_PARTY, ""))
        incumbent = str(cells.get(COL_INCUMBENT, "")).strip()
        rep_candidate = str(cells.get(COL_GOP_CANDIDATE, "")).strip()
        dem_candidate = str(cells.get(COL_DEM_CANDIDATE, "")).strip()
        next_election = parse_int(cells.get(COL_NEXT_ELECTION, ""))

        elections = []
        for yr_info in ELECTION_YEARS:
            year = yr_info["year"]
            bs = yr_info["block_start"]
            margin_raw = cells.get(bs + BLOCK_MARGIN_OFFSET)
            margin_val = parse_float(margin_raw)
            if margin_val is None:
                # No data for this year
                continue

            gop_pct_raw = cells.get(bs + BLOCK_GOP_PCT_OFFSET)
            dem_pct_raw = cells.get(bs + BLOCK_DEM_PCT_OFFSET)
            gop_pct = parse_float(gop_pct_raw)
            dem_pct = parse_float(dem_pct_raw)

            # margin_val is R-positive decimal (0.377 = 37.7% R advantage)
            # Convert to DEM margin in percentage points (positive = D)
            dem_margin = round(-(margin_val * 100), 2)

            # Convert percentages from decimal (0.669 = 66.9%)
            entry: Dict[str, Any] = {"year": year, "dem_margin": dem_margin}
            if gop_pct is not None:
                entry["rep_pct"] = round(gop_pct * 100, 1)
            if dem_pct is not None:
                entry["dem_pct"] = round(dem_pct * 100, 1)
            entry["winner"] = "D" if dem_margin > 0 else "R" if dem_margin < 0 else "EVEN"
            elections.append(entry)

        record: Dict[str, Any] = {
            "state": state_abbr,
            "office": office,
            "party": party,
            "incumbent": incumbent,
            "rep_candidate": rep_candidate,
            "dem_candidate": dem_candidate,
            "next_election": next_election,
            "elections": elections,
        }

        by_fips.setdefault(fips, []).append(record)

    return by_fips


def main():
    parser = argparse.ArgumentParser(description="Generate statewides.json from workbook")
    parser.add_argument(
        "--workbook",
        default="data/State Legislative Election History.xlsx",
        help="Path to the Excel workbook",
    )
    parser.add_argument(
        "--out",
        default="data/statewides.json",
        help="Output path for statewides.json",
    )
    args = parser.parse_args()

    workbook_path = Path(args.workbook)
    if not workbook_path.exists():
        # Try default workbook names
        for name in [
            "data/State Legislative Election History.xlsx",
            "data/State Legislative Election History - Copy.xlsx",
        ]:
            candidate = Path(name)
            if candidate.exists():
                workbook_path = candidate
                break
        else:
            print(f"ERROR: Workbook not found: {args.workbook}")
            return

    print(f"Reading workbook: {workbook_path}")
    rows_by_sheet = load_workbook_rows(workbook_path)

    if "Statewides" not in rows_by_sheet:
        print(f"ERROR: 'Statewides' tab not found. Available sheets: {list(rows_by_sheet.keys())}")
        return

    rows = rows_by_sheet["Statewides"]
    print(f"Found Statewides tab with {len(rows)} rows")

    by_fips = parse_statewides_tab(rows)

    total_records = sum(len(v) for v in by_fips.values())
    print(f"Parsed {total_records} statewide office records for {len(by_fips)} states")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(by_fips, f, ensure_ascii=False)

    print(f"Wrote {out_path}")

    # Print a quick summary
    for fips in sorted(by_fips.keys())[:5]:
        records = by_fips[fips]
        abbr = records[0]["state"] if records else fips
        print(f"  {abbr}({fips}): {len(records)} offices")


if __name__ == "__main__":
    main()
