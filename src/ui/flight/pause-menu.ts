/** The flight pause menu, and the read-only key reference it links to. */
import { ACTIONS, keyLabel } from '../../core/keymap';
import type { AppContext } from '../../core/scene-manager';
import { button } from '../kit/controls';
import { h } from '../kit/dom';
import { openModal, type ModalHandle } from '../kit/modal';

export interface PauseActions {
  save(): void;
  quicksave(): void;
  quickload(): void;
  settings(): void;
  cheats(): void;
  restart(): void;
  hangar(): void;
  menu(): void;
}

export function openKeyReference(ctx: AppContext, onEdit: () => void): ModalHandle {
  const bindings = ctx.settings.get().controls.bindings;
  const groups = new Map<string, HTMLElement[]>();
  for (const a of ACTIONS) {
    groups.set(a.group, [...(groups.get(a.group) ?? []), h('div', { class: 'ref-row' }, h('span', { text: a.label }), h('kbd', { class: 'mono', text: keyLabel(bindings[a.id]) }))]);
  }
  const cols = [...groups].map(([group, rows]) => h('section', { class: 'ref-group' }, h('h4', { class: 'keygroup', text: group }), ...rows));
  const modal = openModal({
    title: 'Controls',
    size: 'lg',
    content: h('div', { class: 'scroll-fill' }, h('div', { class: 'ref-grid' }, ...cols)),
    footer: h(
      'div',
      { style: 'display:flex;justify-content:space-between;width:100%' },
      button({ label: 'Change keys…', variant: 'quiet', onClick: () => (modal.close(), onEdit()) }),
      button({ label: 'Close', variant: 'primary', onClick: () => modal.close() }),
    ),
  });
  return modal;
}

export function openPauseMenu(ctx: AppContext, a: PauseActions): ModalHandle {
  const close = () => modal.close();
  const item = (label: string, fn: () => void, variant: 'primary' | 'default' | 'quiet' = 'default') => button({ label, variant, onClick: () => (close(), fn()) });
  const modal = openModal({
    title: 'Paused',
    content: h(
      'div',
      { class: 'dialog-stack' },
      button({ label: 'Resume', variant: 'primary', onClick: close }),
      item('Save and load…', a.save),
      h('div', { class: 'pause-pair' }, item(`Quick save (${keyLabel(ctx.settings.get().controls.bindings.quicksave)})`, a.quicksave), item(`Quick load (${keyLabel(ctx.settings.get().controls.bindings.quickload)})`, a.quickload)),
      item('Settings', a.settings),
      item('Controls', () => openKeyReference(ctx, a.settings)),
      item('Cheats', a.cheats),
      h('hr', { class: 'dialog-rule' }),
      item('Restart on the pad', a.restart),
      item('Back to the Hangar', a.hangar),
      item('Main menu', a.menu),
    ),
  });
  return modal;
}
