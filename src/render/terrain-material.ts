import { NodeMaterial, type Node, type Texture } from 'three/webgpu';
import {
  abs,
  asin,
  atan,
  attribute,
  color,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  modelNormalMatrix,
  mx_fractal_noise_float,
  normalLocal,
  normalWorld,
  normalize,
  positionView,
  positionWorld,
  pow,
  saturate,
  select,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { DETAIL_PERIOD } from '../terrain/chunk-builder';
import { atmosphereLighting } from './atmosphere-lighting';
import { sunVisibility2 } from './eclipse';
import type { TransmittanceLut } from './atmosphere-lut';
import type { PlanetUniforms } from './planet-uniforms';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Tiling noise sampled triplanar at world period `scale` metres; returns all four channels. */
export function triplanar(tex: Texture, coord: V3, weights: V3, scale: number): Node<'vec4'> {
  const sx = texture(tex, coord.yz.div(scale));
  const sy = texture(tex, coord.xz.div(scale));
  const sz = texture(tex, coord.xy.div(scale));
  return sx.mul(weights.x).add(sy.mul(weights.y)).add(sz.mul(weights.z)) as Node<'vec4'>;
}

export interface EarthMaterialOptions {
  uniforms: PlanetUniforms;
  lut: TransmittanceLut;
  detail: Texture;
  /** Night-light density, equirectangular (see terrain/earth-source EarthData.lights). */
  lights: Texture;
}

/**
 * Earth surface shader. Per-vertex climate (from the terrain workers) selects biomes; tiling detail noise breaks up
 * colour at close range; the ocean has depth colour, sun glint and sky reflection. Lighting is evaluated directly:
 * sun colour comes from the transmittance LUT, so sunsets redden the ground and the terminator is physically placed.
 */
export function createEarthMaterial({ uniforms: u, lut, detail, lights }: EarthMaterialOptions): NodeMaterial {
  const surfA = attribute('aSurfA', 'vec4');
  const detailCoord = attribute('aDetail', 'vec3') as V3;

  const nLocal = normalize(normalLocal) as V3;
  const nW = normalize(normalWorld) as V3;
  const P = positionWorld.sub(u.center) as V3;
  const r = length(P) as F;
  const up = P.div(r) as V3;
  const mu = dot(up, u.sunDir) as F;
  const viewDist = length(positionView) as F;
  const cosSlope = dot(nW, up) as F;

  const elevM = surfA.x.mul(1000) as F;
  const elevKm = max(surfA.x, 0) as F;
  const temp = surfA.y as F;
  const moist = surfA.z as F;
  const ice = surfA.w as F;

  // --- detail noise (fades out with distance, per scale) ---
  const w = pow(abs(nLocal), vec3(4, 4, 4)) as V3;
  const weights = w.div(w.x.add(w.y).add(w.z)) as V3;
  const fade = (scale: number) => smoothstep(scale * 70, scale * 7, viewDist) as F;
  const dCoarse = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 8).r, fade(DETAIL_PERIOD / 8)) as F; // 256 m
  const dMid = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 128).g, fade(DETAIL_PERIOD / 128)) as F; // 16 m
  const dFine = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 1024).b, fade(DETAIL_PERIOD / 1024)) as F; // 2 m
  const detailAlbedo = dCoarse.mul(0.55).add(0.725).mul(dMid.mul(0.4).add(0.8)).mul(dFine.mul(0.3).add(0.85)) as F;

  // --- land colour ---
  const desert = color(0xb08c55);
  const steppe = color(0x7a7338);
  const grass = color(0x4a6222);
  const forest = color(0x1d3d15);
  const rainforest = color(0x0e2e12);
  const tundra = color(0x6f6c5a);
  const rock = color(0x6a625a);
  const snow = color(0xd9dee5);

  let land = mix(desert, steppe, smoothstep(0.1, 0.34, moist)) as V3;
  land = mix(land, grass, smoothstep(0.3, 0.55, moist)) as V3;
  land = mix(land, forest, smoothstep(0.5, 0.78, moist).mul(smoothstep(0.28, 0.5, temp))) as V3;
  land = mix(land, rainforest, smoothstep(0.72, 0.95, moist).mul(smoothstep(0.62, 0.8, temp))) as V3;
  land = mix(land, tundra, smoothstep(0.36, 0.17, temp)) as V3;
  const rockAmount = max(smoothstep(0.86, 0.64, cosSlope), smoothstep(float(1.8).add(temp.mul(3)), float(3.6).add(temp.mul(3)), elevKm)) as F;
  land = mix(land, rock, rockAmount) as V3;
  // Snow clings to gentle slopes and breaks up into rock outcrops at coarse and mid scales.
  const snowPatch = smoothstep(0.18, 0.62, dCoarse.mul(0.7).add(dMid.mul(0.3)).add(ice.mul(0.35))) as F;
  const snowAmount = saturate(ice.mul(smoothstep(0.55, 0.85, cosSlope)).mul(snowPatch)) as F;
  land = mix(land, snow, snowAmount) as V3;
  const beach = smoothstep(10, 0, elevM).mul(0.65) as F;
  land = mix(land, color(0xcdbd94), beach.mul(float(1).sub(snowAmount))) as V3;
  const landAlbedo = land.mul(detailAlbedo.mul(float(1).sub(snowAmount.mul(0.6)).add(snowAmount.mul(0.9)))) as V3;

  // --- ocean colour ---
  const depthM = max(elevM.negate(), 0) as F;
  const shallowness = exp(depthM.div(-30)) as F;
  let sea = mix(color(0x020d22), color(0x053a55), exp(depthM.div(-450))) as V3;
  sea = mix(sea, color(0x1f7d99), shallowness.mul(0.7)) as V3;
  const seaIce = saturate(ice) as F;
  const waterAlbedo = mix(sea, vec3(0.75, 0.82, 0.88), seaIce) as V3;

  const isWater = elevM.lessThan(0) as Node<'bool'>;

  // --- lighting ---
  const { sunColour, ambient } = atmosphereLighting(u.sunE as V3, lut.lookup, lut.def.radius, r, mu);
  const hemi = dot(nW, up).mul(0.35).add(0.65) as F;

  // Water: perturb the normal with scrolling noise gradients (fades with distance so the far ocean stays calm).
  const tw = u.time;
  const wc1 = detailCoord.add(vec3(tw.mul(0.9), 0, tw.mul(0.55))) as V3;
  const wc2 = detailCoord.add(vec3(tw.mul(-0.5), 0, tw.mul(1.3))) as V3;
  const wa = triplanar(detail, wc1, weights, 90);
  const wb = triplanar(detail, wc2, weights, 11);
  const waveFade = smoothstep(9000, 300, viewDist) as F;
  const pertLocal = vec3(wa.r.add(wb.b).sub(1), wa.g.add(wb.r).sub(1), wa.b.add(wb.g).sub(1)).mul(waveFade.mul(0.16)) as V3;
  const pertW = modelNormalMatrix.mul(pertLocal) as V3;
  const nWater = normalize(nW.add(pertW.sub(nW.mul(dot(pertW, nW))))) as V3;

  const Lv = u.sunDir as V3;
  const V = normalize(positionWorld.negate()) as V3;

  const nShade = select(isWater, nWater, nW) as V3;
  const nDotL = saturate(dot(nShade, Lv)) as F;
  const albedo = select(isWater, waterAlbedo, landAlbedo) as V3;

  const eclipse = sunVisibility2(positionWorld, u.sunPos as V3, u.occluderA as Node<'vec4'>, u.occluderB as Node<'vec4'>);
  const diffuse = albedo.mul(sunColour.mul(nDotL).mul(eclipse).add(ambient.mul(hemi))).div(Math.PI) as V3;

  // GGX sun glint on water.
  const Hh = normalize(Lv.add(V)) as V3;
  const nDotH = saturate(dot(nWater, Hh)) as F;
  const nDotV = max(dot(nWater, V), 0.03) as F;
  const alpha = mix(float(0.04), float(0.16), smoothstep(0, 60000, viewDist)) as F;
  const a2 = alpha.mul(alpha) as F;
  const denom = nDotH.mul(nDotH).mul(a2.sub(1)).add(1) as F;
  const D = a2.div(denom.mul(denom).mul(Math.PI)) as F;
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(saturate(dot(V, Hh))), 5))) as F;
  const glint = min(D.mul(fresnel).div(nDotV.mul(4)), 4000).mul(smoothstep(0, 0.04, dot(nWater, Lv))) as F;
  const skyRefl = ambient.div(Math.PI).mul(1.4).mul(float(0.02).add(float(0.98).mul(pow(float(1).sub(nDotV), 5)))) as V3;
  const waterSpec = sunColour.mul(glint).mul(eclipse).add(skyRefl).mul(float(1).sub(seaIce)) as V3;

  // Longitude/latitude of this fragment from its planet-relative direction; the map is smooth at any mesh LOD.
  const dirBF = normalize(u.bodyInverse.mul(vec4(up, 0)).xyz) as V3;
  const mapUV = vec2(atan(dirBF.z.negate(), dirBF.x).div(2 * Math.PI).add(0.5), float(0.5).sub(asin(dirBF.y).div(Math.PI)));
  // City lights on the night side. The source density map is coarse (~40 km), so it is broken up with 2 km noise from
  // orbit (clusters of lights with dark gaps) and with discrete ~24 m dots up close.
  const night = float(1).sub(smoothstep(-0.16, 0.0, mu)) as F;
  const nearLight = smoothstep(160000, 9000, viewDist) as F;
  // ~14 km clumps: direction-based noise, so it is resolvable (and stable) from orbit where a wrapped texture would alias.
  const farNoise = mx_fractal_noise_float(dirBF.mul(1500), 4, 2.1, 0.55).mul(0.5).add(0.5) as F;
  const farShape = float(0.3).add(smoothstep(0.34, 0.7, farNoise).mul(1.5)) as F;
  const dots = smoothstep(0.52, 0.72, mix(float(0.5), triplanar(detail, detailCoord, weights, 24).a, nearLight)) as F;
  const lightShape = mix(farShape, dots.mul(2.2), nearLight) as F;
  const density = pow(texture(lights, mapUV).r, 2.1) as F;
  const emissive = vec3(1.0, 0.66, 0.32).mul(density).mul(lightShape)    .mul(night).mul(0.8).mul(select(isWater, float(0), float(1))) as V3;

  const material = new NodeMaterial();
  material.fragmentNode = vec4(diffuse.add(select(isWater, waterSpec, vec3(0, 0, 0))).add(emissive), 1);
  return material;
}

export interface MoonMaterialOptions {
  uniforms: PlanetUniforms;
  detail: Texture;
}

/** Airless-body shader: maria/highland albedo, bright fresh craters, fine regolith noise. No atmosphere. */
export function createMoonMaterial({ uniforms: u, detail }: MoonMaterialOptions): NodeMaterial {
  const surfA = attribute('aSurfA', 'vec4');
  const surfB = attribute('aSurfB', 'vec4');
  const detailCoord = attribute('aDetail', 'vec3') as V3;
  const nLocal = normalize(normalLocal) as V3;
  const nW = normalize(normalWorld) as V3;
  const viewDist = length(positionView) as F;

  const w = pow(abs(nLocal), vec3(4, 4, 4)) as V3;
  const weights = w.div(w.x.add(w.y).add(w.z)) as V3;
  const fade = (scale: number) => smoothstep(scale * 70, scale * 7, viewDist) as F;
  const d1 = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 4).r, fade(DETAIL_PERIOD / 4)) as F;
  const d2 = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 64).g, fade(DETAIL_PERIOD / 64)) as F;
  const d3 = mix(float(0.5), triplanar(detail, detailCoord, weights, DETAIL_PERIOD / 512).b, fade(DETAIL_PERIOD / 512)) as F;
  const detailAlbedo = d1.mul(0.5).add(0.75).mul(d2.mul(0.45).add(0.78)).mul(d3.mul(0.35).add(0.83)) as F;

  const mare = surfB.y as F;
  const fresh = surfB.z as F;
  const highland = color(0x8a8780);
  const basalt = color(0x3e3d3c);
  let albedo = mix(highland, basalt, mare) as V3;
  albedo = mix(albedo, color(0xc9c6bf), fresh.mul(0.8)) as V3;
  albedo = albedo.mul(detailAlbedo).mul(0.62) as V3;

  const nDotL = saturate(dot(nW, u.sunDir)) as F;
  // Opposition surge: regolith brightens when the sun is behind the viewer.
  const V = normalize(positionWorld.negate()) as V3;
  const phase = float(1).add(saturate(dot(V, u.sunDir)).pow(24).mul(0.6)) as F;
  void surfA;
  const eclipse = sunVisibility2(positionWorld, u.sunPos as V3, u.occluderA as Node<'vec4'>, u.occluderB as Node<'vec4'>);
  const colour = albedo.mul(u.sunE.mul(nDotL).mul(phase).mul(eclipse).add(u.sunE.mul(0.0006))).div(Math.PI) as V3;

  const material = new NodeMaterial();
  material.fragmentNode = vec4(colour, 1);
  return material;
}
