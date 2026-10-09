import { h } from './dom';

const SHOW_DELAY_MS = 380;
const MARGIN = 8;

/**
 * One delegated tooltip for the whole document: any element with data-tip="..." gets it on hover or keyboard focus.
 * `isEnabled` lets the Gameplay > Tooltips setting switch it off live.
 */
export function installTooltips(isEnabled: () => boolean): void {
  const tip = h('div', { class: 'tooltip', role: 'tooltip' });
  document.body.appendChild(tip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let target: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.classList.remove('is-visible');
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || !isEnabled()) return;
    tip.textContent = text;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.bottom + MARGIN;
    if (y + t.height > window.innerHeight - MARGIN) y = r.top - t.height - MARGIN;
    x = Math.max(MARGIN, Math.min(x, window.innerWidth - t.width - MARGIN));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.classList.add('is-visible');
  };

  const enter = (ev: Event) => {
    const el = (ev.target as Element | null)?.closest<HTMLElement>('[data-tip]') ?? null;
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    timer = setTimeout(() => show(el), ev.type === 'focusin' ? 0 : SHOW_DELAY_MS);
  };

  document.addEventListener('pointerover', enter);
  document.addEventListener('focusin', enter);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && hide(), true);
  window.addEventListener('blur', hide);
}
