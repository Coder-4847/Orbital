/**
 * Player input for flight: keyboard and (optionally) a gamepad become steering requests, a throttle target and discrete
 * commands. Steering is read every frame; commands (stage, SAS, gear...) are delivered once per press. Keys come from the
 * player's bindings (Settings > Controls); the defaults are listed in core/keymap.ts.
 */
import { lookup, normalizeCode, type ActionId, type Bindings } from '../core/keymap';
import type { Controls } from './vessel';

export type Command =
  | 'stage' | 'sas' | 'sasMode' | 'sasModeBack' | 'rcs' | 'gear' | 'brakes' | 'chutes' | 'camera' | 'warpDown' | 'warpUp'
  | 'warpReset' | 'pause' | 'hud' | 'mute' | 'map' | 'quicksave' | 'quickload' | 'cheats' | 'debug' | 'revert';

/** Actions delivered once per key press. */
const PRESSED: Partial<Record<ActionId, Command>> = {
  stage: 'stage', sas: 'sas', sasMode: 'sasMode', sasModeBack: 'sasModeBack', rcs: 'rcs', gear: 'gear', brakes: 'brakes', chutes: 'chutes',
  camera: 'camera', map: 'map', warpDown: 'warpDown', warpUp: 'warpUp', warpReset: 'warpReset', hud: 'hud', mute: 'mute', pause: 'pause',
  quicksave: 'quicksave', quickload: 'quickload', cheats: 'cheats', debug: 'debug',
};

const THROTTLE_RATE = 0.6; // per second held

export interface InputFrame {
  controls: Controls;
  /** Change to apply to the throttle this frame (-1..1 scaled by dt already), or an absolute target. */
  throttleDelta: number;
  throttleSet: number | null;
}

export interface InputOptions {
  bindings(): Bindings;
  gamepad(): { enabled: boolean; deadzone: number };
}

export class FlightInput {
  private readonly keys = new Set<string>();
  private readonly pressed: Command[] = [];
  private readonly buttonsDown = new Set<number>();
  private throttleSet: number | null = null;
  private table = new Map<string, ActionId>();
  private tableFor: Bindings | null = null;

  /** The lookup is rebuilt only when the bindings object changes (it is replaced whenever the player rebinds). */
  private actionFor(code: string): ActionId | undefined {
    const b = this.o.bindings();
    if (b !== this.tableFor) {
      this.table = lookup(b);
      this.tableFor = b;
    }
    return this.table.get(normalizeCode(code));
  }

  private readonly onDown = (ev: KeyboardEvent): void => {
    if ((ev.target as HTMLElement | null)?.closest?.('input,textarea,select,[role="dialog"]')) return;
    const action = this.actionFor(ev.code);
    if (!action) return;
    if (!ev.repeat) {
      const cmd = PRESSED[action];
      if (cmd) this.pressed.push(cmd);
      if (action === 'throttleFull') this.throttleSet = 1;
      if (action === 'throttleCut') this.throttleSet = 0;
    }
    ev.preventDefault(); // bound keys never scroll the page or trigger browser shortcuts (F5 reload, Space scroll)
    this.keys.add(normalizeCode(ev.code));
  };
  private readonly onUp = (ev: KeyboardEvent): void => void this.keys.delete(normalizeCode(ev.code));
  private readonly onBlur = (): void => this.keys.clear();

  constructor(private readonly o: InputOptions) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Commands pressed since the last call. */
  drainCommands(): Command[] {
    return this.pressed.splice(0);
  }

  private held(action: ActionId): number {
    return this.keys.has(normalizeCode(this.o.bindings()[action])) ? 1 : 0;
  }

  /** Steering and throttle requests for this frame. */
  read(dt: number): InputFrame {
    const k = (action: ActionId) => this.held(action);
    const controls: Controls = {
      pitch: k('pitchUp') - k('pitchDown'),
      yaw: k('yawRight') - k('yawLeft'),
      roll: k('rollRight') - k('rollLeft'),
      tx: k('translateRight') - k('translateLeft'),
      ty: k('translateUp') - k('translateDown'),
      tz: k('translateForward') - k('translateBack'),
    };
    let throttleDelta = (k('throttleUp') - k('throttleDown')) * THROTTLE_RATE * dt;
    let throttleSet = this.throttleSet;
    this.throttleSet = null;

    const pad = this.gamepad();
    if (pad) {
      const dz = this.o.gamepad().deadzone;
      const dead = (x: number) => (Math.abs(x) < dz ? 0 : x);
      controls.yaw += dead(pad.axes[0] ?? 0);
      controls.pitch -= dead(pad.axes[1] ?? 0);
      controls.roll += dead(pad.axes[2] ?? 0);
      const up = pad.buttons[7]?.value ?? 0;
      const down = pad.buttons[6]?.value ?? 0;
      throttleDelta += (up - down) * THROTTLE_RATE * dt * 1.5;
      this.buttonCommand(pad, 0, 'stage');
      this.buttonCommand(pad, 2, 'sas');
      this.buttonCommand(pad, 3, 'rcs');
      this.buttonCommand(pad, 1, 'gear');
      this.buttonCommand(pad, 4, 'camera');
      this.buttonCommand(pad, 5, 'sasMode');
      this.buttonCommand(pad, 8, 'map');
      this.buttonCommand(pad, 9, 'pause');
      if (pad.buttons[12]?.pressed) throttleSet = 1;
      if (pad.buttons[13]?.pressed) throttleSet = 0;
    }
    for (const key of ['pitch', 'yaw', 'roll', 'tx', 'ty', 'tz'] as const) controls[key] = Math.max(-1, Math.min(1, controls[key]));
    return { controls, throttleDelta, throttleSet };
  }

  /** The first connected gamepad, unless gamepads are switched off in Settings or with ?pad=off (for automated testing). */
  private gamepad(): Gamepad | null {
    if (!this.o.gamepad().enabled) return null;
    if (new URLSearchParams(location.search).get('pad') === 'off') return null;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) if (p?.connected) return p;
    return null;
  }

  /** Name of the connected gamepad, if any (for the Settings page). */
  static gamepadName(): string | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) if (p?.connected) return p.id;
    return null;
  }

  private buttonCommand(pad: Gamepad, index: number, cmd: Command): void {
    const down = pad.buttons[index]?.pressed ?? false;
    if (down && !this.buttonsDown.has(index)) {
      this.buttonsDown.add(index);
      this.pressed.push(cmd);
    } else if (!down) this.buttonsDown.delete(index);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
