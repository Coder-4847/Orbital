export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  /** Tooltip text; shown by the global tooltip manager. */
  tip?: string;
  [attr: string]: unknown;
}

/**
 * Tiny hyperscript helper: h('button', { class: 'btn', onclick: fn }, 'Label').
 * Keys starting with "on" are event listeners; `true` booleans become empty attributes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'tip') el.dataset.tip = String(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

let idCounter = 0;
export const uid = (prefix = 'ui'): string => `${prefix}-${++idCounter}`;

/** Elements that can receive keyboard focus, for focus traps. */
export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
