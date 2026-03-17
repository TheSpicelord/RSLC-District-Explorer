"""
Generate chamber JSON files from the workbook without external dependencies.

Usage examples:
  python scripts/generate_chamber_jsons.py --workbook "data/State Legislative Election History - Copy.xlsx" --states MI,MN
  python scripts/generate_chamber_jsons.py --workbook "data/State Legislative Election History - Copy.xlsx" --states ALL
"""

from __future__ import annotations

import argparse
import json
import re
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

# Keep existing legacy names where they already exist in the project.
OUTPUT_NAME = {
    ("MI", "house"): "michigan_house.json",
    ("MI", "senate"): "michigan_senate.json",
    ("MN", "house"): "minnesota_house.json",
    ("MN", "senate"): "minnesota_senate.json",
}

SPECIAL_TAB_PATTERN = re.compile(r"^([A-Z]{2})\s+(SLDL|SLDU)$")
SEAT_NUMBERED_TABS = {"ID SLDL", "WA SLDL", "WV SLDU"}

NOISE_DISTRICT_WORDS = {
    "STATE",
    "LEGISLATIVE",
    "HOUSE",
    "SENATE",
    "DISTRICT",
    "SUBDISTRICT",
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
    if "house" in text or text == "sldl":
        return "house"
    if "senate" in text or text == "sldu":
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


def has_nonempty_candidate(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    upper = text.upper()
    return upper not in {"NO CANDIDATE", "UNKNOWN", "TBD"}


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


def clean_header(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().upper())


def has_named_incumbent(name: str) -> bool:
    text = str(name or "").strip().upper()
    return bool(text and text not in {"VACANT", "UNKNOWN", "OPEN"})


def canonical_district_id(value: str) -> str:
    did = normalize_district_id(value)
    if not did:
        return ""
    if did.isdigit():
        return str(int(did))
    m = re.match(r"^0*([0-9]+)([A-Z]+)$", did)
    if m:
        return f"{int(m.group(1))}{m.group(2)}"
    return did


def normalize_district_name_match(value: str) -> str:
    text = str(value or "").strip().upper()
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    parts = [p for p in text.split() if p and p not in NOISE_DISTRICT_WORDS]
    return "".join(parts)


def district_id_candidates(raw_value: str) -> List[str]:
    text = str(raw_value or "").strip().upper()
    if not text:
        return []

    candidates = set()

    def add_candidate(v: str):
        did = normalize_district_id(v)
        if did:
            candidates.add(did)

    add_candidate(text)

    # Common formats: "Belknap 01", "State Legislative Subdistrict 1A", "Addison-1".
    parts = re.split(r"\s+", text)
    if parts:
        add_candidate(parts[-1])

    m = re.search(r"SUBDISTRICT\s*([0-9]+[A-Z])", text)
    if m:
        add_candidate(m.group(1))

    for pattern in [r"([0-9]+[A-Z])$", r"([0-9]+)$", r"([A-Z]+-[0-9A-Z]+)$", r"([A-Z]{3})$"]:
        mm = re.search(pattern, text)
        if mm:
            add_candidate(mm.group(1))

    return sorted(candidates)


def parse_special_sheet_identity(name: str):
    m = SPECIAL_TAB_PATTERN.match(str(name or "").strip().upper())
    if not m:
        return "", ""
    state_abbr = m.group(1)
    chamber = "house" if m.group(2) == "SLDL" else "senate"
    return state_abbr, chamber


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


MAIN_SHEET_COLS = {
    "district_name": "E",
    "incumbent_party": "BJ",
    "incumbent_name": "BK",
    "rep_candidate": "BL",
    "dem_candidate": "BM",
    "next_election": "BN",
    "djt_tier": "CS",
    "leg_tier": "CT",
    "demographics": {
        "rural_pct": "BZ",
        "town_pct": "CA",
        "suburban_pct": "CB",
        "urban_pct": "CC",
        "white_pct": "CD",
        "hispanic_pct": "CE",
        "black_pct": "CF",
        "asian_pct": "CG",
        "other_pct": "CH",
        "lt_50k": "CI",
        "between_50_100k": "CJ",
        "gt_150k": "CK",
        "unknown_pct": "CL",
        "non_college_pct": "CM",
        "college_pct": "CN",
        "post_grad_pct": "CO",
        "education_unknown_pct": "CP",
        "total_voters": "CQ",
    },
}

LEG_ELECTION_COLS = {
    2022: {"total": "I", "rep_pct": "J", "dem_pct": "K", "margin": "M"},
    2023: {"total": "AG", "rep_pct": "AH", "dem_pct": "AI", "margin": "AK"},
    2024: {"total": "AO", "rep_pct": "AP", "dem_pct": "AQ", "margin": "AS"},
    2025: {"total": "BE", "rep_pct": "BF", "dem_pct": "BG", "margin": "BI"},
}

TOP_TICKET_COLS = {
    "gov_2022": {"total": "Q", "rep_pct": "R", "dem_pct": "S", "margin": "U"},
    "ussen_2022": {"total": "Y", "rep_pct": "Z", "dem_pct": "AA", "margin": "AC"},
    "pres_2024": {"total": "AW", "rep_pct": "AX", "dem_pct": "AY", "margin": "BA"},
}


def parse_next_election(value: str):
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"(20\d{2})", text)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


VALID_TIER_VALUES = {1, 2, 3, 4}


def parse_tier_value(value):
    text = str(value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"[1-4](?:\.0+)?", text):
        return int(float(text))
    return None


def resolve_district_tier(djt_raw, leg_raw, tier_audit=None, sheet_name="", state_abbr="", district_id=""):
    djt_text = str(djt_raw or "").strip()
    leg_text = str(leg_raw or "").strip()
    djt_tier = parse_tier_value(djt_text)
    leg_tier = parse_tier_value(leg_text)

    if tier_audit is not None:
        bucket = tier_audit.setdefault(
            sheet_name or "UNKNOWN",
            {
                "invalid_djt": 0,
                "invalid_leg": 0,
                "both_valid": [],
            },
        )
        if djt_text and djt_tier is None:
            bucket["invalid_djt"] += 1
        if leg_text and leg_tier is None:
            bucket["invalid_leg"] += 1
        if djt_tier in VALID_TIER_VALUES and leg_tier in VALID_TIER_VALUES:
            bucket["both_valid"].append(
                {
                    "state": state_abbr,
                    "district_id": district_id,
                    "djt_tier": djt_tier,
                    "leg_tier": leg_tier,
                }
            )

    if djt_tier in VALID_TIER_VALUES:
        return djt_tier
    if leg_tier in VALID_TIER_VALUES:
        return leg_tier
    return None


def normalize_modeling_chamber(value: str) -> str:
    text = str(value or "").strip().lower()
    if "lower" in text or "house" in text or text == "sldl":
        return "house"
    if "upper" in text or "senate" in text or text == "sldu":
        return "senate"
    return ""


def parse_modeling_state_header(value: str):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return "", "", ""

    parts = re.split(r"\s*-\s*", text, maxsplit=1)
    state_abbr = normalize_workbook_state(parts[0] if parts else text)
    family_display = parts[1].strip() if len(parts) > 1 else "Model"
    family_key = re.sub(r"[^a-z0-9]+", "_", family_display.lower()).strip("_") or "model"
    return state_abbr, family_key, family_display


def parse_modeling_section(value: str):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    lower = text.lower()
    if not text:
        return None

    kind = ""
    if "partisan" in lower or "affinity" in lower:
        kind = "affinity"
    elif "college" in lower or "education" in lower:
        kind = "education"
    if not kind:
        return None

    variant_key = ""
    variant_label = ""
    if "high+mid" in lower or "high + mid" in lower or "h+m" in lower:
        variant_key = "hm"
        variant_label = "H+M"
    elif "all" in lower:
        variant_key = "all"
        variant_label = "All"
    if not variant_key:
        return None

    return {
        "kind": kind,
        "variant_key": variant_key,
        "variant_label": variant_label,
    }


def modeling_view_key(family_key: str, variant_key: str) -> str:
    return f"model_{family_key}_{variant_key}"


def modeling_view_label(family_display: str, variant_label: str) -> str:
    return f"{family_display} ({variant_label})"


MODELING_AFFINITY_LAYOUTS = {
    "hrcc": {
        "segments": [
            {"header": "GOP BASE", "key": "gop_base", "label": "GOP Base"},
            {"header": "GOP TARGET", "key": "gop_target", "label": "GOP Target"},
            {"header": "SWING", "key": "swing", "label": "Swing"},
            {"header": "DEM LIKELY", "key": "dem_likely", "label": "Likely Dem"},
            {"header": "DEM BASE", "key": "dem_base", "label": "Dem Base"},
        ],
        "gop_count": 2,
        "dem_count": 2,
    },
    "rslc": {
        "segments": [
            {"header": "GOP CONSISTENT", "key": "gop_consistent", "label": "GOP Consistent"},
            {"header": "GOP GOV DROP", "key": "gop_gov_drop", "label": "GOP Gov Drop"},
            {"header": "GOP TARGETS", "key": "gop_targets", "label": "GOP Targets"},
            {"header": "DJT OVERPERFORM", "key": "djt_overperform", "label": "DJT Overperform"},
            {"header": "ISSUE TARGETS", "key": "issue_targets", "label": "Issue Targets"},
            {"header": "CORE PERSUASION", "key": "core_persuasion", "label": "Core Persuasion"},
            {"header": "DEM TARGETS", "key": "dem_targets", "label": "Dem Targets"},
            {"header": "DEM GOV DROP", "key": "dem_gov_drop", "label": "Dem Gov Drop"},
            {"header": "DEM CONSISTENT", "key": "dem_consistent", "label": "Dem Consistent"},
        ],
        "gop_count": 3,
        "dem_count": 3,
    },
}


def slug_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def affinity_layout_for_block(block: dict):
    layout = MODELING_AFFINITY_LAYOUTS.get(block["family_key"])
    if layout:
        return layout

    if block["family_key"] != "rga":
        return None

    ordered_headers = [block["headers"][ci] for ci in sorted(block["headers"].keys())]
    segments = []
    seen = {}
    for index, header in enumerate(ordered_headers):
        raw_label = str(header or "").strip()
        if not raw_label:
            continue
        base_key = slug_key(raw_label) or f"bucket_{index + 1}"
        seen[base_key] = seen.get(base_key, 0) + 1
        seg_key = base_key if seen[base_key] == 1 else f"{base_key}_{seen[base_key]}"
        segments.append(
            {
                "header": clean_header(raw_label),
                "key": seg_key,
                "label": raw_label,
            }
        )

    return {"segments": segments}


def affinity_margin_for_block(block: dict, segments: List[dict]) -> float:
    family_key = block["family_key"]
    values_by_label = {clean_header(segment.get("label")): float(segment.get("value") or 0.0) for segment in segments}

    if family_key == "rslc":
        gop_total = sum(segment["value"] for segment in segments[:3])
        dem_total = sum(segment["value"] for segment in segments[-3:])
        return round(gop_total - dem_total, 1)

    if family_key == "rga":
        if clean_header(block.get("state_abbr")) == "WI":
            gop_total = values_by_label.get("TIFFANY BASE", 0.0) + values_by_label.get("GOP SOFT", 0.0)
            dem_total = values_by_label.get("DEM SOFT", 0.0) + values_by_label.get("DEM BASE", 0.0)
            return round(gop_total - dem_total, 1)
        if clean_header(block.get("state_abbr")) == "IA":
            gop_total = values_by_label.get("FEENSTRA BASE", 0.0) + values_by_label.get("GOP TARGETS", 0.0)
            dem_total = values_by_label.get("DEM LIKELY", 0.0) + values_by_label.get("DEM BASE", 0.0)
            return round(gop_total - dem_total, 1)
        if clean_header(block.get("state_abbr")) == "AZ":
            gop_total = values_by_label.get("GOP BASE", 0.0) + values_by_label.get("GOP TARGETS", 0.0)
            dem_total = values_by_label.get("DEM LIKELY", 0.0) + values_by_label.get("HOBBS BASE", 0.0)
            return round(gop_total - dem_total, 1)
        if clean_header(block.get("state_abbr")) == "GA":
            gop_total = values_by_label.get("GOP BASE", 0.0) + values_by_label.get("GOP TARGETS", 0.0)
            dem_total = values_by_label.get("DEM LIKELY", 0.0) + values_by_label.get("DEM BASE", 0.0)
            return round(gop_total - dem_total, 1)

    layout = MODELING_AFFINITY_LAYOUTS.get(family_key) or {}
    gop_count = int(layout.get("gop_count", 0) or 0)
    dem_count = int(layout.get("dem_count", 0) or 0)
    gop_total = sum(segment["value"] for segment in segments[:gop_count])
    dem_total = sum(segment["value"] for segment in segments[-dem_count:]) if dem_count else 0.0
    return round(dem_total - gop_total, 1)


def discover_modeling_blocks(rows: List[List[str]]):
    if len(rows) < 4:
        return []

    top_row = rows[0]
    chamber_row = rows[1]
    section_row = rows[2]
    header_row = rows[3]
    max_cols = max(len(top_row), len(chamber_row), len(section_row), len(header_row))

    contexts = []
    active_state = ""
    active_chamber = ""
    for ci in range(max_cols):
        raw_state = str(top_row[ci] if ci < len(top_row) else "").strip()
        raw_chamber = str(chamber_row[ci] if ci < len(chamber_row) else "").strip()
        raw_section = str(section_row[ci] if ci < len(section_row) else "").strip()
        header = str(header_row[ci] if ci < len(header_row) else "").strip()
        if raw_state:
            active_state = raw_state
        if raw_chamber:
            active_chamber = raw_chamber
        contexts.append(
            {
                "state_label": active_state,
                "chamber_label": active_chamber,
                "section_label": raw_section,
                "header_label": header,
            }
        )

    def find_district_col(start_col: int, state_label: str, chamber_label: str):
        for cj in range(start_col, -1, -1):
            ctx = contexts[cj]
            if ctx["state_label"] != state_label or ctx["chamber_label"] != chamber_label:
                continue
            if "district" in ctx["header_label"].lower():
                return cj
        return None

    blocks = []
    for ci in range(max_cols):
        raw_section = contexts[ci]["section_label"]
        if not raw_section:
            continue

        state_label = contexts[ci]["state_label"]
        chamber_label = contexts[ci]["chamber_label"]
        state_abbr, family_key, family_display = parse_modeling_state_header(state_label)
        chamber = normalize_modeling_chamber(chamber_label)
        section = parse_modeling_section(raw_section)
        if not state_abbr or not chamber or not section:
            continue

        district_col = find_district_col(ci, state_label, chamber_label)
        if district_col is None:
            continue

        end_col = ci
        for cj in range(ci + 1, max_cols):
            next_state = str(top_row[cj] if cj < len(top_row) else "").strip()
            next_chamber = str(chamber_row[cj] if cj < len(chamber_row) else "").strip()
            next_section = str(section_row[cj] if cj < len(section_row) else "").strip()
            if next_state or next_chamber or next_section:
                break
            end_col = cj

        headers = {}
        for cj in range(ci, end_col + 1):
            header = str(header_row[cj] if cj < len(header_row) else "").strip()
            if header:
                headers[cj] = header

        blocks.append(
            {
                "state_abbr": state_abbr,
                "chamber": chamber,
                "district_col": district_col,
                "start_col": ci,
                "end_col": end_col,
                "headers": headers,
                "family_key": family_key,
                "family_display": family_display,
                "view_key": modeling_view_key(family_key, section["variant_key"]),
                "view_label": modeling_view_label(family_display, section["variant_label"]),
                "kind": section["kind"],
                "variant_label": section["variant_label"],
            }
        )

    return blocks


def build_modeling_rows(sheet_rows: List[Tuple[int, Dict[int, str]]]):
    rows = rows_to_matrix(sheet_rows)
    blocks = discover_modeling_blocks(rows)
    if not blocks:
        return {}

    out: Dict[Tuple[str, str, str], Dict[str, dict]] = {}

    for block in blocks:
        for rid in range(4, len(rows)):
            row = rows[rid] if rid < len(rows) else []
            district_raw = str(row[block["district_col"]] if block["district_col"] < len(row) else "").strip()
            district_id = normalize_district_id(district_raw)
            if not district_id:
                continue

            values_by_header = {}
            for ci, header in block["headers"].items():
                value = str(row[ci] if ci < len(row) else "").strip()
                values_by_header[clean_header(header)] = value

            join_key = (block["state_abbr"], block["chamber"], district_id)
            row_models = out.setdefault(join_key, {})
            model_entry = row_models.setdefault(
                block["view_key"],
                {
                    "label": block["view_label"],
                    "family": block["family_display"],
                    "variant": block["variant_label"],
                },
            )

            if block["kind"] == "affinity":
                layout = affinity_layout_for_block(block)
                if not layout:
                    continue

                segments = []
                total_pct = 0.0
                for spec in layout["segments"]:
                    value = pct(values_by_header.get(spec["header"]))
                    segments.append(
                        {
                            "key": spec["key"],
                            "label": spec["label"],
                            "value": value,
                        }
                    )
                    total_pct += value

                if total_pct <= 0.01:
                    continue

                margin = affinity_margin_for_block(block, segments)

                affinity_entry = {
                    "segments": segments,
                    "margin": margin,
                }
                for segment in segments:
                    if segment["key"]:
                        affinity_entry[segment["key"]] = segment["value"]

                model_entry["affinity"] = affinity_entry
                continue

            non_college = pct(values_by_header.get("NON-COLLEGE"))
            college = pct(values_by_header.get("COLLEGE"))
            total_pct = non_college + college
            if total_pct <= 0.01:
                continue

            model_entry["education"] = {
                "non_college": non_college,
                "college": college,
            }

    return out


def apply_modeling_rows(base_rows: List[dict], modeling_rows: Dict[Tuple[str, str, str], Dict[str, dict]], state_abbr: str, chamber: str):
    if not base_rows or not modeling_rows:
        return 0

    applied = 0
    for row in base_rows:
        district_id = normalize_district_id(row.get("district_id"))
        if not district_id:
            continue
        model_bundle = modeling_rows.get((state_abbr, chamber, district_id))
        if not model_bundle and state_abbr == "AZ":
            other_chamber = "senate" if chamber == "house" else "house"
            model_bundle = modeling_rows.get((state_abbr, other_chamber, district_id))
        if not model_bundle:
            continue

        row["models"] = model_bundle
        view_margins = row.setdefault("view_margins", {})
        for view_key, model_entry in model_bundle.items():
            affinity = model_entry.get("affinity") or {}
            margin = affinity.get("margin")
            if isinstance(margin, (int, float)):
                view_margins[view_key] = round(float(margin), 1)
        applied += 1

    return applied


def build_rows(sheet_rows: List[Tuple[int, Dict[int, str]]], state_abbr: str, tier_audit=None, sheet_name=""):
    out = []
    demo_cols = MAIN_SHEET_COLS["demographics"]

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

        district_name = str(val(row, MAIN_SHEET_COLS["district_name"]) or "").strip()
        inc_name = str(val(row, MAIN_SHEET_COLS["incumbent_name"]) or "").strip() or "Vacant"
        inc_party = party_norm(val(row, MAIN_SHEET_COLS["incumbent_party"]))

        rep_name = str(val(row, MAIN_SHEET_COLS["rep_candidate"]) or "").strip() or "No candidate"
        dem_name = str(val(row, MAIN_SHEET_COLS["dem_candidate"]) or "").strip() or "No candidate"
        next_election = parse_next_election(val(row, MAIN_SHEET_COLS["next_election"]))
        tier = resolve_district_tier(
            val(row, MAIN_SHEET_COLS["djt_tier"]),
            val(row, MAIN_SHEET_COLS["leg_tier"]),
            tier_audit=tier_audit,
            sheet_name=sheet_name,
            state_abbr=state_abbr,
            district_id=district_id,
        )

        elections = []
        view_margins = {}
        leg_margins = {}
        for year, cols in sorted(LEG_ELECTION_COLS.items()):
            tot = num(val(row, cols["total"]))
            rep = pct(val(row, cols["rep_pct"]))
            dem = pct(val(row, cols["dem_pct"]))
            if tot > 0 and (rep > 0 or dem > 0):
                elections.append({"year": year, "dem_pct": dem, "rep_pct": rep, "winner": winner_from_pcts(dem, rep)})

            margin = margin_dem_from_r_minus_d(val(row, cols["margin"]))
            if margin is not None:
                leg_margins[year] = margin
                view_margins[f"leg_{year}"] = margin

        latest_leg = None
        for year in (2025, 2024, 2023, 2022):
            if year in leg_margins:
                latest_leg = leg_margins[year]
                break
        if latest_leg is not None:
            view_margins["latest_leg"] = latest_leg

        top_ticket_margins = {}
        top_ticket_totals = {}
        for key, cols in TOP_TICKET_COLS.items():
            total = num(val(row, cols["total"]))
            rep = pct(val(row, cols["rep_pct"]))
            dem = pct(val(row, cols["dem_pct"]))
            margin = margin_dem_from_r_minus_d(val(row, cols["margin"])) if (total > 0 and (rep > 0 or dem > 0)) else None
            top_ticket_margins[key] = margin
            top_ticket_totals[key] = total if margin is not None else 0
            if margin is not None:
                view_margins[key] = margin

        member = {
            "seat": 1,
            "seat_label": "",
            "incumbent": {"name": inc_name, "party": inc_party},
            "candidates": {"rep": rep_name, "dem": dem_name},
        }

        out.append(
            {
                "state_fips": state_fips,
                "district_id": district_id,
                "district_name": district_name,
                "tier": tier,
                "incumbent": {"name": inc_name, "party": inc_party},
                "members": [member],
                "candidate_seats_up": 1,
                "next_election": next_election,
                "demographics": {
                    "population": num(val(row, demo_cols["total_voters"])),
                    "rural_pct": pct(val(row, demo_cols["rural_pct"])),
                    "town_pct": pct(val(row, demo_cols["town_pct"])),
                    "suburban_pct": pct(val(row, demo_cols["suburban_pct"])),
                    "urban_pct": pct(val(row, demo_cols["urban_pct"])),
                    "income_brackets": {
                        "lt_50k": pct(val(row, demo_cols["lt_50k"])),
                        "between_50_100k": pct(val(row, demo_cols["between_50_100k"])),
                        "gt_150k": pct(val(row, demo_cols["gt_150k"])),
                        "unknown_pct": pct(val(row, demo_cols["unknown_pct"])),
                    },
                    "college_pct": pct(val(row, demo_cols["college_pct"])),
                    "post_grad_pct": pct(val(row, demo_cols["post_grad_pct"])),
                    "education_unknown_pct": pct(val(row, demo_cols["education_unknown_pct"])),
                    "white_pct": pct(val(row, demo_cols["white_pct"])),
                    "hispanic_pct": pct(val(row, demo_cols["hispanic_pct"])),
                    "black_pct": pct(val(row, demo_cols["black_pct"])),
                    "asian_pct": pct(val(row, demo_cols["asian_pct"])),
                    "other_pct": pct(val(row, demo_cols["other_pct"])),
                },
                "elections": elections,
                "view_margins": view_margins,
                "pres_2024_margin": top_ticket_margins["pres_2024"],
                "gov_2022_margin": top_ticket_margins["gov_2022"],
                "ussen_2022_margin": top_ticket_margins["ussen_2022"],
                "top_ticket_totals": {
                    "pres_2024": top_ticket_totals["pres_2024"],
                    "gov_2022": top_ticket_totals["gov_2022"],
                    "ussen_2022": top_ticket_totals["ussen_2022"],
                },
                "candidates_2026": {"rep": rep_name, "dem": dem_name},
            }
        )

    out.sort(key=lambda r: (r["state_fips"], r["district_id"]))
    return out



def parse_candidate_header_seat(header: str, prefix: str):
    m = re.match(rf"^{prefix}(?:\s+(\d+))?$", header)
    if not m:
        return None
    return int(m.group(1) or 1)


def build_special_overrides(sheet_rows: List[Tuple[int, Dict[int, str]]], tab_name: str):
    state_abbr, chamber = parse_special_sheet_identity(tab_name)
    if not state_abbr or not chamber:
        return state_abbr, chamber, []

    header_cells = {}
    for rid, row in sheet_rows:
        if rid == 2:
            header_cells = row
            break
    if not header_cells:
        return state_abbr, chamber, []

    headers = {ci: clean_header(v) for ci, v in header_cells.items()}

    party_cols: Dict[int, int] = {}
    incumbent_cols: Dict[int, int] = {}
    rep_candidate_cols: Dict[int, int] = {}
    dem_candidate_cols: Dict[int, int] = {}

    for ci, h in headers.items():
        m_party = re.match(r"^PARTY(?:\s+(\d+))?$", h)
        if m_party:
            party_cols[int(m_party.group(1) or 1)] = ci
            continue

        m_inc = re.match(r"^INCUMBENT(?:\s+(\d+))?$", h)
        if m_inc:
            incumbent_cols[int(m_inc.group(1) or 1)] = ci
            continue

        seat_rep = parse_candidate_header_seat(h, "GOP CANDIDATE")
        if seat_rep is not None:
            rep_candidate_cols[seat_rep] = ci
            continue

        seat_dem = parse_candidate_header_seat(h, "DEM CANDIDATE")
        if seat_dem is not None:
            dem_candidate_cols[seat_dem] = ci
            continue

    def candidate_value(row: Dict[int, str], col_map: Dict[int, int], seat: int):
        ci = col_map.get(seat)
        if ci is None:
            return ""
        return str(row.get(ci, "") or "").strip()

    overrides = []
    for rid, row in sheet_rows:
        if rid <= 2:
            continue

        raw_district = str(row.get(col_to_idx("A"), "") or "").strip()
        if not raw_district:
            continue

        populated_seats = []
        for seat in sorted(set(party_cols.keys()) | set(incumbent_cols.keys())):
            party_text = str(row.get(party_cols.get(seat, -1), "") or "").strip()
            inc_text = str(row.get(incumbent_cols.get(seat, -1), "") or "").strip()
            if party_text or inc_text:
                populated_seats.append(seat)

        if not populated_seats:
            populated_seats = [1]

        members = []
        for seat in populated_seats:
            party_text = str(row.get(party_cols.get(seat, -1), "") or "").strip()
            inc_name = str(row.get(incumbent_cols.get(seat, -1), "") or "").strip() or "Vacant"
            inc_party = party_norm(party_text)
            rep_name = candidate_value(row, rep_candidate_cols, seat) or "No candidate"
            dem_name = candidate_value(row, dem_candidate_cols, seat) or "No candidate"

            seat_label = f"Seat {seat}" if tab_name in SEAT_NUMBERED_TABS else ""
            members.append(
                {
                    "seat": seat,
                    "seat_label": seat_label,
                    "incumbent": {
                        "name": inc_name,
                        "party": inc_party,
                    },
                    "candidates": {
                        "rep": rep_name,
                        "dem": dem_name,
                    },
                }
            )

        populated_candidate_seats = set()
        for seat in sorted(set(rep_candidate_cols.keys()) | set(dem_candidate_cols.keys())):
            rep_value = candidate_value(row, rep_candidate_cols, seat)
            dem_value = candidate_value(row, dem_candidate_cols, seat)
            if has_nonempty_candidate(rep_value) or has_nonempty_candidate(dem_value):
                populated_candidate_seats.add(seat)

        if tab_name == "WV SLDU":
            candidate_seats_up = 1
        elif populated_candidate_seats:
            candidate_seats_up = len(populated_candidate_seats)
        elif len(rep_candidate_cols) <= 1 and len(dem_candidate_cols) <= 1:
            candidate_seats_up = 1
        else:
            candidate_seats_up = len(populated_seats)
        overrides.append(
            {
                "raw_district": raw_district,
                "district_ids": district_id_candidates(raw_district),
                "district_name_norm": normalize_district_name_match(raw_district),
                "members": members,
                "candidate_seats_up": candidate_seats_up,
            }
        )

    return state_abbr, chamber, overrides


def apply_special_overrides(base_rows: List[dict], overrides: List[dict]):
    if not base_rows or not overrides:
        return 0

    by_id: Dict[str, dict] = {}
    by_canonical: Dict[str, List[dict]] = {}
    for row in base_rows:
        did = normalize_district_id(row.get("district_id"))
        if not did:
            continue
        by_id[did] = row
        canon = canonical_district_id(did)
        by_canonical.setdefault(canon, []).append(row)

    applied = 0
    for ov in overrides:
        target = None

        for candidate_id in ov.get("district_ids", []):
            did = normalize_district_id(candidate_id)
            if did in by_id:
                target = by_id[did]
                break

            canon = canonical_district_id(did)
            matches = by_canonical.get(canon, [])
            if len(matches) == 1:
                target = matches[0]
                break

        if target is None:
            ov_name = ov.get("district_name_norm", "")
            if ov_name:
                name_matches = []
                for row in base_rows:
                    dn = normalize_district_name_match(row.get("district_name", ""))
                    if not dn:
                        continue
                    if ov_name in dn or dn in ov_name:
                        name_matches.append(row)
                if len(name_matches) == 1:
                    target = name_matches[0]

        if target is None:
            continue

        members = ov.get("members", []) or []
        if not members:
            continue

        primary = None
        for member in members:
            if has_named_incumbent(member.get("incumbent", {}).get("name", "")):
                primary = member
                break
        if primary is None:
            primary = members[0]

        rep_primary = str(primary.get("candidates", {}).get("rep", "") or "").strip() or "No candidate"
        dem_primary = str(primary.get("candidates", {}).get("dem", "") or "").strip() or "No candidate"
        inc_name = str(primary.get("incumbent", {}).get("name", "") or "").strip() or "Vacant"
        inc_party = party_norm(primary.get("incumbent", {}).get("party", ""))

        target["members"] = members
        target["candidate_seats_up"] = int(ov.get("candidate_seats_up") or len(members) or 1)
        target["incumbent"] = {"name": inc_name, "party": inc_party}
        target["candidates_2026"] = {"rep": rep_primary, "dem": dem_primary}
        applied += 1

    return applied


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


def build_chamber_name_map(sheet_rows: List[Tuple[int, Dict[int, str]]]):
    rows = rows_to_matrix(sheet_rows)
    if not rows:
        return {}

    out = {}
    header = [str(value or "").strip().lower() for value in (rows[0] or [])]
    col_state = header.index("state") if "state" in header else -1
    col_lower = header.index("lower") if "lower" in header else -1
    col_upper = header.index("upper") if "upper" in header else -1

    if col_state >= 0 and col_lower >= 0 and col_upper >= 0:
        for row in rows[1:]:
            state_abbr = normalize_workbook_state(row[col_state] if col_state < len(row) else "")
            if not state_abbr:
                continue
            lower_name = str(row[col_lower] if col_lower < len(row) else "").strip()
            upper_name = str(row[col_upper] if col_upper < len(row) else "").strip()
            if lower_name:
                out[f"{state_abbr}|house"] = f"{state_abbr} {lower_name}"
            if upper_name:
                out[f"{state_abbr}|senate"] = f"{state_abbr} {upper_name}"
            continue

        return dict(sorted(out.items()))

    normalized_header = {
        str(value or "").strip().lower(): idx
        for idx, value in enumerate(rows[0] or [])
        if str(value or "").strip()
    }
    col_state = normalized_header.get("state")
    col_chamber = normalized_header.get("chamber")
    col_name = None
    for key in (
        "officialname",
        "official_name",
        "official",
        "name",
        "chamber name",
        "official chamber name",
    ):
        if key in normalized_header:
            col_name = normalized_header[key]
            break

    if col_state is None or col_chamber is None or col_name is None:
        return {}

    for row in rows[1:]:
        state_abbr = normalize_workbook_state(row[col_state] if col_state < len(row) else "")
        chamber = normalize_chamber_label(row[col_chamber] if col_chamber < len(row) else "")
        name = str(row[col_name] if col_name < len(row) else "").strip()
        if not state_abbr or not chamber or not name:
            continue
        out[f"{state_abbr}|{chamber}"] = name

    return dict(sorted(out.items()))


def discover_states(sheets: Dict[str, List[Tuple[int, Dict[int, str]]]]) -> List[str]:
    found = set()
    for sheet_name in ("SLDL", "SLDU"):
        for rid, row in sheets.get(sheet_name, []):
            if rid <= 2:
                continue
            state_abbr = normalize_workbook_state(row.get(col_to_idx("B"), ""))
            if state_abbr:
                found.add(state_abbr)
    return sorted(found)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", required=True, help="Path to workbook .xlsx")
    parser.add_argument("--states", required=True, help='Comma-separated state abbreviations (e.g. MI,MN) or "ALL"')
    parser.add_argument("--output-dir", default="data", help="Output directory")
    parser.add_argument(
        "--targets-out",
        default="data/target_districts.json",
        help="Output path for target districts JSON extracted from Overview tab",
    )
    parser.add_argument(
        "--index-out",
        default="data/chamber_files.json",
        help="Output path for chamber file index JSON",
    )
    parser.add_argument(
        "--chamber-names-out",
        default="data/state_chamber_names.json",
        help="Output path for chamber name metadata JSON",
    )
    args = parser.parse_args()

    workbook = Path(args.workbook)
    out_dir = Path(args.output_dir)
    targets_out = Path(args.targets_out)
    index_out = Path(args.index_out)
    chamber_names_out = Path(args.chamber_names_out)

    sheets = load_workbook_rows(workbook)
    modeling_rows = build_modeling_rows(sheets.get("Modeling", []))

    full_run = args.states.strip().upper() == "ALL"
    if full_run:
        states = discover_states(sheets)
    else:
        states = sorted({s.strip().upper() for s in args.states.split(",") if s.strip()})

    special_overrides_map: Dict[Tuple[str, str], List[dict]] = {}
    tier_audit: Dict[str, dict] = {}
    for sheet_name, sheet_rows in sheets.items():
        state_abbr, chamber, overrides = build_special_overrides(sheet_rows, sheet_name)
        if not state_abbr or not chamber or not overrides:
            continue
        special_overrides_map[(state_abbr, chamber)] = overrides

    out_dir.mkdir(parents=True, exist_ok=True)
    chamber_index = {"house": [], "senate": []}

    for state_abbr in states:
        for chamber in ("house", "senate"):
            sheet_name = SHEET_FOR_CHAMBER[chamber]
            rows = build_rows(sheets.get(sheet_name, []), state_abbr, tier_audit=tier_audit, sheet_name=sheet_name)
            modeling_applied = apply_modeling_rows(rows, modeling_rows, state_abbr, chamber)
            overrides = special_overrides_map.get((state_abbr, chamber), [])
            applied = apply_special_overrides(rows, overrides)

            if not rows:
                print(f"Skip {state_abbr} {chamber}: no rows")
                continue

            out_name = OUTPUT_NAME.get((state_abbr, chamber), f"{state_abbr.lower()}_{chamber}.json")
            out_path = out_dir / out_name
            with out_path.open("w", encoding="utf-8") as f:
                json.dump(rows, f, indent=2)
                f.write("\n")

            chamber_index[chamber].append(
                {
                    "state": state_abbr,
                    "url": f"{out_dir.as_posix().rstrip('/')}/{out_name}",
                    "rows": len(rows),
                    "specialOverridesApplied": applied,
                    "modelingApplied": modeling_applied,
                }
            )
            print(f"Wrote {out_path} rows={len(rows)} overrides={applied} modeling={modeling_applied}")

    for chamber in ("house", "senate"):
        chamber_index[chamber].sort(key=lambda x: (x.get("state", ""), x.get("url", "")))

    if full_run:
        index_out.parent.mkdir(parents=True, exist_ok=True)
        with index_out.open("w", encoding="utf-8") as f:
            json.dump(chamber_index, f, indent=2)
            f.write("\n")
        print(f"Wrote {index_out}")

        overview_rows = sheets.get("Overview")
        if overview_rows:
            targets = build_target_rows(overview_rows)
            targets_out.parent.mkdir(parents=True, exist_ok=True)
            with targets_out.open("w", encoding="utf-8") as f:
                json.dump(targets, f, indent=2)
                f.write("\n")
            print(f"Wrote {targets_out} rows={len(targets)}")

        chamber_name_rows = sheets.get("Chamber Names")
        if chamber_name_rows:
            chamber_name_map = build_chamber_name_map(chamber_name_rows)
            chamber_names_out.parent.mkdir(parents=True, exist_ok=True)
            with chamber_names_out.open("w", encoding="utf-8") as f:
                json.dump(chamber_name_map, f, indent=2)
                f.write("\n")
            print(f"Wrote {chamber_names_out} rows={len(chamber_name_map)}")
    else:
        print(f"Preserved existing {index_out}, {targets_out}, and {chamber_names_out} for partial state regeneration.")

    for sheet_name in ("SLDL", "SLDU"):
        bucket = tier_audit.get(sheet_name) or {}
        invalid_djt = int(bucket.get("invalid_djt") or 0)
        invalid_leg = int(bucket.get("invalid_leg") or 0)
        both_valid = list(bucket.get("both_valid") or [])
        if invalid_djt:
            print(f"WARNING: {sheet_name} ignored {invalid_djt} DJT Tier values outside 1-4.")
        if invalid_leg:
            print(f"WARNING: {sheet_name} ignored {invalid_leg} Leg Tier values outside 1-4.")
        if both_valid:
            examples = ", ".join(
                f"{item['state']}-{item['district_id']} (DJT {item['djt_tier']}, Leg {item['leg_tier']})"
                for item in both_valid[:8]
            )
            print(
                f"WARNING: {sheet_name} has {len(both_valid)} rows with both DJT Tier and Leg Tier set; "
                f"using DJT Tier. Examples: {examples}"
            )

    from validate_chamber_jsons import validate_generated_outputs

    errors, warnings = validate_generated_outputs(out_dir, index_out)
    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)
    print("Validation passed.")


if __name__ == "__main__":
    main()

