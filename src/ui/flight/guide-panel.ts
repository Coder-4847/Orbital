/**
 * The flight guide card: the phases of the flight as a row of steps, the current step's instruction with the real key names,
 * and a live figure with a progress bar. What it says is decided by flight/guide.ts; this only draws it.
 */
import { keyLabel, type ActionId, type Bindings } from '../../core/keymap';
import type { GuideView } from '../../flight/guide';
import { h } from '../kit/dom';

export interface GuidePanelActions {
  /** Open the How to Play pages. */
  help(): void;
  /** The player closed the card. */
  hide(): void;
  bindings(): Bindings;
}

/** "Press {stage} to go" -> text nodes and <kbd> elements with the bound key. */
export function withKeys(text: string, bindings: Bindings): Array<Node | string> {
  return text.split(/\{(\w+)\}/).map((part, i) => {
    if (i % 2 === 0) return part;
    const code = (bindings as Record<string, string | undefined>)[part as ActionId];
    return h('kbd', { class: 'key mono', text: code ? keyLabel(code) : part });
  });
}

export class GuidePanel {
  readonly root = h('div', { class: 'guide-card pe', role: 'status' });
  private readonly phases = h('ol', { class: 'guide-phases' });
  private readonly title = h('div', { class: 'guide-title' });
  private readonly text = h('p', { class: 'guide-text' });
  private readonly status = h('div', { class: 'guide-status mono' });
  private readonly bar = h('div', { class: 'guide-bar-fill' });
  private readonly barWrap = h('div', { class: 'guide-bar' }, this.bar);
  private signature = '';
  private phaseSignature = '';

  constructor(private readonly actions: GuidePanelActions) {
    const head = h(
      'div',
      { class: 'guide-head' },
      h('span', { class: 'guide-kicker', text: 'Flight guide' }),
      h('span', { class: 'hud-spacer' }),
      h('button', { class: 'guide-icon', type: 'button', text: '?', tip: 'How to play', 'aria-label': 'How to play', onclick: () => actions.help() }),
      h('button', { class: 'guide-icon', type: 'button', text: '×', tip: 'Hide the guide (the Guide button brings it back)', 'aria-label': 'Hide the guide', onclick: () => actions.hide() }),
    );
    this.root.append(head, this.phases, this.title, this.text, this.status, this.barWrap);
    // Like the HUD: clicking the card must never steal the keyboard from flying.
    for (const b of this.root.querySelectorAll('button')) {
      b.tabIndex = -1;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
    }
  }

  show(on: boolean): void {
    this.root.classList.toggle('is-on', on);
  }

  update(view: GuideView): void {
    const phaseSig = `${view.phases?.join('|') ?? ''}@${view.phase}`;
    if (phaseSig !== this.phaseSignature) {
      this.phaseSignature = phaseSig;
      this.phases.style.display = view.phases ? '' : 'none';
      this.phases.replaceChildren(
        ...(view.phases ?? []).map((name, i) => h('li', { class: `guide-phase${i < view.phase ? ' is-done' : i === view.phase ? ' is-now' : ''}`, 'aria-current': i === view.phase ? 'step' : undefined }, h('span', { class: 'guide-dot' }), h('span', { text: name }))),
      );
    }
    const sig = `${view.id}|${view.title}|${view.text}`;
    if (sig !== this.signature) {
      const stepChanged = !this.signature.startsWith(`${view.id}|`);
      this.signature = sig;
      this.title.textContent = view.title;
      this.text.replaceChildren(...withKeys(view.text, this.actions.bindings()));
      if (stepChanged) {
        this.root.classList.remove('is-new');
        void this.root.offsetWidth; // restart the highlight animation
        this.root.classList.add('is-new');
      }
    }
    const status = view.status ?? '';
    if (this.status.textContent !== status) this.status.textContent = status;
    this.status.style.display = status ? '' : 'none';
    this.barWrap.style.display = view.progress === undefined ? 'none' : '';
    if (view.progress !== undefined) this.bar.style.width = `${Math.round(view.progress * 100)}%`;
  }
}
