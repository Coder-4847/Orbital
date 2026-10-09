/** The Hangar toolbar and its dialogs: save, load, examples, import and export of crafts. */
import { button, segmented, toggle } from '../ui/kit/controls';
import { h } from '../ui/kit/dom';
import { openModal } from '../ui/kit/modal';
import { newCraft } from './craft';
import { CraftRepository, exportCraft, importCraft } from './craft-store';
import { SYMMETRY_STEPS, type HangarEditor } from './editor';
import { EXAMPLES } from './examples';
import type { Panel } from './hangar-panels';

export function toast(host: HTMLElement, text: string): void {
  const el = h('div', { class: 'hangar-toast', role: 'status', text });
  host.append(el);
  setTimeout(() => el.classList.add('is-leaving'), 2800);
  setTimeout(() => el.remove(), 3300);
}

/** Download text as a file via a temporary link. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (name: string): string => name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'craft';

export interface ToolbarHooks {
  repo: CraftRepository;
  host: HTMLElement;
  onLaunch(): void;
}

function openSave(ed: HangarEditor, hooks: ToolbarHooks): void {
  const input = h('input', { class: 'hangar-name', type: 'text', maxlength: '48', value: ed.craft.name, 'aria-label': 'Craft name' });
  const save = async () => {
    ed.rename(input.value);
    try {
      await hooks.repo.save(ed.craft);
      modal.close();
      toast(hooks.host, `Saved "${ed.craft.name}".`);
    } catch (err) {
      toast(hooks.host, `Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') void save();
  });
  const modal = openModal({
    title: 'Save craft',
    content: h('div', { class: 'dialog-stack' }, h('p', { class: 'dialog-note', text: 'Saving with the name of an existing craft replaces it.' }), input),
    footer: h('div', { class: 'dialog-actions' }, button({ label: 'Cancel', variant: 'quiet', onClick: () => modal.close() }), button({ label: 'Save', variant: 'primary', onClick: () => void save() })),
  });
  input.select();
}

async function openLoad(ed: HangarEditor, hooks: ToolbarHooks): Promise<void> {
  const list = h('div', { class: 'dialog-list' });
  const modal = openModal({ title: 'Load craft', content: list, footer: h('div', { class: 'dialog-actions' }, button({ label: 'Close', variant: 'quiet', onClick: () => modal.close() })) });
  const draw = async () => {
    const crafts = await hooks.repo.list();
    list.replaceChildren(
      ...(crafts.length === 0
        ? [h('div', { class: 'empty', text: 'No saved crafts yet.' })]
        : crafts.map((c) =>
            h(
              'div',
              { class: 'dialog-row' },
              h('div', { class: 'dialog-row-main' }, h('div', { class: 'dialog-row-title', text: c.name }), h('div', { class: 'part-meta mono', text: `${c.partCount} parts · ${new Date(c.updatedAt).toLocaleString()}` })),
              button({
                label: 'Load',
                variant: 'primary',
                onClick: async () => {
                  const craft = await hooks.repo.get(c.id);
                  if (!craft) return;
                  ed.load(craft);
                  modal.close();
                  toast(hooks.host, `Loaded "${craft.name}".`);
                },
              }),
              button({ label: 'Delete', variant: 'danger', onClick: async () => (await hooks.repo.delete(c.id), draw()) }),
            ),
          )),
    );
  };
  await draw();
}

function openExamples(ed: HangarEditor, hooks: ToolbarHooks): void {
  const modal = openModal({
    title: 'Example crafts',
    content: h(
      'div',
      { class: 'dialog-list' },
      ...EXAMPLES.map((ex) =>
        h(
          'div',
          { class: 'dialog-row' },
          h('div', { class: 'dialog-row-main' }, h('div', { class: 'dialog-row-title', text: ex.title }), h('div', { class: 'part-meta', text: ex.blurb })),
          button({
            label: 'Open',
            variant: 'primary',
            onClick: () => {
              ed.load(ex.build());
              modal.close();
              toast(hooks.host, `Opened "${ex.title}".`);
            },
          }),
        ),
      ),
    ),
    footer: h('div', { class: 'dialog-actions' }, button({ label: 'Close', variant: 'quiet', onClick: () => modal.close() })),
  });
}

function pickFile(onText: (text: string) => void): void {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) onText(await file.text());
  });
  input.click();
}

export function createToolbar(ed: HangarEditor, hooks: ToolbarHooks): Panel {
  const undo = button({ label: '↶', variant: 'quiet', tip: 'Undo (Ctrl+Z)', onClick: () => ed.undo() });
  const redo = button({ label: '↷', variant: 'quiet', tip: 'Redo (Ctrl+Y)', onClick: () => ed.redo() });
  const symmetry = segmented({
    label: 'Symmetry',
    options: SYMMETRY_STEPS.map((n) => ({ value: n as number, label: `${n}×`, tip: n === 1 ? 'No symmetry' : n === 2 ? 'Mirror (2×)' : `${n}-way radial symmetry` })),
    value: ed.symmetry,
    onChange: (n) => ed.setSymmetry(n),
  });
  const cheat = toggle({ label: 'Unlimited building space', value: ed.unlimited, onChange: (on) => ed.setUnlimited(on) });
  const importFile = () =>
    pickFile((text) => {
      try {
        ed.load(importCraft(text));
        toast(hooks.host, `Imported "${ed.craft.name}".`);
      } catch (err) {
        toast(hooks.host, err instanceof Error ? err.message : 'Could not read that file.');
      }
    });
  const root = h(
    'div',
    { class: 'hangar-toolbar pe' },
    h('div', { class: 'tool-group' }, undo, redo),
    h('div', { class: 'tool-group', 'aria-label': 'Symmetry' }, h('span', { class: 'tool-label', text: 'Symmetry' }), symmetry.el),
    h(
      'div',
      { class: 'tool-group' },
      button({ label: 'New', variant: 'quiet', tip: 'Start an empty craft', onClick: () => (ed.load(newCraft()), toast(hooks.host, 'New craft.')) }),
      button({ label: 'Save', variant: 'quiet', onClick: () => openSave(ed, hooks) }),
      button({ label: 'Load', variant: 'quiet', onClick: () => void openLoad(ed, hooks) }),
      button({ label: 'Examples', variant: 'quiet', onClick: () => openExamples(ed, hooks) }),
      button({ label: 'Import', variant: 'quiet', tip: 'Import a craft file (.json)', onClick: importFile }),
      button({ label: 'Export', variant: 'quiet', tip: 'Download this craft as a .json file', onClick: () => downloadText(`${safeName(ed.craft.name)}.orbital-craft.json`, exportCraft(ed.craft)) }),
    ),
    h('div', { class: 'tool-group' }, h('span', { class: 'tool-label', text: 'Unlimited space' }), cheat.el),
    button({ label: 'Launch', variant: 'primary', tip: 'Roll the craft to the pad', onClick: hooks.onLaunch }),
  );
  return {
    root,
    refresh() {
      (undo as HTMLButtonElement).disabled = !ed.canUndo;
      (redo as HTMLButtonElement).disabled = !ed.canRedo;
      symmetry.set(ed.symmetry);
      cheat.set(ed.unlimited);
    },
  };
}
