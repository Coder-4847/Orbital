/**
 * The maneuver node editor: time of the burn and its prograde / normal / radial parts, with the total delta-v, how long the
 * burn takes and the delta-v the current stage has. Plain DOM; every change goes through the Navigator.
 */
import { formatSpeed, type Units } from '../core/units';
import { button } from '../ui/kit/controls';
import { h } from '../ui/kit/dom';
import { fmtCountdown } from './format-time';
import { burnEstimate, nodeMagnitude } from './maneuver';
import type { Navigator } from './navigator';
import type { FlightWorld } from './flight-world';

export interface NodePanelOptions {
  nav: Navigator;
  world: () => FlightWorld;
  warpTo(ut: number): void;
  /** The node list or a node changed: the prediction needs recomputing. */
  onChange(): void;
  units(): Units;
}

const AXES = [
  { key: 'prograde', label: 'Prograde', tip: 'Speed up (+) or slow down (-)' },
  { key: 'normal', label: 'Normal', tip: 'Tilt the orbit plane (+ along the orbit normal)' },
  { key: 'radial', label: 'Radial', tip: 'Push away from (+) or towards (-) the body' },
] as const;
const STEPS = [-100, -10, -1, 1, 10, 100];

export class NodePanel {
  readonly root = h('div', { class: 'node-panel pe' });
  private selected: number | null = null;
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly time = h('span', { class: 'mono node-time' });
  private readonly summary = h('div', { class: 'node-summary mono' });

  constructor(private readonly o: NodePanelOptions) {
    this.root.style.display = 'none';
    const timeRow = h(
      'div',
      { class: 'node-row' },
      h('span', { class: 'hud-label', text: 'Burn at' }),
      this.time,
      h(
        'span',
        { class: 'node-steps' },
        this.timeButton('−10m', -600),
        this.timeButton('−1m', -60),
        this.timeButton('+1m', 60),
        this.timeButton('+10m', 600),
      ),
    );
    const axisRows = AXES.map((a) => {
      const input = h('input', { class: 'node-input mono', type: 'number', step: '1', value: '0', 'aria-label': `${a.label} delta-v (m/s)`, tip: a.tip }) as HTMLInputElement;
      input.addEventListener('change', () => this.set(a.key, Number(input.value) || 0));
      input.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.nudge(a.key, ev.deltaY < 0 ? 1 : -1);
      });
      this.inputs.set(a.key, input);
      return h(
        'div',
        { class: 'node-row' },
        h('span', { class: 'hud-label', text: a.label }),
        input,
        h('span', { class: 'node-steps' }, ...STEPS.map((s) => button({ label: s > 0 ? `+${s}` : `${s}`, variant: 'quiet', tip: `${s > 0 ? '+' : ''}${s} m/s`, onClick: () => this.nudge(a.key, s) }))),
      );
    });
    const apsisRow = h(
      'div',
      { class: 'node-row node-actions' },
      button({ label: 'To apoapsis', variant: 'quiet', onClick: () => this.moveTo('apoapsis') }),
      button({ label: 'To periapsis', variant: 'quiet', onClick: () => this.moveTo('periapsis') }),
      button({ label: 'Warp to node', variant: 'default', onClick: () => this.warp() }),
      button({ label: 'Delete', variant: 'quiet', onClick: () => this.remove() }),
    );
    this.root.append(h('h3', { class: 'section-title', text: 'Maneuver node' }), timeRow, ...axisRows, this.summary, apsisRow);
    for (const b of this.root.querySelectorAll('button')) {
      b.tabIndex = -1;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
    }
  }

  private timeButton(label: string, delta: number): HTMLButtonElement {
    return button({ label, variant: 'quiet', tip: `Move the burn ${delta > 0 ? 'later' : 'earlier'}`, onClick: () => this.shift(delta) });
  }

  get selectedId(): number | null {
    return this.selected;
  }

  select(id: number | null): void {
    this.selected = id;
    this.root.style.display = id === null ? 'none' : '';
    this.update();
  }

  private node() {
    return this.o.nav.nodes.find((n) => n.id === this.selected) ?? null;
  }

  private set(axis: 'prograde' | 'normal' | 'radial', value: number): void {
    const n = this.node();
    if (!n) return;
    this.o.nav.updateNode(n.id, { [axis]: value });
    this.o.onChange();
    this.update();
  }

  private nudge(axis: 'prograde' | 'normal' | 'radial', delta: number): void {
    const n = this.node();
    if (n) this.set(axis, Math.round((n[axis] + delta) * 100) / 100);
  }

  private shift(seconds: number): void {
    const n = this.node();
    if (!n) return;
    this.o.nav.updateNode(n.id, { ut: Math.max(this.o.world().ut + 5, n.ut + seconds) });
    this.o.onChange();
    this.update();
  }

  private moveTo(kind: 'apoapsis' | 'periapsis'): void {
    const n = this.node();
    const t = this.o.nav.apsisTime(kind);
    if (!n || t === null) return;
    this.o.nav.updateNode(n.id, { ut: t });
    this.o.onChange();
    this.update();
  }

  private warp(): void {
    const n = this.node();
    if (!n) return;
    const v = this.o.world().active;
    const burn = v ? burnEstimate(v).burnTime(nodeMagnitude(n)) : 0;
    this.o.warpTo(n.ut - (Number.isFinite(burn) ? burn / 2 : 0) - 10);
  }

  private remove(): void {
    const n = this.node();
    if (!n) return;
    this.o.nav.removeNode(n.id);
    this.select(null);
    this.o.onChange();
  }

  /** Refresh the readouts (the countdown and the burn estimate change as time passes). */
  update(): void {
    const n = this.node();
    if (!n) {
      if (this.selected !== null) this.select(null);
      return;
    }
    const world = this.o.world();
    this.time.textContent = `T${n.ut >= world.ut ? '−' : '+'}${fmtCountdown(Math.abs(n.ut - world.ut))}`;
    for (const a of AXES) {
      const input = this.inputs.get(a.key)!;
      if (document.activeElement !== input) input.value = String(Math.round(n[a.key] * 10) / 10);
    }
    const v = world.active;
    const dv = nodeMagnitude(n);
    const est = v ? burnEstimate(v) : null;
    const burn = est ? est.burnTime(dv) : Infinity;
    this.summary.textContent = `Δv ${formatSpeed(dv, this.o.units())} · burn ${Number.isFinite(burn) ? fmtCountdown(burn) : est && est.thrust > 0 ? 'more than one stage' : 'no engine'} · stage Δv ${est ? formatSpeed(est.stageDeltaV, this.o.units()) : '—'}`;
  }
}
