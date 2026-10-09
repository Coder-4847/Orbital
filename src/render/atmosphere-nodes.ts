import { Vector3, type Node, type Texture } from 'three/webgpu';
import { abs, clamp, exp, float, max, pow, smoothstep, sqrt, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { AtmosphereDef } from './atmosphere-model';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/**
 * An atmosphere as shader nodes. The same maths serves two uses: compile-time constants (terrain materials and the LUT bake
 * know their body) and uniforms (the full-screen atmosphere pass switches between bodies at runtime without recompiling).
 */
export interface AtmosphereNodes {
  radiusKm: F;
  topKm: F;
  /** Horizon distance from the top of the atmosphere, km: sqrt(top^2 - radius^2). */
  horizonKm: F;
  rayleigh: V3;
  rayleighH: F;
  mieScattering: V3;
  mieAbsorption: V3;
  mieH: F;
  mieG: F;
  layerCentre: F;
  layerHalf: F;
  layerScattering: V3;
  layerAbsorption: V3;
  layerG: F;
}

const horizonKm = (def: AtmosphereDef) => Math.sqrt((def.topRadius / 1000) ** 2 - (def.radius / 1000) ** 2);

export function constantNodes(def: AtmosphereDef): AtmosphereNodes {
  const L = def.layer;
  return {
    radiusKm: float(def.radius / 1000),
    topKm: float(def.topRadius / 1000),
    horizonKm: float(horizonKm(def)),
    rayleigh: vec3(...def.rayleighScattering),
    rayleighH: float(def.rayleighScaleHeight),
    mieScattering: vec3(...def.mieScattering),
    mieAbsorption: vec3(...def.mieAbsorption),
    mieH: float(def.mieScaleHeight),
    mieG: float(def.mieG),
    layerCentre: float(L ? L.centre : 1e9),
    layerHalf: float(L ? L.halfWidth : 1),
    layerScattering: vec3(...(L ? L.scattering : [0, 0, 0])),
    layerAbsorption: vec3(...(L ? L.absorption : [0, 0, 0])),
    layerG: float(L ? L.g : 0),
  };
}

/** Uniform-backed atmosphere whose parameters can be swapped at runtime. */
export class UniformAtmosphere {
  readonly nodes: AtmosphereNodes;
  private readonly u = {
    radiusKm: uniform(1),
    topKm: uniform(1),
    horizonKm: uniform(1),
    rayleigh: uniform(new Vector3()),
    rayleighH: uniform(1),
    mieS: uniform(new Vector3()),
    mieA: uniform(new Vector3()),
    mieH: uniform(1),
    mieG: uniform(0),
    layerC: uniform(1e9),
    layerW: uniform(1),
    layerS: uniform(new Vector3()),
    layerA: uniform(new Vector3()),
    layerG: uniform(0),
  };

  constructor() {
    const u = this.u;
    this.nodes = {
      radiusKm: u.radiusKm as unknown as F,
      topKm: u.topKm as unknown as F,
      horizonKm: u.horizonKm as unknown as F,
      rayleigh: u.rayleigh as unknown as V3,
      rayleighH: u.rayleighH as unknown as F,
      mieScattering: u.mieS as unknown as V3,
      mieAbsorption: u.mieA as unknown as V3,
      mieH: u.mieH as unknown as F,
      mieG: u.mieG as unknown as F,
      layerCentre: u.layerC as unknown as F,
      layerHalf: u.layerW as unknown as F,
      layerScattering: u.layerS as unknown as V3,
      layerAbsorption: u.layerA as unknown as V3,
      layerG: u.layerG as unknown as F,
    };
  }

  set(def: AtmosphereDef): void {
    const u = this.u;
    const L = def.layer;
    u.radiusKm.value = def.radius / 1000;
    u.topKm.value = def.topRadius / 1000;
    u.horizonKm.value = horizonKm(def);
    u.rayleigh.value.fromArray(def.rayleighScattering);
    u.rayleighH.value = def.rayleighScaleHeight;
    u.mieS.value.fromArray(def.mieScattering);
    u.mieA.value.fromArray(def.mieAbsorption);
    u.mieH.value = def.mieScaleHeight;
    u.mieG.value = def.mieG;
    u.layerC.value = L ? L.centre : 1e9;
    u.layerW.value = L ? L.halfWidth : 1;
    u.layerS.value.fromArray(L ? L.scattering : [0, 0, 0]);
    u.layerA.value.fromArray(L ? L.absorption : [0, 0, 0]);
    u.layerG.value = L ? L.g : 0;
  }
}

/** Tent profile of the extra layer at height h (metres): 1 at its centre, 0 beyond its half-width. */
export const layerTent = (a: AtmosphereNodes, h: F): F => max(float(1).sub(abs(h.sub(a.layerCentre)).div(a.layerHalf)), 0) as F;

/** Extinction coefficient (RGB, per metre) at height h metres. */
export function extinctionNodes(a: AtmosphereNodes, h: F): V3 {
  const rayleigh = a.rayleigh.mul(exp(h.div(a.rayleighH).negate()));
  const mie = a.mieScattering.add(a.mieAbsorption).mul(exp(h.div(a.mieH).negate()));
  const layer = a.layerScattering.add(a.layerAbsorption).mul(layerTent(a, h));
  return rayleigh.add(mie).add(layer) as V3;
}

/** Cornette-Shanks phase function (normalised over the sphere) for asymmetry g. */
export function mieLikePhase(g: F, cosTheta: F): F {
  const gg = g.mul(g);
  return float(3 / (8 * Math.PI))
    .mul(float(1).sub(gg))
    .mul(cosTheta.mul(cosTheta).add(1))
    .div(float(2).add(gg).mul(pow(float(1).add(gg).sub(g.mul(2).mul(cosTheta)), 1.5))) as F;
}

/**
 * A transmittance LUT texture that can be swapped at runtime. Sampling nodes created through `sample` are tracked so that
 * `set` re-points all of them (a cloned TextureNode would otherwise keep the texture it was created with).
 */
export class LutBinding {
  private readonly nodes: Array<{ value: Texture }> = [];

  constructor(private texture_: Texture) {}

  readonly sample = (uv: Node<'vec2'>): Node<'vec4'> => {
    const node = texture(this.texture_, uv);
    this.nodes.push(node as unknown as { value: Texture });
    return node as unknown as Node<'vec4'>;
  };

  set(tex: Texture): void {
    if (tex === this.texture_) return;
    this.texture_ = tex;
    for (const n of this.nodes) n.value = tex;
  }
}

/**
 * Sun transmittance lookup: from radius `rMetres` along direction cosine `mu` to the top of the atmosphere, zero when the
 * planet blocks the ray (smoothed over the Sun's angular size). `sample` reads the baked LUT for this atmosphere.
 */
export function lutLookup(a: AtmosphereNodes, sample: (uv: Node<'vec2'>) => Node<'vec4'>, rMetres: F, mu: F): V3 {
  const R = a.radiusKm;
  const Ra = a.topKm;
  const H = a.horizonKm;
  const r = max(rMetres.div(1000), R);
  const rho = sqrt(max(r.mul(r).sub(R.mul(R)), 0));
  const muH = float(0).sub(sqrt(max(float(1).sub(R.mul(R).div(r.mul(r))), 0)));
  const muC = max(mu, muH);
  const disc = max(r.mul(r).mul(muC).mul(muC).sub(r.mul(r)).add(Ra.mul(Ra)), 0);
  const dTop = r.mul(muC).negate().add(sqrt(disc));
  const dMin = Ra.sub(r);
  const dMax = rho.add(H);
  const u = clamp(dTop.sub(dMin).div(max(dMax.sub(dMin), 1e-3)), 0, 1);
  const v = clamp(rho.div(H), 0, 1);
  const vis = smoothstep(muH.sub(0.006), muH.add(0.002), mu);
  return sample(vec2(u, v)).rgb.mul(vis) as V3;
}
