"""Resolve a voter-file district to the district_id a chamber JSON actually uses.

Most chambers key on zero-padded integers, but eight do not, so a voter-file row is
matched against the IDs present in the chamber file rather than formatted blindly:

    ak_senate                 DISTRICT A -> 00A
    ma_senate                 integer    -> D01
    md/mn/nd/sd house         district + subdistrict -> 01A
    vt_house                  matched via district_name ("Addison-1" -> A-1)
    vt_senate                 explicit county crosswalk (Windsor -> WSR)

Shared by build_national_margins.py (every fallback state) and build_model_margins.py
(states whose dedicated model sets resolve_names, i.e. Alaska). Anything that fails to
resolve is returned as None so the caller can report it rather than silently drop it.
"""

import re

# Vermont senate districts are county-based; the app uses 3-letter codes.
VT_SENATE = {
    "ADDISON": "ADD", "BENNINGTON": "BEN", "CALEDONIA": "CAL",
    "CHITTENDEN CENTRAL": "CHC", "CHITTENDEN NORTH": "CHN",
    "CHITTENDEN SOUTHEAST": "CHS", "ESSEX": "ESX", "FRANKLIN": "FRA",
    "GRAND ISLE": "GRI", "LAMOILLE": "LAM", "ORANGE": "ORA", "ORLEANS": "ORL",
    "RUTLAND": "RUT", "WASHINGTON": "WAS", "WINDHAM": "WDH", "WINDSOR": "WSR",
}

NAME_SUFFIX = re.compile(
    r"\s+STATE\s+(HOUSE|SENATE|LEGISLATIVE)\s+DISTRICT$|\s+DISTRICT$", re.I)

# Massachusetts writes house districts as ordinal words in the voter file ("EIGHTEENTH
# ESSEX") but as numerals in the app ("18th Essex"). Worse, the two sources number the
# districts on entirely different schemes — the voter file alphabetically, the app by
# county — so an integer join silently pairs unrelated districts. Names are the only
# reliable key, which means both spellings have to reduce to the same canonical form.
_UNITS = {"FIRST": 1, "SECOND": 2, "THIRD": 3, "FOURTH": 4, "FIFTH": 5, "SIXTH": 6,
          "SEVENTH": 7, "EIGHTH": 8, "NINTH": 9}
_TEENS = {"TENTH": 10, "ELEVENTH": 11, "TWELFTH": 12, "THIRTEENTH": 13, "FOURTEENTH": 14,
          "FIFTEENTH": 15, "SIXTEENTH": 16, "SEVENTEENTH": 17, "EIGHTEENTH": 18,
          "NINETEENTH": 19}
_TENS = {"TWENTY": 20, "THIRTY": 30, "FORTY": 40}
# Standalone tens ordinals — "TWENTIETH MIDDLESEX", not "TWENTY FIRST MIDDLESEX".
_TENS_ORDINAL = {"TWENTIETH": 20, "THIRTIETH": 30, "FORTIETH": 40}


def _ordinal_tokens(tokens):
    """Fold ordinal words/numerals into bare digits: EIGHTEENTH -> 18, 18TH -> 18."""
    out, i = [], 0
    while i < len(tokens):
        t = tokens[i]
        if t in _TENS_ORDINAL:
            out.append(str(_TENS_ORDINAL[t]))
        elif t in _TENS:
            val = _TENS[t]
            if i + 1 < len(tokens) and tokens[i + 1] in _UNITS:
                val += _UNITS[tokens[i + 1]]
                i += 1
            out.append(str(val))
        elif t in _TEENS:
            out.append(str(_TEENS[t]))
        elif t in _UNITS:
            out.append(str(_UNITS[t]))
        else:
            m = re.fullmatch(r"(\d+)(ST|ND|RD|TH)", t)
            out.append(m.group(1) if m else t)
        i += 1
    return out


def normalize_name(s):
    s = str(s or "").strip().upper()
    s = NAME_SUFFIX.sub("", s)
    s = s.replace("-", " ").replace(",", " ")
    tokens = [t for t in s.split() if t and t != "AND"]
    return " ".join(_ordinal_tokens(tokens)).strip()


def make_resolver(state, chamber, recs):
    """Map a voterfile (district, proper, subdistrict) tuple to this chamber's district_id."""
    ids = {str(r.get("district_id")) for r in recs}
    by_name = {}
    for r in recs:
        nm = normalize_name(r.get("district_name"))
        if nm:
            by_name.setdefault(nm, str(r.get("district_id")))

    def resolve(n, proper, sub):
        p = normalize_name(proper)
        s = str(sub or "").strip().upper()

        # 1. Descriptive name match — VT house ("ADDISON-1" -> "A-1").
        if p and p in by_name:
            return by_name[p]
        # 2. Explicit crosswalks.
        if state == "VT" and chamber == "senate":
            cand = VT_SENATE.get(p)
            if cand and cand in ids:
                return cand
        m = re.fullmatch(r"DISTRICT\s+([A-Z0-9]+)", p)
        if m and f"00{m.group(1)}" in ids:
            return f"00{m.group(1)}"
        # 3. Mechanical integer forms.
        if n:
            cands = ([f"{n:02d}{s}"] if s else []) + [f"{n:03d}", f"D{n:02d}", str(n)]
            for c in cands:
                if c in ids:
                    return c
        return None

    return resolve

