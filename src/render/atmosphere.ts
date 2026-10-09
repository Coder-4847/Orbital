import {
  AddEquation,
  CustomBlending,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector3,
  type UniformNode,
} from 'three/webgpu';
import {
  Fn,
  Loop,
  acos,
  cameraPosition,
  dot,
  exp,
  float,
  length,
  max,
  min,
  normalize,
  positionWorld,
  pow,
  select,
  smoothstep,
  sqrt,
  vec3,
  vec4,
} from 'three/tsl';

export interface AtmosphereParams {
  /** Planet surface radius and outer shell radius, in world units. */
  radius: number;
  outerRadius: number;
  /** Scale heights in world units. */
  scaleHeightRayleigh: number;
  scaleHeightMie: number;
  /** Scattering coefficients per world unit (RGB for Rayleigh). */
  betaRayleigh: [number, number, number];
  betaMie: number;
  /** Henyey-Greenstein-style asymmetry for Mie scattering. */
  mieG: number;
  /** Sun radiance scale; also tunes overall brightness of the haze. */
  sunIntensity: number;
}

/** Earth's atmosphere in SI units; scale with `earthAtmosphere(metersPerUnit)`. */
export function earthAtmosphere(metersPerUnit: number, planetRadiusUnits: number, opts: { heightScale?: number; sunIntensity?: number; mieScale?: number } = {}): AtmosphereParams {
  const k = metersPerUnit; // metres per world unit; coefficients are per metre, so multiply
  const heightScale = opts.heightScale ?? 1;
  return {
    radius: planetRadiusUnits,
    outerRadius: planetRadiusUnits + (100_000 * heightScale) / k,
    scaleHeightRayleigh: (8_000 * heightScale) / k,
    scaleHeightMie: (1_200 * heightScale) / k,
    betaRayleigh: [(5.802e-6 / heightScale) * k, (13.558e-6 / heightScale) * k, (33.1e-6 / heightScale) * k],
    betaMie: (3.996e-6 * (opts.mieScale ?? 1) / heightScale) * k,
    mieG: 0.76,
    sunIntensity: opts.sunIntensity ?? 22,
  };
}

const STEPS = 20;
const MIE_EXTINCTION = 1.11;

/**
 * Single-scattering atmosphere, ray-marched on a shell mesh around the planet.
 * Rayleigh + Mie with exponential density; sun transmittance uses a Kasten-Young airmass approximation so
 * twilight reddens naturally. This is the Phase-1 stand-in; Phase 2 replaces it with LUT-based scattering.
 *
 * Blend is premultiplied-over: out = inscatter + dst * transmittance, so the planet behind is dimmed as well as brightened.
 */
export function createAtmosphereMaterial(
  p: AtmosphereParams,
  center: UniformNode<'vec3', Vector3>,
  sunDir: UniformNode<'vec3', Vector3>,
): MeshBasicNodeMaterial {
  const R = float(p.radius);
  const Ra = float(p.outerRadius);
  const HR = float(p.scaleHeightRayleigh);
  const HM = float(p.scaleHeightMie);
  const betaR = vec3(...p.betaRayleigh);
  const betaM = float(p.betaMie);
  const betaMExt = float(p.betaMie * MIE_EXTINCTION);
  const g = float(p.mieG);

  const shade = Fn(() => {
    const ro = cameraPosition.sub(center).toVar();
    const rd = normalize(positionWorld.sub(cameraPosition)).toVar();
    const b = dot(ro, rd).toVar();
    const ro2 = dot(ro, ro).toVar();

    // Ray segment inside the shell, clipped by the planet body.
    const sA = sqrt(max(b.mul(b).sub(ro2.sub(Ra.mul(Ra))), 0));
    const t0 = max(b.negate().sub(sA), 0).toVar();
    const t1 = b.negate().add(sA).toVar();
    const discP = b.mul(b).sub(ro2.sub(R.mul(R)));
    const tP = b.negate().sub(sqrt(max(discP, 0)));
    t1.assign(select(discP.greaterThan(0).and(tP.greaterThan(0)), min(t1, tP), t1));

    const ds = max(t1.sub(t0), 0).div(STEPS).toVar();

    const cosT = dot(rd, sunDir).toVar();
    const phaseR = float(3 / (16 * Math.PI)).mul(cosT.mul(cosT).add(1));
    const gg = g.mul(g);
    const phaseM = float(3 / (8 * Math.PI))
      .mul(float(1).sub(gg))
      .mul(cosT.mul(cosT).add(1))
      .div(float(2).add(gg).mul(pow(float(1).add(gg).sub(g.mul(2).mul(cosT)), 1.5)));

    const odR = float(0).toVar();
    const odM = float(0).toVar();
    const inscatter = vec3(0).toVar();

    Loop(STEPS, ({ i }) => {
      const pos = ro.add(rd.mul(t0.add(ds.mul(float(i).add(0.5))))).toVar();
      const rr = length(pos).toVar();
      const hgt = max(rr.sub(R), 0).toVar();
      const rhoR = exp(hgt.negate().div(HR)).toVar();
      const rhoM = exp(hgt.negate().div(HM)).toVar();
      odR.addAssign(rhoR.mul(ds));
      odM.addAssign(rhoM.mul(ds));

      // Sun: cosine of the local sun zenith angle, and whether the planet's own shadow covers this point.
      const mu = dot(pos, sunDir).div(rr).toVar();
      const horizon = sqrt(max(float(1).sub(R.mul(R).div(rr.mul(rr))), 0)); // sun visible when mu > -horizon
      const lit = smoothstep(horizon.negate().sub(0.025), horizon.negate().add(0.015), mu);
      const zenithDeg = acos(max(mu, 0)).mul(180 / Math.PI);
      const airmass = float(1).div(max(mu, 0).add(float(0.50572).mul(pow(float(96.07995).sub(zenithDeg), -1.6364))));

      const tauSun = betaR.mul(rhoR.mul(HR).mul(airmass)).add(betaMExt.mul(rhoM.mul(HM).mul(airmass)));
      const tauView = betaR.mul(odR).add(betaMExt.mul(odM));
      const attenuation = exp(tauSun.add(tauView).negate());

      const scatter = betaR.mul(rhoR.mul(ds)).mul(phaseR).add(vec3(betaM.mul(rhoM.mul(ds)).mul(phaseM)));
      inscatter.addAssign(scatter.mul(attenuation).mul(lit));
    });

    const transmittance = exp(betaR.mul(odR).add(betaMExt.mul(odM)).negate());
    const alpha = float(1).sub(dot(transmittance, vec3(1 / 3, 1 / 3, 1 / 3)));
    return vec4(inscatter.mul(p.sunIntensity), alpha);
  });

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
  });
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  material.fragmentNode = shade();
  return material;
}
