"""Build data/polling.json from the 2025-26 Polling Tracker workbook.

Reads the per-state battleground tabs (currently just MI) and emits district-keyed
poll toplines for the District Explorer's Polling panel. Non-battleground districts
simply have no entry; the panel shows "No polling data."

The tracker stores margins as R-minus-D fractions and toplines as percentages; only
toplines (plus top issue) are published. Keys are the app's join keys ("26|044").

Usage:
    python scripts/build_polling_json.py
"""

import json
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string

ROOT = Path(__file__).resolve().parent.parent
TRACKER = ROOT / "data" / "2025-26 Polling Tracker.xlsx"
OUT = ROOT / "data" / "polling.json"

# Per-tab layout: state fips, data rows, and topline column blocks.
# Ballot blocks are (key, label, (R, D, L-or-None, U)); image blocks (key, label, (+, -, U)).
MI_BALLOTS = [
    ("leg", "State Leg Ballot", ("BQ", "BR", None, "BS")),
    ("leg_informed", "Informed State Leg", ("CA", "CB", None, "CC")),
    ("gov", "Governor", ("CK", "CL", "CM", "CN")),
    ("ussen", "US Senate", ("CW", "CX", "CY", "CZ")),
    ("sos", "Secretary of State", ("DI", "DJ", "DK", "DL")),
]
MI_IMAGES = [
    ("trump", "Trump Image", ("DU", "DV", "DW")),
    ("gop_cand", "GOP Candidate Image", ("EE", "EF", "EG")),
    ("dem_cand", "Dem Candidate Image", ("EO", "EP", "EQ")),
]

# Free-text notes that live outside the table (kept by hand; re-check when the
# tracker gains rows). Each is (chamber, join key, entry).
EXTRA_ENTRIES = [
    ("senate", "26|035", {
        "date": "2026-08", "label": "2026", "source": "SRCC",
        "note": "SRCC poll had SD-35 at D+8.",
        "ballots": {}, "images": {},
    }),
]


def pctv(v):
    if v is None or v == "":
        return None
    return round(float(v), 1)


def build_mi(wb, out):
    ws = wb["MI"]

    def g(row, col):
        return row[column_index_from_string(col) - 1].value

    for row in ws.iter_rows(min_row=5, max_row=18):
        chamber_raw = g(row, "B")
        if not chamber_raw:
            continue
        chamber = "house" if str(chamber_raw).strip() == "House" else "senate"
        key = f"26|{int(g(row, 'C')):03d}"
        rep = str(g(row, "E") or "").strip()
        dem = str(g(row, "F") or "").strip()
        entry = {
            "date": "2026-08",
            "label": "Aug 2026",
            "rep": rep.replace("*", ""),
            "dem": dem.replace("*", ""),
            "rep_inc": rep.endswith("*"),
            "dem_inc": dem.endswith("*"),
            "ballots": {},
            "images": {},
            "top_issue": str(g(row, "BM") or "").strip() or None,
        }
        for bkey, label, cols in MI_BALLOTS:
            r, d, l, u = (pctv(g(row, c)) if c else None for c in cols)
            if r is None and d is None:
                continue
            entry["ballots"][bkey] = {"label": label, "r": r, "d": d, "l": l, "u": u}
        for ikey, label, cols in MI_IMAGES:
            p, m, u = (pctv(g(row, c)) for c in cols)
            if p is None and m is None:
                continue
            entry["images"][ikey] = {"label": label, "pos": p, "neg": m, "u": u}
        out[chamber].setdefault(key, []).append(entry)


def main():
    wb = openpyxl.load_workbook(TRACKER, read_only=True, data_only=True)
    out = {"house": {}, "senate": {}}
    build_mi(wb, out)
    wb.close()
    for chamber, key, entry in EXTRA_ENTRIES:
        out[chamber].setdefault(key, []).append(entry)
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    n = sum(len(v) for c in out.values() for v in c.values())
    print(f"Wrote {OUT.name}: {len(out['house'])} house + {len(out['senate'])} senate districts, {n} poll entries.")


if __name__ == "__main__":
    main()
