/**
 * The flight HUD: navball with SAS mode buttons and a throttle bar in the middle, the staging stack and system toggles on the
 * left, flight and orbit readouts on the right, and a feed of messages. Built from DOM elements and updated about ten times
 * a second (the navball is drawn by the scene every frame).
 */
import { fmtDuration } from '../builder/format';
import { button } from '../ui/kit/controls';
import { h } from '../ui/kit/dom';
import { formatLength, formatSpeed, type Units } from '../core/units';
import { Navball } from './navball';
import type { OrbitInfo } from './orbit-info';
import type { FlightVectors } from './sas';
import type { SasMode, Vessel } from './vessel';
import { attitude } from './navball-math';

export interface HudActions {
  stage(): void;
  toggleSas(): void;
  setSasMode(mode: SasMode): void;
  toggleRcs(): void;
  toggleGear(): void;
  toggleBrakes(): void;
  chutes(): void;
  setThrottle(v: number): void;
  cycleCamera(): void;
  warp(delta: number): void;
  pause(): void;
  mute(): void;
  toggleMap(): void;
  toggleGuide(): void;
  help(): void;
}

export interface HudState {
  vessel: Vessel;
  fv: FlightVectors;
  orbit: OrbitInfo;
  /** Altitude above sea level and above the terrain (m). */
  altitude: number;
  agl: number;
  verticalSpeed: number;
  warpText: string;
  bodyName: string;
  /** The maneuver being flown, if any. */
  node: { text: string; remaining: string | null } | null;
  cameraMode: string;
  muted: boolean;
  totalFuel: number;
  initialFuel: number;
  date: string;
  units: Units;
}

const SAS_MODES: Array<{ mode: SasMode; label: string; tip: string }> = [
  { mode: 'stability', label: 'Hold', tip: 'Hold the current attitude' },
  { mode: 'prograde', label: 'Pro', tip: 'Point along the velocity' },
  { mode: 'retrograde', label: 'Ret', tip: 'Point against the velocity' },
  { mode: 'normal', label: 'Nrm', tip: 'Point along the orbit normal' },
  { mode: 'antinormal', label: 'Anti', tip: 'Point against the orbit normal' },
  { mode: 'radialOut', label: 'R+', tip: 'Point away from the planet (radial out)' },
  { mode: 'radialIn', label: 'R-', tip: 'Point towards the planet (radial in)' },
  { mode: 'maneuver', label: 'Mnv', tip: 'Point along the maneuver burn' },
];

const row = (label: string, tip: string): { el: HTMLElement; value: HTMLElement } => {
  const value = h('span', { class: 'hud-value mono' });
  return { el: h('div', { class: 'hud-row', tip }, h('span', { class: 'hud-label', text: label }), value), value };
};

const HUD_DETAIL_KEY = 'orbital.hud.detail';

/** Readouts: id, label, what it means (tooltip), and whether it is in the short list shown by default. */
const ROWS: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ['body', 'Near', 'The body whose gravity you are in. Altitude and the orbit are measured from it.', false],
  ['alt', 'Altitude', 'Height above sea level.', true],
  ['agl', 'Above ground', 'Height above the ground right under you. The one to watch when landing.', false],
  ['vs', 'Vertical speed', 'How fast you are going up (+) or coming down (-).', true],
  ['ap', 'Apoapsis', 'The highest point of your path. Burn prograde (the way you are going) to raise it.', true],
  ['pe', 'Periapsis', 'The lowest point of your path. Above the atmosphere (80 km on Earth) means a stable orbit. "Underground" means the path still dips below the ground: normal on the way up, it only clears at the end of the burn.', true],
  ['tap', 'To apoapsis', 'Time until you reach the highest point: the place to burn to raise the periapsis.', true],
  ['tpe', 'To periapsis', 'Time until you reach the lowest point of your path.', false],
  ['inc', 'Inclination', 'Tilt of your orbit against the equator.', false],
  ['att', 'Attitude', 'Where the nose points: degrees above the horizon / compass heading (90 is east).', true],
  ['q', 'Dynamic pressure', 'How hard the air pushes on the rocket, and your Mach number. Steer gently while it is high.', false],
  ['heat', 'Hull heat', 'How close the hottest part is to burning up, during re-entry.', false],
  ['g', 'Acceleration', 'The g-force you feel.', false],
  ['twr', 'Thrust', 'Total push of the running engines.', false],
  ['fuel', 'Propellant', 'Liquid fuel left in the whole rocket.', true],
  ['ec', 'Charge', 'Electric charge: SAS needs it.', false],
  ['met', 'Mission time', 'Time since lift-off.', false],
  ['date', 'Date (UTC)', 'The date in the simulation. Time warp moves it on.', false],
];

export class FlightHud {
  readonly root = h('div', { class: 'flight-hud' });
  readonly navball = new Navball(184);
  private readonly values = new Map<string, HTMLElement>();
  private readonly throttleFill = h('div', { class: 'throttle-fill' });
  private readonly throttleReadout = h('div', { class: 'throttle-readout mono' });
  private readonly stageList = h('div', { class: 'hud-stages' });
  private readonly toggles = new Map<string, HTMLButtonElement>();
  private readonly sasButtons = new Map<SasMode, HTMLButtonElement>();
  private readonly messages = h('div', { class: 'hud-messages', 'aria-live': 'polite' });
  private readonly banner = h('div', { class: 'hud-banner' });
  private readonly speedLabel = h('span', { class: 'hud-label' });
  private readonly speed = h('div', { class: 'hud-speed mono' });
  private readonly cameraLabel = h('span', { class: 'hud-chip mono' });
  private readonly warpLabel = h('span', { class: 'hud-chip mono' });
  private readonly nodeBanner = h('div', { class: 'hud-node mono' });
  private readonly cheatBadge = h('span', { class: 'hud-chip hud-cheat mono', text: 'CHEATS', tip: 'Cheats are switched on (Cheats menu)' });
  private readonly stageButton: HTMLButtonElement;
  private readonly guideButton: HTMLButtonElement;
  private lastStageSig = '';

  constructor(actions: HudActions) {
    this.guideButton = button({ label: 'Guide', variant: 'quiet', tip: 'Show or hide the flight guide: what to do next', onClick: () => actions.toggleGuide() }) as HTMLButtonElement;
    this.guideButton.classList.add('hud-toggle');
    const toggle = (id: string, label: string, tip: string, on: () => void): HTMLButtonElement => {
      const b = button({ label, variant: 'quiet', tip, onClick: on }) as HTMLButtonElement;
      b.classList.add('hud-toggle');
      this.toggles.set(id, b);
      return b;
    };
    this.stageButton = button({ label: 'STAGE', variant: 'primary', tip: 'Activate the next stage (Space)', onClick: () => actions.stage() }) as HTMLButtonElement;
    this.stageButton.classList.add('hud-stage-button');

    const sasRow = h('div', { class: 'hud-sas' });
    for (const m of SAS_MODES) {
      const b = button({ label: m.label, variant: 'quiet', tip: m.tip, onClick: () => actions.setSasMode(m.mode) }) as HTMLButtonElement;
      b.classList.add('hud-sas-button');
      this.sasButtons.set(m.mode, b);
      sasRow.append(b);
    }

    const throttle = h('div', { class: 'throttle', role: 'slider', 'aria-label': 'Throttle', tabindex: '-1' }, this.throttleFill);
    const setFromPointer = (ev: PointerEvent) => {
      const r = throttle.getBoundingClientRect();
      actions.setThrottle(1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    throttle.addEventListener('pointerdown', (ev) => {
      throttle.setPointerCapture(ev.pointerId);
      setFromPointer(ev);
    });
    throttle.addEventListener('pointermove', (ev) => ev.buttons && setFromPointer(ev));

    const center = h(
      'div',
      { class: 'hud-center pe' },
      this.speed,
      h('div', { class: 'hud-ballrow' }, h('div', { class: 'hud-throttle-col' }, throttle, this.throttleReadout), this.navball.canvas),
      sasRow,
    );

    const left = h(
      'div',
      { class: 'hud-left pe' },
      h('h3', { class: 'section-title', text: 'Staging' }),
      this.stageList,
      this.stageButton,
      h(
        'div',
        { class: 'hud-toggles' },
        toggle('sas', 'SAS', 'Stability assist (T)', () => actions.toggleSas()),
        toggle('rcs', 'RCS', 'Reaction control thrusters (R)', () => actions.toggleRcs()),
        toggle('gear', 'Legs', 'Landing legs (G)', () => actions.toggleGear()),
        toggle('brakes', 'Brakes', 'Brakes (B)', () => actions.toggleBrakes()),
        toggle('chutes', 'Chutes', 'Arm all parachutes (P)', () => actions.chutes()),
      ),
    );

    const right = h('div', { class: 'hud-right pe' }, h('div', { class: 'hud-row-head' }, this.speedLabel));
    for (const [id, label, tip, core] of ROWS) {
      const r = row(label, tip);
      if (!core) r.el.classList.add('hud-row--extra');
      this.values.set(id, r.value);
      right.append(r.el);
    }
    // The short list is what a flight to orbit needs; the rest is one click away and the choice is remembered.
    const more = button({ label: '', variant: 'quiet', tip: 'Show every readout, or only the essentials', onClick: () => setDetail(!right.classList.contains('is-full')) }) as HTMLButtonElement;
    more.classList.add('hud-more');
    const setDetail = (full: boolean): void => {
      right.classList.toggle('is-full', full);
      more.textContent = full ? 'Less ▴' : 'More ▾';
      try {
        localStorage.setItem(HUD_DETAIL_KEY, full ? '1' : '0');
      } catch {
        /* not remembered */
      }
    };
    let full = false;
    try {
      full = localStorage.getItem(HUD_DETAIL_KEY) === '1';
    } catch {
      /* storage blocked: the short list */
    }
    setDetail(full);
    right.append(more);

    const top = h(
      'div',
      { class: 'hud-top pe' },
      button({ label: '← Menu', variant: 'quiet', tip: 'Pause menu (Esc)', onClick: () => actions.pause() }),
      this.guideButton,
      button({ label: 'How to play', variant: 'quiet', tip: 'What everything on this screen means, and how to reach orbit', onClick: () => actions.help() }),
      h('span', { class: 'hud-spacer' }),
      this.cheatBadge,
      h('button', { class: 'hud-chip-button', type: 'button', tip: 'Change camera (C)', onclick: () => actions.cycleCamera() }, this.cameraLabel),
      button({ label: '◀', variant: 'quiet', tip: 'Slower time warp (,)', onClick: () => actions.warp(-1) }),
      this.warpLabel,
      button({ label: '▶', variant: 'quiet', tip: 'Faster time warp (.)', onClick: () => actions.warp(1) }),
      button({ label: 'Map', variant: 'quiet', tip: 'Orbit map and maneuver nodes (M)', onClick: () => actions.toggleMap() }),
      button({ label: '♪', variant: 'quiet', tip: 'Mute or unmute engine sound (V)', onClick: () => actions.mute() }),
    );

    this.root.append(top, this.banner, this.nodeBanner, this.messages, left, center, right);
    // HUD buttons must never keep keyboard focus: Space and Enter belong to flying (staging), not to whichever button was clicked last.
    for (const b of this.root.querySelectorAll('button')) {
      b.tabIndex = -1;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
    }
  }

  /** Show a message for a few seconds. */
  message(text: string, level: 'info' | 'warn' | 'bad' = 'info'): void {
    const el = h('div', { class: `hud-message hud-message--${level}`, text });
    this.messages.append(el);
    while (this.messages.childElementCount > 5) this.messages.firstElementChild?.remove();
    setTimeout(() => el.classList.add('is-leaving'), 5200);
    setTimeout(() => el.remove(), 5800);
  }

  setGuideOn(on: boolean): void {
    this.guideButton.classList.toggle('is-on', on);
  }

  setCheatBadge(on: boolean): void {
    this.cheatBadge.style.display = on ? '' : 'none';
  }

  setBanner(text: string | null): void {
    this.banner.textContent = text ?? '';
    this.banner.classList.toggle('is-on', text !== null);
  }

  update(s: HudState): void {
    const v = s.vessel;
    this.cameraLabel.textContent = `${s.cameraMode} cam`;
    this.warpLabel.textContent = s.warpText;
    this.nodeBanner.textContent = s.node ? (s.node.remaining ? `${s.node.text} · remaining ${s.node.remaining}` : s.node.text) : '';
    this.nodeBanner.classList.toggle('is-on', s.node !== null);
    this.speedLabel.textContent = s.fv.speedMode === 'surface' ? 'Surface' : 'Orbit';
    const ref = s.fv.speedMode === 'surface' ? s.fv.velSurface : s.fv.velOrbit;
    this.speed.textContent = `${s.fv.speedMode === 'surface' ? 'SRF' : 'ORB'}  ${formatSpeed(Math.hypot(ref[0], ref[1], ref[2]), s.units)}`;
    const set = (id: string, text: string) => {
      const el = this.values.get(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const o = s.orbit;
    set('body', s.bodyName);
    set('alt', formatLength(s.altitude, s.units));
    set('agl', formatLength(s.agl, s.units));
    set('vs', `${s.verticalSpeed >= 0 ? '+' : ''}${formatSpeed(s.verticalSpeed, s.units)}`);
    set('ap', o.bound ? formatLength(o.apoapsis, s.units) : 'escape');
    // A path that dips below the ground is just "underground": "-5,360 km" says nothing a player can use.
    set('pe', o.periapsis < 0 ? 'underground' : formatLength(o.periapsis, s.units));
    set('tap', o.bound ? fmtDuration(o.timeToApoapsis) : '—');
    set('tpe', o.bound ? fmtDuration(o.timeToPeriapsis) : '—');
    set('inc', `${((o.inclination * 180) / Math.PI).toFixed(1)}°`);
    const a = attitude(v.q, s.fv);
    set('att', `${((a.pitch * 180) / Math.PI).toFixed(0)}° / ${((a.heading * 180) / Math.PI).toFixed(0)}°`);
    set('q', `${(v.tele.q / 1000).toFixed(1)} kPa  M${v.tele.mach.toFixed(2)}`);
    set('heat', v.tele.heat > 0.02 ? `${Math.round(v.tele.heat * 100)}%` : 'cool');
    this.values.get('heat')?.classList.toggle('is-warn', v.tele.heat > 0.7);
    set('g', `${v.tele.gForce.toFixed(2)} g`);
    set('twr', v.tele.thrust > 0 ? `${(v.tele.thrust / 1000).toFixed(0)} kN` : '—');
    set('fuel', s.initialFuel > 0 ? `${Math.round((100 * s.totalFuel) / s.initialFuel)}%` : '—');
    set('ec', v.chargeMax > 0 ? `${Math.round(v.charge)} / ${Math.round(v.chargeMax)}` : '—');
    set('met', fmtDuration(v.met));
    set('date', s.date);

    this.throttleFill.style.height = `${v.throttle * 100}%`;
    this.throttleReadout.textContent = `${Math.round(v.throttle * 100)}%`;
    const on = (id: string, state: boolean) => this.toggles.get(id)?.classList.toggle('is-on', state);
    on('sas', v.sas.enabled);
    on('rcs', v.rcs);
    on('gear', v.legsOut);
    on('brakes', v.brakes);
    for (const [mode, b] of this.sasButtons) b.classList.toggle('is-on', v.sas.enabled && v.sas.mode === mode);
    this.drawStages(v);
  }

  private drawStages(v: Vessel): void {
    const groups = new Map<number, string[]>();
    for (const p of v.parts) if (p.stage >= v.nextStage && (p.def.engine || p.def.decoupler || p.def.category === 'parachute')) groups.set(p.stage, [...(groups.get(p.stage) ?? []), p.def.name]);
    const stages = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    const sig = stages.map(([n, parts]) => `${n}:${parts.join(',')}`).join('|') + `@${v.nextStage}`;
    this.stageButton.disabled = stages.length === 0;
    if (sig === this.lastStageSig) return;
    this.lastStageSig = sig;
    this.stageList.replaceChildren(
      ...(stages.length === 0
        ? [h('div', { class: 'hud-stage hud-stage--empty', text: 'No stages left' })]
        : stages.map(([n, parts], i) => h('div', { class: `hud-stage${i === 0 ? ' is-next' : ''}` }, h('span', { class: 'hud-stage-n mono', text: String(n) }), h('span', { text: summarise(parts) })))),
    );
  }
}

/** "Falcon-850, Decoupler 1.25 m, Decoupler 1.25 m" -> "Falcon-850, 2x Decoupler 1.25 m". */
function summarise(parts: string[]): string {
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(', ');
}
