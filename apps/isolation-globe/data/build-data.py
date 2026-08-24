#!/usr/bin/env python3
"""Build the isolation-globe dataset: apps/isolation-globe/assets/{terrain.png,labels.json}

    python3 apps/isolation-globe/data/build-data.py --work /tmp/globe-work

Run it only when you want to regenerate the data — the outputs are committed, and
Netlify never runs this. It needs ~1 GB of downloads and about twenty minutes.

WHAT IT PRODUCES

terrain.png is a 2160x1080 equirectangular grid (10 arc-minutes, ~18 km at the
equator) carrying three things in the three colour channels:

    R,G  elevation+1 as a 16-bit big-endian value; 0 means "no land in this cell"
    B    index into labels.json "places" -- the country/territory the cell is in

regions.png is the same grid again, with R,G a 16-bit index into labels.json
"regions" -- the named island, island group, mountain range or plateau the cell
belongs to. It is a second file rather than a fourth channel because packing it
into terrain.png would interleave two unrelated signals into the same bytes and
cost more in lost PNG compression than the extra header saves.

Elevation is the MAXIMUM ground in the cell, never the mean. That single choice
is what makes both of the app's questions answerable from one grid: a cell whose
only land is a 400 m atoll still reads as land, and a cell holding one 4,000 m
summit still reads as 4,000 m instead of being averaged down to its valleys.

SOURCES

  Natural Earth 10m (land, minor islands, countries, named peaks and islands)
      -- the coastline authority, including islets a DEM would miss entirely
  AWS Terrain Tiles / terrarium (zoom 6 globally over land, zoom 8 above 600 m)
      -- the elevation, resampled by max-pooling

STAGES (each caches into --work, so a rerun is cheap)

  1  fetch    Natural Earth GeoJSON
  2  mask     rasterise land at 5' -- fill + edge-march, so no islet is dropped
  3  dem6     zoom-6 tiles over every land-bearing tile
  4  dem8     zoom-8 tiles over everything the zoom-6 pass put above 600 m,
              because zoom 6 shaves 8-30% off summits and summit height is
              exactly what the app's elevation slider asks about
  5  assemble downsample to 10', patch the poles, stamp named peaks, encode
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen

import numpy as np
from PIL import Image

# 5' working grid, halved to the 10' grid the app ships and computes on.
FW, FH = 4320, 2160
OW, OH = 2160, 1080
TILE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"
NE_LAYERS = [
    "ne_10m_land",
    "ne_10m_minor_islands",
    "ne_10m_admin_0_countries",
    "ne_10m_geography_regions_points",
    "ne_10m_geography_regions_elevation_points",
    "ne_10m_geography_regions_polys",
]
# Painted broadest-first so the most specific name ends up on top: an island in
# an archipelago on a continental shelf should read as the island.
REGION_ORDER = [
    "Continent", "Geoarea", "Coast", "Tundra", "Lowland", "Plain", "Desert",
    "Basin", "Delta", "Wetlands", "Valley", "Gorge", "Foothills", "Plateau",
    "Range/mtn", "Isthmus", "Peninsula", "Pen/cape", "Island group", "Island",
]
# How usable each class is as a headline name, 0 being best. Natural Earth has no
# polygon for Easter Island, so without this the island reads as "Polynesia" —
# true, and useless. Tier 1 names a group, which is right only when nothing names
# the island itself; tier 2 is broad enough that the country reads better.
REGION_TIER = {"Island group": 1, "Continent": 2, "Geoarea": 2, "Coast": 2,
               "Tundra": 2, "Lowland": 2, "Plain": 2}
HI_ZOOM, HI_MIN_M = 8, 600
MERC_LIMIT = 85.05112878  # web mercator cuts off here; Antarctica runs past it
MAX_ELEV = 8850  # Everest; nothing on land is higher, so anything above is noise
SPIKE_M = 2000   # see reject_spikes()


# --------------------------------------------------------------------------- 1
def fetch_ne(work):
    d = os.path.join(work, "ne")
    os.makedirs(d, exist_ok=True)
    for layer in NE_LAYERS:
        p = os.path.join(d, layer + ".geojson")
        if os.path.exists(p):
            continue
        print(f"  fetching {layer}", flush=True)
        with urlopen(NE_URL.format(layer), timeout=300) as r, open(p, "wb") as f:
            f.write(r.read())
    return d


def load_ne(nedir, layer):
    with open(os.path.join(nedir, layer + ".geojson")) as f:
        return json.load(f)["features"]


# --------------------------------------------------------------------------- 2
def to_grid(ring, w, h):
    a = np.asarray(ring, dtype=np.float64)
    return (a[:, 0] + 180.0) / 360.0 * w, (90.0 - a[:, 1]) / 180.0 * h


def fill_ring(grid, x, y, value, w, h):
    """Even-odd scanline fill sampled at cell centres."""
    r0 = max(0, int(math.floor(y.min() - 0.5)))
    r1 = min(h - 1, int(math.ceil(y.max() + 0.5)))
    if r1 < r0:
        return
    x0, y0, x1, y1 = x[:-1], y[:-1], x[1:], y[1:]
    keep = y0 != y1
    x0, y0, x1, y1 = x0[keep], y0[keep], x1[keep], y1[keep]
    if len(x0) == 0:
        return
    ylo, yhi = np.minimum(y0, y1), np.maximum(y0, y1)
    slope = (x1 - x0) / (y1 - y0)
    for r in range(r0, r1 + 1):
        yc = r + 0.5
        hit = (ylo <= yc) & (yhi > yc)
        if not hit.any():
            continue
        xs = np.sort(x0[hit] + (yc - y0[hit]) * slope[hit])
        for i in range(0, len(xs) - 1, 2):
            ca = int(math.ceil(xs[i] - 0.5))
            cb = int(math.floor(xs[i + 1] - 0.5))
            if cb >= ca:
                grid[r, max(0, ca):min(w, cb + 1)] = value


def stroke_ring(grid, x, y, value, w, h):
    """Mark every cell each edge passes through, stepping at half a cell."""
    x0, y0, x1, y1 = x[:-1], y[:-1], x[1:], y[1:]
    span = np.maximum(np.abs(x1 - x0), np.abs(y1 - y0))
    n = np.minimum(np.maximum(np.ceil(span * 2.0).astype(np.int64), 1) + 1, 4096)
    total = int(n.sum())
    if total == 0:
        return
    seg = np.repeat(np.arange(len(n)), n)
    t = (np.arange(total) - np.concatenate(([0], np.cumsum(n)[:-1]))[seg]) / np.maximum(n[seg] - 1, 1)
    c = np.clip((x0[seg] + (x1[seg] - x0[seg]) * t).astype(np.int64), 0, w - 1)
    r = np.clip((y0[seg] + (y1[seg] - y0[seg]) * t).astype(np.int64), 0, h - 1)
    grid[r, c] = value


def paint(grid, feature, value, w, h, holes=True):
    g = feature.get("geometry")
    if not g:
        return
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    for poly in polys:
        for i, ring in enumerate(poly):
            if len(ring) >= 3:
                x, y = to_grid(ring, w, h)
                # Ring 0 is the outline; later rings are lakes punched out of it.
                fill_ring(grid, x, y, value if i == 0 else (0 if holes else value), w, h)
        for ring in poly:
            if len(ring) >= 2:
                x, y = to_grid(ring, w, h)
                stroke_ring(grid, x, y, value, w, h)  # coastline always wins


def build_mask(work, nedir):
    p = os.path.join(work, f"landmask_{FW}x{FH}.npy")
    if os.path.exists(p):
        return np.load(p)
    # Centre-sampling alone drops every island smaller than a cell, which is
    # fatal for an app about "the nearest land no matter its size". So we fill
    # interiors AND march along every coastline edge, and OR the two together.
    mask = np.zeros((FH, FW), dtype=np.uint8)
    for layer in ("ne_10m_land", "ne_10m_minor_islands"):
        for f in load_ne(nedir, layer):
            paint(mask, f, 1, FW, FH)
        print(f"  {layer}: {int(mask.sum()):,} land cells", flush=True)
    mask = mask.astype(bool)
    np.save(p, mask)
    return mask


# ------------------------------------------------------------------------- 3/4
def merc_lat(y_units, n):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y_units / n))))


def group_max(a, idx, axis):
    b = np.flatnonzero(np.r_[True, idx[1:] != idx[:-1]])
    return np.maximum.reduceat(a, b, axis=axis), idx[b]


def pool_tiles(tiles, zoom, label):
    """Fetch terrarium tiles and max-pool them into a 5' grid."""
    n = 1 << zoom
    out = np.full((FH, FW), -32768, dtype=np.int16)
    lock = threading.Lock()
    counts = [0, 0]
    rows, cols = {}, {}
    for _, ty in tiles:
        if ty not in rows:
            la = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty + (np.arange(256) + 0.5) / 256) / n))))
            rows[ty] = np.clip(((90 - la) / 180 * FH).astype(np.int32), 0, FH - 1)
    for tx, _ in tiles:
        if tx not in cols:
            lo = (tx + (np.arange(256) + 0.5) / 256) / n * 360 - 180
            cols[tx] = np.clip(((lo + 180) / 360 * FW).astype(np.int32), 0, FW - 1)

    def one(t):
        tx, ty = t
        raw = None
        for attempt in range(4):
            try:
                with urlopen(TILE_URL.format(z=zoom, x=tx, y=ty), timeout=45) as r:
                    raw = r.read()
                break
            except Exception:
                if attempt == 3:
                    with lock:
                        counts[1] += 1
                    return
        a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.int32)
        e = (a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256.0) - 32768.0
        e = np.clip(np.round(e), -32767, 32767).astype(np.int16)
        blk, rr = group_max(e, rows[ty], 0)
        blk, cc = group_max(blk, cols[tx], 1)
        with lock:
            sub = out[rr[0]:rr[-1] + 1, cc[0]:cc[-1] + 1]
            np.maximum(sub, blk, out=sub)
            counts[0] += 1
            if counts[0] % 1000 == 0:
                print(f"  {label}: {counts[0]}/{len(tiles)}", flush=True)

    with ThreadPoolExecutor(max_workers=32) as ex:
        list(ex.map(one, tiles))
    print(f"  {label}: {counts[0]} ok, {counts[1]} failed", flush=True)
    return out


def build_dem6(work, mask):
    p = os.path.join(work, f"dem_{FW}x{FH}.npy")
    if os.path.exists(p):
        return np.load(p)
    n = 1 << 6
    tiles = []
    for ty in range(n):
        lat_n, lat_s = merc_lat(ty, n), merc_lat(ty + 1, n)
        r0 = int((90 - lat_n) / 180 * FH)
        r1 = max(min(FH, int(math.ceil((90 - lat_s) / 180 * FH))), r0 + 1)
        for tx in range(n):
            c0 = int(tx / n * FW)
            c1 = max(min(FW, int(math.ceil((tx + 1) / n * FW))), c0 + 1)
            if mask[r0:r1, c0:c1].any():
                tiles.append((tx, ty))
    print(f"  {len(tiles)} of {n*n} zoom-6 tiles contain land", flush=True)
    dem = pool_tiles(tiles, 6, "z6")
    np.save(p, dem)
    return dem


def build_dem8(work, mask, dem6):
    p = os.path.join(work, f"dem_hi_{FW}x{FH}.npy")
    if os.path.exists(p):
        return np.load(p)
    n = 1 << HI_ZOOM
    rs, cs = np.nonzero(mask & (dem6 >= HI_MIN_M))
    lat = 90 - (rs + 0.5) * 180 / FH
    lon = -180 + (cs + 0.5) * 360 / FW
    s = np.sin(np.radians(np.clip(lat, -MERC_LIMIT, MERC_LIMIT)))
    tx = ((lon + 180) / 360 * n).astype(np.int64)
    ty = np.clip(((0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * n).astype(np.int64), 0, n - 1)
    # One-tile skirt, so a summit sitting just over a tile edge is still covered.
    base = np.unique(np.stack([tx, ty], 1), axis=0)
    want = {((int(a) + da) % n, min(max(int(b) + db, 0), n - 1))
            for a, b in base for da in (-1, 0, 1) for db in (-1, 0, 1)}
    tiles = sorted(want)
    print(f"  {len(tiles):,} zoom-{HI_ZOOM} tiles over land >= {HI_MIN_M} m", flush=True)
    dem = pool_tiles(tiles, HI_ZOOM, "z8")
    np.save(p, dem)
    return dem


# --------------------------------------------------------------------------- 5
def reject_spikes(dem6, dem8):
    """Drop zoom-8 cells that the zoom-6 pass says cannot possibly be right.

    Terrarium carries a scatter of corrupt cells — 18,111 m in Honshu, 9,499 m
    in Newfoundland, 3,349 m in Pennsylvania. Resampling finer can only raise a
    cell's maximum, and only by as much relief as the finer grid uncovers, so
    anything more than SPIKE_M above the coarse pass's own neighbourhood is
    noise rather than a summit. Real gains stay well inside it: Everest's cell
    rises 417 m between the two passes, K2's 1,223 m, Gongga Shan's 1,516 m —
    while every rejected cell checked by hand sat somewhere with no mountain at
    all. The failure mode matters more than the margin: too tight and a summit
    falls back to its coarse height, too loose and the map grows a fake range.
    """
    ceil6 = dem6.copy()
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr or dc:
                np.maximum(ceil6, np.roll(np.roll(dem6, dr, 0), dc, 1), out=ceil6)
    # Cells the coarse pass never sampled carry no opinion, so they are not
    # judged here; they are open ocean inside the skirt and the land mask drops
    # them anyway.
    bad = (dem8 > -32768) & (ceil6 > -32768) & (dem8 > ceil6.astype(np.int32) + SPIKE_M)
    if bad.any():
        print(f"  rejected {int(bad.sum())} corrupt zoom-{HI_ZOOM} cells "
              f"(highest was {int(dem8[bad].max()):,} m)", flush=True)
    out = dem8.copy()
    out[bad] = -32768
    return out


def assemble(work, nedir, mask, dem6, dem8, outdir):
    dem = np.maximum(dem6, reject_spikes(dem6, dem8))
    covered = dem > -32768

    # Web Mercator stops at 85.05 deg, so the innermost Antarctic plateau has no
    # tile coverage at all. Extend the last covered row down each column: the
    # plateau there is a broad 2,500-3,500 m dome, so a column-wise carry is a
    # far better answer than either zero or a global constant.
    hole = mask & ~covered
    if hole.any():
        rows = np.where(covered.any(1))[0]
        last = rows.max()
        south = np.where(dem[last] > -32768, dem[last], 2800).astype(np.int16)
        patch = hole[last + 1:]
        dem[last + 1:][patch] = np.broadcast_to(south, patch.shape)[patch]
        print(f"  patched {int(hole.sum()):,} polar cells with no tile coverage", flush=True)

    fine = np.where(mask, np.clip(np.maximum(dem, 0), 0, MAX_ELEV), -1).astype(np.int16)
    # Max-pool 5' -> 10'. Land beats -1, so a cell holding one atoll stays land.
    elev = np.maximum.reduce([fine[0::2, 0::2], fine[0::2, 1::2], fine[1::2, 0::2], fine[1::2, 1::2]])
    land = elev >= 0
    print(f"  {int(land.sum()):,} land cells of {OW*OH:,}", flush=True)

    # Named peaks carry a surveyed height; the tiles carry a resampled one, which
    # is always lower. Take the survey where we have it, so "nearest ground above
    # 4,000 m" does not quietly lose Mount Rainier to a resampling artefact.
    peaks = []
    for f in load_ne(nedir, "ne_10m_geography_regions_elevation_points"):
        p = f["properties"]
        m = p.get("elevation")
        name = p.get("name_en") or p.get("name")
        if not name or m is None or m <= 0 or p.get("featurecla") == "depression":
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        peaks.append({"name": name, "elev": int(m), "lat": round(lat, 4), "lon": round(lon, 4)})
    stamped = 0
    for pk in peaks:
        r = min(int((90 - pk["lat"]) / 180 * OH), OH - 1)
        c = int((pk["lon"] + 180) / 360 * OW) % OW
        if land[r, c] and pk["elev"] > elev[r, c]:
            elev[r, c] = min(pk["elev"], MAX_ELEV)
            stamped += 1
    print(f"  stamped {stamped} of {len(peaks)} surveyed peaks", flush=True)

    # Country / territory index, so a readout can name what it points at.
    idx = np.zeros((OH, OW), dtype=np.int32)
    feats = load_ne(nedir, "ne_10m_admin_0_countries")
    names = [f["properties"].get("ADMIN") or f["properties"].get("NAME") for f in feats]
    # Biggest first, so a small island territory painted later wins its own cells
    # back from the large neighbour whose bounding area swallowed them.
    order = sorted(range(len(feats)), key=lambda i: -bbox_area(feats[i]))
    for rank, i in enumerate(order, start=1):
        paint(idx, feats[i], rank, OW, OH, holes=False)
    idx[~land] = 0
    keep = np.argsort(-np.bincount(idx.ravel(), minlength=len(feats) + 1)[1:])[:255]
    remap = np.zeros(len(feats) + 1, dtype=np.uint8)
    places = [""]
    for slot, rank in enumerate(keep, start=1):
        remap[rank + 1] = slot
        places.append(names[order[rank]])
    country = remap[idx]

    # Named regions: islands, archipelagos, ranges, plateaus. This is what lets a
    # readout say "Easter Island" instead of "Chile".
    ridx = np.zeros((OH, OW), dtype=np.int32)
    regions = [""]
    tier = [2]  # parallel to regions; see REGION_TIER
    rfeats = load_ne(nedir, "ne_10m_geography_regions_polys")
    by_class = {}
    for f in rfeats:
        by_class.setdefault(f["properties"].get("FEATURECLA"), []).append(f)
    for cla in REGION_ORDER:
        # Within a class, big first for the same most-specific-wins reason.
        for f in sorted(by_class.get(cla, []), key=lambda x: -bbox_area(x)):
            nm = f["properties"].get("NAME_EN") or f["properties"].get("NAME")
            if not nm:
                continue
            regions.append(nm)
            tier.append(REGION_TIER.get(cla, 0))
            paint(ridx, f, len(regions) - 1, OW, OH, holes=False)
    ridx[~land] = 0
    print(f"  {len(regions)-1} named regions, covering "
          f"{int((ridx > 0).sum())/max(1, int(land.sum())):.0%} of land cells", flush=True)

    # Encode. R,G hold elevation+1 big-endian (0 = no land); B holds the place index.
    v = np.where(land, elev.astype(np.int32) + 1, 0)
    rgb = np.empty((OH, OW, 3), dtype=np.uint8)
    rgb[:, :, 0] = (v >> 8).astype(np.uint8)
    rgb[:, :, 1] = (v & 255).astype(np.uint8)
    rgb[:, :, 2] = country
    os.makedirs(outdir, exist_ok=True)
    png = os.path.join(outdir, "terrain.png")
    Image.fromarray(rgb, "RGB").save(png, optimize=True, compress_level=9)

    rrgb = np.zeros((OH, OW, 3), dtype=np.uint8)
    rrgb[:, :, 0] = (ridx >> 8).astype(np.uint8)
    rrgb[:, :, 1] = (ridx & 255).astype(np.uint8)
    rpng = os.path.join(outdir, "regions.png")
    Image.fromarray(rrgb, "RGB").save(rpng, optimize=True, compress_level=9)

    islands = []
    for f in load_ne(nedir, "ne_10m_geography_regions_points"):
        p = f["properties"]
        if p.get("featurecla") not in ("island", "island group"):
            continue
        name = p.get("name_en") or p.get("name")
        lon, lat = f["geometry"]["coordinates"][:2]
        if name:
            islands.append({"name": name, "lat": round(lat, 4), "lon": round(lon, 4)})

    meta = {
        "width": OW,
        "height": OH,
        "maxElev": int(elev.max()),
        "places": places,
        "regions": regions,
        "regionTier": tier,
        "peaks": sorted(peaks, key=lambda p: -p["elev"]),
        "islands": islands,
    }
    with open(os.path.join(outdir, "labels.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print(f"  terrain.png {os.path.getsize(png)/1e6:.2f} MB  "
          f"regions.png {os.path.getsize(rpng)/1e3:.0f} kB  "
          f"labels.json {os.path.getsize(os.path.join(outdir,'labels.json'))/1e3:.0f} kB", flush=True)


def bbox_area(feature):
    g = feature.get("geometry")
    if not g:
        return 0.0
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    lo = np.concatenate([np.asarray(p[0], dtype=np.float64) for p in polys])
    return float((lo[:, 0].max() - lo[:, 0].min()) * (lo[:, 1].max() - lo[:, 1].min()))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(here, ".work"))
    ap.add_argument("--out", default=os.path.abspath(os.path.join(here, "..", "assets")))
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)

    print("1/5 Natural Earth", flush=True)
    nedir = fetch_ne(a.work)
    print("2/5 land mask", flush=True)
    mask = build_mask(a.work, nedir)
    print("3/5 elevation, zoom 6", flush=True)
    dem6 = build_dem6(a.work, mask)
    print(f"4/5 elevation, zoom {HI_ZOOM} above {HI_MIN_M} m", flush=True)
    dem8 = build_dem8(a.work, mask, dem6)
    print("5/5 assemble", flush=True)
    assemble(a.work, nedir, mask, dem6, dem8, a.out)


if __name__ == "__main__":
    sys.exit(main())
