/**
 * The save and load dialog. Lists every save (newest first) with its thumbnail, in-game date and when it was last played, and
 * can load, overwrite, export, delete and import saves. Opened from the main menu (load only) and from the flight pause menu
 * (which can also save the running flight).
 */
import { formatUniversalTime, timeAgo } from '../../core/time';
import type { AppContext } from '../../core/scene-manager';
import type { SaveSummary } from '../../save/saves';
import { button } from '../kit/controls';
import { h } from '../kit/dom';
import { openModal, type ModalHandle } from '../kit/modal';

export interface SaveManagerOptions {
  /** Present when a flight is running: shows the "save current flight" section. Resolves with the new save. */
  saveCurrent?: (name: string, overwriteId?: string) => Promise<SaveSummary>;
  defaultName?: string;
  onLoad(save: SaveSummary): void;
}

const KIND_LABEL: Record<SaveSummary['kind'], string> = { manual: '', auto: 'autosave', quick: 'quicksave' };

/** Offer `text` as a file download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'save';

export function openSaveManager(ctx: AppContext, opts: SaveManagerOptions): ModalHandle {
  const status = h('p', { class: 'field-hint', role: 'status' });
  const list = h('div', null, h('p', { class: 'empty', text: 'Loading…' }));
  const say = (text: string) => (status.textContent = text);

  const nameInput = h('input', { class: 'save-name-input', type: 'text', maxlength: '60', value: opts.defaultName ?? 'My flight', 'aria-label': 'Name for the new save' }) as HTMLInputElement;
  nameInput.addEventListener('keydown', (ev) => ev.stopPropagation());
  const save = async (overwriteId?: string) => {
    if (!opts.saveCurrent) return;
    const name = nameInput.value.trim() || 'My flight';
    try {
      const s = await opts.saveCurrent(name, overwriteId);
      say(`Saved “${s.name}”.`);
      ctx.audio.ui('confirm');
    } catch (err) {
      say(`Could not save: ${(err as Error).message}`);
      ctx.audio.ui('error');
    }
    void render();
  };

  const importInput = h('input', { type: 'file', accept: '.json,.orbital,application/json', hidden: true }) as HTMLInputElement;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const s = await ctx.saves.importSave(await file.text());
      say(`Imported “${s.name}”.`);
    } catch (err) {
      say((err as Error).message);
      ctx.audio.ui('error');
    }
    void render();
  });

  const render = async () => {
    let saves: SaveSummary[];
    try {
      saves = await ctx.saves.list();
    } catch {
      list.replaceChildren(h('p', { class: 'empty', text: 'Saved games are unavailable in this browser session.' }));
      return;
    }
    if (saves.length === 0) {
      list.replaceChildren(h('p', { class: 'empty', text: 'No saved games yet. Launch a rocket and your flights will appear here.' }));
      return;
    }
    list.replaceChildren(
      h(
        'ul',
        { class: 'save-list' },
        ...saves.map((s) =>
          h(
            'li',
            { class: 'save-row' },
            s.thumbnail ? h('img', { class: 'save-thumb', src: s.thumbnail, alt: '' }) : h('div', { class: 'save-thumb save-thumb--empty' }),
            h(
              'div',
              { class: 'save-info' },
              h('div', { class: 'save-name', text: s.name }),
              h('div', { class: 'save-meta mono', text: `${formatUniversalTime(s.gameTime)} · ${timeAgo(s.updatedAt)}${KIND_LABEL[s.kind] ? ` · ${KIND_LABEL[s.kind]}` : ''}` }),
            ),
            h(
              'div',
              { class: 'save-actions' },
              button({ label: 'Load', variant: 'primary', onClick: () => (modal.close(), opts.onLoad(s)) }),
              opts.saveCurrent && s.kind === 'manual' ? button({ label: 'Overwrite', variant: 'quiet', tip: 'Replace this save with the current flight', onClick: () => void save(s.id) }) : null,
              button({
                label: 'Export',
                variant: 'quiet',
                tip: 'Download this save as a file',
                onClick: async () => {
                  try {
                    downloadText(`${safeName(s.name)}.orbital.json`, await ctx.saves.exportSave(s.id));
                  } catch (err) {
                    say((err as Error).message);
                  }
                },
              }),
              button({
                label: 'Delete',
                variant: 'quiet',
                onClick: async () => {
                  await ctx.saves.delete(s.id);
                  void render();
                },
              }),
            ),
          ),
        ),
      ),
    );
  };

  const content = h(
    'div',
    { class: 'save-manager scroll-fill' },
    opts.saveCurrent
      ? h('div', { class: 'save-new' }, nameInput, button({ label: 'Save as new', variant: 'primary', onClick: () => void save() }))
      : null,
    list,
    status,
    importInput,
  );
  const modal = openModal({
    title: opts.saveCurrent ? 'Save and load' : 'Load game',
    size: 'lg',
    content,
    footer: h(
      'div',
      { style: 'display:flex;justify-content:space-between;width:100%' },
      button({ label: 'Import a save file…', variant: 'quiet', onClick: () => importInput.click() }),
      button({ label: 'Close', variant: 'primary', onClick: () => modal.close() }),
    ),
  });
  void render();
  return modal;
}
