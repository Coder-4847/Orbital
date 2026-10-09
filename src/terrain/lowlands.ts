/**
 * Coastal plains the baked heightmap cannot see. The source raster has one grey step per ~35 m and the bake calls anything
 * within two steps of sea level "ocean", so land under about 70 m is missing: all of Florida and the Atlantic and Gulf coastal
 * plain around the launch site. Each plain here is a hand-traced outline (degrees east / north) that the Earth source adds
 * back as low, humid land. Pure data and maths.
 */
export interface Lowland {
  id: string;
  /** Closed outline, [lon, lat] in degrees. Where an edge runs inland it must lie on land the heightmap already has. */
  outline: ReadonlyArray<readonly [number, number]>;
  /** Round lakes cut out of the plain: [lon, lat, radius km]. */
  lakes: ReadonlyArray<readonly [number, number, number]>;
}

export const LOWLANDS: readonly Lowland[] = [
  {
    id: 'us-southeast',
    outline: [
      // inland edge, south-west to north-east (the heightmap has the hills behind it)
      [-88.0, 31.6], [-85.5, 32.6], [-83.0, 33.3], [-81.0, 34.3], [-79.0, 35.8], [-77.6, 37.3],
      // Atlantic coast, Virginia Beach to the Georgia border
      [-75.95, 36.9], [-75.75, 36.2], [-75.5, 35.25], [-76.0, 35.0], [-76.53, 34.6], [-77.4, 34.5], [-77.95, 33.87], [-78.6, 33.85],
      [-78.9, 33.65], [-79.2, 33.2], [-79.6, 32.95], [-79.9, 32.7], [-80.45, 32.4], [-80.85, 32.0], [-81.15, 31.5], [-81.4, 31.0],
      // Florida, east coast: Jacksonville, Cape Canaveral, Miami
      [-81.42, 30.7], [-81.38, 30.3], [-81.27, 29.85], [-81.0, 29.2], [-80.75, 28.85], [-80.555, 28.62], [-80.5, 28.46], [-80.58, 28.38],
      [-80.6, 28.2], [-80.56, 28.07], [-80.445, 27.86], [-80.36, 27.64], [-80.29, 27.45], [-80.16, 27.2], [-80.07, 26.94], [-80.03, 26.7],
      [-80.1, 26.12], [-80.13, 25.78], [-80.3, 25.4], [-80.4, 25.2],
      // Cape Sable and up the Gulf coast
      [-81.1, 25.13], [-81.2, 25.5], [-81.4, 25.85], [-81.73, 25.93], [-81.81, 26.14], [-82.1, 26.45], [-82.27, 26.8], [-82.46, 27.1],
      [-82.58, 27.33], [-82.74, 27.53], [-82.74, 27.72], [-82.83, 27.98], [-82.8, 28.2], [-82.7, 28.55], [-82.72, 28.9], [-83.05, 29.14],
      [-83.4, 29.67], [-83.75, 29.98], [-84.2, 30.07], [-84.4, 29.9], [-85.0, 29.65], [-85.38, 29.68], [-85.4, 29.93], [-85.75, 30.12],
      [-86.5, 30.38], [-87.2, 30.32], [-87.7, 30.25], [-88.0, 30.23],
    ],
    lakes: [[-80.8, 26.95, 22]], // Okeechobee
  },
];

const KM_PER_DEG = 111.195;
/** Beyond this distance (km) outside an outline the plain has no effect at all. */
export const LOWLAND_REACH_KM = 400;

interface Prepared {
  /** Outline in local kilometres (equirectangular about the centre latitude: good to a few percent at this size). */
  xs: Float64Array;
  ys: Float64Array;
  lon0: number;
  lat0: number;
  cosLat0: number;
  /** Bounding box in degrees, grown by the reach. */
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  lakes: Array<{ x: number; y: number; r: number }>;
}

function prepare(l: Lowland): Prepared {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of l.outline) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const lon0 = (minLon + maxLon) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  const n = l.outline.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  l.outline.forEach(([lon, lat], i) => {
    xs[i] = (lon - lon0) * cosLat0 * KM_PER_DEG;
    ys[i] = (lat - lat0) * KM_PER_DEG;
  });
  const reach = LOWLAND_REACH_KM / KM_PER_DEG;
  return {
    xs, ys, lon0, lat0, cosLat0,
    minLon: minLon - reach / cosLat0, maxLon: maxLon + reach / cosLat0, minLat: minLat - reach, maxLat: maxLat + reach,
    lakes: l.lakes.map(([lon, lat, r]) => ({ x: (lon - lon0) * cosLat0 * KM_PER_DEG, y: (lat - lat0) * KM_PER_DEG, r })),
  };
}

const PREPARED = LOWLANDS.map(prepare);

/**
 * Signed distance (km) from a point to the nearest lowland shore: positive on the plain, negative at sea or in a lake.
 * Returns -Infinity far from every plain, which is nearly everywhere, so the common case costs four comparisons.
 */
export function lowlandDistance(lonDeg: number, latDeg: number): number {
  let best = -Infinity;
  for (const p of PREPARED) {
    if (lonDeg < p.minLon || lonDeg > p.maxLon || latDeg < p.minLat || latDeg > p.maxLat) continue;
    const x = (lonDeg - p.lon0) * p.cosLat0 * KM_PER_DEG;
    const y = (latDeg - p.lat0) * KM_PER_DEG;
    const { xs, ys } = p;
    const n = xs.length;
    let d2 = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = xs[j]!, ay = ys[j]!, bx = xs[i]!, by = ys[i]!;
      const ex = bx - ax, ey = by - ay;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      const dx = x - (ax + ex * t), dy = y - (ay + ey * t);
      d2 = Math.min(d2, dx * dx + dy * dy);
      if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * ex) inside = !inside;
    }
    let d = inside ? Math.sqrt(d2) : -Math.sqrt(d2);
    for (const lake of p.lakes) d = Math.min(d, Math.hypot(x - lake.x, y - lake.y) - lake.r);
    if (d > best) best = d;
  }
  return best < -LOWLAND_REACH_KM ? -Infinity : best;
}
