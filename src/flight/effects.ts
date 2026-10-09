/**
 * Flight particles: smoke blasted out from under a rocket on the pad, thin exhaust trails, explosion fireballs and the puff of a
 * separation. Particles live in the planet's body-fixed frame so smoke stays where the ground is while the Earth turns, and are
 * placed relative to the camera every frame (floating origin). A fixed pool of sprites, each with its own opacity.
 */
import { AdditiveBlending, Group, Sprite, SpriteNodeMaterial, Vector3, type Node, type Scene } from 'three/webgpu';
import { length, materialOpacity, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { qrot, qrotInv, type Quat, type V3 } from './math3';

interface Particle {
  sprite: Sprite;
  material: SpriteNodeMaterial;
  fire: boolean;
  active: boolean;
  age: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  pos: V3;
  vel: V3;
  drag: number;
}

const POOL = 420;

export class FlightEffects {
  readonly root = new Group();
  private readonly particles: Particle[] = [];
  /** 0..1 daylight on the smoke, so it does not glow at night. */
  private readonly light = uniform(1);
  private cursor = 0;
  /** Share of requested particles that are actually spawned (the particle-density setting, 0..1). */
  density = 1;
  private readonly tmp = new Vector3();

  constructor(scene: Scene) {
    // an opacityNode replaces material.opacity, so the per-particle fade is multiplied back in
    const radial = () => smoothstep(0.5, 0.05, length(uv().sub(vec2(0.5, 0.5)))).mul(materialOpacity) as unknown as Node<'float'>;
    for (let i = 0; i < POOL; i++) {
      const fire = i % 3 === 0;
      const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: fire ? AdditiveBlending : undefined });
      material.colorNode = fire ? vec3(1.0, 0.55, 0.18).mul(8) : vec3(1.3, 1.27, 1.22).mul(this.light);
      material.opacityNode = radial();
      const sprite = new Sprite(material);
      sprite.visible = false;
      sprite.frustumCulled = false;
      sprite.renderOrder = fire ? 7 : 5;
      this.root.add(sprite);
      this.particles.push({ sprite, material, fire, active: false, age: 0, life: 1, size0: 1, size1: 1, alpha: 1, pos: [0, 0, 0], vel: [0, 0, 0], drag: 0 });
    }
    scene.add(this.root);
  }

  /** Forget every particle (after a change of body: they belong to the old body's frame). */
  clear(): void {
    for (const p of this.particles) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  setLight(daylight: number): void {
    (this.light as unknown as { value: number }).value = Math.max(0.03, Math.min(1, daylight));
  }

  private take(fire: boolean): Particle {
    for (let n = 0; n < POOL; n++) {
      const p = this.particles[(this.cursor + n) % POOL]!;
      if (!p.active && p.fire === fire) {
        this.cursor = (this.cursor + n + 1) % POOL;
        return p;
      }
    }
    return this.particles[this.cursor++ % POOL]!; // pool exhausted: recycle the next one
  }

  /** Spawn a particle at body-fixed position `pos` (m from the planet's centre) moving at `vel` (body-fixed m/s). */
  spawn(fire: boolean, pos: V3, vel: V3, size0: number, size1: number, life: number, alpha: number, drag = 0.6): void {
    if (this.density < 1 && Math.random() > this.density) return;
    const p = this.take(fire);
    p.active = true;
    p.age = 0;
    p.life = life;
    p.size0 = size0;
    p.size1 = size1;
    p.alpha = alpha;
    p.pos = [...pos];
    p.vel = [...vel];
    p.drag = drag;
    p.sprite.visible = true;
  }

  /** A burst: `size` is roughly the diameter of the fireball (m). `pos`/`vel` are in the body-fixed frame. */
  explosion(pos: V3, vel: V3, size: number): void {
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const burst = (): V3 => {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      return [r * Math.cos(a), u, r * Math.sin(a)];
    };
    for (let i = 0; i < 14; i++) {
      const d = burst();
      const s = rand(0.3, 1) * size * 3;
      this.spawn(true, pos, [vel[0] + d[0] * s, vel[1] + d[1] * s, vel[2] + d[2] * s], size * rand(0.5, 1), size * rand(1.4, 2.6), rand(0.7, 1.5), 0.9, 1.4);
    }
    for (let i = 0; i < 18; i++) {
      const d = burst();
      const s = rand(0.1, 0.6) * size * 2;
      this.spawn(false, pos, [vel[0] + d[0] * s, vel[1] + d[1] * s + 2, vel[2] + d[2] * s], size * rand(0.6, 1.2), size * rand(2.5, 4.5), rand(3, 6), 0.55, 0.7);
    }
  }

  /** Per-frame: age the particles and place them relative to the camera. `planetQuat` rotates body-fixed to inertial. */
  update(dt: number, planetQuat: Quat, planetPos: Vector3, cameraWorld: Vector3): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vel = [p.vel[0] * k, p.vel[1] * k, p.vel[2] * k];
      p.pos = [p.pos[0] + p.vel[0] * dt, p.pos[1] + p.vel[1] * dt, p.pos[2] + p.vel[2] * dt];
      const t = p.age / p.life;
      const world = qrot(planetQuat, p.pos);
      this.tmp.set(world[0], world[1], world[2]).add(planetPos).sub(cameraWorld);
      p.sprite.position.copy(this.tmp);
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
      p.sprite.scale.set(size, size, 1);
      p.material.opacity = p.alpha * (p.fire ? (1 - t) * (1 - t) : Math.min(1, t * 8) * (1 - t));
    }
  }

  /** Convert an inertial position to the body-fixed frame (for callers spawning particles). */
  static toBodyFixed(q: Quat, p: V3): V3 {
    return qrotInv(q, p);
  }

  dispose(): void {
    for (const p of this.particles) p.material.dispose();
    this.root.removeFromParent();
  }
}
