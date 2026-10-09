import { FOCUSABLE, h } from './dom';

export interface ModalOptions {
  title: string;
  content: HTMLElement;
  /** "lg" is a fixed-size panel (settings); default sizes to content. */
  size?: 'md' | 'lg';
  footer?: HTMLElement;
  onClose?: () => void;
}

export interface ModalHandle {
  close(): void;
  el: HTMLElement;
}

const openStack: ModalHandle[] = [];

/** True while any modal is open, so scenes can ignore hotkeys. */
export const isModalOpen = (): boolean => openStack.length > 0;

/** Accessible modal dialog: focus trap, Esc/backdrop to close, focus restored on close. */
export function openModal(opts: ModalOptions): ModalHandle {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const titleId = `modal-title-${openStack.length}`;
  const closeBtn = h('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close', text: '×' });
  const body = h('div', { class: opts.size === 'lg' ? 'modal-body is-fill' : 'modal-body' }, opts.content);
  const modal = h(
    'div',
    { class: `modal modal--${opts.size ?? 'md'}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal-head' }, h('h2', { class: 'modal-title', id: titleId, text: opts.title }), closeBtn),
    body,
    opts.footer ? h('div', { class: 'modal-foot' }, opts.footer) : null,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, modal);
  document.body.appendChild(backdrop);

  let closed = false;
  const handle: ModalHandle = { el: modal, close };

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    openStack.splice(openStack.indexOf(handle), 1);
    backdrop.classList.remove('is-open');
    setTimeout(() => backdrop.remove(), 280);
    previouslyFocused?.focus?.();
    opts.onClose?.();
  }

  function onKey(ev: KeyboardEvent): void {
    // Only the top-most modal reacts.
    if (openStack[openStack.length - 1] !== handle) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === 'Tab') {
      const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (ev.shiftKey && (active === first || !modal.contains(active))) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && (active === last || !modal.contains(active))) {
        ev.preventDefault();
        first.focus();
      }
    }
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (ev) => {
    if (ev.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  openStack.push(handle);

  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    (modal.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? modal.querySelector<HTMLElement>(FOCUSABLE) ?? modal).focus();
  });
  return handle;
}
