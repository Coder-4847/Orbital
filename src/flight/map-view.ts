import { BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicNodeMaterial, MathUtils, Vector3, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { AU, BODIES, type BodyDef } from '../data/solar-system';
import { frameToWorld } from '../physics/frames';
import { orbitPoints, orbitalPeriod } from '../physics/kepler';
import type { SolarSystem } from '../render/solar-system';
import { h } from '../ui/kit/dom';
import { formatDistance } from './debug-overlay';

const ORBIT_SEGMENTS = 192;
const REFRESH_SECONDS = 0.5;
const MIN_DISTANCE_RADII = 1.7;
const MAX_DISTANCE = 3e13;

interface OrbitLine {
  def: BodyDef;
  line: Line;
  positions: Float32Array;
  /** Orbit points relative to the parent, world axes, refreshed a few times per second (shape changes very slowly). */
  local: Float64Array;
  semiMajor: number;
  colour: [number, number, number];
}

interface Label {
  def: BodyDef;
  el: HTMLButtonElement;
}

export interface MapViewOptions {
  system: SolarSystem;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Root DOM element for labels and the info card. */
  ui: HTMLElement;
  /** Element that receives drag and wheel input. */
  surface: HTMLElement;
  /** The user asked to fly to a body (Enter / double-click). */
  onGoto(id: string): void;
  /** Flight: the vessel's world position, so the camera can focus on it (focus id 'vessel'). */
  vessel?(): Vector3 | null;
  /** Hint line shown at the bottom, if different from the explorer's. */
  hint?: string;
}

/** The pseudo-body id for focusing on the vessel. */
export const VESSEL_FOCUS = 'vessel';

const scratch = new Vector3();
const view = new Vector3();

/**
 * Map view: the same real-scale solar system, seen from an orbiting camera that can zoom smoothly from a planet's surface
 * to the whole system. Adds orbit lines (relative to each body's parent), labels you can click to switch focus, and an
 * info card. Rendering is unchanged: bodies are real spheres plus point markers when too small to resolve.
 */
export class MapView {
  active = false;
  focusId = 'earth';

  private readonly lines: OrbitLine[] = [];
  private readonly labels: Label[] = [];
  private readonly group = new Group();
  private readonly labelRoot = h('div', { class: 'map-labels' });
  private readonly info = h('div', { class: 'map-info pe' });
  private readonly hint: HTMLElement;
  private readonly disposers: Array<() => void> = [];

  private yaw = 0.6;
  private pitch = 0.45;
  private distance = 5e8;
  private targetDistance = 5e8;
  /** Offset from the focus body that decays to zero: keeps the camera glued to a moving body while switching focus. */
  private readonly blend = new Vector3();
  private readonly position = new Vector3();
  private dragging = false;
  private refreshTimer = 0;
  private lastRefreshUT = Number.NaN;

  constructor(private readonly o: MapViewOptions) {
    this.hint = h('div', { class: 'map-hint mono', text: o.hint ?? 'drag  rotate · wheel  zoom · click a label  focus · Tab  next body · Enter  fly there · M  back' });
    this.group.visible = false;
    this.group.name = 'map-orbits';
    o.scene.add(this.group);

    for (const def of BODIES) {
      if (!def.orbit || !def.parent) continue;
      const geometry = new BufferGeometry();
      const positions = new Float32Array((ORBIT_SEGMENTS + 1) * 3);
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const c = def.color;
      const tint = new Color(0.55 + c[0] * 0.3, 0.62 + c[1] * 0.25, 0.72 + c[2] * 0.2);
      const material = new LineBasicNodeMaterial({ color: tint, transparent: true, opacity: def.kind === 'moon' ? 0.28 : 0.4, depthWrite: false });
      const line = new Line(geometry, material);
      line.frustumCulled = false;
      line.renderOrder = 3;
      this.group.add(line);
      this.lines.push({ def, line, positions, local: new Float64Array((ORBIT_SEGMENTS + 1) * 3), semiMajor: 0, colour: [c[0], c[1], c[2]] });
    }

    for (const def of BODIES) {
      const el = h('button', { class: 'map-label', type: 'button', 'data-kind': def.kind, text: def.name, tabindex: '-1' });
      el.addEventListener('click', () => this.focus(def.id));
      el.addEventListener('dblclick', () => o.onGoto(def.id));
      this.labelRoot.appendChild(el);
      this.labels.push({ def, el });
    }
    o.ui.append(this.labelRoot, this.info, this.hint);
    this.setUiVisible(false);

    const on = (target: EventTarget, type: string, fn: (ev: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(o.surface, 'pointerdown', ((ev: PointerEvent) => {
      if (!this.active || ev.button !== 0) return;
      this.dragging = true;
      o.surface.setPointerCapture?.(ev.pointerId);
    }) as never);
    on(window, 'pointerup', (() => (this.dragging = false)) as never);
    on(o.surface, 'pointermove', ((ev: PointerEvent) => {
      if (!this.active || !this.dragging) return;
      this.yaw -= ev.movementX * 0.005;
      this.pitch = MathUtils.clamp(this.pitch + ev.movementY * 0.005, -1.5, 1.5);
    }) as never);
    on(o.surface, 'wheel', ((ev: WheelEvent) => {
      if (!this.active) return;
      this.targetDistance = MathUtils.clamp(this.targetDistance * Math.exp(ev.deltaY * 0.0012), this.minDistance, MAX_DISTANCE);
      ev.preventDefault();
    }) as never);
    on(window, 'keydown', ((ev: KeyboardEvent) => {
      if (!this.active || (ev.target as HTMLElement | null)?.closest?.('input,textarea,select,[role="dialog"]')) return;
      if (ev.code === 'Tab') {
        ev.preventDefault();
        const ring = this.o.vessel ? [VESSEL_FOCUS, ...BODIES.map((b) => b.id)] : BODIES.map((b) => b.id);
        const i = ring.indexOf(this.focusId);
        this.focus(ring[(i + (ev.shiftKey ? ring.length - 1 : 1)) % ring.length]!);
      } else if (ev.code === 'Enter') o.onGoto(this.focusId);
      else if (ev.code === 'Home') this.focus(this.o.vessel ? VESSEL_FOCUS : 'sun');
    }) as never);
  }

  /** Centre and size of what the camera is focused on: a body, or the vessel. */
  private focusOf(id: string): { position: Vector3; radius: number } {
    if (id === VESSEL_FOCUS) return { position: this.o.vessel?.() ?? this.vesselLast, radius: 8 };
    const p = this.o.system.get(id);
    return { position: p.position, radius: p.radius };
  }
  private readonly vesselLast = new Vector3();

  private get minDistance(): number {
    return this.focusOf(this.focusId).radius * (this.focusId === VESSEL_FOCUS ? 2 : MIN_DISTANCE_RADII);
  }

  private setUiVisible(on: boolean): void {
    this.labelRoot.style.display = on ? '' : 'none';
    this.info.style.display = on ? '' : 'none';
    this.hint.style.display = on ? '' : 'none';
    this.group.visible = on;
  }

  /** Open the map, centred on the nearest body (or the current focus). */
  enter(cameraWorld: Vector3, nearestId: string): void {
    this.active = true;
    this.focusId = nearestId;
    const focus = this.focusOf(nearestId);
    this.distance = this.targetDistance = MathUtils.clamp(Math.max(cameraWorld.distanceTo(focus.position), focus.radius * 3), this.minDistance, MAX_DISTANCE);
    this.blend.set(0, 0, 0);
    this.lastRefreshUT = Number.NaN;
    this.setUiVisible(true);
    this.renderInfo();
  }

  /** Set the camera distance (m) from the focus at once. */
  zoomTo(distance: number): void {
    this.distance = this.targetDistance = MathUtils.clamp(distance, this.minDistance, MAX_DISTANCE);
  }

  exit(): void {
    this.active = false;
    this.dragging = false;
    this.setUiVisible(false);
  }

  /** Switch focus to a body, easing the camera over and choosing a sensible zoom for it. */
  focus(id: string): void {
    if (id === this.focusId) return;
    const from = this.focusOf(this.focusId);
    const to = this.focusOf(id);
    // Keep the camera where it is for a moment: blend = (old centre) - (new centre), decaying to zero.
    this.blend.add(from.position).sub(to.position);
    this.focusId = id;
    const r = to.radius;
    const kind = id === VESSEL_FOCUS ? 'vessel' : this.o.system.get(id).def.kind;
    this.targetDistance = MathUtils.clamp(kind === 'vessel' ? 4000 : kind === 'star' ? r * 4 : kind === 'moon' ? r * 10 : r * 7, this.minDistance, MAX_DISTANCE);
    this.renderInfo();
  }

  /** Compute the camera pose for this frame and refresh lines and labels. Returns the camera's world position. */
  update(dt: number, ut: number, camera: PerspectiveCamera, viewport: { width: number; height: number }): Vector3 {
    const k = 1 - Math.exp(-dt * 5);
    this.blend.multiplyScalar(Math.exp(-dt * 3.5));
    this.distance = Math.exp(Math.log(this.distance) + (Math.log(this.targetDistance) - Math.log(this.distance)) * k);

    const focus = this.focusOf(this.focusId);
    if (this.focusId === VESSEL_FOCUS) this.vesselLast.copy(focus.position);
    const cp = Math.cos(this.pitch);
    this.position
      .set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp)
      .multiplyScalar(this.distance)
      .add(focus.position)
      .add(this.blend);

    // Look at the focus (plus the blend, so the view follows the easing).
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    const target = scratch.copy(focus.position).add(this.blend).sub(this.position);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateMatrix();

    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0 || Math.abs(ut - this.lastRefreshUT) > 86400 * 3) {
      this.refreshTimer = REFRESH_SECONDS;
      this.lastRefreshUT = ut;
      this.refreshOrbits(ut);
    }
    this.updateLines();
    this.updateLabels(camera, viewport);
    return this.position;
  }

  private refreshOrbits(ut: number): void {
    for (const l of this.lines) {
      const info = this.o.system.ephemeris.orbitOf(l.def.id, ut);
      if (!info) continue;
      const pts = orbitPoints(info.elements, ORBIT_SEGMENTS);
      l.semiMajor = info.elements.a;
      for (let i = 0; i < pts.length; i++) {
        const w = frameToWorld(info.frame, pts[i]!);
        l.local[i * 3] = w[0];
        l.local[i * 3 + 1] = w[1];
        l.local[i * 3 + 2] = w[2];
      }
    }
  }

  /** Orbit lines are relative to the parent's *current* position, converted to camera-relative float32 every frame. */
  private updateLines(): void {
    const cam = this.position;
    for (const l of this.lines) {
      const parent = this.o.system.get(l.def.parent!);
      const camToParent = cam.distanceTo(parent.position);
      // Moon orbits clutter the view from far away: show them only when you are near their planet.
      const show = l.def.kind !== 'moon' || camToParent < 70 * l.semiMajor;
      l.line.visible = show && l.semiMajor !== 0;
      if (!l.line.visible) continue;
      const ox = parent.position.x - cam.x;
      const oy = parent.position.y - cam.y;
      const oz = parent.position.z - cam.z;
      for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
        l.positions[i * 3] = l.local[i * 3]! + ox;
        l.positions[i * 3 + 1] = l.local[i * 3 + 1]! + oy;
        l.positions[i * 3 + 2] = l.local[i * 3 + 2]! + oz;
      }
      (l.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    }
  }

  private updateLabels(camera: PerspectiveCamera, viewport: { width: number; height: number }): void {
    const cam = this.position;
    for (const lab of this.labels) {
      const p = this.o.system.get(lab.def.id);
      let visible = true;
      if (lab.def.kind === 'moon') {
        const parent = this.o.system.get(lab.def.parent!);
        visible = cam.distanceTo(parent.position) < 70 * (p.position.distanceTo(parent.position) || 1) || lab.def.id === this.focusId;
      }
      view.copy(p.position).sub(cam);
      const dist = view.length();
      view.applyMatrix4(camera.matrixWorldInverse);
      if (!visible || view.z >= 0 || dist > MAX_DISTANCE * 2) {
        lab.el.style.display = 'none';
        continue;
      }
      view.applyMatrix4(camera.projectionMatrix); // view-space -> clip (the matrix applies the perspective divide)
      const x = (view.x * 0.5 + 0.5) * viewport.width;
      const y = (-view.y * 0.5 + 0.5) * viewport.height;
      if (x < -40 || x > viewport.width + 40 || y < -20 || y > viewport.height + 20) {
        lab.el.style.display = 'none';
        continue;
      }
      lab.el.style.display = '';
      lab.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      lab.el.classList.toggle('is-focus', lab.def.id === this.focusId);
    }
  }

  private renderInfo(): void {
    if (this.focusId === VESSEL_FOCUS) {
      this.info.replaceChildren(h('div', { class: 'map-info-title', text: 'Vessel' }), h('div', { class: 'map-info-kind', text: 'active craft' }));
      return;
    }
    const p = this.o.system.get(this.focusId);
    const def = p.def;
    const orbit = this.o.system.ephemeris.orbitOf(def.id, 0);
    const parent = def.parent ? BODIES.find((b) => b.id === def.parent) : undefined;
    const rows: Array<[string, string]> = [
      ['Radius', formatDistance(def.radius)],
      ['Gravity', `${((def.gm / (def.radius * def.radius))).toFixed(2)} m/s²`],
    ];
    if (parent && orbit) {
      rows.push(['Orbits', parent.name]);
      rows.push(['Semi-major axis', def.parent === 'sun' ? `${(orbit.elements.a / AU).toFixed(3)} AU` : formatDistance(orbit.elements.a)]);
      const period = orbitalPeriod(orbit.elements.a, orbit.mu);
      rows.push(['Period', period > 2 * 86400 * 365 ? `${(period / 86400 / 365.25).toFixed(2)} yr` : `${(period / 86400).toFixed(2)} d`]);
      rows.push(['Sphere of influence', formatDistance(this.o.system.ephemeris.soi.get(def.id)!)]);
    }
    this.info.replaceChildren(
      h('div', { class: 'map-info-title', text: def.name }),
      h('div', { class: 'map-info-kind', text: def.kind }),
      h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'mono', text: v })])),
    );
  }

  dispose(): void {
    this.disposers.forEach((fn) => fn());
    for (const l of this.lines) {
      l.line.geometry.dispose();
      (l.line.material as LineBasicNodeMaterial).dispose();
    }
    this.o.scene.remove(this.group);
    this.labelRoot.remove();
    this.info.remove();
    this.hint.remove();
  }
}
