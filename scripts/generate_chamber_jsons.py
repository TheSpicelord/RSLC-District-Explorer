#!/usr/bin/env python3
"""
Generate chamber JSON files from the workbook without external dependencies.

Usage:
  python scripts/generate_chamber_jsons.py --workbook "data/State Legislative Election History - Copy.xlsx" --states MI,MN
"""

from __future__ import annotations

import argparse
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Tuple


NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

SHEET_FOR_CHAMBER = {
    "house": "SLDL",
    "senate": "SLDU",
}

OUTPUT_NAME = {
    ("MI", "house"): "michigan_house.json",
    ("MI", "senate"): "michigan_senate.json",
    ("MN", "house"): "minnesota_house.json",
    ("MN", "senate"): "minnesota_senate.json",
}

STATE_NAME_TO_ABBR = {
    "ALABAMA": "AL",
    "ALASKA": "AK",
    "ARIZONA": "AZ",
    "ARKANSAS": "AR",
    "CALIFORNIA": "CA",
    "COLORADO": "CO",
    "CONNECTICUT": "CT",
    "DELAWARE": "DE",
    "FLORIDA": "FL",
    "GEORGIA": "GA",
    "HAWAII": "HI",
    "IDAHO": "ID",
    "ILLINOIS": "IL",
    "INDIANA": "IN",
    "IOWA": "IA",
    "KANSAS": "KS",
    "KENTUCKY": "KY",
    "LOUISIANA": "LA",
    "MAINE": "ME",
    "MARYLAND": "MD",
    "MASSACHUSETTS": "MA",
    "MICHIGAN": "MI",
    "MINNESOTA": "MN",
    "MISSISSIPPI": "MS",
    "MISSOURI": "MO",
    "MONTANA": "MT",
    "NEBRASKA": "NE",
    "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM",
    "NEW YORK": "NY",
    "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND",
    "OHIO": "OH",
    "OKLAHOMA": "OK",
    "OREGON": "OR",
    "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN",
    "TEXAS": "TX",
    "UTAH": "UT",
    "VERMONT": "VT",
    "VIRGINIA": "VA",
    "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI",
    "WYOMING": "WY",
    "DISTRICT OF COLUMBIA": "DC",
}


def col_to_idx(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def normalize_state_fips(value: str) -> str:
    digits = "".join(ch for ch in str(value or "").strip() if ch.isdigit())
    return digits.zfill(2) if digits else ""


def normalize_district_id(value: str) -> str:
    raw = str(value or "").strip().upper().replace(" ", "")
    if not raw:
        return ""
    if raw.isdigit():
        return raw.zfill(3)
    return raw


def normalize_chamber_label(value: str) -> str:
    text = str(value or "").strip().lower()
    if "house" in text:
        return "house"
    if "senate" in text:
        return "senate"
    return ""


def normalize_workbook_state(value: str) -> str:
    text = str(value or "").strip().upper()
    if len(text) == 2 and text.isalpha():
        return text
    return STATE_NAME_TO_ABBR.get(text, "")


def pct(value: str) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return round(float(value) * 100.0, 1)
    except Exception:
        return 0.0


def num(value: str) -> int:
    if value in (None, ""):
        return 0
    try:
        return int(round(float(value)))
    except Exception:
        return 0


def margin_dem_from_r_minus_d(value: str):
    if value in (None, ""):
        return None
    try:
        return round((-float(value)) * 100.0, 1)
    except Exception:
        return None


def party_norm(value: str) -> str:
    s = str(value or "").strip().upper()
    if s in ("", "VACANT", "OPEN"):
        return "O"
    if s.startswith("REP") or s in ("R", "GOP", "REPUBLICAN"):
        return "R"
    if s.startswith("DEM") or s in ("D", "DEMOCRAT", "DEMOCRATIC"):
        return "D"
    return "O"


def winner_from_pcts(dem: float, rep: float) -> str:
    if dem > rep:
        return "D"
    if rep > dem:
        return "R"
    return "O"


def load_workbook_rows(path: Path) -> Dict[str, List[Tuple[int, Dict[int, str]]]]:
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
        rid_to_target = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall("p:Relationship", NS)}

        sheets = {}
        for sh in wb.findall("m:sheets/m:sheet", NS):
            name = sh.attrib["name"]
            rid = sh.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = "xl/" + rid_to_target[rid]
            root = ET.fromstring(z.read(target))
            rows = []
            for r in root.findall("m:sheetData/m:row", NS):
                rid_num = int(r.attrib["r"])
                cells = {}
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


def val(row: Dict[int, str], col: str):
    return row.get(col_to_idx(col), "")


def build_rows(sheet_rows: List[Tuple[int, Dict[int, str]]], state_abbr: str):
    out = []
    for rid, row in sheet_rows:
        if rid <= 2:
            continue
        st = str(val(row, "B")).strip().upper()
        if st != state_abbr:
            continue

        state_fips = normalize_state_fips(val(row, "A"))
        district_id = normalize_district_id(val(row, "C"))
        if not state_fips or not district_id:
            continue

        district_name = str(val(row, "E") or "").strip()
        inc_name = str(val(row, "BC") or "").strip() or "Vacant"
        inc_party = party_norm(val(row, "BB"))

        rep_name = str(val(row, "BD") or "").strip() or "No candidate"
        dem_name = str(val(row, "BE") or "").strip() or "No candidate"

        elections = []
        for year, tot_col, rep_col, dem_col in [
            (2022, "I", "J", "K"),
            (2023, "Y", "Z", "AA"),
            (2024, "AG", "AH", "AI"),
            (2025, "AW", "AX", "AY"),
        ]:
            tot = num(val(row, tot_col))
            rep = pct(val(row, rep_col))
            dem = pct(val(row, dem_col))
            if tot > 0 and (rep > 0 or dem > 0):
                elections.append({"year": year, "dem_pct": dem, "rep_pct": rep, "winner": winner_from_pcts(dem, rep)})

        elections.sort(key=lambda e: e["year"])

        m22 = margin_dem_from_r_minus_d(val(row, "M"))
        m23 = margin_dem_from_r_minus_d(val(row, "AC"))
        m24 = margin_dem_from_r_minus_d(val(row, "AK"))
        m25 = margin_dem_from_r_minus_d(val(row, "BA"))
        mgov22 = margin_dem_from_r_minus_d(val(row, "U"))
        mpres24 = margin_dem_from_r_minus_d(val(row, "AS"))

        latest_leg = None
        for m in (m25, m24, m23, m22):
            if m is not None:
                latest_leg = m
                break

        view_margins = {}
        if m22 is not None:
            view_margins["leg_2022"] = m22
        if m23 is not None:
            view_margins["leg_2023"] = m23
        if m24 is not None:
            view_margins["leg_2024"] = m24
        if m25 is not None:
            view_margins["leg_2025"] = m25
        if latest_leg is not None:
            view_margins["latest_leg"] = latest_leg
        if mgov22 is not None:
            view_margins["gov_2022"] = mgov22
        if mpres24 is not None:
            view_margins["pres_2024"] = mpres24

        out.append(
            {
                "state_fips": state_fips,
                "district_id": district_id,
                "district_name": district_name,
                "incumbent": {"name": inc_name, "party": inc_party},
                "demographics": {
                    "population": num(val(row, "CH")),
                    "rural_pct": pct(val(row, "BQ")),
                    "town_pct": pct(val(row, "BR")),
                    "suburban_pct": pct(val(row, "BS")),
                    "urban_pct": pct(val(row, "BT")),
                    "income_brackets": {
                        "lt_50k": pct(val(row, "BZ")),
                        "between_50_100k": pct(val(row, "CA")),
                        "gt_150k": pct(val(row, "CB")),
                        "unknown_pct": pct(val(row, "CC")),
                    },
                    "college_pct": pct(val(row, "CE")),
                    "post_grad_pct": pct(val(row, "CF")),
                    "education_unknown_pct": pct(val(row, "CG")),
                    "white_pct": pct(val(row, "BU")),
                    "hispanic_pct": pct(val(row, "BV")),
                    "black_pct": pct(val(row, "BW")),
                    "asian_pct": pct(val(row, "BX")),
                    "other_pct": pct(val(row, "BY")),
                },
                "elections": elections,
                "view_margins": view_margins,
                "pres_2024_margin": mpres24 if mpres24 is not None else 0.0,
                "gov_2022_margin": mgov22 if mgov22 is not None else 0.0,
                "top_ticket_totals": {
                    "pres_2024": num(val(row, "AO")),
                    "gov_2022": num(val(row, "Q")),
                },
                "candidates_2026": {"rep": rep_name, "dem": dem_name},
            }
        )

    out.sort(key=lambda r: (r["state_fips"], r["district_id"]))
    return out


def rows_to_matrix(sheet_rows: List[Tuple[int, Dict[int, str]]]) -> List[List[str]]:
    row_map: Dict[int, Dict[int, str]] = {}
    max_row = 0
    max_col = 0
    for rid, cells in sheet_rows:
        row_map[rid] = cells
        if rid > max_row:
            max_row = rid
        if cells:
            this_max_col = max(cells.keys())
            if this_max_col > max_col:
                max_col = this_max_col

    matrix: List[List[str]] = []
    for rid in range(1, max_row + 1):
        row = [""] * (max_col + 1)
        cells = row_map.get(rid, {})
        for ci, value in cells.items():
            row[ci] = str(value or "").strip()
        matrix.append(row)
    return matrix


def extract_target_table_matrix_rows(rows: List[List[str]]):
    title_row = -1
    title_col = -1
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if str(value or "").strip().upper() == "TARGET DISTRICTS":
                title_row = r
                title_col = c
                break
        if title_row >= 0:
            break

    if title_row < 0:
        return None

    for r in range(title_row + 1, min(len(rows), title_row + 8)):
        row = rows[r] if r < len(rows) else []
        mapping: Dict[str, int] = {}
        for c in range(title_col, min(len(row), title_col + 12)):
            header = str(row[c] or "").strip().lower()
            if not header:
                continue
            mapping[header] = c

        col_state = mapping.get("state")
        col_chamber = mapping.get("chamber")
        col_district = mapping.get("district")
        if col_district is None:
            col_district = mapping.get("#")
        if col_district is None:
            col_district = mapping.get("dist")
        if isinstance(col_state, int) and isinstance(col_chamber, int) and isinstance(col_district, int):
            return {
                "col_state": col_state,
                "col_chamber": col_chamber,
                "col_district": col_district,
                "start_row": r + 1,
            }

    return None


def build_target_rows(sheet_rows: List[Tuple[int, Dict[int, str]]]):
    rows = rows_to_matrix(sheet_rows)
    table = extract_target_table_matrix_rows(rows)
    if not table:
        return []

    out = []
    seen = set()
    empty_streak = 0
    for r in range(table["start_row"], len(rows)):
        row = rows[r] if r < len(rows) else []
        state_raw = str(row[table["col_state"]] if table["col_state"] < len(row) else "").strip()
        chamber_raw = str(row[table["col_chamber"]] if table["col_chamber"] < len(row) else "").strip()
        district_raw = str(row[table["col_district"]] if table["col_district"] < len(row) else "").strip()

        if not state_raw and not chamber_raw and not district_raw:
            empty_streak += 1
            if empty_streak >= 3:
                break
            continue

        empty_streak = 0
        state_abbr = normalize_workbook_state(state_raw)
        chamber = normalize_chamber_label(chamber_raw)
        district_id = normalize_district_id(district_raw)
        if not state_abbr or not chamber or not district_id:
            continue

        key = (state_abbr, chamber, district_id)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "stateAbbr": state_abbr,
                "chamber": chamber,
                "districtId": district_id,
                "rawDistrict": district_raw or district_id,
            }
        )

    out.sort(key=lambda r: (r["stateAbbr"], r["chamber"], r["districtId"]))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", required=True, help="Path to workbook .xlsx")
    parser.add_argument("--states", required=True, help="Comma-separated state abbreviations, e.g. MI,MN")
    parser.add_argument("--output-dir", default="data", help="Output directory")
    parser.add_argument(
        "--targets-out",
        default="data/target_districts.json",
        help="Output path for target districts JSON extracted from Overview tab",
    )
    args = parser.parse_args()

    workbook = Path(args.workbook)
    out_dir = Path(args.output_dir)
    targets_out = Path(args.targets_out)
    states = [s.strip().upper() for s in args.states.split(",") if s.strip()]

    sheets = load_workbook_rows(workbook)

    for state_abbr in states:
        for chamber in ("house", "senate"):
            sheet_name = SHEET_FOR_CHAMBER[chamber]
            rows = build_rows(sheets[sheet_name], state_abbr)
            out_name = OUTPUT_NAME.get((state_abbr, chamber), f"{state_abbr.lower()}_{chamber}.json")
            out_path = out_dir / out_name
            with out_path.open("w", encoding="utf-8") as f:
                json.dump(rows, f, indent=2)
                f.write("\n")
            print(f"Wrote {out_path} rows={len(rows)}")

    overview_rows = sheets.get("Overview")
    if overview_rows:
        targets = build_target_rows(overview_rows)
        targets_out.parent.mkdir(parents=True, exist_ok=True)
        with targets_out.open("w", encoding="utf-8") as f:
            json.dump(targets, f, indent=2)
            f.write("\n")
        print(f"Wrote {targets_out} rows={len(targets)}")


if __name__ == "__main__":
    main()
