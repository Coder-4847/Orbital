import { NodeMaterial, type Node, type Texture } from 'three/webgpu';
import {
  abs,
  asin,
  atan,
  attribute,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalLocal,
  normalWorld,
  normalize,
  positionView,
  positionWorld,
  pow,
  saturate,
  select,
  sin,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl';
import { DETAIL_PERIOD } from '../terrain/chunk-builder';
import type { BodyPalette, RGB } from '../terrain/body-profiles';
import { atmosphereLighting } from './atmosphere-lighting';
import type { TransmittanceLut } from './atmosphere-lut';
import { sunVisibility2 } from './eclipse';
import type { PlanetUniforms } from './planet-uniforms';
import { ringOpticalDepth } from './rings';
import { triplanar } from './terrain-material';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/** sRGB-ish authoring colours to linear working space. */
const lin = (c: RGB): V3 => vec3(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)) as V3;

export interface RockyMaterialOptions {
  uniforms: PlanetUniforms;
  detail: Texture;
  palette: BodyPalette;
  maxHeight: number;
  /** Present for bodies with an atmosphere (Venus, Mars, Titan): sunlight is filtered through it. */
  lut?: TransmittanceLut;
}

/**
 * Shader for the rocky and icy worlds with procedural terrain. Per-vertex tone (dark/light mottling), accent (young
 * craters, volcanic patches) and ice select between the body's palette colours; slope, elevation and tiling detail add
 * texture; light is the Sun (through the atmosphere where there is one), eclipse shadows, and a trace of ambient.
 */
export function createRockyMaterial({ uniforms: u, detail, palette, maxHeight, lut }: RockyMaterialOptions): NodeMaterial {
  const surfA = attribute('aSurfA', 'vec4');
  const surfB = attribute('aSurfB', 'vec4');
  const detailCoord = attribute('aDetail', 'vec3') as V3;
  const nLocal = normalize(normalLocal) as V3;
  const nW = normalize(normalWorld) as V3;
  const P = positionWorld.sub(u.center) as V3;
  const r = length(P) as F;
  const up = P.div(r) as V3;
  const viewDist = length(positionView) as F;

  const w = pow(abs(nLocal), vec3(4, 4, 4)) as V3;
  const weights = w.div(w.x.add(w.y).add(w.z)) as V3;
  const fade = (scale: number) => smoothstep(scale * 70, scale * 7, viewDist) as F;
  const d1 = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 4).r, fade(DETAIL_PERIOD / 4)) as F;
  const d2 = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 64).g, fade(DETAIL_PERIOD / 64)) as F;
  const d3 = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 512).b, fade(DETAIL_PERIOD / 512)) as F;
  const detailAlbedo = d1.mul(0.5).add(0.75).mul(d2.mul(0.45).add(0.78)).mul(d3.mul(0.35).add(0.83)) as F;

  const tone = surfB.y as F;
  const accent = surfB.z as F;
  const ice = surfA.w as F;
  const elevM = surfA.x.mul(1000) as F;

  let albedo = mix(lin(palette.base), lin(palette.dark), tone.mul(palette.toneStrength)) as V3;
  albedo = mix(albedo, lin(palette.fresh), accent.mul(0.85)) as V3;
  albedo = mix(albedo, lin(palette.ice), saturate(ice)) as V3;
  const cosSlope = dot(nW, up) as F;
  const relief = clamp(elevM.div(maxHeight), -1, 1).mul(0.12).add(1) as F;
  albedo = albedo.mul(detailAlbedo).mul(relief).mul(mix(float(0.62), float(1), smoothstep(0.55, 0.95, cosSlope))) as V3;

  const mu = dot(up, u.sunDir) as F;
  const nDotL = saturate(dot(nW, u.sunDir)) as F;
  const eclipse = sunVisibility2(positionWorld, u.sunPos as V3, u.occluderA as V4, u.occluderB as V4);

  let sunColour: V3 = u.sunE as V3;
  let ambient: V3 = u.sunE.mul(0.0006) as V3;
  let phase: F = float(1);
  if (lut) {
    ({ sunColour, ambient } = atmosphereLighting(u.sunE as V3, lut.lookup, lut.def.radius, r, mu));
  } else {
    const V = normalize(positionWorld.negate()) as V3;
    phase = float(1).add(saturate(dot(V, u.sunDir)).pow(24).mul(0.5)) as F; // opposition surge on airless regolith
  }

  const hemi = dot(nW, up).mul(0.35).add(0.65) as F;
  const colour = albedo.mul(sunColour.mul(nDotL).mul(phase).mul(eclipse).add(ambient.mul(hemi))).div(Math.PI) as V3;
  const material = new NodeMaterial();
  material.fragmentNode = vec4(colour, 1);
  return material;
}

export interface GasPalette {
  a: RGB;
  b: RGB;
  c: RGB;
  /** Bands per radian of latitude, and how strongly turbulence bends them. */
  frequency: number;
  turbulence: number;
  /** 0..1: contrast between the two band colours. */
  contrast: number;
  /** A storm: latitude (deg), longitude (deg), half-extent (deg lat, deg lon) and its colour. */
  storm?: { lat: number; lon: number; dLat: number; dLon: number; colour: RGB };
  polar: RGB;
  seed: number;
}

export interface GasGiantMaterialOptions {
  uniforms: PlanetUniforms;
  lut: TransmittanceLut;
  palette: GasPalette;
  /** Saturn: cast the ring shadow on the planet. */
  ringShadow?: boolean;
}

/** Banded cloud-top shader for the gas and ice giants, lit through their atmosphere (terminators redden). */
export function createGasGiantMaterial({ uniforms: u, lut, palette, ringShadow }: GasGiantMaterialOptions): NodeMaterial {
  const n = normalize(normalLocal) as V3; // flat sphere: the vertex normal is the body-fixed direction
  const nW = normalize(normalWorld) as V3;
  const lat = asin(clamp(n.y, -1, 1)) as F;
  const lon = atan(n.z.negate(), n.x) as F;
  const seed = vec3(palette.seed, palette.seed * 1.7, palette.seed * 2.3);

  const warp = mx_fractal_noise_float(n.mul(vec3(2.2, 5.5, 2.2)).add(seed), 5, 2, 0.5) as F;
  const band = float(0.5).add(float(0.5).mul(sin(lat.mul(palette.frequency).add(warp.mul(palette.turbulence))))) as F;
  const streaks = mx_fractal_noise_float(n.mul(vec3(26, 110, 26)).add(seed), 4, 2.1, 0.5).mul(0.5).add(0.5) as F;
  let col = mix(lin(palette.a), lin(palette.b), band.mul(palette.contrast)) as V3;
  col = mix(col, lin(palette.c), smoothstep(0.55, 0.9, streaks).mul(0.35)) as V3;

  if (palette.storm) {
    const s = palette.storm;
    const delta = lon.sub((s.lon * Math.PI) / 180);
    const dLon = atan(sin(delta), cos(delta)) as F; // longitude difference wrapped to [-pi, pi]
    const dx = dLon.div((s.dLon * Math.PI) / 180);
    const dy = lat.sub((s.lat * Math.PI) / 180).div((s.dLat * Math.PI) / 180);
    const weight = smoothstep(1, 0.35, dx.mul(dx).add(dy.mul(dy)).sqrt().add(warp.mul(0.25)));
    col = mix(col, lin(s.colour), weight.mul(0.85)) as V3;
  }
  col = mix(col, lin(palette.polar), smoothstep(1.1, 1.5, abs(lat))) as V3;

  const P = positionWorld.sub(u.center) as V3;
  const r = length(P) as F;
  const mu = dot(P.div(r), u.sunDir) as F;
  const { sunColour, ambient } = atmosphereLighting(u.sunE as V3, lut.lookup, lut.def.radius, r, mu);
  const nDotL = saturate(dot(nW, u.sunDir)) as F;
  const eclipse = sunVisibility2(positionWorld, u.sunPos as V3, u.occluderA as V4, u.occluderB as V4);

  let ringT: F = float(1);
  if (ringShadow) {
    // Where does the sun ray from this point cross the ring plane (through the planet centre, normal = body +Y = world pole)?
    const pole = u.pole as V3;
    const denom = dot(u.sunDir, pole);
    const t = dot(P, pole).negate().div(select(abs(denom).lessThan(1e-4), float(1e-4), denom)) as F;
    const hit = P.add((u.sunDir as V3).mul(t));
    const tau = ringOpticalDepth(length(hit).div(1e6) as F);
    ringT = select(t.greaterThan(0), exp(tau.negate().div(max(abs(denom), 0.05))), float(1)) as F;
  }

  const colour = col.mul(sunColour.mul(nDotL).mul(eclipse).mul(ringT).add(ambient)).div(Math.PI) as V3;
  const material = new NodeMaterial();
  material.fragmentNode = vec4(colour, 1);
  return material;
}

/** The Sun: an emissive HDR disc with limb darkening. Radiance is "900 suns" of a lit surface (the marker uses the same). */
export function createSunMaterial(uniforms: PlanetUniforms): NodeMaterial {
  // Radial direction from the centre uniform (the interpolated normal of a body 1e11 m away is too coarse to trust).
  const radial = normalize(positionWorld.sub(uniforms.center)) as V3;
  const V = normalize(positionWorld.negate()) as V3;
  const mu = saturate(dot(radial, V)) as F;
  const limb = float(1).sub(float(0.62).mul(float(1).sub(mu))) as F;
  const material = new NodeMaterial();
  material.fragmentNode = vec4(vec3(1.0, 0.9, 0.72).mul(900).mul(limb), 1);
  return material;
}
