/**
 * Aerodynamic heating. The leading end of a vessel takes stagnation-point heating q = k * sqrt(rho / Rn) * v^3 (Sutton-Graves),
 * the sides a small fraction of it; parts in the lee are shielded. Only a thin skin layer heats quickly, and the skin radiates
 * away what it can, so a blunt capsule settles at an equilibrium temperature set by its heat flux. Ablative heat shields turn
 * most of the load into burnt-off material. A part hotter than its limit is destroyed. Pure maths.
 */
import type { V3 } from './math3';
import type { FlightPart, Vessel } from './vessel';

const STEFAN_BOLTZMANN = 5.670374e-8;
const SUTTON_GRAVES = 1.7415e-4;
const SKIN_FRACTION = 0.03; // share of a part's mass in the layer that heats quickly
const SPECIFIC_HEAT = 900; // J/kg/K
const EMISSIVITY = 0.85;
const ABLATION_HEAT = 3e6; // J/kg carried off by burning shield material
const SHIELD_PASS_THROUGH = 0.12; // share of the heat a working shield lets into the part
const SIDE_FACTOR = 0.07; // sides of a vessel in hypersonic flow get a small fraction of the nose's heating
/** Below this speed (m/s) the air is not hot enough to matter. */
const MIN_SPEED = 400;
const AIR_CP = 1005; // J/kg/K

export interface HeatResult {
  /** Parts that went past their temperature limit this step. */
  overheated: string[];
}

/** Frontal area and nose radius of a part (m^2, m). */
function faceOf(p: FlightPart): { area: number; nose: number } {
  const r = p.def.radius;
  return { area: Math.PI * r * r, nose: Math.max(0.25, r * (p.def.category === 'heatshield' ? 1.3 : 0.9)) };
}

function skinArea(p: FlightPart): number {
  const r = p.def.radius;
  return Math.PI * r * r + 2 * Math.PI * r * p.def.height;
}

/**
 * Advance every part's skin temperature by `dt`. `airflow` is the unit vector (body frame) of the vessel's motion through the
 * air; `density` and `speed` are the air density and relative speed. Updates `v.tele.heat` and `v.tele.heatFlux`.
 */
export function heatVessel(v: Vessel, airflow: V3, density: number, speed: number, ambient: number, dt: number): HeatResult {
  const overheated: string[] = [];
  let hottest = 0;
  let peak = 0;
  const heating = density > 1e-9 && speed > MIN_SPEED;
  const totalEnthalpy = 0.5 * speed * speed + AIR_CP * ambient; // J/kg carried by the flow
  for (const p of v.parts) {
    const mass = Math.max(p.dry + p.fuel, 1);
    const skin = Math.max(SKIN_FRACTION * mass, 5) * SPECIFIC_HEAT;
    let power = 0;
    if (heating) {
      const cosTop = airflow[1]; // +Y end leads when the vessel moves along +Y
      const lead = v.exposedTop.has(p.id) && cosTop > 0 ? cosTop : v.exposedBottom.has(p.id) && cosTop < 0 ? -cosTop : 0;
      const face = faceOf(p);
      // a wall already near the flow's recovery temperature takes little more: the heat flux falls as (1 - h_wall / h_total)
      const wall = Math.max(0, 1 - (AIR_CP * p.temperature) / totalEnthalpy);
      let flux = 0;
      let area = 0;
      if (lead > 0.05) {
        flux = wall * SUTTON_GRAVES * Math.sqrt(density / face.nose) * speed ** 3 * lead * lead;
        area = face.area;
      }
      // side heating on every part, from the cross-flow component
      const sideFlux = wall * SIDE_FACTOR * SUTTON_GRAVES * Math.sqrt(density / 1.0) * speed ** 3 * Math.sqrt(Math.max(0, 1 - cosTop * cosTop));
      const sideArea = 2 * p.def.radius * p.def.height;
      let q = flux * area + sideFlux * sideArea;
      if (p.def.category === 'heatshield' && p.ablator > 0) {
        const absorbed = q * (1 - SHIELD_PASS_THROUGH);
        const burnt = Math.min(p.ablator, absorbed * dt / ABLATION_HEAT);
        p.ablator -= burnt;
        p.dry -= burnt;
        q *= SHIELD_PASS_THROUGH;
      }
      power = q;
      if (area > 0) peak = Math.max(peak, flux);
    }
    const radiating = EMISSIVITY * STEFAN_BOLTZMANN * skinArea(p) * (p.temperature ** 4 - ambient ** 4);
    p.temperature = Math.max(3, p.temperature + ((power - radiating) / skin) * dt);
    const limit = p.def.maxTemp;
    hottest = Math.max(hottest, Math.max(0, (p.temperature - 300) / (limit - 300)));
    if (p.temperature > limit * 1.02) overheated.push(p.id);
  }
  v.tele.heat = hottest;
  v.tele.heatFlux = peak;
  return { overheated };
}
