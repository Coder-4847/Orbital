/**
 * Interface sounds by event delegation: every button, tab and switch clicks and every button answers a hover with a faint tick,
 * with no wiring in the individual screens. Dialogs opening are marked with a soft sweep. The first click or key press also
 * starts the audio context, as browsers insist on a gesture.
 */
import type { AudioManager } from './audio-manager';

const INTERACTIVE = 'button, [role="tab"], [role="switch"], [role="menuitem"], input[type="range"], .seg-option';

export function installUiSounds(audio: AudioManager): void {
  const unlock = () => audio.unlock();
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  document.addEventListener(
    'click',
    (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest?.(INTERACTIVE) as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (el.matches('[role="switch"]')) audio.ui('toggle');
      else if (el.matches('.btn--primary, .menu-item')) audio.ui('confirm');
      else audio.ui('click');
    },
    true,
  );
  document.addEventListener(
    'pointerover',
    (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('button, [role="tab"]') as HTMLButtonElement | null;
      if (el && !el.disabled && ev.pointerType !== 'touch') audio.ui('hover');
    },
    true,
  );
  // dialogs opening
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.matches('[role="dialog"], .modal-backdrop')) audio.ui('open');
  }).observe(document.body, { childList: true });
}
