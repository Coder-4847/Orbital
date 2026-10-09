/**
 * Re-entry plasma: a glowing shock layer in front of whatever leads a vessel through the air, and a trail of hot gas left
 * behind it. Its strength follows the heat flux the heating model reports for the vessel, so a shielded capsule glows
 * orange and trails fire for as long as it is really being heated, and a clean slow descent shows nothing at all.
 */
import { AdditiveBlending, Sprite, SpriteNodeMaterial, Vector3, type Node, type Scene } from 'three/webgpu';
import { exp, length, mix, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { FlightEffects } from './effects';
import { surfaceVelocity, type FlightEnv } from './env';
import { qrot, qrotInv, vadd, vlen, vscale, vsub, type V3 } from './math3';
import type { Vessel } from './vessel';

const GLOWS = 4;
/** Heat flux (W/m^2) at which the glow is clearly visible, and at which it is white-hot. */
const FLUX_VISIBLE = 4e4;
const FLUX_HOT = 1.2e6;

interface Glow {
  sprite: Sprite;
  material: SpriteNodeMaterial;
  heat: { value: number };
}

export class PlasmaEffect {
  private readonly glows: Glow[] = [];
  private readonly tmp = new Vector3();

  constructor(scene: Scene) {
    for (let i = 0; i < GLOWS; i++) {
      const heat = uniform(0);
      const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
      const r = length(uv().sub(vec2(0.5, 0.5))).mul(2);
      const profile = exp(r.mul(-3.2)).mul(0.9).add(exp(r.mul(-9)).mul(1.4));
      const orange = vec3(1.0, 0.42, 0.1);
      const white = vec3(0.75, 0.82, 1.0);
      material.colorNode = mix(orange, white, (heat as unknown as Node<'float'>).mul(0.7)).mul(profile).mul((heat as unknown as Node<'float'>).mul(7));
      material.opacityNode = (r.oneMinus() as unknown as Node<'float'>).clamp(0, 1);
      const sprite = new Sprite(material);
      sprite.visible = false;
      sprite.frustumCulled = false;
      sprite.renderOrder = 8;
      scene.add(sprite);
      this.glows.push({ sprite, material, heat: heat as unknown as { value: number } });
    }
  }

  /** Place a glow on each hot vessel (the hottest first) and leave a trail of particles behind it. */
  update(vessels: readonly Vessel[], env: FlightEnv, planetPos: Vector3, cameraWorld: Vector3, effects: FlightEffects, dt: number, enabled: boolean): void {
    const hot = enabled ? vessels.filter((v) => v.tele.heatFlux > FLUX_VISIBLE).sort((a, b) => b.tele.heatFlux - a.tele.heatFlux).slice(0, GLOWS) : [];
    this.glows.forEach((g, i) => {
      const v = hot[i];
      g.sprite.visible = !!v;
      if (!v) return;
      const k = Math.min(1, Math.sqrt(v.tele.heatFlux / FLUX_HOT));
      const front = this.frontOf(v);
      const world = vadd(v.pos, qrot(v.q, front.point));
      this.tmp.set(world[0], world[1], world[2]).add(planetPos).sub(cameraWorld);
      g.sprite.position.copy(this.tmp);
      const size = Math.max(3, front.radius * 5) * (0.8 + k);
      g.sprite.scale.set(size, size, 1);
      g.heat.value = Math.min(1, 0.15 + k);

      // trail: particles that stay behind in the air (the body-fixed frame) as the vessel streaks on
      const speed = vlen(vsub(v.vel, surfaceVelocity(env, v.pos)));
      const step = Math.max(front.radius * 2, 1);
      const n = Math.min(10, Math.max(1, Math.round((speed * dt) / step)));
      const dir = qrot(v.q, v.tele.airflow);
      for (let j = 0; j < n; j++) {
        const back = vscale(dir, -(j / n) * speed * dt);
        const p = qrotInv(env.planetQuat, vadd(world, back));
        effects.spawn(true, p, [0, 0, 0], front.radius * 1.6, front.radius * 4.5, 0.9 + Math.random() * 0.6, 0.45 + 0.5 * k, 0.3);
      }
    });
  }

  /** The leading end of the vessel: where the shock sits (body frame, relative to the centre of mass) and how wide it is. */
  private frontOf(v: Vessel): { point: V3; radius: number } {
    const up = v.tele.airflow[1] >= 0;
    let y = up ? -Infinity : Infinity;
    let radius = 0.5;
    for (const p of v.parts) {
      const end = p.pos[1] + (up ? 1 : -1) * p.def.height * 0.5;
      if (up ? end > y : end < y) {
        y = end;
        radius = p.def.radius;
      }
    }
    return { point: [0, y - v.mass.com[1] + (up ? 0.3 : -0.3), 0], radius };
  }

  dispose(): void {
    for (const g of this.glows) {
      g.material.dispose();
      g.sprite.removeFromParent();
    }
  }
}
