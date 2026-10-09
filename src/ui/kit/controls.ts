import { h, uid, type Child } from './dom';

/** Every control exposes its element plus set(), so panels can resync from state without rebuilding. */
export interface Control<T> {
  el: HTMLElement;
  set(value: T): void;
}

export interface ButtonOptions {
  label: string;
  variant?: 'default' | 'primary' | 'quiet' | 'danger';
  onClick: (ev: MouseEvent) => void;
  tip?: string;
  disabled?: boolean;
}

export function button({ label, variant = 'default', onClick, tip, disabled }: ButtonOptions): HTMLButtonElement {
  const cls = variant === 'default' ? 'btn' : `btn btn--${variant}`;
  return h('button', { class: cls, type: 'button', text: label, tip, disabled, onclick: onClick as EventListener });
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  label: string; // accessible name
  onInput: (v: number) => void;
}

export function slider(opts: SliderOptions): Control<number> {
  const format = opts.format ?? ((v: number) => String(v));
  const input = h('input', {
    type: 'range',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    'aria-label': opts.label,
  });
  const readout = h('span', { class: 'slider-value mono' });
  const paint = (v: number) => {
    input.style.setProperty('--pct', `${((v - opts.min) / (opts.max - opts.min)) * 100}%`);
    readout.textContent = format(v);
  };
  const set = (v: number) => {
    input.value = String(v);
    paint(v);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    opts.onInput(v);
  });
  set(opts.value);
  return { el: h('div', { class: 'slider' }, input, readout), set };
}

export function toggle(opts: { label: string; value: boolean; onChange: (v: boolean) => void }): Control<boolean> {
  const el = h('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-label': opts.label });
  const set = (v: boolean) => el.setAttribute('aria-checked', String(v));
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    set(next);
    opts.onChange(next);
  });
  set(opts.value);
  return { el, set };
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  tip?: string;
}

/** Radio-group style choice with arrow-key navigation. */
export function segmented<T extends string | number>(opts: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}): Control<T> {
  const buttons = opts.options.map((o) =>
    h('button', { type: 'button', role: 'radio', tip: o.tip, text: o.label, 'data-value': String(o.value) }),
  );
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': opts.label }, ...buttons);
  const set = (v: T) => {
    buttons.forEach((b, i) => {
      const on = opts.options[i]!.value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => {
      const v = opts.options[i]!.value;
      set(v);
      opts.onChange(v);
    });
    b.addEventListener('keydown', (ev) => {
      const dir = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      ev.preventDefault();
      const next = buttons[(i + dir + buttons.length) % buttons.length]!;
      next.focus();
      next.click();
    });
  });
  set(opts.value);
  return { el, set };
}

/** A labelled settings row: description on the left, control on the right. */
export function field(label: string, hint: string | null, control: HTMLElement): HTMLElement {
  const id = uid('field');
  const text = h('div', null, h('span', { class: 'field-label', id, text: label }), hint ? h('span', { class: 'field-hint', text: hint }) : null);
  return h('div', { class: 'field' }, text, h('div', { class: 'field-control' }, control));
}

export const sectionTitle = (text: string): HTMLElement => h('h3', { class: 'section-title', text });

export interface TabDef {
  id: string;
  label: string;
  content: HTMLElement;
}

/** Vertical tab list with roving tabindex and arrow-key navigation. */
export function tabs(defs: TabDef[], initial = defs[0]?.id): HTMLElement {
  const prefix = uid('tabs');
  const tabEls = defs.map((d) =>
    h('button', { class: 'tab', type: 'button', role: 'tab', id: `${prefix}-${d.id}-tab`, 'aria-controls': `${prefix}-${d.id}`, text: d.label }),
  );
  const panels = defs.map((d) => {
    d.content.classList.add('tabpanel');
    d.content.setAttribute('role', 'tabpanel');
    d.content.id = `${prefix}-${d.id}`;
    d.content.setAttribute('aria-labelledby', `${prefix}-${d.id}-tab`);
    return d.content;
  });
  const select = (index: number, focus = false) => {
    tabEls.forEach((t, i) => {
      const on = i === index;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panels[i]!.hidden = !on;
    });
    if (focus) tabEls[index]!.focus();
  };
  tabEls.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (ev) => {
      const dir = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      ev.preventDefault();
      select((i + dir + tabEls.length) % tabEls.length, true);
    });
  });
  select(Math.max(0, defs.findIndex((d) => d.id === initial)));
  return h('div', { class: 'tabs' }, h('div', { class: 'tablist', role: 'tablist', 'aria-orientation': 'vertical' }, ...tabEls), ...(panels as Child[]));
}
