import { button } from './kit/controls';
import { h } from './kit/dom';
import { isModalOpen } from './kit/modal';

/** Top bar with a title and a Back button, plus an optional bottom note. Esc also goes back (unless a dialog is open). */
export function buildSceneChrome(title: string, note: string, onBack: () => void): { root: HTMLElement; dispose(): void } {
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && !isModalOpen()) onBack();
  };
  document.addEventListener('keydown', onKey);
  const root = h(
    'div',
    null,
    h('div', { class: 'scene-bar' }, button({ label: '← Menu', variant: 'quiet', onClick: onBack, tip: 'Back to main menu (Esc)' }), h('h1', { text: title })),
    h('div', { class: 'scene-note', text: note }),
  );
  return { root, dispose: () => document.removeEventListener('keydown', onKey) };
}
