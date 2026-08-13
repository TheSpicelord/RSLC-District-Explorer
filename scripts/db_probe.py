"""Verify the SQL Server connection and list candidate model tables.

    python scripts/db_probe.py                 # connection test + model-ish tables
    python scripts/db_probe.py --all           # every table in the database
    python scripts/db_probe.py --columns NAME  # column list for one table

VPN required. Read-only — issues no writes.
"""

import argparse
import sys

from db import connect, load_config

MODEL_NAME_HINTS = ("rslc", "rga", "hrcc", "exchange", "audience", "model", "score")


def list_tables(cursor, only_model_like=True):
    cursor.execute(
        """
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
    )
    rows = [(s, t) for s, t in cursor.fetchall()]
    if only_model_like:
        rows = [r for r in rows if any(h in r[1].lower() for h in MODEL_NAME_HINTS)]
    return rows


def show_columns(cursor, table_name):
    cursor.execute(
        """
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
        """,
        table_name,
    )
    rows = cursor.fetchall()
    if not rows:
        print(f"No such table: {table_name}")
        return
    print(f"\nColumns in {table_name}:")
    for name, dtype, nullable in rows:
        print(f"  {name:<48} {dtype:<18} {'NULL' if nullable == 'YES' else 'NOT NULL'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="List every table, not just model-like ones")
    parser.add_argument("--columns", metavar="TABLE", help="Show columns for one table")
    args = parser.parse_args()

    cfg = load_config()
    print(f"Connecting to {cfg['server']} / {cfg['database']} ...")
    try:
        conn = connect(cfg)
    except Exception as e:
        print(f"\nConnection FAILED: {e}")
        print("\nCheck: VPN connected? Credentials correct in scripts/db_config.ini?")
        print("       ODBC Driver 17 for SQL Server installed?")
        sys.exit(1)

    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT @@VERSION")
        version = cursor.fetchone()[0].splitlines()[0]
        print(f"Connected OK — {version}\n")

        if args.columns:
            show_columns(cursor, args.columns)
            return

        tables = list_tables(cursor, only_model_like=not args.all)
        label = "tables" if args.all else "model-like tables"
        print(f"{len(tables)} {label}:")
        for schema, name in tables:
            print(f"  {schema}.{name}")

        if not args.all:
            print("\n(--all lists every table; --columns TABLE shows one table's columns)")


if __name__ == "__main__":
    main()
