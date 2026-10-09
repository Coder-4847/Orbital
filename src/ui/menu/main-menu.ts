import { APP_VERSION } from '../../version';
import { h } from '../kit/dom';

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MainMenuOptions {
  items: MenuItem[];
  rendererLabel: string;
}

/** Wordmark + vertical menu. Arrow keys move between items; Enter/Space activates. */
export function buildMainMenu({ items, rendererLabel }: MainMenuOptions): { root: HTMLElement; buttons: Map<string, HTMLButtonElement> } {
  const buttons = new Map<string, HTMLButtonElement>();
  const list = h('ul', { class: 'menu-list', role: 'menu' });

  for (const item of items) {
    const btn = h('button', { class: 'menu-item', type: 'button', role: 'menuitem', disabled: item.disabled, 'data-id': item.id }, item.label, item.hint ? h('small', { class: 'mono', text: item.hint }) : null);
    btn.addEventListener('click', item.onSelect);
    buttons.set(item.id, btn);
    list.appendChild(h('li', { role: 'none' }, btn));
  }

  list.addEventListener('keydown', (ev) => {
    const dir = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    ev.preventDefault();
    const enabled = [...buttons.values()].filter((b) => !b.disabled);
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    enabled[(at + dir + enabled.length) % enabled.length]?.focus();
  });

  const root = h(
    'div',
    { class: 'menu' },
    h(
      'header',
      { class: 'wordmark' },
      h('h1', { class: 'wordmark-title', text: 'ORBITAL' }),
      h('div', { class: 'wordmark-rule' }),
      h('p', { class: 'wordmark-sub', text: 'Spaceflight simulator' }),
    ),
    h('nav', { 'aria-label': 'Main menu' }, list),
    h('div', { class: 'corner corner--left mono', text: `v${APP_VERSION}` }),
    h('div', { class: 'corner corner--right mono', text: rendererLabel, tip: 'Active rendering backend' }),
  );
  return { root, buttons };
}
