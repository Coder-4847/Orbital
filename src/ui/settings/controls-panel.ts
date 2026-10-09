/**
 * Settings > Controls: mouse, gamepad and full key rebinding for flight. A key button waits for the next key press; binding a
 * key another action already uses swaps the two, so nothing is ever left unbound.
 */
import { ACTIONS, DEFAULT_BINDINGS, isBindable, keyLabel, rebind, type ActionId } from '../../core/keymap';
import { FlightInput } from '../../flight/flight-input';
import type { Settings, SettingsStore } from '../../save/settings';
import { button, field, sectionTitle, slider, toggle, type Control } from '../kit/controls';
import { h } from '../kit/dom';

export function buildControlsPanel(settings: SettingsStore, bind: <T>(control: Control<T>, read: (s: Settings) => T) => HTMLElement, syncers: Array<(s: Settings) => void>): HTMLElement {
  const root = h('div', null);

  // --- mouse
  root.append(
    sectionTitle('Mouse'),
    field(
      'Sensitivity',
      'Camera rotation speed.',
      bind(slider({ label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, value: 1, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => settings.patch('controls', { mouseSensitivity: v }) }), (s) => s.controls.mouseSensitivity),
    ),
    field('Invert Y axis', null, bind(toggle({ label: 'Invert Y axis', value: false, onChange: (v) => settings.patch('controls', { invertY: v }) }), (s) => s.controls.invertY)),
  );

  // --- gamepad
  const padName = h('span', { class: 'field-hint mono' });
  const updatePad = () => (padName.textContent = FlightInput.gamepadName() ? `Connected: ${FlightInput.gamepadName()}` : 'No gamepad detected. Press a button on it to wake it up.');
  updatePad();
  addEventListener('gamepadconnected', updatePad);
  addEventListener('gamepaddisconnected', updatePad);
  root.append(
    sectionTitle('Gamepad'),
    field('Use a gamepad', 'Left stick yaw and pitch, right stick roll, triggers throttle, A stage, X SAS, Y RCS, B legs, bumpers camera and SAS mode.', bind(toggle({ label: 'Use a gamepad', value: true, onChange: (v) => settings.patch('controls', { gamepad: v }) }), (s) => s.controls.gamepad)),
    field('Stick dead zone', 'Ignore small stick movements.', bind(slider({ label: 'Stick dead zone', min: 0, max: 0.4, step: 0.01, value: 0.12, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => settings.patch('controls', { gamepadDeadzone: v }) }), (s) => s.controls.gamepadDeadzone)),
    padName,
  );

  // --- key bindings
  const keyButtons = new Map<ActionId, HTMLButtonElement>();
  let listening: { action: ActionId; stop: () => void } | null = null;
  const stopListening = () => listening?.stop();

  const startListening = (action: ActionId, btn: HTMLButtonElement) => {
    stopListening();
    btn.textContent = 'Press a key…';
    btn.classList.add('is-listening');
    const onKey = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.code === 'Escape') return stop();
      if (!isBindable(ev.code)) return;
      settings.patch('controls', { bindings: rebind(settings.get().controls.bindings, action, ev.code) });
      stop();
    };
    const stop = () => {
      window.removeEventListener('keydown', onKey, true);
      btn.classList.remove('is-listening');
      btn.textContent = keyLabel(settings.get().controls.bindings[action]);
      listening = null;
    };
    window.addEventListener('keydown', onKey, true);
    listening = { action, stop };
  };

  const groups = new Map<string, HTMLElement[]>();
  for (const info of ACTIONS) {
    const btn = h('button', { class: 'keybind mono', type: 'button', 'aria-label': `Key for ${info.label}`, tip: 'Click, then press the new key' }) as HTMLButtonElement;
    btn.addEventListener('click', () => startListening(info.id, btn));
    keyButtons.set(info.id, btn);
    groups.set(info.group, [...(groups.get(info.group) ?? []), field(info.label, null, btn)]);
  }
  syncers.push((s) => {
    for (const [id, btn] of keyButtons) if (!btn.classList.contains('is-listening')) btn.textContent = keyLabel(s.controls.bindings[id]);
  });
  root.append(
    sectionTitle('Keys'),
    h('p', { class: 'field-hint', text: 'Click a key, then press the new one. A key already in use is swapped with the action that had it. Esc cancels. These keys work in flight; the Hangar and Explorer keep their own.' }),
  );
  for (const [group, rows] of groups) root.append(h('h4', { class: 'keygroup', text: group }), ...rows);
  root.append(h('div', { style: 'margin-top:1rem' }, button({ label: 'Reset keys to defaults', variant: 'quiet', onClick: () => (stopListening(), settings.patch('controls', { bindings: { ...DEFAULT_BINDINGS } })) })));
  return root;
}
