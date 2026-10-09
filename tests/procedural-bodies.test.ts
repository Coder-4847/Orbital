import { describe, expect, it } from 'vitest';
import { BODY_PROFILES, maxLevelFor } from '../src/terrain/body-profiles';
import { buildChunk } from '../src/terrain/chunk-builder';
import { lonLatToDirection } from '../src/terrain/cube-sphere';
import { ProceduralBodySource } from '../src/terrain/procedural-source';
import { TERRAIN_BODY_IDS, createTerrainSource } from '../src/terrain/source-registry';
import { makeSurfaceSample } from '../src/terrain/types';
import { loadEarthDataForTests } from './helpers/earth-data';

const DEG = Math.PI / 180;
const at = (src: ProceduralBodySource, lon: number, lat: number, spacing = 2000) => {
  const d = lonLatToDirection(lon * DEG, lat * DEG, new Float64Array(3));
  const out = makeSurfaceSample();
  src.sample(d[0]!, d[1]!, d[2]!, spacing, out);
  return out;
};

describe('procedural bodies', () => {
  it('every catalogue body with terrain has a source, and each is deterministic', () => {
    for (const id of TERRAIN_BODY_IDS) {
      const a = createTerrainSource(id, loadEarthDataForTests());
      const b = createTerrainSource(id, loadEarthDataForTests());
      const sa = makeSurfaceSample();
      const sb = makeSurfaceSample();
      a.sample(0.3, 0.5, Math.sqrt(1 - 0.34), 100, sa);
      b.sample(0.3, 0.5, Math.sqrt(1 - 0.34), 100, sb);
      expect(sa).toEqual(sb);
    }
  });

  it('heights stay within each profile\'s declared bound on a global sample', () => {
    const violations: string[] = [];
    for (const id of Object.keys(BODY_PROFILES)) {
      const src = createTerrainSource(id) as ProceduralBodySource;
      const spacing = src.radius / 400;
      let worst = 0;
      for (let i = 0; i < 2500; i++) {
        const y = 1 - (2 * (i + 0.5)) / 2500;
        const r = Math.sqrt(1 - y * y);
        const phi = i * 2.399963229728653;
        const out = makeSurfaceSample();
        src.sample(r * Math.cos(phi), y, r * Math.sin(phi), spacing, out);
        expect(Number.isFinite(out.height)).toBe(true);
        expect(out.tone).toBeGreaterThanOrEqual(0);
        expect(out.tone).toBeLessThanOrEqual(1);
        worst = Math.max(worst, Math.abs(out.height));
      }
      if (worst >= src.maxHeight) violations.push(`${id}: ${worst.toFixed(0)} >= ${src.maxHeight}`);
    }
    expect(violations).toEqual([]);
  });

  it('Mars has Olympus Mons high, Hellas low, and polar caps', () => {
    const mars = createTerrainSource('mars') as ProceduralBodySource;
    const olympus = at(mars, -133.8, 18.65, 5000).height;
    const hellas = at(mars, 70, -42, 5000).height;
    expect(olympus).toBeGreaterThan(12_000);
    expect(hellas).toBeLessThan(-3000);
    expect(olympus - hellas).toBeGreaterThan(18_000);
    expect(at(mars, 20, 88).ice).toBeGreaterThan(0.9);
    expect(at(mars, 20, 10).ice).toBe(0);
  });

  it('Mars lowlands are lower on average than the southern highlands', () => {
    const mars = createTerrainSource('mars') as ProceduralBodySource;
    let north = 0;
    let south = 0;
    for (let k = 0; k < 300; k++) {
      north += at(mars, (k * 47) % 360 - 180, 40 + (k % 7) * 3, 20_000).height;
      south += at(mars, (k * 53) % 360 - 180, -40 - (k % 7) * 3, 20_000).height;
    }
    expect(south / 300 - north / 300).toBeGreaterThan(2000);
  });

  it('Pluto\'s Sputnik Planitia is bright nitrogen ice in a basin; Cthulhu is dark', () => {
    const pluto = createTerrainSource('pluto') as ProceduralBodySource;
    const sputnik = at(pluto, 178, 25, 3000);
    expect(sputnik.ice).toBeGreaterThan(0.8);
    expect(sputnik.tone).toBeLessThan(0.15);
    expect(at(pluto, 90, -10, 3000).tone).toBeGreaterThan(0.9);
  });

  it('Europa has dark lineae and a bright base; Titan has a dark equatorial dune belt', () => {
    const europa = createTerrainSource('europa') as ProceduralBodySource;
    let lineae = 0;
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const t = at(europa, (k * 37) % 360 - 180, ((k * 13) % 120) - 60, 3000).tone;
      n++;
      if (t > 0.6) lineae++;
    }
    expect(lineae / n).toBeGreaterThan(0.03);
    expect(lineae / n).toBeLessThan(0.5);

    const titan = createTerrainSource('titan') as ProceduralBodySource;
    let eq = 0;
    let pol = 0;
    for (let k = 0; k < 300; k++) {
      eq += at(titan, (k * 41) % 360 - 180, (k % 9) - 4, 5000).tone;
      pol += at(titan, (k * 41) % 360 - 180, 70 + (k % 9), 5000).tone;
    }
    expect(eq / 300).toBeGreaterThan(pol / 300 + 0.15);
  });

  it('Callisto is more densely cratered (rougher at crater scales) than Europa', () => {
    const rough = (id: string) => {
      const src = createTerrainSource(id) as ProceduralBodySource;
      let sum = 0;
      for (let k = 0; k < 200; k++) {
        const lon = (k * 29) % 360 - 180;
        const a = at(src, lon, 10, 1500).height;
        const b = at(src, lon + 0.2, 10, 1500).height;
        sum += Math.abs(a - b);
      }
      return sum / 200;
    };
    expect(rough('callisto')).toBeGreaterThan(rough('europa'));
  });

  it('chunks build for a small irregular moon and a large icy moon', () => {
    for (const id of ['phobos', 'ganymede']) {
      const src = createTerrainSource(id);
      const c = buildChunk(src, { face: 2, level: 3, i: 3, j: 4 });
      expect(c.vertexCount).toBeGreaterThan(4000);
      expect(c.positions.every(Number.isFinite)).toBe(true);
    }
  });

  it('maxLevelFor gives ~0.5 m cells', () => {
    expect(maxLevelFor(6_371_000)).toBe(19);
    expect(maxLevelFor(11_100)).toBeLessThanOrEqual(10);
    expect(maxLevelFor(2_439_700)).toBeGreaterThanOrEqual(17);
  });
});
