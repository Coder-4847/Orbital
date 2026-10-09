/**
 * Flight key bindings. Every action has one default key (a KeyboardEvent.code); the player can rebind any of them in Settings.
 * Binding a key that another action already uses swaps the two, so no key ever does two things. Shift, Ctrl and Alt match
 * on either side of the keyboard. Pure logic (no DOM).
 */
export type ActionId =
  | 'pitchUp' | 'pitchDown' | 'yawLeft' | 'yawRight' | 'rollLeft' | 'rollRight'
  | 'throttleUp' | 'throttleDown' | 'throttleFull' | 'throttleCut'
  | 'stage' | 'sas' | 'sasMode' | 'sasModeBack' | 'rcs' | 'gear' | 'brakes' | 'chutes'
  | 'translateLeft' | 'translateRight' | 'translateUp' | 'translateDown' | 'translateForward' | 'translateBack'
  | 'camera' | 'map' | 'warpDown' | 'warpUp' | 'warpReset' | 'hud' | 'mute' | 'pause'
  | 'quicksave' | 'quickload' | 'cheats' | 'debug';

export interface ActionInfo {
  id: ActionId;
  label: string;
  group: 'Steering' | 'Throttle and staging' | 'Systems' | 'RCS translation' | 'Views and time' | 'Game';
}

export const ACTIONS: readonly ActionInfo[] = [
  { id: 'pitchUp', label: 'Pitch up', group: 'Steering' },
  { id: 'pitchDown', label: 'Pitch down', group: 'Steering' },
  { id: 'yawLeft', label: 'Yaw left', group: 'Steering' },
  { id: 'yawRight', label: 'Yaw right', group: 'Steering' },
  { id: 'rollLeft', label: 'Roll left', group: 'Steering' },
  { id: 'rollRight', label: 'Roll right', group: 'Steering' },
  { id: 'throttleUp', label: 'Throttle up', group: 'Throttle and staging' },
  { id: 'throttleDown', label: 'Throttle down', group: 'Throttle and staging' },
  { id: 'throttleFull', label: 'Full throttle', group: 'Throttle and staging' },
  { id: 'throttleCut', label: 'Cut throttle', group: 'Throttle and staging' },
  { id: 'stage', label: 'Stage', group: 'Throttle and staging' },
  { id: 'sas', label: 'SAS on / off', group: 'Systems' },
  { id: 'sasMode', label: 'Next SAS mode', group: 'Systems' },
  { id: 'sasModeBack', label: 'Previous SAS mode', group: 'Systems' },
  { id: 'rcs', label: 'RCS on / off', group: 'Systems' },
  { id: 'gear', label: 'Landing legs', group: 'Systems' },
  { id: 'brakes', label: 'Brakes', group: 'Systems' },
  { id: 'chutes', label: 'Arm parachutes', group: 'Systems' },
  { id: 'translateLeft', label: 'Translate left', group: 'RCS translation' },
  { id: 'translateRight', label: 'Translate right', group: 'RCS translation' },
  { id: 'translateUp', label: 'Translate up', group: 'RCS translation' },
  { id: 'translateDown', label: 'Translate down', group: 'RCS translation' },
  { id: 'translateForward', label: 'Translate forward', group: 'RCS translation' },
  { id: 'translateBack', label: 'Translate back', group: 'RCS translation' },
  { id: 'camera', label: 'Change camera', group: 'Views and time' },
  { id: 'map', label: 'Map', group: 'Views and time' },
  { id: 'warpDown', label: 'Slower time warp', group: 'Views and time' },
  { id: 'warpUp', label: 'Faster time warp', group: 'Views and time' },
  { id: 'warpReset', label: 'Real time', group: 'Views and time' },
  { id: 'hud', label: 'Hide / show HUD', group: 'Views and time' },
  { id: 'mute', label: 'Mute sound', group: 'Game' },
  { id: 'pause', label: 'Pause menu', group: 'Game' },
  { id: 'quicksave', label: 'Quick save', group: 'Game' },
  { id: 'quickload', label: 'Quick load', group: 'Game' },
  { id: 'cheats', label: 'Cheats menu', group: 'Game' },
  { id: 'debug', label: 'Debug overlay', group: 'Game' },
];

export type Bindings = Record<ActionId, string>;

export const DEFAULT_BINDINGS: Bindings = {
  pitchUp: 'KeyW', pitchDown: 'KeyS', yawLeft: 'KeyA', yawRight: 'KeyD', rollLeft: 'KeyQ', rollRight: 'KeyE',
  throttleUp: 'ShiftLeft', throttleDown: 'ControlLeft', throttleFull: 'KeyZ', throttleCut: 'KeyX',
  stage: 'Space', sas: 'KeyT', sasMode: 'KeyY', sasModeBack: 'KeyU', rcs: 'KeyR', gear: 'KeyG', brakes: 'KeyB', chutes: 'KeyP',
  translateLeft: 'KeyJ', translateRight: 'KeyL', translateUp: 'KeyI', translateDown: 'KeyK', translateForward: 'KeyN', translateBack: 'KeyH',
  camera: 'KeyC', map: 'KeyM', warpDown: 'Comma', warpUp: 'Period', warpReset: 'Slash', hud: 'F2', mute: 'KeyV', pause: 'Escape',
  quicksave: 'F5', quickload: 'F9', cheats: 'F10', debug: 'F3',
};

/** Left and right Shift / Ctrl / Alt are one key for binding purposes. */
export const normalizeCode = (code: string): string => code.replace(/^(Shift|Control|Alt)(Left|Right)$/, '$1Left');

/** Keys that cannot be bound (they would lock the player out of the browser or the page). */
const FORBIDDEN = new Set(['F1', 'F4', 'F11', 'F12', 'Tab', 'MetaLeft', 'MetaRight', 'ContextMenu']);
export const isBindable = (code: string): boolean => code !== '' && !FORBIDDEN.has(code);

/** A readable name for a key code: "KeyW" -> "W", "ShiftLeft" -> "Shift", "Comma" -> ",". */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const names: Record<string, string> = {
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
    Space: 'Space', Escape: 'Esc', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Enter: 'Enter', Backspace: 'Backspace',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  return names[code] ?? code;
}

/** Rebind `action` to `code`. If another action had that key, it takes the key `action` had (a swap). Returns the new bindings. */
export function rebind(bindings: Bindings, action: ActionId, code: string): Bindings {
  const next = { ...bindings };
  const wanted = normalizeCode(code);
  const old = next[action];
  for (const info of ACTIONS) {
    if (info.id !== action && normalizeCode(next[info.id]) === wanted) next[info.id] = old;
  }
  next[action] = wanted;
  return next;
}

/** code -> action lookup for the current bindings. */
export function lookup(bindings: Bindings): Map<string, ActionId> {
  const map = new Map<string, ActionId>();
  for (const info of ACTIONS) map.set(normalizeCode(bindings[info.id]), info.id);
  return map;
}

/** Actions that share a key (should be empty: `rebind` keeps bindings unique, but a hand-edited settings file might not). */
export function conflicts(bindings: Bindings): ActionId[][] {
  const by = new Map<string, ActionId[]>();
  for (const info of ACTIONS) {
    const code = normalizeCode(bindings[info.id]);
    by.set(code, [...(by.get(code) ?? []), info.id]);
  }
  return [...by.values()].filter((list) => list.length > 1);
}

/** Replace any broken or duplicated bindings with defaults so every action stays reachable. */
export function sanitize(bindings: Partial<Bindings> | undefined): Bindings {
  const out = { ...DEFAULT_BINDINGS };
  for (const info of ACTIONS) {
    const code = bindings?.[info.id];
    if (typeof code === 'string' && isBindable(code)) out[info.id] = normalizeCode(code);
  }
  if (conflicts(out).length > 0) return { ...DEFAULT_BINDINGS };
  return out;
}
