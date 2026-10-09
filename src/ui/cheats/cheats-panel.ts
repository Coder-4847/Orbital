/**
 * The cheats menu: switches for the sandbox options and, during a flight, one-shot actions (refuel, teleport to orbit or to the
 * ground anywhere, jump the clock). Reachable from the pause menu and by a key. Cheats never alter a save file.
 */
import { dateToUniversalTime, universalTimeToDate } from '../../core/time';
import type { AppContext } from '../../core/scene-manager';
import { BODIES } from '../../data/solar-system';
import type { Cheats } from '../../save/cheats';
import { button, field, sectionTitle, toggle } from '../kit/controls';
import { h } from '../kit/dom';
import { openModal, type ModalHandle } from '../kit/modal';

/** What the running flight offers the menu. Each action returns an error message, or null on success. */
export interface FlightCheatActions {
  refuelAndRepair(): void;
  teleportToOrbit(bodyId: string, altitudeMeters: number): string | null;
  teleportToSurface(bodyId: string, latDeg: number, lonDeg: number): string | null;
  teleportToPad(): string | null;
  currentUT(): number;
  jumpToTime(ut: number): string | null;
}

interface Switch {
  key: keyof Cheats;
  label: string;
  hint: string;
  scope: 'flight' | 'hangar' | 'both';
}

const SWITCHES: Switch[] = [
  { key: 'unlimitedFuel', label: 'Unlimited fuel', hint: 'Engines and RCS never use propellant.', scope: 'flight' },
  { key: 'unlimitedCharge', label: 'Unlimited electric charge', hint: 'Batteries never run down.', scope: 'flight' },
  { key: 'maxThrust', label: 'Maximum engine power', hint: 'Every engine delivers four times its thrust.', scope: 'flight' },
  { key: 'invulnerable', label: 'No crash damage', hint: 'Nothing breaks from impacts, loads, heat or pressure.', scope: 'flight' },
  { key: 'noHeating', label: 'Disable re-entry heating', hint: 'No aerodynamic heating at any speed.', scope: 'flight' },
  { key: 'noAero', label: 'Disable aerodynamic forces', hint: 'No drag, lift or parachute forces.', scope: 'flight' },
  { key: 'zeroGravity', label: 'Zero gravity', hint: 'Switches gravity off (time warp on rails is not available).', scope: 'flight' },
  { key: 'maxWarp', label: 'Maximum time warp unlocked', hint: 'Ignore the safety limits near the atmosphere and surfaces.', scope: 'flight' },
  { key: 'unlimitedBuild', label: 'Unlimited building space', hint: 'No part-count, size or mass limits in the Hangar.', scope: 'both' },
  { key: 'unlockAllParts', label: 'Unlock all parts', hint: 'Every part is available. (There is no part progression yet, so this is always on.)', scope: 'hangar' },
  { key: 'debugOverlay', label: 'Show debug overlay', hint: 'Frame rate, frame time, terrain chunks and the physics step.', scope: 'both' },
];

const input = (attrs: Record<string, string>): HTMLInputElement => {
  const el = h('input', { class: 'cheat-input mono', ...attrs }) as HTMLInputElement;
  el.addEventListener('keydown', (ev) => ev.stopPropagation()); // typing must not trigger hotkeys
  return el;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const toInputValue = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

export function openCheats(ctx: AppContext, flight?: FlightCheatActions): ModalHandle {
  const { cheats } = ctx;
  const message = h('p', { class: 'field-hint cheat-message', role: 'status' });
  const report = (error: string | null, ok: string) => {
    message.textContent = error ?? ok;
    message.classList.toggle('is-bad', !!error);
    if (error) ctx.audio.ui('error');
  };

  const syncers: Array<() => void> = [];
  const switches = SWITCHES.filter((s) => (flight ? s.scope !== 'hangar' : s.scope !== 'flight')).map((s) => {
    const t = toggle({ label: s.label, value: cheats.get()[s.key], onChange: (v) => cheats.setCheat(s.key, v) });
    syncers.push(() => t.set(cheats.get()[s.key]));
    return field(s.label, s.hint, t.el);
  });
  const unsubscribe = cheats.subscribe(() => syncers.forEach((fn) => fn()));

  const actions: HTMLElement[] = [];
  if (flight) {
    const bodySelect = (filter: (id: string) => boolean) =>
      h('select', { class: 'cheat-input', 'aria-label': 'Body' }, ...BODIES.filter((b) => filter(b.id)).map((b) => h('option', { value: b.id, text: b.name }))) as HTMLSelectElement;
    const orbitBody = bodySelect(() => true);
    orbitBody.value = 'earth';
    const altitude = input({ type: 'number', value: '200', min: '1', step: '10', 'aria-label': 'Orbit altitude in kilometres' });
    const surfaceBody = bodySelect((id) => BODIES.find((b) => b.id === id)?.render === 'terrain');
    surfaceBody.value = 'moon';
    const lat = input({ type: 'number', value: '0', min: '-90', max: '90', step: '1', 'aria-label': 'Latitude' });
    const lon = input({ type: 'number', value: '0', min: '-180', max: '180', step: '1', 'aria-label': 'Longitude' });
    const date = input({ type: 'datetime-local', 'aria-label': 'Universal time (UTC)' });
    const seedDate = () => (date.value = toInputValue(universalTimeToDate(flight.currentUT())));
    seedDate();

    actions.push(
      sectionTitle('Actions'),
      field('Refuel and repair', 'Fills the tanks and batteries, cools the vessel and restores heat shields and parachutes.', button({ label: 'Refuel now', onClick: () => (flight.refuelAndRepair(), report(null, 'Refuelled and repaired.')) })),
      field(
        'Teleport to orbit',
        'A circular equatorial orbit around the body, at this altitude (km).',
        h('div', { class: 'cheat-row' }, orbitBody, altitude, button({ label: 'Go', onClick: () => report(flight.teleportToOrbit(orbitBody.value, Number(altitude.value) * 1000), 'You are in orbit.') })),
      ),
      field(
        'Teleport to the surface',
        'Stand on the ground at a latitude and longitude, or at the launch pad.',
        h(
          'div',
          { class: 'cheat-row' },
          surfaceBody,
          lat,
          lon,
          button({ label: 'Go', onClick: () => report(flight.teleportToSurface(surfaceBody.value, Number(lat.value), Number(lon.value)), 'You are on the ground.') }),
          button({ label: 'Launch pad', variant: 'quiet', onClick: () => report(flight.teleportToPad(), 'You are on the launch pad.') }),
        ),
      ),
      field(
        'Universal time',
        'Jump to a UTC date. A landed vessel waits; one in orbit follows its orbit.',
        h(
          'div',
          { class: 'cheat-row' },
          date,
          button({
            label: 'Jump',
            onClick: () => {
              const ut = dateToUniversalTime(new Date(`${date.value}:00Z`));
              report(flight.jumpToTime(ut), 'Time has moved.');
              seedDate();
            },
          }),
          ...[['+1 h', 3600], ['+1 day', 86400], ['+1 week', 604800]].map(([label, seconds]) =>
            button({ label: label as string, variant: 'quiet', onClick: () => (report(flight.jumpToTime(flight.currentUT() + (seconds as number)), 'Time has moved.'), seedDate()) }),
          ),
        ),
      ),
      message,
    );
  }

  const content = h(
    'div',
    { class: 'cheats scroll-fill' },
    h('p', { class: 'cheat-note', text: 'Cheats are for fun and sandboxing. They are remembered between sessions and can be switched off at any time.' }),
    sectionTitle('Switches'),
    ...switches,
    ...actions,
  );
  const modal = openModal({
    title: 'Cheats',
    size: 'lg',
    content,
    footer: h(
      'div',
      { style: 'display:flex;justify-content:space-between;width:100%' },
      button({ label: 'Switch everything off', variant: 'quiet', onClick: () => cheats.reset() }),
      button({ label: 'Done', variant: 'primary', onClick: () => modal.close() }),
    ),
    onClose: unsubscribe,
  });
  return modal;
}
