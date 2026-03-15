from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List, Tuple


def normalize_state_fips(value) -> str:
    digits = "".join(ch for ch in str(value or "").strip() if ch.isdigit())
    return digits.zfill(2) if digits else ""


def normalize_district_id(value) -> str:
    raw = str(value or "").strip().upper().replace(" ", "")
    if not raw:
        return ""
    if raw.isdigit():
        return raw.zfill(3)
    return raw


def row_join_key(row: dict) -> str:
    return f"{normalize_state_fips(row.get('state_fips'))}|{normalize_district_id(row.get('district_id'))}"


def latest_leg_margin(row: dict):
    view_margins = row.get("view_margins") or {}
    if isinstance(view_margins.get("latest_leg"), (int, float)):
        return float(view_margins["latest_leg"])

    years = [2025, 2024, 2023, 2022]
    for year in years:
        key = f"leg_{year}"
        if isinstance(view_margins.get(key), (int, float)):
            return float(view_margins[key])

    for year in years:
        key = f"state_leg_{year}_margin"
        if isinstance(row.get(key), (int, float)):
            return float(row[key])

    for election in sorted(row.get("elections", []), key=lambda item: item.get("year", 0), reverse=True):
        dem = election.get("dem_pct")
        rep = election.get("rep_pct")
        if isinstance(dem, (int, float)) and isinstance(rep, (int, float)):
            return float(dem) - float(rep)

    return None


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_index(repo_root: Path, index_path: Path) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    index = load_json(index_path)
    if not isinstance(index, dict):
        return ["Index JSON is not an object."], warnings

    house_entries = index.get("house") or []
    senate_entries = index.get("senate") or []

    if any(str(entry.get("state") or "").upper() == "NE" for entry in house_entries):
        errors.append("NE house should not be present in chamber index.")

    seen_urls = set()
    for chamber, entries in (("house", house_entries), ("senate", senate_entries)):
        if not isinstance(entries, list):
            errors.append(f"Index entry for {chamber} is not a list.")
            continue

        for entry in entries:
            state = str(entry.get("state") or "").upper()
            url = str(entry.get("url") or "").strip()
            expected_rows = entry.get("rows")

            if not state or not url:
                errors.append(f"{chamber} index contains an incomplete entry: {entry!r}")
                continue

            if url in seen_urls:
                errors.append(f"Duplicate file URL in chamber index: {url}")
                continue
            seen_urls.add(url)

            file_path = repo_root / url
            if not file_path.exists():
                errors.append(f"Missing indexed data file: {url}")
                continue

            rows = load_json(file_path)
            if not isinstance(rows, list):
                errors.append(f"Indexed data file is not an array: {url}")
                continue

            if isinstance(expected_rows, int) and len(rows) != expected_rows:
                errors.append(f"{url} row count mismatch: index={expected_rows} actual={len(rows)}")

            file_errors, file_warnings = validate_rows(state, chamber, url, rows)
            errors.extend(file_errors)
            warnings.extend(file_warnings)

    return errors, warnings


def validate_rows(state_abbr: str, chamber: str, url: str, rows: List[dict]) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    seen_join_keys = set()
    missing_latest_leg = 0
    multi_member_rows = 0
    multi_member_one_seat_up_rows = 0

    for idx, row in enumerate(rows, start=1):
        join_key = row_join_key(row)
        if not join_key or join_key == "|":
            errors.append(f"{url} row {idx} is missing a usable join key.")
        elif join_key in seen_join_keys:
            errors.append(f"{url} duplicate join key: {join_key}")
        else:
            seen_join_keys.add(join_key)

        tier = row.get("tier")
        if tier is not None and tier not in (1, 2, 3, 4):
            errors.append(f"{url} row {idx} has invalid tier={tier!r}; expected 1-4 or null.")

        models = row.get("models")
        if models is not None and not isinstance(models, dict):
            errors.append(f"{url} row {idx} has invalid models payload; expected object.")
        elif isinstance(models, dict):
            view_margins = row.get("view_margins") or {}
            for model_key, model_entry in models.items():
                if not isinstance(model_entry, dict):
                    errors.append(f"{url} row {idx} has invalid model entry for {model_key!r}.")
                    continue
                affinity = model_entry.get("affinity")
                if affinity is None:
                    continue
                if not isinstance(affinity, dict):
                    errors.append(f"{url} row {idx} has invalid affinity block for {model_key!r}.")
                    continue
                margin = affinity.get("margin")
                if not isinstance(margin, (int, float)):
                    errors.append(f"{url} row {idx} is missing numeric affinity margin for {model_key!r}.")
                    continue
                view_margin = view_margins.get(model_key)
                if isinstance(view_margin, (int, float)) and abs(float(view_margin) - float(margin)) > 0.15:
                    errors.append(
                        f"{url} row {idx} has mismatched model margin for {model_key!r}: "
                        f"view_margins={view_margin} affinity={margin}."
                    )

        members = row.get("members") or []
        if not isinstance(members, list) or not members:
            errors.append(f"{url} row {idx} has no members array.")
            continue

        if len(members) > 1:
            multi_member_rows += 1

        candidate_seats_up = row.get("candidate_seats_up")
        if not isinstance(candidate_seats_up, int) or candidate_seats_up < 1 or candidate_seats_up > len(members):
            errors.append(
                f"{url} row {idx} has invalid candidate_seats_up={candidate_seats_up} for members={len(members)}."
            )
        if len(members) > 1 and candidate_seats_up == 1:
            multi_member_one_seat_up_rows += 1

        if latest_leg_margin(row) is None:
            missing_latest_leg += 1

    if missing_latest_leg:
        warnings.append(f"{url} has {missing_latest_leg} rows with no latest legislative margin.")

    special_errors = validate_special_cases(state_abbr, chamber, url, rows, multi_member_rows, multi_member_one_seat_up_rows)
    errors.extend(special_errors)

    return errors, warnings


def validate_special_cases(
    state_abbr: str,
    chamber: str,
    url: str,
    rows: List[dict],
    multi_member_rows: int,
    multi_member_one_seat_up_rows: int,
) -> List[str]:
    errors: List[str] = []

    if (state_abbr, chamber) in {
        ("AZ", "house"),
        ("NJ", "house"),
        ("MD", "house"),
        ("VT", "house"),
        ("VT", "senate"),
        ("NH", "house"),
    }:
        if multi_member_rows == 0:
            errors.append(f"{url} expected multi-member districts but none were found.")

    if (state_abbr, chamber) in {("ID", "house"), ("WA", "house")}:
        bad_rows = []
        for row in rows:
            members = row.get("members") or []
            seat_labels = [str(member.get("seat_label") or "").strip() for member in members]
            if len(members) != 2 or seat_labels != ["Seat 1", "Seat 2"]:
                bad_rows.append(row.get("district_id"))
        if bad_rows:
            errors.append(f"{url} expected all rows to have Seat 1/Seat 2 pairs; bad districts: {bad_rows[:8]}")

    if (state_abbr, chamber) == ("WV", "senate") and multi_member_one_seat_up_rows == 0:
        errors.append(f"{url} expected at least one multi-member district with candidate_seats_up=1.")

    return errors


def validate_generated_outputs(output_dir: Path, index_path: Path) -> Tuple[List[str], List[str]]:
    repo_root = output_dir.parent if output_dir.name == "data" else output_dir
    return validate_index(repo_root, index_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="data", help="Directory containing chamber JSON files")
    parser.add_argument("--index", default="data/chamber_files.json", help="Path to chamber index JSON")
    args = parser.parse_args()

    errors, warnings = validate_generated_outputs(Path(args.output_dir), Path(args.index))
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")

    if errors:
        raise SystemExit(1)
    print("Validation passed.")


if __name__ == "__main__":
    main()
