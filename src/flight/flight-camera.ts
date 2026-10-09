/**
 * Flight cameras. All three keep the horizon level except the nose camera, which rides with the vessel:
 *   orbit: circles the vessel (drag to turn, wheel to zoom), measured against the local horizon;
 *   chase: follows behind the direction of travel and looks at the vessel;
 *   pad:   a camera standing on the ground near the pad, watching the vessel go (switches to orbit when it is far away);
 *   nose:  looks along the vessel's nose from the command pod.
 * Positions are doubles in the heliocentric inertial frame; the render camera itself stays at the origin.
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { horizon, surfaceVelocity, type FlightEnv } from './env';
import type { PadFrame } from './pad';
import { qrot, vadd, vlen, vnorm, vscale, vsub, type V3 } from './math3';
import type { Vessel } from './vessel';

export type CameraMode = 'orbit' | 'chase' | 'pad' | 'nose';
export const CAMERA_MODES: CameraMode[] = ['orbit', 'chase', 'pad', 'nose'];

/** Beyond this distance (m) from the pad the pad camera hands over to the orbit camera. */
const PAD_CAMERA_RANGE = 3500;

export class FlightCamera {
  mode: CameraMode = 'pad';
  yaw = 3.7;
  pitch = 0.22;
  distance = 40;
  /** Height of the rocket on the pad (m): the pad camera stands back in proportion to it. */
  rocketHeight = 20;
  private readonly m = new Matrix4();
  private readonly eye = new Vector3();
  private readonly target = new Vector3();
  private readonly up = new Vector3();

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!;
    return this.mode;
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.005));
  }

  zoom(wheel: number): void {
    this.distance = Math.max(4, Math.min(2e5, this.distance * Math.exp(wheel * 0.0012)));
  }

  /**
   * Compute the camera for this frame. `planetPos` is the planet's centre in the world frame; the result is the camera position
   * (world, doubles) and orientation.
   */
  place(v: Vessel, env: FlightEnv, planetPos: Vector3, pad: PadFrame | null, outPos: Vector3, outQuat: Quaternion): void {
    const { up, east, north } = horizon(env, v.pos);
    const at = (p: V3): Vector3 => new Vector3(p[0] + planetPos.x, p[1] + planetPos.y, p[2] + planetPos.z);
    const center = at(v.pos);
    this.up.set(up[0], up[1], up[2]);

    if (this.mode === 'pad' && pad) {
      const rel = vsub(v.pos, qrot(env.planetQuat, pad.center));
      if (Math.hypot(rel[0], rel[1], rel[2]) > PAD_CAMERA_RANGE) this.mode = 'orbit';
    }
    if (this.mode === 'pad' && pad) {
      const h = this.rocketHeight;
      const local = vadd(vadd(vscale(pad.east, Math.max(14, h * 0.6)), vscale(pad.up, 5)), vscale(pad.south, Math.max(34, h * 1.2 + 12)));
      this.eye.copy(at(qrot(env.planetQuat, vadd(pad.center, local))));
      this.target.copy(center);
    } else if (this.mode === 'chase') {
      const motion = vsub(v.vel, surfaceVelocity(env, v.pos));
      const dir = vlen(motion) > 5 ? vnorm(motion) : qrot(v.q, [0, 1, 0]);
      const d = this.distance;
      const eye = vadd(vscale(dir, -d), vscale(up, d * 0.22));
      this.eye.copy(center).add(new Vector3(eye[0], eye[1], eye[2]));
      this.target.copy(center);
    } else if (this.mode === 'nose') {
      const root = v.parts.find((p) => p.def.category === 'command') ?? v.parts[0];
      const local = root ? vsub(root.pos, v.mass.com) : ([0, 0, 0] as V3);
      const head = qrot(v.q, vadd(local, [0, (root?.def.height ?? 1) / 2 + 0.2, 0]));
      this.eye.copy(at(vadd(v.pos, head)));
      const fwd = qrot(v.q, [0, 1, 0]);
      this.target.copy(this.eye).add(new Vector3(fwd[0], fwd[1], fwd[2]));
      const upBody = qrot(v.q, [0, 0, -1]);
      this.up.set(upBody[0], upBody[1], upBody[2]);
    } else {
      const cp = Math.cos(this.pitch);
      const d = this.distance;
      const dir = vadd(vadd(vscale(north, Math.cos(this.yaw) * cp), vscale(east, Math.sin(this.yaw) * cp)), vscale(up, Math.sin(this.pitch)));
      this.eye.copy(center).add(new Vector3(dir[0] * d, dir[1] * d, dir[2] * d));
      this.target.copy(center);
    }
    outPos.copy(this.eye);
    this.m.lookAt(this.eye, this.target, this.up);
    outQuat.setFromRotationMatrix(this.m);
  }
}

/** Drag to turn and wheel to zoom the flight camera on `canvas`. Returns the function that removes the listeners. */
export function bindCameraInput(canvas: HTMLElement, cam: FlightCamera, opts: { enabled(): boolean; sensitivity(): { mouse: number; invertY: boolean } }): () => void {
  const move = (ev: PointerEvent) => {
    if (!ev.buttons || !opts.enabled()) return;
    const c = opts.sensitivity();
    cam.rotate(ev.movementX * c.mouse, ev.movementY * c.mouse * (c.invertY ? -1 : 1));
  };
  const wheel = (ev: WheelEvent) => {
    if (opts.enabled()) cam.zoom(ev.deltaY);
    ev.preventDefault();
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('wheel', wheel);
  };
}
