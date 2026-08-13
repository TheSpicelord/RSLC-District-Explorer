"""SQL Server connection helper for the District Explorer.

Credentials live in scripts/db_config.ini (gitignored — see db_config.template.ini).
Reaching the server requires VPN.

    from db import connect, load_config
    with connect(load_config()) as conn:
        ...

Requires: pip install pyodbc
"""

import configparser
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "scripts" / "db_config.ini"

DEFAULT_DRIVER = "ODBC Driver 17 for SQL Server"


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit(
            f"Missing {CONFIG_PATH}.\n"
            "Copy scripts/db_config.template.ini to scripts/db_config.ini and fill in credentials."
        )
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH, encoding="utf-8")
    return cfg["sqlserver"]


def connect(cfg, timeout=30):
    import pyodbc

    driver = cfg.get("driver", DEFAULT_DRIVER)
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={cfg['server']};"
        f"DATABASE={cfg['database']};"
        f"UID={cfg['username']};"
        f"PWD={cfg['password']};"
        "Encrypt=yes;TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=timeout)
