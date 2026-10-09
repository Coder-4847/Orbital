import { MAX_WARP_INDEX, WARP_RATES, formatWarp } from '../core/warp';
import { dateToUniversalTime, universalTimeToDate } from '../core/time';
import { button } from '../ui/kit/controls';
import { h } from '../ui/kit/dom';

export interface TimePanelHooks {
  getUT(): number;
  setUT(ut: number): void;
  getWarpIndex(): number;
  setWarpIndex(i: number): void;
  /** Highest warp index currently allowed (map view and cheats raise it). */
  maxWarpIndex(): number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const toInputValue = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/**
 * Universal time readout, warp ladder and "jump to date". Dates are UTC. Jumping is exact because the whole solar system
 * is an analytic function of universal time.
 */
export function createTimePanel(hooks: TimePanelHooks): { root: HTMLElement; update(): void } {
  const date = h('div', { class: 'time-date mono' });
  const rate = h('div', { class: 'time-rate mono' });
  const slower = button({ label: '◀', variant: 'quiet', tip: 'Slower (,)', onClick: () => hooks.setWarpIndex(hooks.getWarpIndex() - 1) });
  const faster = button({ label: '▶', variant: 'quiet', tip: 'Faster (.)', onClick: () => hooks.setWarpIndex(hooks.getWarpIndex() + 1) });
  const realtime = button({ label: '1×', variant: 'quiet', tip: 'Real time (/)', onClick: () => hooks.setWarpIndex(0) });

  const input = h('input', { type: 'datetime-local', class: 'time-input mono', 'aria-label': 'Jump to date (UTC)' });
  const jump = () => {
    const value = input.value;
    if (!value) return;
    const t = dateToUniversalTime(new Date(`${value}:00Z`));
    if (Number.isFinite(t)) hooks.setUT(t);
  };
  const go = button({ label: 'Jump', variant: 'default', tip: 'Jump to this UTC date', onClick: jump });
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // typing a date must not trigger flight hotkeys
    if (ev.key === 'Enter') jump();
  });
  let seeded = false;

  const root = h('div', { class: 'time-panel pe' }, date, h('div', { class: 'time-row' }, slower, rate, faster, realtime), h('div', { class: 'time-row' }, input, go));

  return {
    root,
    update() {
      const ut = hooks.getUT();
      const d = universalTimeToDate(ut);
      date.textContent = Number.isNaN(d.getTime()) ? '—' : `${d.toISOString().slice(0, 10)}  ${d.toISOString().slice(11, 19)} UTC`;
      const i = hooks.getWarpIndex();
      rate.textContent = formatWarp(WARP_RATES[i]!);
      slower.disabled = i <= 0;
      faster.disabled = i >= Math.min(hooks.maxWarpIndex(), MAX_WARP_INDEX);
      if (!seeded && document.activeElement !== input) {
        input.value = toInputValue(d);
        seeded = true;
      }
    },
  };
}
