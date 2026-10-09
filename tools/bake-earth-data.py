"""
Bakes compact Earth terrain data from NASA's public-domain "Earth heightmap" (Visible Earth 73934,
as mirrored on Wikimedia Commons: Srtm_ramp2.world.21600x10800.jpg, 8-bit, sea level = 12, ocean is flat).

Outputs (equirectangular, north at top, lon -180..180):
  earth-elevation.png  4096x2048  8-bit land elevation, 0 = sea level (ocean), 1..255 = land, metres = v/255 * 8848 (see height-data.ts)
  earth-land.png       4096x2048  8-bit land coverage (anti-aliased coastline): 255 = fully land. Contour 0.5 is the coast.
  earth-coast.png      1024x512   8-bit distance from land over the ocean, 0..255 -> 0..2550 km (10 km per step)

Usage: python -I tools/bake-earth-data.py <srtm_full.jpg> <output-dir>
Needs: Pillow, numpy.  Run once; the outputs are committed under src/assets/data/.
"""
import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SEA = 12.0  # sea-level grey value in the source
EARTH_RADIUS_KM = 6371.0


def main(src: str, out: str) -> None:
    img = Image.open(src).convert("L")

    # --- Elevation: area-average to 4096x2048 (anti-aliased coastlines), then remap.
    small = np.asarray(img.resize((4096, 2048), Image.BOX), dtype=np.float32)
    # JPEG noise makes ocean read 11..13; treat anything below sea+0.9 as ocean.
    land = np.clip(small - (SEA + 0.9), 0, None) / (255.0 - SEA - 0.9)  # 0..1
    elev_u8 = np.clip(np.round(land * 255.0), 0, 255).astype(np.uint8)
    Image.fromarray(elev_u8, "L").save(f"{out}/earth-elevation.png", optimize=True)
    print("elevation: land fraction", float((elev_u8 > 0).mean()))

    # --- Land coverage: box-filter the full-resolution binary mask so the 0.5 contour reproduces the coast sub-pixel.
    full = np.asarray(img, dtype=np.uint8)
    binary = Image.fromarray(((full >= 14) * 255).astype(np.uint8), "L")  # land = grey value above sea level + noise
    cov_img = binary.resize((4096, 2048), Image.BOX)  # exact box filter for non-integer ratios
    cov_img.save(f"{out}/earth-land.png", optimize=True)
    cov = np.asarray(cov_img, dtype=np.float32) / 255.0
    print("land coverage fraction", float(cov.mean()))

    # --- Coast distance over the ocean at 1024x512 using true great-circle distance.
    w, h = 1024, 512
    mask = np.asarray(Image.fromarray(elev_u8, "L").resize((w, h), Image.BOX), dtype=np.float32) > 0.5
    lat = (90.0 - (np.arange(h) + 0.5) / h * 180.0) * np.pi / 180.0
    lon = ((np.arange(w) + 0.5) / w * 360.0 - 180.0) * np.pi / 180.0
    lon_g, lat_g = np.meshgrid(lon, lat)
    vec = np.stack([np.cos(lat_g) * np.cos(lon_g), np.sin(lat_g), -np.cos(lat_g) * np.sin(lon_g)], axis=-1).reshape(-1, 3).astype(np.float32)

    flat_mask = mask.reshape(-1)
    # Only land pixels that touch ocean can be nearest to an ocean pixel.
    padded = np.pad(mask, 1, mode="edge")
    touches = mask & ~(padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:])
    coast_pts = vec[touches.reshape(-1)]
    ocean_idx = np.nonzero(~flat_mask)[0]
    print("coast points", len(coast_pts), "ocean pixels", len(ocean_idx))

    dist_km = np.zeros(h * w, dtype=np.float32)
    best = np.full(len(ocean_idx), -1.0, dtype=np.float32)  # max dot product = nearest
    chunk = 20000
    for i in range(0, len(ocean_idx), chunk):
        sel = ocean_idx[i : i + chunk]
        dots = vec[sel] @ coast_pts.T
        best[i : i + chunk] = dots.max(axis=1)
    ang = np.arccos(np.clip(best, -1.0, 1.0))
    dist_km[ocean_idx] = ang * EARTH_RADIUS_KM
    coast_u8 = np.clip(np.round(dist_km / 10.0), 0, 255).astype(np.uint8).reshape(h, w)
    Image.fromarray(coast_u8, "L").save(f"{out}/earth-coast.png", optimize=True)
    print("coast distance max km", float(dist_km.max()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
