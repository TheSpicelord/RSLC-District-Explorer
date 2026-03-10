import csv
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://en.wikipedia.org/wiki/List_of_U.S._state_representatives_(Alabama_to_Missouri)"
OUTPUT_PATH = Path(__file__).resolve().parent / "state_house_members_alabama_to_missouri.csv"
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
}
SKIP_HEADINGS = {
    "Summary",
    "Superlatives",
    "Terminology for lower houses",
    "See also",
    "References",
    "Notes",
    "External links",
}
PARTY_ALIAS = {
    "R": "R",
    "REP": "R",
    "REPUBLICAN": "R",
    "D": "D",
    "DEM": "D",
    "DEMOCRAT": "D",
    "DEMOCRATIC": "D",
    "DFL": "D",
    "I": "I",
    "IND": "I",
    "INDEPENDENT": "I",
}


def clean_member_name(raw: str) -> str:
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    # Remove leading template glyphs / separators (e.g., colored bar symbols).
    text = re.sub(r"^[^\w]+", "", text, flags=re.UNICODE).strip()
    return text


def normalize_party(raw: str) -> str:
    token = str(raw or "").strip().split(",", 1)[0].strip()
    key = re.sub(r"[^A-Za-z]", "", token).upper()
    if not key:
        return ""
    return PARTY_ALIAS.get(key, key[:3] if len(key) > 3 else key)


def parse_member_li(li):
    text = li.get_text(" ", strip=True)
    # Typical rows:
    # "Jane Doe (R)"
    # "1A. Jane Doe (R)"
    # "Jane Doe (D, 1st Barnstable)"
    m = re.match(r"^(?:(\d+[A-Z]?)\.\s*)?(.*?)\s+\(([^)]+)\)\s*$", text)
    if m:
        district_raw = (m.group(1) or "").strip()
        member = clean_member_name(m.group(2))
        party = normalize_party(m.group(3).strip())
        return district_raw, member, party
    # Fallback when party suffix is missing/odd.
    return "", clean_member_name(text), ""


def parse_member_text_block(text: str):
    # Handles navboxes that render members as plain text instead of <li> list items.
    # Example:
    # "1A. John Burkel (R) 1B. Steve Gander (R) ..."
    pattern = re.compile(r"([0-9]+[A-Z]?)\.\s*(.*?)\s+\(([^)]+)\)(?=\s+[0-9]+[A-Z]?\.\s|$)")
    out = []
    for m in pattern.finditer(text):
        district = m.group(1).strip()
        member = clean_member_name(m.group(2))
        party = normalize_party(m.group(3).strip())
        out.append((district, member, party))
    return out


def main():
    response = requests.get(URL, headers=REQUEST_HEADERS, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    rows = []
    seen = set()
    headings = soup.select("div.mw-heading.mw-heading2")
    for heading in headings:
        state = heading.get_text(" ", strip=True).replace("[ edit ]", "").strip()
        if not state or state in SKIP_HEADINGS:
            continue

        # Each state block is a navbox immediately after the heading (with optional navbox-styles div).
        navbox = heading.find_next_sibling("div", class_="navbox")
        if not navbox:
            continue

        table = navbox.find("table")
        if not table:
            continue
        trs = table.find_all("tr")
        if len(trs) < 3:
            continue
        member_td = trs[2].find("td")
        if not member_td:
            continue

        parsed = []
        text_matches = parse_member_text_block(member_td.get_text(" ", strip=True))
        if text_matches:
            parsed.extend(text_matches)
        else:
            member_lis = member_td.find_all("li")
            if not member_lis:
                continue
            for idx, li in enumerate(member_lis, start=1):
                district_raw, member, party = parse_member_li(li)
                district = district_raw if district_raw else str(idx)
                parsed.append((district, member, party))

        for district, member, party in parsed:
            if not member:
                continue
            rec = (state, district, member, party)
            if rec in seen:
                continue
            seen.add(rec)
            rows.append(
                {
                    "state": state,
                    "district": district,
                    "member": member,
                    "party": party,
                }
            )

    def district_sort_key(value: str):
        text = str(value or "").strip().upper()
        m = re.match(r"^(\d+)([A-Z]?)$", text)
        if not m:
            return (10**9, text)
        base = int(m.group(1))
        suffix = m.group(2)
        return (base, suffix)

    rows.sort(key=lambda r: (r["state"], district_sort_key(r["district"])))
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["state", "district", "member", "party"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
