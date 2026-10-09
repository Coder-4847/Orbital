"""
Bakes a night-lights density map from Natural Earth populated places (public domain, 10m scale).

Output: earth-lights.png  1024x512 equirectangular, 8-bit; 0 = dark, 255 = brightest metro area.
Usage: python -I tools/bake-lights.py <ne_10m_populated_places_simple.geojson> <output-dir>
Needs: Pillow, numpy.
"""
import json
import sys
import numpy as np
from PIL import Image

W, H = 1024, 512
KM_PER_RAD = 6371.0


def main(src: str, out: str) -> None:
    feats = json.load(open(src, encoding="utf8"))["features"]
    lat = (90.0 - (np.arange(H) + 0.5) / H * 180.0) * np.pi / 180.0
    lon = ((np.arange(W) + 0.5) / W * 360.0 - 180.0) * np.pi / 180.0
    lon_g, lat_g = np.meshgrid(lon, lat)
    dens = np.zeros((H, W), dtype=np.float32)

    for f in feats:
        p = f["properties"]
        pop = float(p.get("pop_max") or 0)
        if pop < 20000:
            continue
        la, lo = np.radians(p["latitude"]), np.radians(p["longitude"])
        sigma_km = 14.0 + 7.0 * np.sqrt(pop / 1e6)  # metro footprint
        # great-circle distance on the grid, only within a window to stay fast
        j0, j1 = int(max(0, (0.5 - np.degrees(la) / 180.0) * H - 12)), int(min(H, (0.5 - np.degrees(la) / 180.0) * H + 12))
        sub_lat = lat_g[j0:j1]
        sub_lon = lon_g[j0:j1]
        cosd = np.sin(sub_lat) * np.sin(la) + np.cos(sub_lat) * np.cos(la) * np.cos(sub_lon - lo)
        d_km = np.arccos(np.clip(cosd, -1, 1)) * KM_PER_RAD
        weight = (pop / 1e6) ** 0.55
        dens[j0:j1] += weight * np.exp(-0.5 * (d_km / sigma_km) ** 2).astype(np.float32)

    dens = np.log1p(dens * 6.0)
    dens = dens / np.percentile(dens[dens > 0], 99.5)
    img = np.clip(dens, 0, 1) ** 0.8
    Image.fromarray((img * 255).astype(np.uint8), "L").save(f"{out}/earth-lights.png", optimize=True)
    print("lights coverage", float((img > 0.05).mean()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
