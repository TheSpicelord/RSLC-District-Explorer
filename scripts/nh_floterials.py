"""New Hampshire floterial districts, and how to derive their numbers.

New Hampshire elects 400 representatives from 203 districts. 164 are ordinary
"base" districts; the other 39 are FLOTERIAL districts, which do not have their
own territory - each one overlays a group of whole base districts and elects
additional members across them. A voter therefore lives in a base district AND a
floterial, but every source we have (the voter file, the absentee feed) records
exactly one lower-district value per voter, so a floterial can never be populated
directly. That is why every New Hampshire model stopped at 164 of 203.

Because a floterial is exactly the union of whole base districts, its numbers are
computable rather than missing: aggregate the constituents. This module holds the
mapping and the aggregation helper.

DERIVATION. FLOTERIAL_PARTS below was computed geometrically, not typed by hand:
the state's own floterial boundaries (data/shapes/nh_house_floterial.zip, NAD83 /
New Hampshire ftUS) were reprojected onto the Census base districts
(data/shapes/house.zip) and a base district was taken as a constituent when >=80%
of its area falls inside the floterial. Re-run this file as a script to
regenerate it (needs pyshp, shapely and pyproj).

It was validated four ways, and all four had to agree before it was used:
  * all 39 floterial ids exist in District Explorer's nh_house.json;
  * no base district is claimed by two floterials;
  * SEATS RECONCILE EXACTLY - 342 base + 58 floterial = 400, the true size of the
    New Hampshire House;
  * the union of each floterial's constituents covers 98.3-100% of the floterial
    polygon (median 99.9%) with at most 0.7% spilling outside it.
A population cross-check was not possible: District Explorer stores population 0
for floterials, since they have no territory of their own.

REGENERATE AFTER REDISTRICTING. This mapping is specific to the 2022 map. If New
Hampshire redraws, re-run this module and re-copy it to the ABEV Tracker, which
keeps its own copy rather than importing across projects.
"""

# floterial district id -> the base district ids it is composed of
FLOTERIAL_PARTS = {
    "008": ("003", "004"),
    "107": ("105", "106"),
    "108": ("103", "104"),
    "215": ("201", "202", "203", "204", "205", "206"),
    "216": ("208", "209"),
    "217": ("210", "211", "212"),
    "218": ("213", "214"),
    "307": ("304", "305"),
    "417": ("413", "414", "415"),
    "418": ("409", "410", "411", "416"),
    "537": ("534", "543"),
    "538": ("513", "514"),
    "539": ("515", "516", "520"),
    "540": ("518", "519", "521", "522", "523"),
    "541": ("517", "524", "525", "526"),
    "544": ("528", "529"),
    "545": ("535", "536"),
    "625": ("602", "603"),
    "626": ("601", "604", "605"),
    "627": ("610", "611", "614"),
    "628": ("615", "616", "617"),
    "629": ("618", "623", "624"),
    "630": ("619", "620", "621", "622"),
    "731": ("702", "703"),
    "732": ("706", "707", "708"),
    "733": ("710", "711", "712"),
    "734": ("714", "715"),
    "735": ("716", "717"),
    "736": ("719", "720"),
    "737": ("721", "722"),
    "738": ("723", "724"),
    "739": ("726", "727", "728"),
    "740": ("729", "730"),
    "818": ("803", "804"),
    "819": ("805", "806", "807", "808", "809"),
    "820": ("810", "811"),
    "821": ("813", "814", "815", "816", "817"),
    "907": ("902", "903"),
    "908": ("904", "905", "906"),
}

BASE_DISTRICTS_IN_A_FLOTERIAL = {d for parts in FLOTERIAL_PARTS.values() for d in parts}


def floterial_margins(by_district):
    """Synthesize floterial entries from base-district results.

    `by_district` maps district id -> (segments, margin, n), which is what every
    aggregator in build_model_margins returns. Returns a NEW dict of the same
    shape holding only the floterials that could be built.

    Both the margin and each segment share are n-WEIGHTED MEANS of the
    constituents, which is exact rather than an approximation: every one of these
    numbers is already a per-voter share of the district, so
    sum(n_k * x_k) / sum(n_k) is the same value you would get by pooling the
    underlying voters and recomputing.

    A floterial is only produced when EVERY one of its constituents is present.
    Publishing a floterial built from a subset would quietly describe part of a
    district as though it were the whole, which is worse than leaving it blank.
    """
    # Callers disagree about key type: build_model_margins aggregates on ints
    # (3, 102, 905) while the JSON files and the ABEV rollups use zero-padded
    # strings ("003"). Canonicalise for the lookup and hand back whichever shape
    # the caller passed in, so this works for both without either having to care.
    canon = {}
    for key in by_district:
        text = str(key).strip().upper()
        canon[text.zfill(3) if text.isdigit() else text] = key
    as_int = all(isinstance(k, int) for k in by_district) and bool(by_district)

    out = {}
    for flo, parts in FLOTERIAL_PARTS.items():
        have = [by_district[canon[p]] for p in parts if p in canon]
        if len(have) != len(parts):
            continue
        total = sum(n for _, _, n in have)
        if not total:
            continue
        margin = sum(n * mrg for _, mrg, n in have) / total
        weighted = {}
        for segments, _, n in have:
            for seg in segments:
                slot = weighted.setdefault(seg["key"], {"label": seg["label"], "sum": 0.0})
                slot["sum"] += n * seg["value"]
        order = [seg["key"] for seg in have[0][0]]
        out[int(flo) if as_int else flo] = (
            [{"key": k, "label": weighted[k]["label"],
              "value": round(weighted[k]["sum"] / total, 1)} for k in order],
            round(margin, 1),
            total,
        )
    return out


def is_floterial(abbr, chamber, district_id):
    """Is this district a New Hampshire floterial?

    Consumers need this because floterial and base districts OVERLAP: a New
    Hampshire voter is counted once in a base district and again in the floterial
    above it, so adding up a house district column double-counts by design and
    lands well above the statewide total. Statewide figures are computed
    per-voter and never by summing districts, so they are unaffected - but
    anything that does sum districts must skip these.
    """
    if abbr != "NH" or chamber != "house":
        return False
    text = str(district_id).strip()
    return (text.zfill(3) if text.isdigit() else text) in FLOTERIAL_PARTS


def floterial_counts(dmap, tlmap, stats, buckets):
    """Synthesize floterial entries from base-district COUNTS (the ABEV shape).

    `dmap` is district -> {stat: {bucket: n}} and `tlmap` is
    district -> {stat: {date: {bucket: n}}}, which is what daily_update and
    historical_pull build. Returns (districts, timelines) holding only the
    floterials that could be built.

    Unlike the margin version this is plain integer addition and therefore exact:
    a floterial's electorate IS the union of its constituents, and no voter is in
    two of them, so the counts simply add. Timelines add per date as well, which
    keeps the chronological views and the totals consistent with each other.

    As with floterial_margins, a floterial is only produced when every one of its
    constituents is present.
    """
    canon = {}
    for key in dmap:
        text = str(key).strip().upper()
        canon[text.zfill(3) if text.isdigit() else text] = key
    as_int = all(isinstance(k, int) for k in dmap) and bool(dmap)

    made_d, made_t = {}, {}
    for flo, parts in FLOTERIAL_PARTS.items():
        if not all(p in canon for p in parts):
            continue
        keys = [canon[p] for p in parts]
        out_key = int(flo) if as_int else flo
        made_d[out_key] = {
            stat: {b: sum(int((dmap[k].get(stat) or {}).get(b, 0)) for k in keys) for b in buckets}
            for stat in stats
        }
        per_stat = {}
        for stat in stats:
            acc = {}
            for k in keys:
                for date, row in ((tlmap.get(k) or {}).get(stat) or {}).items():
                    slot = acc.setdefault(date, {b: 0 for b in buckets})
                    for b in buckets:
                        slot[b] += int(row.get(b, 0))
            per_stat[stat] = acc
        made_t[out_key] = per_stat
    return made_d, made_t


if __name__ == "__main__":  # regeneration
    import json, os, re, tempfile, zipfile
    import shapefile
    from shapely.geometry import shape
    from shapely.ops import transform
    from pyproj import CRS, Transformer

    def _load(zp):
        d = tempfile.mkdtemp()
        zipfile.ZipFile(zp).extractall(d)
        shp = [os.path.join(r, n) for r, _, fs in os.walk(d) for n in fs if n.endswith(".shp")][0]
        return shapefile.Reader(shp), CRS.from_wkt(open(shp[:-4] + ".prj").read())

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fl, fc = _load(os.path.join(here, "data/shapes/nh_house_floterial.zip"))
    hs, hc = _load(os.path.join(here, "data/shapes/house.zip"))
    tr = Transformer.from_crs(fc, hc, always_xy=True).transform
    ff = [f[0] for f in fl.fields[1:]]
    hf = [f[0] for f in hs.fields[1:]]
    COUNTY = {"BE": "0", "CA": "1", "CH": "2", "CO": "3", "GR": "4",
              "HI": "5", "ME": "6", "RO": "7", "ST": "8", "SU": "9"}
    base = {sr.record[hf.index("SLDLST")]: shape(sr.shape.__geo_interface__).buffer(0)
            for sr in hs.shapeRecords() if sr.record[hf.index("STATEFP")] == "33"}
    built = {}
    for sr in fl.shapeRecords():
        code = str(sr.record[ff.index("floathse22")]).strip()
        if not code:
            continue
        m = re.match(r"([A-Z]{2})(\d+)$", code)
        did = COUNTY[m.group(1)] + m.group(2).zfill(2)
        poly = transform(tr, shape(sr.shape.__geo_interface__)).buffer(0)
        built[did] = sorted(d for d, b in base.items()
                            if b.area and poly.intersection(b).area / b.area >= 0.80)
    print("FLOTERIAL_PARTS = {")
    for did in sorted(built):
        print(f'    "{did}": (' + ", ".join(f'"{k}"' for k in built[did]) + "),")
    print("}")
