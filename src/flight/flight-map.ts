/**
 * The map in flight: the solar-system map (MapView) with the vessel's predicted path drawn on it, markers for apsides, node
 * burns, encounters, escapes and impacts, the maneuver node editor, warp-to-event shortcuts and a target body whose closest
 * approach is marked. Everything it shows comes from the Navigator's patched-conic prediction.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicNodeMaterial, Vector3, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { bodyDef } from '../data/solar-system';
import { orbitPoints, TWO_PI, meanMotion, type Vec3 } from '../physics/kepler';
import type { SolarSystem } from '../render/solar-system';
import { button } from '../ui/kit/controls';
import { h } from '../ui/kit/dom';
import { formatLength, type Units } from '../core/units';
import type { FlightWorld } from './flight-world';
import { fmtCountdown } from './format-time';
import { MapView, VESSEL_FOCUS } from './map-view';
import type { MarkerPoint, Navigator, WarpEvent } from './navigator';
import { NodePanel } from './node-panel';
import { patchState, type Patch, type Trajectory } from './trajectory';

const PATCH_COLOURS = ['#4fd0ff', '#ffa04f', '#7dff8a', '#e08aff', '#ffe066', '#ff7a7a', '#9aa6ff', '#ffffff'];
const MAX_POINTS = 420;
const PICK_RADIUS = 16; // px

interface PatchLine {
  line: Line;
  geometry: BufferGeometry;
  /** Points relative to the patch's body, and the time at each. */
  rel: Float64Array;
  times: Float64Array;
  count: number;
}

interface MarkerEl {
  data: MarkerPoint;
  el: HTMLElement;
  text: HTMLElement;
}

export interface FlightMapOptions {
  system: SolarSystem;
  scene: Scene;
  camera: PerspectiveCamera;
  ui: HTMLElement;
  surface: HTMLElement;
  nav: Navigator;
  world: () => FlightWorld;
  warpTo(ut: number): void;
  /** The vessel's position in the world (heliocentric) frame. */
  vesselPosition(): Vector3 | null;
  message(text: string): void;
  units(): Units;
}

const scratch = new Vector3();

/** Sample a patch: the whole ellipse if the orbit closes without events, otherwise the stretch from `from` to the end. */
function samplePatch(p: Patch, from: number): { rel: Float64Array; times: Float64Array; count: number } {
  const rel = new Float64Array(MAX_POINTS * 3);
  const times = new Float64Array(MAX_POINTS);
  const start = Math.max(p.startUt, from);
  const full = p.bound && p.endUt - p.startUt >= p.period * 0.999;
  let count = 0;
  const push = (r: Vec3, t: number) => {
    rel[count * 3] = r[0];
    rel[count * 3 + 1] = r[1];
    rel[count * 3 + 2] = r[2];
    times[count++] = t;
  };
  if (full) {
    const n = meanMotion(p.elements.a, p.mu);
    const e = p.elements.e;
    const m0 = p.elements.M0 + n * (start - p.startUt);
    const pts = orbitPoints(p.elements, 240);
    for (let k = 0; k < pts.length && count < MAX_POINTS; k++) {
      const E = (k / 240) * TWO_PI;
      const M = E - e * Math.sin(E);
      let dm = (M - m0) % TWO_PI;
      if (dm < 0) dm += TWO_PI;
      push(pts[k]!, start + dm / n);
    }
    return { rel, times, count };
  }
  // partial: step by true-anomaly increments so the curve is smooth at periapsis and cheap far away
  const end = p.endUt;
  let t = start;
  const dTheta = TWO_PI / 220;
  while (t < end && count < MAX_POINTS - 1) {
    const s = patchState(p, t);
    push(s.r, t);
    const r2 = s.r[0] ** 2 + s.r[1] ** 2 + s.r[2] ** 2;
    const hx = s.r[1] * s.v[2] - s.r[2] * s.v[1];
    const hy = s.r[2] * s.v[0] - s.r[0] * s.v[2];
    const hz = s.r[0] * s.v[1] - s.r[1] * s.v[0];
    const hm = Math.hypot(hx, hy, hz);
    t += Math.max(1, (dTheta * r2) / Math.max(hm, 1));
  }
  push(p.r1, end);
  return { rel, times, count };
}

export class FlightMap {
  readonly view: MapView;
  readonly panel: NodePanel;
  private readonly group = new Group();
  private readonly lines: PatchLine[] = [];
  private readonly markers: MarkerEl[] = [];
  private readonly markerLayer = h('div', { class: 'map-markers' });
  private readonly vesselEl = h('div', { class: 'map-marker map-marker--vessel' }, h('span', { class: 'map-glyph' }), h('span', { class: 'map-marker-text', text: 'Vessel' }));
  private readonly tools = h('div', { class: 'map-tools pe' });
  private readonly status = h('div', { class: 'map-status mono' });
  private readonly warpButtons = new Map<WarpEvent, HTMLButtonElement>();
  private readonly targetButton: HTMLButtonElement;
  private built: Trajectory | null = null;
  private anchors: Vec3[] = [];
  private markerTimer = 0;
  private panelTimer = 0;
  private downAt: { x: number; y: number; t: number } | null = null;
  private readonly disposers: Array<() => void> = [];
  private camPos = new Vector3();
  private camera!: PerspectiveCamera;
  private viewport = { width: 1, height: 1 };

  constructor(private readonly o: FlightMapOptions) {
    this.group.visible = false;
    o.scene.add(this.group);
    this.view = new MapView({
      system: o.system,
      scene: o.scene,
      camera: o.camera,
      ui: o.ui,
      surface: o.surface,
      onGoto: () => undefined,
      vessel: () => o.vesselPosition(),
      hint: 'drag  rotate · wheel  zoom · Tab  focus · click the orbit  new node · M  back to the cockpit',
    });
    this.panel = new NodePanel({
      nav: o.nav,
      world: o.world,
      warpTo: (ut) => o.warpTo(ut),
      onChange: () => this.rebuild(true),
      units: o.units,
    });

    const warp = (kind: WarpEvent, label: string, tip: string) => {
      const b = button({ label, variant: 'quiet', tip, onClick: () => this.warpTo(kind) });
      this.warpButtons.set(kind, b);
      return b;
    };
    this.targetButton = button({ label: 'Target', variant: 'quiet', tip: 'Mark the closest approach to the focused body', onClick: () => this.toggleTarget() });
    this.tools.append(
      h('div', { class: 'map-tools-row' }, button({ label: '+ Node', variant: 'default', tip: 'Add a maneuver node (or click the orbit)', onClick: () => this.newNode() }), this.targetButton, button({ label: 'Clear nodes', variant: 'quiet', onClick: () => this.clearNodes() })),
      h('div', { class: 'map-tools-row' }, h('span', { class: 'hud-label', text: 'Warp to' }), warp('node', 'Node', 'Warp to the next maneuver node'), warp('apoapsis', 'Ap', 'Warp to apoapsis'), warp('periapsis', 'Pe', 'Warp to periapsis'), warp('soi', 'SOI', 'Warp to the next change of sphere of influence')),
      this.status,
    );
    this.markerLayer.append(this.vesselEl);
    o.ui.append(this.markerLayer, this.tools, this.panel.root);
    this.setVisible(false);
    for (const b of this.tools.querySelectorAll('button')) {
      b.tabIndex = -1;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
    }

    const on = (target: EventTarget, type: string, fn: (ev: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(o.surface, 'pointerdown', ((ev: PointerEvent) => {
      if (this.active && ev.button === 0) this.downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    }) as never);
    on(window, 'pointerup', ((ev: PointerEvent) => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || !this.active || ev.target !== o.surface) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 5 && performance.now() - d.t < 450) this.click(ev);
    }) as never);
  }

  get active(): boolean {
    return this.view.active;
  }

  private setVisible(on: boolean): void {
    this.group.visible = on;
    this.markerLayer.style.display = on ? '' : 'none';
    this.tools.style.display = on ? '' : 'none';
    if (!on) this.panel.root.style.display = 'none';
    else this.panel.select(this.panel.selectedId);
  }

  enter(cameraWorld: Vector3, bodyId: string): void {
    this.view.enter(cameraWorld, bodyId);
    const v = this.o.world().active;
    if (v) this.view.zoomTo(Math.max(this.o.world().env.radius * 3, Math.hypot(...v.pos) * 3));
    this.setVisible(true);
    this.rebuild(true);
  }

  exit(): void {
    this.view.exit();
    this.setVisible(false);
  }

  // ------------------------------------------------------------------ actions

  private newNode(): void {
    const { nav } = this.o;
    const t = nav.apsisTime('apoapsis') ?? nav.apsisTime('periapsis') ?? this.o.world().ut + 300;
    this.addNodeAt(t);
  }

  private addNodeAt(t: number): void {
    const world = this.o.world();
    const node = this.o.nav.addNode(Math.max(t, world.ut + 10));
    this.rebuild(true);
    this.panel.select(node.id);
  }

  private clearNodes(): void {
    this.o.nav.clearNodes();
    this.panel.select(null);
    this.rebuild(true);
  }

  private warpTo(kind: WarpEvent): void {
    const t = this.o.nav.nextEvent(kind);
    if (t === null) {
      this.o.message('Nothing to warp to.');
      return;
    }
    this.o.warpTo(t);
  }

  private toggleTarget(): void {
    const id = this.view.focusId;
    const world = this.o.world();
    if (this.o.nav.target) {
      this.o.nav.setTarget(null);
      this.o.message('Target cleared.');
    } else if (id !== VESSEL_FOCUS && id !== world.bodyId) {
      this.o.nav.setTarget(id);
      this.o.message(`Target: ${bodyDef(id).name}`);
    } else this.o.message('Focus a body with Tab or by clicking its label, then press Target.');
    this.rebuild(true);
  }

  /** A click on the map: add a node where the cursor is on the predicted path. */
  private click(ev: PointerEvent): void {
    const rect = this.o.surface.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best: { t: number; d: number } | null = null;
    this.lines.forEach((pl, i) => {
      const anchor = this.anchors[i];
      if (!anchor) return;
      for (let k = 0; k < pl.count; k++) {
        const p = this.project(anchor[0] + pl.rel[k * 3]!, anchor[1] + pl.rel[k * 3 + 1]!, anchor[2] + pl.rel[k * 3 + 2]!);
        if (!p) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < PICK_RADIUS && (!best || d < best.d)) best = { t: pl.times[k]!, d };
      }
    });
    if (best) this.addNodeAt((best as { t: number }).t);
    else this.panel.select(null);
  }

  // ------------------------------------------------------------------ drawing

  private project(wx: number, wy: number, wz: number): { x: number; y: number; dist: number } | null {
    scratch.set(wx - this.camPos.x, wy - this.camPos.y, wz - this.camPos.z);
    const dist = scratch.length();
    scratch.applyMatrix4(this.camera.matrixWorldInverse);
    if (scratch.z >= 0) return null;
    scratch.applyMatrix4(this.camera.projectionMatrix);
    return { x: (scratch.x * 0.5 + 0.5) * this.viewport.width, y: (-scratch.y * 0.5 + 0.5) * this.viewport.height, dist };
  }

  /** Rebuild the line geometry and markers from the current prediction. */
  private rebuild(force: boolean): void {
    const traj = this.o.nav.refresh(performance.now() / 1000, 0.25, force);
    if (!traj || (traj === this.built && !force)) return;
    this.built = traj;
    const ut = this.o.world().ut;
    traj.patches.forEach((p, i) => {
      let pl = this.lines[i];
      if (!pl) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
        const material = new LineBasicNodeMaterial({ color: new Color(PATCH_COLOURS[i % PATCH_COLOURS.length]!), transparent: true, opacity: 0.95, depthWrite: false });
        const line = new Line(geometry, material);
        line.frustumCulled = false;
        line.renderOrder = 5;
        this.group.add(line);
        pl = { line, geometry, rel: new Float64Array(0), times: new Float64Array(0), count: 0 };
        this.lines[i] = pl;
      }
      const s = samplePatch(p, ut);
      pl.rel = s.rel;
      pl.times = s.times;
      pl.count = s.count;
      pl.geometry.setDrawRange(0, s.count);
      pl.line.visible = true;
    });
    for (let i = traj.patches.length; i < this.lines.length; i++) this.lines[i]!.line.visible = false;
    this.rebuildMarkers();
  }

  private rebuildMarkers(): void {
    for (const m of this.markers) m.el.remove();
    this.markers.length = 0;
    for (const data of this.o.nav.markers()) {
      const text = h('span', { class: 'map-marker-text' });
      const el = h('div', { class: `map-marker map-marker--${data.kind}${data.kind === 'node' ? ' pe' : ''}` }, h('span', { class: 'map-glyph' }), text);
      if (data.kind === 'node') el.addEventListener('click', () => this.panel.select(data.nodeId ?? null));
      this.markerLayer.append(el);
      this.markers.push({ data, el, text });
    }
    this.markerTimer = 0;
  }

  private markerText(m: MarkerPoint, patch: Patch | undefined, ut: number): string {
    const when = m.ut > ut ? ` · ${fmtCountdown(m.ut - ut)}` : '';
    const alt = patch ? ` ${this.fmt(Math.hypot(...m.r) - patch.radius)}` : '';
    if (m.kind === 'apoapsis' || m.kind === 'periapsis') return `${m.label}${alt}${when}`;
    if (m.kind === 'node') {
      const node = this.o.nav.nodes.find((n) => n.id === m.nodeId);
      return node ? `Δv ${Math.hypot(node.prograde, node.normal, node.radial).toFixed(0)} m/s${when}` : m.label;
    }
    return `${m.label}${when}`;
  }

  /** Per-frame update: camera, lines, markers. Returns the camera's world position. */
  update(dt: number, camera: PerspectiveCamera, viewport: { width: number; height: number }): Vector3 {
    const world = this.o.world();
    this.camera = camera;
    this.viewport = viewport;
    this.camPos = this.view.update(dt, world.ut, camera, viewport);
    this.rebuild(false);
    this.anchors = this.o.nav.patchAnchors();

    this.lines.forEach((pl, i) => {
      const anchor = this.anchors[i];
      if (!pl.line.visible || !anchor) return;
      const pos = pl.geometry.getAttribute('position') as BufferAttribute;
      const a = pos.array as Float32Array;
      const ox = anchor[0] - this.camPos.x;
      const oy = anchor[1] - this.camPos.y;
      const oz = anchor[2] - this.camPos.z;
      for (let k = 0; k < pl.count; k++) {
        a[k * 3] = pl.rel[k * 3]! + ox;
        a[k * 3 + 1] = pl.rel[k * 3 + 1]! + oy;
        a[k * 3 + 2] = pl.rel[k * 3 + 2]! + oz;
      }
      pos.needsUpdate = true;
    });

    this.markerTimer -= dt;
    const refreshText = this.markerTimer <= 0;
    if (refreshText) this.markerTimer = 0.4;
    const traj = this.built;
    for (const m of this.markers) {
      const anchor = this.anchors[m.data.patch];
      const p = anchor ? this.project(anchor[0] + m.data.r[0], anchor[1] + m.data.r[1], anchor[2] + m.data.r[2]) : null;
      const visible = !!p && p.x > -30 && p.x < viewport.width + 30 && p.y > -20 && p.y < viewport.height + 20;
      m.el.style.display = visible ? '' : 'none';
      if (!visible || !p) continue;
      m.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      if (refreshText) m.text.textContent = this.markerText(m.data, traj?.patches[m.data.patch], world.ut);
      if (m.data.kind === 'node') m.el.classList.toggle('is-selected', m.data.nodeId === this.panel.selectedId);
    }
    const vp = this.o.vesselPosition();
    const vs = vp ? this.project(vp.x, vp.y, vp.z) : null;
    this.vesselEl.style.display = vs ? '' : 'none';
    if (vs) this.vesselEl.style.transform = `translate(${vs.x.toFixed(1)}px, ${vs.y.toFixed(1)}px)`;

    this.panelTimer -= dt;
    if (this.panelTimer <= 0) {
      this.panelTimer = 0.25;
      this.panel.update();
      this.updateTools();
    }
    return this.camPos;
  }

  private fmt(m: number): string {
    return formatLength(m, this.o.units());
  }

  private updateTools(): void {
    const nav = this.o.nav;
    for (const [kind, b] of this.warpButtons) b.disabled = nav.nextEvent(kind) === null;
    const ca = nav.closestApproachToTarget();
    this.targetButton.classList.toggle('is-on', nav.target !== null);
    this.targetButton.textContent = nav.target ? `Target: ${bodyDef(nav.target).name}` : 'Target';
    const world = this.o.world();
    const lines = [`In ${bodyDef(world.bodyId).name}'s sphere of influence`];
    if (ca) lines.push(`Closest approach to ${bodyDef(nav.target!).name}: ${this.fmt(ca.distance)} in ${fmtCountdown(ca.ut - world.ut)}`);
    const traj = nav.trajectory;
    const enc = traj?.patches.find((p, i) => i > 0 && p.startUt > world.ut && bodyDef(p.body).parent === traj.patches[i - 1]!.body);
    if (enc) {
      const peri = enc.elements.a * (1 - enc.elements.e) - enc.radius;
      lines.push(`${bodyDef(enc.body).name} encounter in ${fmtCountdown(enc.startUt - world.ut)}: periapsis ${this.fmt(peri)}`);
    }
    this.status.replaceChildren(...lines.map((t) => h('div', { text: t })));
  }

  dispose(): void {
    this.disposers.forEach((fn) => fn());
    for (const pl of this.lines) {
      pl.geometry.dispose();
      (pl.line.material as LineBasicNodeMaterial).dispose();
    }
    this.o.scene.remove(this.group);
    this.markerLayer.remove();
    this.tools.remove();
    this.panel.root.remove();
    this.view.dispose();
  }
}

/** Where the vessel is (heliocentric world frame), from the world's current body and the vessel's body-relative position. */
export function vesselWorldPosition(world: FlightWorld, out: Vector3): Vector3 | null {
  const v = world.active;
  if (!v || !world.host) return null;
  const b = world.host.ephemeris.get(world.bodyId).pos;
  return out.set(b[0] + v.pos[0], b[1] + v.pos[1], b[2] + v.pos[2]);
}

