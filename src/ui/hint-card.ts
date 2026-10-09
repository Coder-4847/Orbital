/**
 * The on-screen card that shows a hint. It remembers which hints were shown (in localStorage) so each appears once, fades
 * itself away after a while, and has a "turn hints off" button that sets the Settings switch.
 */
import { HINTS, type HintId } from '../flight/hints';
import type { SettingsStore } from '../save/settings';
import { button } from './kit/controls';
import { h } from './kit/dom';

export const HINTS_KEY = 'orbital.hints';
/** Dispatched on `window` by Settings to make every hint appear again. */
export const RESET_HINTS_EVENT = 'orbital:reset-hints';
const SHOW_SECONDS = 22;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class HintCard {
  readonly root = h('div', { class: 'hint-card pe', role: 'status' });
  readonly seen: Set<string>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private showing = false;

  constructor(private readonly settings: SettingsStore, private readonly storage: StorageLike | null = safeStorage()) {
    let ids: string[] = [];
    try {
      const raw = storage?.getItem(HINTS_KEY);
      if (raw) ids = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string');
    } catch {
      /* unreadable: treat everything as new */
    }
    this.seen = new Set(ids);
    addEventListener(RESET_HINTS_EVENT, this.onReset);
  }

  private readonly onReset = (): void => {
    this.seen.clear();
  };

  dispose(): void {
    removeEventListener(RESET_HINTS_EVENT, this.onReset);
    clearTimeout(this.timer);
  }

  get busy(): boolean {
    return this.showing;
  }

  /** Show a hint now. Marks it as seen. */
  show(id: HintId): void {
    if (this.showing) return;
    const hint = HINTS[id];
    this.seen.add(id);
    this.save();
    this.showing = true;
    this.root.replaceChildren(
      h('div', { class: 'hint-title', text: hint.title }),
      h('p', { class: 'hint-text', text: hint.text }),
      h(
        'div',
        { class: 'hint-actions' },
        button({ label: 'Got it', variant: 'primary', onClick: () => this.hide() }),
        button({
          label: 'Turn hints off',
          variant: 'quiet',
          onClick: () => {
            this.settings.patch('gameplay', { hints: false });
            this.hide();
          },
        }),
      ),
    );
    for (const b of this.root.querySelectorAll('button')) {
      b.tabIndex = -1;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
    }
    this.root.classList.add('is-on');
    this.timer = setTimeout(() => this.hide(), SHOW_SECONDS * 1000);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.root.classList.remove('is-on');
    this.showing = false;
  }

  /** Forget everything that was shown (the Hints reset in Settings), so they all appear again. */
  reset(): void {
    this.seen.clear();
    this.save();
  }

  private save(): void {
    try {
      this.storage?.setItem(HINTS_KEY, JSON.stringify([...this.seen]));
    } catch {
      /* not persisted */
    }
  }
}
