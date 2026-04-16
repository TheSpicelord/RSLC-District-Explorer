#!/usr/bin/env python3
"""
scripts/compute_cd_overlaps.py

Pre-computes which state legislative districts (house and senate) spatially
intersect with target congressional districts from the workbook's
'Congressional Targets' tab.

Usage:
    python scripts/compute_cd_overlaps.py

Reads:
    data/State Legislative Election History.xlsx  (or - Copy.xlsx if locked)
    data/shapes/congressionals/{STATE}.zip        per-state congressional shapefiles
    data/shapes/house.zip                         national house district shapefile
    data/shapes/senate.zip                        national senate district shapefile

Writes:
    data/congressional_targets.json

Output format:
    {
      "target_cds": ["AK-1", "AZ-1", ...],      sorted list of all target CD ids
      "house": { "02|001": ["AK-1"], ... },      join_key -> overlapping target CDs
      "senate": { "02|001": ["AK-1"], ... }
    }

Join keys match the app's "${stateFips}|${districtId}" format (e.g. "26|001").
"""

import os, sys, struct, zipfile, json, re, math
import xml.etree.ElementTree as ET
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

STATE_ABBR_TO_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06",
    "CO": "08", "CT": "09", "DE": "10", "FL": "12", "GA": "13",
    "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19",
    "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24",
    "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29",
    "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34",
    "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45",
    "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50",
    "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56",
}


# ─── Coordinate reprojection ─────────────────────────────────────────────────

def _parse_prj_params(prj_text):
    """Parse a WKT .prj string into a dict of projection type + PARAMETER values."""
    params = {}
    m = re.search(r'PROJECTION\["([^"]+)"\]', prj_text, re.IGNORECASE)
    params['_projection'] = m.group(1) if m else ('' if 'PROJCS' in prj_text else 'Geographic')
    for m in re.finditer(r'PARAMETER\["([^"]+)",\s*([-\d.eE+]+)\]', prj_text):
        try:
            params[m.group(1)] = float(m.group(2))
        except ValueError:
            pass
    m = re.search(r'SPHEROID\["[^"]+",\s*([-\d.eE+]+),\s*([-\d.eE+]+)\]', prj_text)
    if m:
        params['_semi_major'] = float(m.group(1))
        params['_inv_flat']   = float(m.group(2))
    return params


def _make_inverse_projector(prj_params):
    """
    Return a (x, y) -> (lon_deg, lat_deg) function, or None if already geographic.
    Handles: Web Mercator / Mercator_Auxiliary_Sphere, Lambert Conformal Conic,
             Transverse Mercator (UTM).
    """
    proj = prj_params.get('_projection', '').lower().replace(' ', '_').replace('-', '_')
    if not proj or proj == 'geographic':
        return None  # already WGS84 / geographic — no transform needed

    a    = prj_params.get('_semi_major', 6378137.0)
    invf = prj_params.get('_inv_flat',   298.257222101)
    f    = 1.0 / invf
    e2   = 2*f - f*f
    e    = math.sqrt(e2)

    # ── Web Mercator (Mercator_Auxiliary_Sphere, EPSG:3857) ──────────────────
    if 'mercator_auxiliary_sphere' in proj or 'web_mercator' in proj:
        R = 6378137.0
        def inv_web(x, y, _R=R):
            return (math.degrees(x / _R),
                    math.degrees(2*math.atan(math.exp(y / _R)) - math.pi/2))
        return inv_web

    # ── Lambert Conformal Conic ───────────────────────────────────────────────
    if 'lambert_conformal_conic' in proj:
        fe   = prj_params.get('False_Easting',    0.0)
        fn   = prj_params.get('False_Northing',   0.0)
        lon0 = math.radians(prj_params.get('Central_Meridian',    0.0))
        lat0 = math.radians(prj_params.get('Latitude_Of_Origin',  0.0))
        lat1 = math.radians(prj_params.get('Standard_Parallel_1', math.degrees(lat0)))
        lat2 = math.radians(prj_params.get('Standard_Parallel_2', math.degrees(lat1)))

        def _m(phi):
            return math.cos(phi) / math.sqrt(1 - e2 * math.sin(phi)**2)
        def _t(phi):
            s = math.sin(phi)
            return math.tan(math.pi/4 - phi/2) / ((1 - e*s) / (1 + e*s))**(e/2)

        m1, m2       = _m(lat1), _m(lat2)
        t0, t1, t2   = _t(lat0), _t(lat1), _t(lat2)
        n  = math.sin(lat1) if abs(lat1 - lat2) < 1e-10 else (
             (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2)))
        F    = m1 / (n * t1**n)
        rho0 = a * F * t0**n

        def inv_lcc(x, y, _a=a, _e=e, _fe=fe, _fn=fn, _lon0=lon0,
                    _n=n, _F=F, _rho0=rho0):
            dx, dy       = x - _fe, y - _fn
            rho_prime    = math.copysign(math.sqrt(dx*dx + (_rho0-dy)**2), _n)
            theta_prime  = math.atan2(dx, _rho0 - dy)
            if abs(rho_prime) < 1e-10:
                return (math.degrees(_lon0), math.copysign(90.0, _n))
            t_prime = (rho_prime / (_a * _F)) ** (1.0 / _n)
            lon     = theta_prime / _n + _lon0
            phi     = math.pi/2 - 2*math.atan(t_prime)
            for _ in range(10):
                s       = math.sin(phi)
                phi_new = math.pi/2 - 2*math.atan(t_prime * ((1-_e*s)/(1+_e*s))**(_e/2))
                if abs(phi_new - phi) < 1e-12:
                    phi = phi_new
                    break
                phi = phi_new
            return (math.degrees(lon), math.degrees(phi))

        return inv_lcc

    # ── Transverse Mercator (UTM) ─────────────────────────────────────────────
    if 'transverse_mercator' in proj:
        k0   = prj_params.get('Scale_Factor',      0.9996)
        fe   = prj_params.get('False_Easting',   500000.0)
        fn   = prj_params.get('False_Northing',       0.0)
        lon0 = math.radians(prj_params.get('Central_Meridian',   0.0))
        lat0 = math.radians(prj_params.get('Latitude_Of_Origin', 0.0))
        ep2  = e2 / (1 - e2)

        def _M(phi):
            return a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)*phi
                       - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024)*math.sin(2*phi)
                       + (15*e2**2/256 + 45*e2**3/1024)*math.sin(4*phi)
                       - (35*e2**3/3072)*math.sin(6*phi))
        M0 = _M(lat0)

        def inv_tm(x, y, _a=a, _e2=e2, _e=e, _ep2=ep2, _k0=k0,
                   _fe=fe, _fn=fn, _lon0=lon0, _M0=M0):
            M  = _M0 + (y - _fn) / _k0
            mu = M / (_a * (1 - _e2/4 - 3*_e2**2/64 - 5*_e2**3/256))
            e1 = (1 - math.sqrt(1-_e2)) / (1 + math.sqrt(1-_e2))
            phi1 = (mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu)
                       + (21*e1**2/16 - 55*e1**4/32)*math.sin(4*mu)
                       + (151*e1**3/96)*math.sin(6*mu))
            sp1 = math.sin(phi1)
            N1  = _a / math.sqrt(1 - _e2*sp1**2)
            T1  = math.tan(phi1)**2
            C1  = _ep2 * math.cos(phi1)**2
            R1  = _a*(1-_e2) / (1 - _e2*sp1**2)**1.5
            D   = (x - _fe) / (N1 * _k0)
            lat = phi1 - (N1*math.tan(phi1)/R1)*(
                      D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*_ep2)*D**4/24)
            lon = _lon0 + (D - (1 + 2*T1 + C1)*D**3/6) / math.cos(phi1)
            return (math.degrees(lon), math.degrees(lat))

        return inv_tm

    return None  # unsupported projection


# ─── Shapefile parsing ────────────────────────────────────────────────────────

def find_file_in_zip(z, ext):
    """Find the first non-macOS-artifact file with the given extension."""
    return next(
        (n for n in z.namelist()
         if n.lower().endswith(ext) and '__MACOSX' not in n and not os.path.basename(n).startswith('.')),
        None,
    )


def parse_dbf(data):
    """
    Parse a dBASE III/IV DBF file.
    Returns (fields, records) where records is a list of dicts keyed by field name.
    """
    num_records  = struct.unpack_from('<I', data, 4)[0]
    header_size  = struct.unpack_from('<H', data, 8)[0]
    record_size  = struct.unpack_from('<H', data, 10)[0]

    fields = []
    offset = 32
    while offset + 32 <= len(data):
        if data[offset] == 0x0D:   # header terminator
            break
        name   = data[offset:offset+11].rstrip(b'\x00').decode('latin-1', errors='replace')
        length = data[offset+16]
        fields.append({'name': name, 'length': length})
        offset += 32

    records = []
    rec_start = header_size
    for i in range(num_records):
        base = rec_start + i * record_size
        if base + record_size > len(data):
            break
        if data[base] == 0x2A:       # '*' = deleted record
            continue
        record = {}
        field_pos = base + 1         # skip deletion-flag byte
        for field in fields:
            raw = data[field_pos:field_pos + field['length']]
            record[field['name']] = raw.decode('latin-1', errors='replace').strip()
            field_pos += field['length']
        records.append(record)

    return fields, records


def parse_shp_polygons(data):
    """
    Parse a .shp file and return a list of polygon records.
    Each record: {'bbox': (xmin, ymin, xmax, ymax), 'rings': [[(x, y), ...]]}
    Only Polygon (5), PolygonZ (15), PolygonM (25) types are handled.
    """
    POLYGON_TYPES = {5, 15, 25}
    polygons  = []
    file_len  = struct.unpack_from('>I', data, 24)[0] * 2  # 16-bit words → bytes
    offset    = 100                                          # skip 100-byte file header

    while offset + 8 <= len(data) and offset < file_len:
        content_len = struct.unpack_from('>I', data, offset + 4)[0] * 2
        offset += 8

        if content_len < 4 or offset + content_len > len(data):
            offset += content_len
            continue

        shape_type = struct.unpack_from('<I', data, offset)[0]

        if shape_type == 0:
            offset += content_len
            continue

        if shape_type not in POLYGON_TYPES or content_len < 44:
            offset += content_len
            continue

        xmin, ymin, xmax, ymax = struct.unpack_from('<4d', data, offset + 4)
        num_parts  = struct.unpack_from('<I', data, offset + 36)[0]
        num_points = struct.unpack_from('<I', data, offset + 40)[0]

        parts_base  = offset + 44
        points_base = parts_base + num_parts * 4

        if points_base + num_points * 16 > offset + content_len:
            offset += content_len
            continue

        parts = [struct.unpack_from('<I', data, parts_base + p * 4)[0] for p in range(num_parts)]

        all_points = []
        for i in range(num_points):
            x, y = struct.unpack_from('<2d', data, points_base + i * 16)
            all_points.append((x, y))

        rings = []
        for p in range(num_parts):
            start = parts[p]
            end   = parts[p + 1] if p + 1 < num_parts else num_points
            rings.append(all_points[start:end])

        polygons.append({'bbox': (xmin, ymin, xmax, ymax), 'rings': rings})
        offset += content_len

    return polygons


def load_shapefile_from_zip(zip_path):
    """
    Load a shapefile ZIP and return a list of feature dicts:
    {'props': {field: value, ...}, 'bbox': ..., 'rings': ...}

    Automatically reprojects coordinates to WGS84 (lon/lat) if the .prj file
    indicates a projected CRS (e.g. State Plane, UTM, Web Mercator).
    """
    with zipfile.ZipFile(zip_path) as z:
        shp_name = find_file_in_zip(z, '.shp')
        dbf_name = find_file_in_zip(z, '.dbf')
        prj_name = find_file_in_zip(z, '.prj')
        if not shp_name or not dbf_name:
            raise ValueError(f"Cannot find .shp or .dbf in {zip_path}")
        polygons  = parse_shp_polygons(z.read(shp_name))
        _, records = parse_dbf(z.read(dbf_name))
        prj_text  = z.read(prj_name).decode('utf-8', errors='replace') if prj_name else ''

    projector = _make_inverse_projector(_parse_prj_params(prj_text)) if prj_text else None

    if projector:
        reprojected = []
        for poly in polygons:
            new_rings = []
            xs, ys = [], []
            for ring in poly['rings']:
                new_ring = [projector(px, py) for px, py in ring]
                new_rings.append(new_ring)
                for lon, lat in new_ring:
                    xs.append(lon); ys.append(lat)
            bbox = (min(xs), min(ys), max(xs), max(ys)) if xs else poly['bbox']
            reprojected.append({'bbox': bbox, 'rings': new_rings})
        polygons = reprojected

    if len(polygons) != len(records):
        raise ValueError(
            f"Shape/record count mismatch in {zip_path}: "
            f"{len(polygons)} polygons vs {len(records)} records"
        )

    return [{'props': rec, **poly} for poly, rec in zip(polygons, records)]


# ─── Spatial operations ───────────────────────────────────────────────────────

def bbox_intersects(a, b):
    """Do bounding boxes (xmin, ymin, xmax, ymax) overlap?"""
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def point_in_ring(px, py, ring):
    """Ray-casting point-in-polygon test for a single ring."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > py) != (yj > py):
            x_cross = (xj - xi) * (py - yi) / (yj - yi) + xi
            if px < x_cross:
                inside = not inside
        j = i
    return inside


def segments_cross(a1, a2, b1, b2):
    """
    True if segment a1→a2 strictly crosses segment b1→b2.

    Requires d1 and d2 to have strictly opposite signs (neither zero), and
    likewise d3/d4.  When two polygons share a boundary vertex, the shared
    endpoint produces a cross-product of exactly 0.  The old (d1>0)!=(d2>0)
    test counted that as True (0 is not >0), causing false positives for
    adjacent districts that merely touch at a common vertex.
    """
    def cross2d(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    d1 = cross2d(b1, b2, a1)
    d2 = cross2d(b1, b2, a2)
    d3 = cross2d(a1, a2, b1)
    d4 = cross2d(a1, a2, b2)
    return ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0))


def ring_centroid(ring):
    """Average-of-vertices centroid.  Fast and interior for typical convex/
    mildly-concave legislative district shapes."""
    if not ring:
        return None
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    return cx, cy


def rings_intersect(ring_a, ring_b):
    """
    Check if two polygon outer rings have a region of positive area in common
    (i.e. they genuinely overlap, not merely share an edge or a vertex).

    Strategy — interior-point sampling only (no edge-crossing test):

      1. Centroid of each ring tested against the other.  Catches full
         containment.  Centroids are interior points that won't coincidentally
         land on a neighbour's boundary.

      2. Triangle-centroid interior samples — for each sampled edge [i, i+1]
         of ring_a, the point ((cx_a + v_i + v_{i+1}) / 3) is the centroid of
         the triangle formed by the ring's own centroid and that edge.  For
         convex / mildly-concave polygons this point is always strictly inside
         ring_a, never on its boundary.  Testing ~40 such points against ring_b
         catches partial overlaps where the ring_a centroid lies outside ring_b.

    Why no edge-crossing test:
      Congressional and TIGER legislative-district shapefiles represent shared
      boundaries with slightly different vertex positions (sub-metre offsets).
      Edge-crossing tests treat these near-coincident boundary segments as
      "crossings", producing false positives for every adjacent district.
      Interior-point sampling is immune to this because the test points are
      moved well away from the boundary into the polygon's interior.
    """
    if not ring_a or not ring_b:
        return False

    ca = ring_centroid(ring_a)
    cb = ring_centroid(ring_b)

    # --- Centroid containment ---
    if ca and point_in_ring(ca[0], ca[1], ring_b):
        return True
    if cb and point_in_ring(cb[0], cb[1], ring_a):
        return True

    # --- Triangle-centroid interior sampling ---
    # The triangle centroid (ring_centroid + v_i + v_{i+1}) / 3 is interior for
    # convex polygons but can fall outside for concave ones.  We verify each
    # candidate is inside its own ring before testing it against the other ring,
    # so concave polygons can't generate false positives.
    if ca:
        step_a = max(1, (len(ring_a) - 1) // 40)
        for i in range(0, len(ring_a) - 1, step_a):
            tx = (ca[0] + ring_a[i][0] + ring_a[i + 1][0]) / 3
            ty = (ca[1] + ring_a[i][1] + ring_a[i + 1][1]) / 3
            if point_in_ring(tx, ty, ring_a) and point_in_ring(tx, ty, ring_b):
                return True

    if cb:
        step_b = max(1, (len(ring_b) - 1) // 40)
        for i in range(0, len(ring_b) - 1, step_b):
            tx = (cb[0] + ring_b[i][0] + ring_b[i + 1][0]) / 3
            ty = (cb[1] + ring_b[i][1] + ring_b[i + 1][1]) / 3
            if point_in_ring(tx, ty, ring_b) and point_in_ring(tx, ty, ring_a):
                return True

    return False


def polygons_intersect(poly_a, poly_b):
    """
    Check if two shapefile polygon features spatially intersect.
    Uses outer rings only (inner rings/holes are not considered).
    """
    if not bbox_intersects(poly_a['bbox'], poly_b['bbox']):
        return False
    ring_a = poly_a['rings'][0] if poly_a['rings'] else []
    ring_b = poly_b['rings'][0] if poly_b['rings'] else []
    return rings_intersect(ring_a, ring_b)


# ─── CD number extraction ─────────────────────────────────────────────────────

def extract_cd_number(props):
    """
    Extract the congressional district number (as a plain string like '1', '13')
    from a shapefile feature's property dict.

    Handles:
      - Standard TIGER files: CD119FP, CD118FP  (e.g. "00" = at-large → "1")
      - Custom redistricting files: DISTRICT, District  (TX, CA, NC, MO, OH, UT)
      - NAMELSAD fallback: "Congressional District 13" → "13"
                           "Congressional District (at large)" → "1"
    """
    # TIGER standard fields — "00" means at-large (single-district state)
    for field in ('CD119FP', 'CD118FP'):
        val = props.get(field, '').strip()
        if not val:
            continue
        try:
            n = int(val)
            if n == 0:
                return '1'        # at-large coded as 00 in TIGER
            if 1 <= n <= 53:
                return str(n)
        except ValueError:
            pass

    # Custom shapefile fields
    for field in ('DISTRICT', 'District'):
        val = props.get(field, '').strip()
        if not val:
            continue
        try:
            n = int(val)
            if 1 <= n <= 53:
                return str(n)
        except ValueError:
            pass

    # NAMELSAD fallback
    namelsad = props.get('NAMELSAD', '').strip()
    if namelsad:
        if re.search(r'at.large', namelsad, re.IGNORECASE):
            return '1'
        m = re.search(r'\b(\d+)\s*$', namelsad)
        if m:
            return m.group(1)

    return None


# ─── Excel reading ────────────────────────────────────────────────────────────

def _load_shared_strings(z):
    if 'xl/sharedStrings.xml' not in z.namelist():
        return []
    root = ET.parse(z.open('xl/sharedStrings.xml')).getroot()
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    sst = []
    for si in root.findall(f'{{{ns}}}si'):
        sst.append(''.join(t.text or '' for t in si.findall(f'.//{{{ns}}}t')))
    return sst


def _find_workbook():
    primary  = BASE_DIR / 'data' / 'State Legislative Election History.xlsx'
    fallback = BASE_DIR / 'data' / 'State Legislative Election History - Copy.xlsx'
    for path in (primary, fallback):
        try:
            with zipfile.ZipFile(path):
                pass
            return path
        except Exception:
            continue
    raise FileNotFoundError("Could not open any workbook file (is the Excel file locked?)")


def load_congressional_targets():
    """
    Read the 'Congressional Targets' sheet and return a list of
    (state_abbr: str, district_num: str) tuples, e.g. [('CA', '13'), ...].
    """
    path = _find_workbook()
    print(f"  Reading workbook: {path.name}")

    with zipfile.ZipFile(path) as z:
        sst = _load_shared_strings(z)

        rels_root = ET.parse(z.open('xl/_rels/workbook.xml.rels')).getroot()
        wb_root   = ET.parse(z.open('xl/workbook.xml')).getroot()
        wb_ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

        sheet_rid = {
            s.get('name'): s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            for s in wb_root.findall(f'.//{{{wb_ns}}}sheet')
        }
        if 'Congressional Targets' not in sheet_rid:
            raise ValueError("'Congressional Targets' sheet not found in workbook")

        rel_target = {r.get('Id'): r.get('Target') for r in rels_root}
        sheet_path = 'xl/' + rel_target[sheet_rid['Congressional Targets']]
        ws = ET.parse(z.open(sheet_path)).getroot()
        ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

        def cell_val(c):
            t    = c.get('t', '')
            v_el = c.find(f'{{{ns}}}v')
            if v_el is None:
                return ''
            return sst[int(v_el.text)] if t == 's' else (v_el.text or '')

        targets    = []
        first_row  = True
        col_re     = re.compile(r'[0-9]')
        for row in ws.findall(f'.//{{{ns}}}row'):
            cells = {col_re.sub('', c.get('r', '')): cell_val(c) for c in row.findall(f'{{{ns}}}c')}
            if first_row:
                first_row = False
                continue   # skip header row
            state    = cells.get('A', '').strip().upper()
            district = cells.get('B', '').strip()
            if not state or not district:
                continue
            try:
                targets.append((state, str(int(district))))
            except ValueError:
                pass

    return targets


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Congressional District Overlap Pre-computation")
    print("=" * 60)

    # Step 1: Load target CDs from Excel
    print("\n[1/4] Loading Congressional Targets from workbook...")
    targets = load_congressional_targets()
    print(f"      {len(targets)} target CDs found")

    targets_by_state = {}
    for state_abbr, district in targets:
        targets_by_state.setdefault(state_abbr, set()).add(district)

    target_cd_ids = sorted(f"{st}-{d}" for st, d in targets)
    print(f"      States: {sorted(targets_by_state.keys())}")

    # Step 2: Load national leg district shapefiles
    print("\n[2/4] Loading national house and senate shapefiles...")
    house_features  = load_shapefile_from_zip(BASE_DIR / 'data' / 'shapes' / 'house.zip')
    senate_features = load_shapefile_from_zip(BASE_DIR / 'data' / 'shapes' / 'senate.zip')
    print(f"      {len(house_features)} house districts, {len(senate_features)} senate districts")

    # Index by state FIPS
    def index_by_fips(features, district_field):
        index = {}
        for f in features:
            fips = f['props'].get('STATEFP', '').strip().zfill(2)
            if not fips:
                continue
            dist = f['props'].get(district_field, '').strip().upper()
            if not dist or dist == 'ZZZ':
                continue
            index.setdefault(fips, []).append(f)
        return index

    house_by_fips  = index_by_fips(house_features, 'SLDLST')
    senate_by_fips = index_by_fips(senate_features, 'SLDUST')

    # Step 3: Compute intersections per state
    print("\n[3/4] Computing spatial intersections...")
    house_overlaps  = {}   # join_key -> [cd_id, ...]
    senate_overlaps = {}

    for state_abbr in sorted(targets_by_state.keys()):
        target_districts = targets_by_state[state_abbr]
        state_fips = STATE_ABBR_TO_FIPS.get(state_abbr)
        if not state_fips:
            print(f"      WARNING: No FIPS mapping for {state_abbr} — skipping")
            continue

        cd_zip = BASE_DIR / 'data' / 'shapes' / 'congressionals' / f'{state_abbr}.zip'
        if not cd_zip.exists():
            print(f"      WARNING: No congressional shapefile for {state_abbr} — skipping")
            continue

        print(f"\n      {state_abbr} (FIPS {state_fips})"
              f"  target CDs: {sorted(target_districts, key=int)}")

        # Load and filter to target CDs only
        all_cd_features = load_shapefile_from_zip(cd_zip)
        target_cd_features = []
        for f in all_cd_features:
            cd_num = extract_cd_number(f['props'])
            if cd_num in target_districts:
                f['cd_id'] = f"{state_abbr}-{cd_num}"
                target_cd_features.append(f)

        if not target_cd_features:
            print(f"        WARNING: Could not match any target CD polygons.")
            print(f"        Sample props: {all_cd_features[0]['props'] if all_cd_features else 'N/A'}")
            continue

        found_nums = sorted(set(f['cd_id'].split('-')[1] for f in target_cd_features), key=int)
        print(f"        Matched {len(target_cd_features)} CD polygon(s): {found_nums}")

        def check_chamber(leg_features, district_field, output_dict, chamber_name):
            hit = 0
            for leg_f in leg_features:
                raw_dist = leg_f['props'].get(district_field, '').strip()
                if not raw_dist or raw_dist.upper() == 'ZZZ':
                    continue
                district_id = raw_dist.zfill(3)
                join_key    = f"{state_fips}|{district_id}"
                overlapping = [
                    cd_f['cd_id']
                    for cd_f in target_cd_features
                    if polygons_intersect(leg_f, cd_f)
                ]
                if overlapping:
                    existing = output_dict.get(join_key, [])
                    merged   = list(existing)
                    for cd_id in overlapping:
                        if cd_id not in merged:
                            merged.append(cd_id)
                    output_dict[join_key] = merged
                    hit += 1
            print(f"        {chamber_name}: {len(leg_features)} districts, {hit} overlap a target CD")

        check_chamber(house_by_fips.get(state_fips, []),  'SLDLST', house_overlaps,  'House ')
        check_chamber(senate_by_fips.get(state_fips, []), 'SLDUST', senate_overlaps, 'Senate')
        sys.stdout.flush()

    # Step 4: Write output
    print("\n[4/4] Writing congressional_targets.json...")

    def sort_dict(d):
        return {k: sorted(v) for k, v in sorted(d.items())}

    output = {
        "target_cds": target_cd_ids,
        "house":      sort_dict(house_overlaps),
        "senate":     sort_dict(senate_overlaps),
    }

    out_path = BASE_DIR / 'data' / 'congressional_targets.json'
    with open(out_path, 'w') as fp:
        json.dump(output, fp, separators=(',', ':'))

    print(f"      Wrote {out_path}")
    print(f"      {len(target_cd_ids)} target CDs")
    print(f"      {len(house_overlaps)} house districts overlap at least one target CD")
    print(f"      {len(senate_overlaps)} senate districts overlap at least one target CD")
    print("\nDone.")


if __name__ == '__main__':
    main()
