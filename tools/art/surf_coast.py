"""Builds docs/assets/surf-coast.json: the land shapes drawn on the Surf forecast map.

Run once, by hand, and commit the result; the site build does not run it:

    .venv\\Scripts\\python tools\\art\\surf_coast.py

It downloads the outlines of Pembrokeshire and the two counties next to it from the Office for National Statistics
(Local Authority Districts, December 2023, generalised to 20 m and clipped to the coastline), keeps what falls
inside the map, drops rocks too small to see, and thins the points so the file stays small.

Source: Office for National Statistics, licensed under the Open Government Licence v3.0.
Contains OS data (c) Crown copyright and database right 2023.
"""
import json
import math
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "assets", "surf-coast.json")

SERVICE = ("https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
           "Local_Authority_Districts_December_2023_Boundaries_UK_BGC/FeatureServer/0/query")
COUNTIES = ["Pembrokeshire", "Ceredigion", "Carmarthenshire"]   # the first is the one the page is about
BBOX = [-5.62, 51.53, -4.47, 52.19]     # west, south, east, north: what the map shows
PAD = 0.03                              # degrees kept beyond the map edge, so shapes run off it cleanly
TOLERANCE_M = 60                        # points closer than this to the simplified line are dropped
MIN_AREA_KM2 = 0.04                     # islands smaller than this are left out
CREDIT = ("Coastline: Office for National Statistics, licensed under the Open Government Licence v3.0. "
          "Contains OS data © Crown copyright and database right 2023.")

KX = math.cos(math.radians((BBOX[1] + BBOX[3]) / 2))   # a degree of longitude is this much of a degree of latitude here
M_PER_DEG = 111_200


def download():
    names = ",".join("'%s'" % n for n in COUNTIES)
    query = urllib.parse.urlencode({"where": "LAD23NM IN (%s)" % names, "outFields": "LAD23NM", "outSR": "4326", "f": "geojson"})
    with urllib.request.urlopen(SERVICE + "?" + query, timeout=60) as r:
        return json.load(r)


def clip(ring, box):
    """Sutherland-Hodgman: the part of a ring inside a box [west, south, east, north]."""
    def cut(points, inside, cross):
        out = []
        for i, p in enumerate(points):
            q = points[i - 1]
            if inside(p):
                if not inside(q):
                    out.append(cross(q, p))
                out.append(p)
            elif inside(q):
                out.append(cross(q, p))
        return out

    def at_x(x):
        return lambda a, b: [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])]

    def at_y(y):
        return lambda a, b: [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y]

    w, s, e, n = box
    pts = ring[:-1] if ring[0] == ring[-1] else ring[:]
    for inside, cross in ((lambda p: p[0] >= w, at_x(w)), (lambda p: p[0] <= e, at_x(e)),
                          (lambda p: p[1] >= s, at_y(s)), (lambda p: p[1] <= n, at_y(n))):
        pts = cut(pts, inside, cross)
        if not pts:
            return []
    return pts


def metres(p):
    return (p[0] * KX * M_PER_DEG, p[1] * M_PER_DEG)


def simplify(points, tolerance):
    """Douglas-Peucker on an open line of [lon, lat] points; distances in metres."""
    xy = [metres(p) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        far, where = 0.0, None
        for i in range(a + 1, b):
            px, py = xy[i]
            d = math.hypot(px - ax, py - ay) if length == 0 else abs(dx * (ay - py) - (ax - px) * dy) / length
            if d > far:
                far, where = d, i
        if where is not None and far > tolerance:
            keep[where] = True
            stack += [(a, where), (where, b)]
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tolerance):
    """A closed ring is simplified as two lines, split at the point furthest from its start."""
    if len(ring) < 8:
        return ring
    x0, y0 = metres(ring[0])
    split = max(range(len(ring)), key=lambda i: math.hypot(metres(ring[i])[0] - x0, metres(ring[i])[1] - y0))
    first = simplify(ring[:split + 1], tolerance)
    second = simplify(ring[split:] + [ring[0]], tolerance)
    return first[:-1] + second[:-1]


def area_km2(ring):
    xy = [metres(p) for p in ring]
    return abs(sum(xy[i - 1][0] * xy[i][1] - xy[i][0] * xy[i - 1][1] for i in range(len(xy)))) / 2 / 1e6


def main():
    box = [BBOX[0] - PAD, BBOX[1] - PAD, BBOX[2] + PAD, BBOX[3] + PAD]
    by_name = {f["properties"]["LAD23NM"]: f["geometry"] for f in download()["features"]}
    land, total = [], 0
    for name in COUNTIES:
        geometry = by_name[name]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        rings = []
        for polygon in polygons:
            ring = clip(polygon[0], box)            # the outer ring; none of these counties has a lake worth drawing
            if len(ring) < 3 or area_km2(ring) < MIN_AREA_KM2:
                continue
            ring = simplify_ring(ring, TOLERANCE_M)
            if len(ring) >= 3:
                rings.append([[round(p[0], 4), round(p[1], 4)] for p in ring])
        rings.sort(key=area_km2, reverse=True)
        total += sum(len(r) for r in rings)
        land.append({"name": name, "rings": rings})
        print("%s: %d shapes, %d points" % (name, len(rings), sum(len(r) for r in rings)))
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"bbox": BBOX, "credit": CREDIT, "land": land}, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    print("wrote %s: %d points, %.0f KB" % (os.path.relpath(OUT, ROOT), total, os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
