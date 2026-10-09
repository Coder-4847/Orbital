import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three/webgpu';

const EYE_HEIGHT = 1.8;
const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();
const _m = new Matrix4();

export interface CameraEnvironment {
  /** Height above the nearest surface (metres); drives speed. */
  altitude: number;
  /** Unit vector pointing away from the nearest body's centre at the camera. */
  up: Vector3;
  /** Distance to the nearest body's centre minus its radius; collision only applies when this is small. */
  nearSurface: boolean;
}

/**
 * Free-fly debug camera that works from deep space to the ground: speed scales with altitude (so crossing the
 * 6000 km from orbit to surface takes seconds, and walking pace is available at the ground), and near a planet
 * the horizon is levelled like an FPS camera. Position is double precision; the renderer works camera-relative.
 */
export class FreeCamera {
  readonly position = new Vector3(0, 0, 3e7);
  readonly orientation = new Quaternion();
  /** Multiplier set with the mouse wheel (power of 1.3). */
  speedExponent = 0;
  groundCollision = true;
  sensitivity = 1;
  invertY = false;
  /** When false (map view) input is ignored and discarded. */
  enabled = true;

  private readonly velocity = new Vector3();
  private readonly keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private dragging = false;
  private disposers: Array<() => void> = [];
  /** Current speed in m/s, for the overlay. */
  speed = 0;

  constructor(private readonly element: HTMLElement) {
    const on = (target: Window | HTMLElement | Document, type: string, fn: (ev: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(window, 'keydown', ((ev: KeyboardEvent) => {
      if (!this.enabled) return;
      if ((ev.target as HTMLElement | null)?.closest?.('input,textarea,select,[role="dialog"]')) return;
      this.keys.add(ev.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(ev.code)) ev.preventDefault();
    }) as never);
    on(window, 'keyup', ((ev: KeyboardEvent) => this.keys.delete(ev.code)) as never);
    on(window, 'blur', (() => this.keys.clear()) as never);
    on(element, 'mousedown', ((ev: MouseEvent) => {
      if (!this.enabled) return;
      if (ev.button !== 0 && ev.button !== 2) return;
      this.dragging = true;
      void element.requestPointerLock?.();
    }) as never);
    on(window, 'mouseup', (() => (this.dragging = false)) as never);
    on(window, 'mousemove', ((ev: MouseEvent) => {
      if (!this.enabled) return;
      if (!this.dragging && document.pointerLockElement !== element) return;
      this.lookDX += ev.movementX;
      this.lookDY += ev.movementY;
    }) as never);
    on(element, 'contextmenu', ((ev: Event) => ev.preventDefault()) as never);
    on(element, 'wheel', ((ev: WheelEvent) => {
      if (!this.enabled) return;
      this.speedExponent = MathUtils.clamp(this.speedExponent - Math.sign(ev.deltaY), -12, 16);
      ev.preventDefault();
    }) as never);
    on(document, 'pointerlockchange', (() => {
      if (document.pointerLockElement !== element) this.dragging = false;
    }) as never);
  }

  /** Teleport and aim. `lookAt` is a point to face (world metres). */
  placeLooking(position: Vector3, lookAt: Vector3, up = new Vector3(0, 1, 0)): void {
    this.position.copy(position);
    _fwd.subVectors(lookAt, position).normalize();
    _right.crossVectors(_fwd, up).normalize();
    _up.crossVectors(_right, _fwd);
    // Camera basis: +X right, +Y up, looking down -Z.
    this.orientation.setFromRotationMatrix(_m.makeBasis(_right, _up, _v.copy(_fwd).negate()));
    this.velocity.set(0, 0, 0);
  }

  update(dt: number, env: CameraEnvironment): void {
    if (!this.enabled) {
      this.lookDX = this.lookDY = 0;
      this.keys.clear();
      this.velocity.set(0, 0, 0);
      return;
    }
    // --- look ---
    const level = MathUtils.smoothstep(env.altitude, 3e6, 1.5e5); // 0 in deep space, 1 near a planet
    const sens = 0.0022 * this.sensitivity;
    const yaw = -this.lookDX * sens;
    const pitch = -this.lookDY * sens * (this.invertY ? -1 : 1);
    this.lookDX = 0;
    this.lookDY = 0;
    const roll = ((this.keys.has('KeyE') ? -1 : 0) + (this.keys.has('KeyQ') ? 1 : 0)) * 1.2 * dt * (1 - level);

    _up.set(0, 1, 0).applyQuaternion(this.orientation);
    _v.copy(_up).lerp(env.up, level).normalize(); // yaw axis: camera up in space, planet up near ground
    this.orientation.premultiply(_q.setFromAxisAngle(_v, yaw));
    _right.set(1, 0, 0).applyQuaternion(this.orientation);
    this.orientation.premultiply(_q.setFromAxisAngle(_right, pitch));
    if (roll !== 0) {
      _fwd.set(0, 0, -1).applyQuaternion(this.orientation);
      this.orientation.premultiply(_q.setFromAxisAngle(_fwd, roll));
    }
    if (level > 0.01) this.levelHorizon(env.up, level, dt);
    this.orientation.normalize();

    // --- move ---
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const forward = k('KeyW') - k('KeyS');
    const strafe = k('KeyD') - k('KeyA');
    const lift = k('KeyR') + k('Space') - k('KeyF') - k('KeyC');
    const base = MathUtils.clamp(env.altitude * 0.9, 2, 4e8) * Math.pow(1.3, this.speedExponent);
    const mult = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 6 : 1) * (this.keys.has('ControlLeft') ? 0.15 : 1);
    const target = _v.set(strafe, 0, -forward).applyQuaternion(this.orientation);
    target.addScaledVector(env.up, lift).multiplyScalar(base * mult);
    // Critically damped-ish smoothing, independent of frame rate.
    const a = 1 - Math.exp(-dt / 0.1);
    this.velocity.lerp(target, a);
    this.position.addScaledVector(this.velocity, dt);
    this.speed = this.velocity.length();

    if (this.groundCollision && env.nearSurface && env.altitude < EYE_HEIGHT) {
      this.position.addScaledVector(env.up, EYE_HEIGHT - env.altitude);
      const down = this.velocity.dot(env.up);
      if (down < 0) this.velocity.addScaledVector(env.up, -down);
    }
  }

  /** Roll about the view axis so the camera's up vector tends to the planet's up vector. */
  private levelHorizon(planetUp: Vector3, level: number, dt: number): void {
    _fwd.set(0, 0, -1).applyQuaternion(this.orientation);
    _right.crossVectors(_fwd, planetUp);
    if (_right.lengthSq() < 1e-8) return; // looking straight up/down: no horizon
    _right.normalize();
    _up.crossVectors(_right, _fwd).normalize(); // desired up
    const currentUp = _v.set(0, 1, 0).applyQuaternion(this.orientation);
    let angle = Math.acos(MathUtils.clamp(currentUp.dot(_up), -1, 1));
    if (new Vector3().crossVectors(currentUp, _up).dot(_fwd) < 0) angle = -angle;
    const step = angle * (1 - Math.exp(-dt * 6 * level));
    this.orientation.premultiply(_q.setFromAxisAngle(_fwd, step));
  }

  dispose(): void {
    this.disposers.forEach((fn) => fn());
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }
}
