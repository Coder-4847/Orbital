import { describe, expect, it } from 'vitest';
import { lonLatToDirection } from '../src/terrain/cube-sphere';
import { EarthSource } from '../src/terrain/earth-source';
import { MoonSource } from '../src/terrain/moon-source';
import { Simplex3 } from '../src/terrain/noise';
import { makeSurfaceSample, type TerrainSource } from '../src/terrain/types';
import { loadEarthDataForTests } from './helpers/earth-data';

const DEG = Math.PI / 180;
const at = (src: TerrainSource, lonDeg: number, latDeg: number, spacing = 1000) => {
  const d = lonLatToDirection(lonDeg * DEG, latDeg * DEG, new Float64Array(3));
  const out = makeSurfaceSample();
  src.sample(d[0]!, d[1]!, d[2]!, spacing, out);
  return out;
};

describe('Simplex3', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = new Simplex3(5);
    const b = new Simplex3(5);
    const c = new Simplex3(6);
    expect(a.noise(1.3, 2.7, -0.4)).toBe(b.noise(1.3, 2.7, -0.4));
    expect(a.noise(1.3, 2.7, -0.4)).not.toBe(c.noise(1.3, 2.7, -0.4));
  });

  it('stays within [-1.1, 1.1] and has roughly zero mean', () => {
    const n = new Simplex3(9);
    let min = 9, max = -9, sum = 0;
    const count = 20000;
    for (let i = 0; i < count; i++) {
      const v = n.noise(i * 0.137, i * 0.071 + 3, i * 0.213 - 7);
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
    }
    expect(min).toBeGreaterThan(-1.1);
    expect(max).toBeLessThan(1.1);
    expect(Math.abs(sum / count)).toBeLessThan(0.05);
  });

  it('fbm skips octaves finer than minWavelength (coarse sampling is smoother)', () => {
    const n = new Simplex3(2);
    const fine = n.fbm(10, 20, 30, 100, 0.1, 0.6);
    const coarse = n.fbm(10, 20, 30, 100, 50, 0.6);
    expect(fine).not.toBe(coarse);
  });
});

describe('EarthSource (real data)', () => {
  const earth = new EarthSource(loadEarthDataForTests());

  it('puts the Himalaya high, the open Pacific at sea level and the Sahara above sea level', () => {
    expect(at(earth, 86.9, 28).height).toBeGreaterThan(4500);
    const pacific = at(earth, -150, 0);
    expect(pacific.height).toBe(0);
    expect(pacific.elevation).toBeLessThan(-3000);
    expect(at(earth, 15, 25).height).toBeGreaterThan(100);
    expect(at(earth, 25, 0).height).toBeGreaterThan(0); // Africa
  });

  it('has Earth-like land fraction (25-36%) on a global sample', () => {
    let land = 0;
    const count = 4000;
    for (let i = 0; i < count; i++) {
      // Fibonacci sphere
      const y = 1 - (2 * (i + 0.5)) / count;
      const r = Math.sqrt(1 - y * y);
      const phi = i * 2.399963229728653;
      const out = makeSurfaceSample();
      earth.sample(r * Math.cos(phi), y, r * Math.sin(phi), 5000, out);
      if (out.height > 0) land++;
    }
    expect(land / count).toBeGreaterThan(0.25);
    expect(land / count).toBeLessThan(0.36);
  });

  it('is deterministic and independent between instances', () => {
    const other = new EarthSource(loadEarthDataForTests());
    const a = at(earth, 10.123, 47.456, 3);
    const b = at(other, 10.123, 47.456, 3);
    expect(a).toEqual(b);
  });

  it('finer spacing adds detail but stays close to the coarse surface', () => {
    const coarse = at(earth, 86.9, 28, 20000).height;
    const fine = at(earth, 86.9, 28, 1).height;
    expect(Math.abs(fine - coarse)).toBeLessThan(900);
  });

  it('snow on high latitudes and mountains, none in the tropics lowlands', () => {
    expect(at(earth, 0, -80).ice).toBeGreaterThan(0.8); // Antarctica
    expect(at(earth, 86.9, 28).ice).toBeGreaterThan(0.5); // Himalaya
    expect(at(earth, -60, -3).ice).toBeLessThan(0.05); // Amazon
  });

  it('has night lights over Europe/India and none over the ocean', () => {
    let lit = 0;
    for (let k = 0; k < 40; k++) lit = Math.max(lit, at(earth, 2 + k * 0.3, 48 + (k % 5) * 0.4).lights);
    expect(lit).toBeGreaterThan(0.1);
    expect(at(earth, -150, 0).lights).toBe(0);
  });
});

describe('MoonSource', () => {
  const moon = new MoonSource();

  it('is deterministic', () => {
    expect(at(moon, 20, 10, 5)).toEqual(at(new MoonSource(), 20, 10, 5));
  });

  it('maria are low and dark, highlands high and bright', () => {
    const mare = at(moon, 31.4, 8.5, 5000); // Tranquillitatis
    const highland = at(moon, 160, 20, 5000); // far side
    expect(mare.tone).toBeGreaterThan(0.8);
    expect(highland.tone).toBe(0);
    expect(mare.height).toBeLessThan(highland.height);
  });

  it('Tycho has a deep bowl relative to its rim', () => {
    const centre = at(moon, -11.4, -43.3, 500).height;
    // Rim is ~42 km away along a meridian: 42.5 km / 1737.4 km in radians.
    const rim = at(moon, -11.4, -43.3 + (42.5 / 1737.4) / DEG, 500).height;
    expect(rim - centre).toBeGreaterThan(1500);
  });

  it('stays within its declared height bound over a global sample', () => {
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const y = 1 - (2 * (i + 0.5)) / 3000;
      const r = Math.sqrt(1 - y * y);
      const phi = i * 2.399963229728653;
      const out = makeSurfaceSample();
      moon.sample(r * Math.cos(phi), y, r * Math.sin(phi), 3000, out);
      worst = Math.max(worst, Math.abs(out.height));
    }
    expect(worst).toBeLessThan(moon.maxHeight);
  });
});
