/**
 * Hangar side panels: the part palette, the live stats panel with the selected-part inspector, and the staging editor.
 * Each is a small view over the HangarEditor: it rebuilds its contents from the editor state on `refresh()`.
 */
import { h } from '../ui/kit/dom';
import { button, toggle } from '../ui/kit/controls';
import { craftBounds, getPart, type Craft } from './craft';
import type { HangarEditor } from './editor';
import { fmtDuration, fmtDv, fmtLength, fmtMass, fmtThrust, fmtTwr } from './format';
import { LIMITS, adviceFor, limitViolations } from './limits';
import { PART_LIBRARY, partDef } from './part-library';
import { CATEGORY_LABELS, type PartCategory } from './part-types';
import { stageParts } from './staging';
import { computeStats } from './stats';

export interface Panel {
  root: HTMLElement;
  refresh(): void;
}

// --------------------------------------------------------------------------- palette

export function createPalette(ed: HangarEditor): Panel {
  let category: PartCategory | 'all' = 'command';
  let query = '';
  const search = h('input', { class: 'hangar-search', type: 'search', placeholder: 'Search parts', 'aria-label': 'Search parts' });
  const chips = h('div', { class: 'hangar-chips' });
  const list = h('div', { class: 'hangar-parts', role: 'list' });
  const cats = Object.keys(CATEGORY_LABELS) as PartCategory[];

  const drawChips = () => {
    chips.replaceChildren(
      ...(['all', ...cats] as const).map((c) =>
        h('button', { type: 'button', class: `hangar-chip${category === c ? ' is-on' : ''}`, text: c === 'all' ? 'All' : CATEGORY_LABELS[c], onclick: () => ((category = c), drawChips(), drawList()) }),
      ),
    );
  };
  const drawList = () => {
    const q = query.trim().toLowerCase();
    const parts = PART_LIBRARY.filter((p) => (category === 'all' || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q)));
    list.replaceChildren(
      ...parts.map((p) => {
        const active = ed.tool?.kind === 'part' && ed.tool.def === p.id;
        const bits = [fmtMass(p.dryMass + (p.propellant?.mass ?? 0))];
        if (p.engine) bits.push(fmtThrust(p.engine.thrustVac), `${p.engine.ispVac} s`);
        else if (p.propellant) bits.push(`${fmtMass(p.propellant.mass)} fuel`);
        else bits.push(`Ø ${(p.radius * 2).toFixed(2)} m`);
        return h(
          'button',
          { type: 'button', role: 'listitem', class: `part-card${active ? ' is-active' : ''}`, tip: p.blurb, onclick: () => ed.setTool(active ? null : { kind: 'part', def: p.id }) },
          h('span', { class: 'part-name', text: p.name }),
          h('span', { class: 'part-meta mono', text: bits.join(' · ') }),
        );
      }),
    );
    if (parts.length === 0) list.append(h('div', { class: 'empty', text: 'No parts match.' }));
  };
  search.addEventListener('input', () => ((query = search.value), drawList()));
  search.addEventListener('keydown', (ev) => ev.stopPropagation()); // typing must not trigger hangar hotkeys
  drawChips();
  drawList();
  const root = h('div', { class: 'hangar-panel hangar-palette pe' }, h('h3', { class: 'section-title', text: 'Parts' }), search, chips, list);
  return { root, refresh: drawList };
}

// --------------------------------------------------------------------------- stats

const row = (k: string, v: string, cls = ''): HTMLElement => h('div', { class: `stat-row ${cls}` }, h('span', { text: k }), h('span', { class: 'mono', text: v }));

export interface StatsHooks {
  getShowMarkers(): boolean;
  setShowMarkers(on: boolean): void;
}

export function createStatsPanel(ed: HangarEditor, hooks: StatsHooks): Panel {
  const name = h('input', { class: 'hangar-name', type: 'text', maxlength: '48', 'aria-label': 'Craft name' });
  name.addEventListener('change', () => ed.rename(name.value));
  name.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') name.blur();
  });
  const body = h('div', { class: 'hangar-stats-body' });
  const markers = toggle({ label: 'Show centre of mass and pressure', value: hooks.getShowMarkers(), onChange: hooks.setShowMarkers });
  const inspector = h('div', { class: 'hangar-inspector' });

  const refresh = () => {
    const c = ed.craft;
    if (document.activeElement !== name) name.value = c.name;
    const s = computeStats(c);
    const b = c.parts.length ? craftBounds(c) : null;
    const violations = ed.unlimited ? [] : limitViolations(c);
    const rows: HTMLElement[] = [
      row('Parts', `${s.partCount} / ${ed.unlimited ? '∞' : LIMITS.maxParts}`),
      row('Mass', `${fmtMass(s.wetMass)} wet · ${fmtMass(s.dryMass)} dry`),
      row('Size', b ? `${fmtLength(b.max[1] - b.min[1])} tall` : '—'),
      row('Δv', `${fmtDv(s.dvVac)} vacuum · ${fmtDv(s.dvSL)} sea level`, 'is-key'),
      row('TWR', `${fmtTwr(s.twrSL)} sea level · ${fmtTwr(s.twrVac)} vacuum`, s.twrSL > 0 && s.twrSL < 1 ? 'is-bad' : 'is-key'),
    ];
    if (s.stabilityMargin !== null) rows.push(row('Stability', `${s.stabilityMargin >= 0 ? '+' : ''}${s.stabilityMargin.toFixed(2)} m (CoM ${s.stabilityMargin >= 0 ? 'above' : 'below'} CoP)`));

    const table = h(
      'table',
      { class: 'stage-table mono' },
      h('thead', null, h('tr', null, ...['Stage', 'Δv vac', 'TWR', 'Burn'].map((t) => h('th', { text: t })))),
      h(
        'tbody',
        null,
        ...s.stages.map((st) =>
          h(
            'tr',
            { class: st.engines === 0 && st.dvVac === 0 ? 'is-idle' : '' },
            h('td', { text: String(st.index) }),
            h('td', { text: st.dvVac > 0 ? Math.round(st.dvVac).toLocaleString('en-US') : '—' }),
            h('td', { text: st.thrustVac > 0 ? `${fmtTwr(st.twrSL)} / ${fmtTwr(st.twrVac)}` : '—' }),
            h('td', { text: fmtDuration(st.burnTime) }),
          ),
        ),
      ),
    );
    const advice = [...violations.map((t) => ({ level: 'warning', text: t })), ...adviceFor(c)];
    body.replaceChildren(
      ...rows,
      s.stages.length ? table : h('div', { class: 'empty', text: 'Add engines and tanks to see stages.' }),
      ...advice.map((a) => h('div', { class: `advice advice--${a.level}`, text: a.text })),
      h('div', { class: 'stat-row' }, h('span', { text: 'Show CoM / CoP' }), markers.el),
    );
    drawInspector(ed, inspector, c);
  };
  const root = h('div', { class: 'hangar-panel hangar-stats pe' }, name, body, inspector);
  return { root, refresh };
}

function drawInspector(ed: HangarEditor, el: HTMLElement, c: Craft): void {
  const inst = ed.selected ? getPart(c, ed.selected) : undefined;
  if (!inst) {
    el.replaceChildren(h('div', { class: 'hint-line', text: 'Click a part to select it. Pick one from the list to place it.' }));
    return;
  }
  const d = partDef(inst.def);
  const lines: string[] = [fmtMass(d.dryMass + (d.propellant ? d.propellant.mass * inst.fill : 0))];
  if (d.engine) lines.push(`${fmtThrust(d.engine.thrustSL)} SL / ${fmtThrust(d.engine.thrustVac)} vac`, `Isp ${d.engine.ispSL}/${d.engine.ispVac} s`);
  if (d.propellant) lines.push(`${fmtMass(d.propellant.mass * inst.fill)} propellant`);
  if (ed.selection.length > 1) lines.push(`${ed.selection.length} linked copies`);
  const side = inst.parentNode === 'surface';
  const actions = h(
    'div',
    { class: 'inspector-actions' },
    button({ label: '⟲', variant: 'quiet', tip: 'Turn left (Q)', onClick: () => ed.rotateSelection(Math.PI / 12) }),
    button({ label: '⟳', variant: 'quiet', tip: 'Turn right (E)', onClick: () => ed.rotateSelection(-Math.PI / 12) }),
    button({ label: '↑', variant: 'quiet', tip: 'Slide up (R)', disabled: !side, onClick: () => ed.offsetSelection(0.1) }),
    button({ label: '↓', variant: 'quiet', tip: 'Slide down (F)', disabled: !side, onClick: () => ed.offsetSelection(-0.1) }),
    button({ label: 'Copy', variant: 'quiet', tip: 'Copy (Ctrl+C), then paste with Ctrl+V', onClick: () => ed.copySelection() && ed.beginPaste() }),
    button({ label: 'Delete', variant: 'danger', tip: 'Delete with everything attached beyond it (Del)', onClick: () => ed.deleteSelection() }),
  );
  const parts: HTMLElement[] = [h('div', { class: 'inspector-title', text: d.name }), h('div', { class: 'part-meta mono', text: lines.join(' · ') }), actions];
  if (d.propellant) {
    const fill = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(inst.fill * 100)), class: 'hangar-fill', 'aria-label': 'Propellant loaded' });
    fill.addEventListener('change', () => ed.setFill(Number(fill.value) / 100));
    parts.push(h('label', { class: 'inspector-fill' }, h('span', { text: 'Fuel loaded' }), fill));
  }
  el.replaceChildren(...parts);
}

// --------------------------------------------------------------------------- staging

export function createStagingPanel(ed: HangarEditor): Panel {
  const list = h('div', { class: 'staging-list' });
  const auto = button({ label: 'Auto', variant: 'quiet', tip: 'Work out the staging from the rocket\'s structure', onClick: () => ed.autoStaging() });
  const head = h('div', { class: 'staging-head' }, h('h3', { class: 'section-title', text: 'Staging' }), auto);
  let dragged: { kind: 'part'; id: string } | { kind: 'stage'; index: number } | null = null;

  const dropZone = (el: HTMLElement, onDrop: () => void) => {
    el.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      el.classList.add('is-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-over'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('is-over');
      onDrop();
    });
  };

  const refresh = () => {
    const groups = stageParts(ed.craft);
    auto.classList.toggle('is-on', !ed.craft.manualStaging);
    const stages = groups.map((members, i) => {
      const chips = members.map((p) => {
        const chip = h('span', { class: `stage-chip${ed.selection.includes(p.id) ? ' is-selected' : ''}`, draggable: 'true', text: partDef(p.def).name, tip: 'Drag to another stage' });
        chip.addEventListener('dragstart', (ev) => {
          dragged = { kind: 'part', id: p.id };
          ev.dataTransfer?.setData('text/plain', p.id);
        });
        chip.addEventListener('click', () => ed.select(p.id));
        return chip;
      });
      const grip = h('span', { class: 'stage-grip', draggable: 'true', text: `Stage ${i}`, tip: 'Drag to reorder stages' });
      grip.addEventListener('dragstart', (ev) => {
        dragged = { kind: 'stage', index: i };
        ev.dataTransfer?.setData('text/plain', `stage-${i}`);
      });
      const box = h('div', { class: 'stage-box' }, h('div', { class: 'stage-title' }, grip, h('span', { class: 'stage-sub', text: i === 0 ? 'launch' : '' })), h('div', { class: 'stage-chips' }, ...chips));
      dropZone(box, () => {
        if (dragged?.kind === 'part') ed.setStage(dragged.id, i);
        else if (dragged?.kind === 'stage') ed.reorderStage(dragged.index, i);
        dragged = null;
      });
      return box;
    });
    const fresh = h('div', { class: 'stage-box stage-new', text: 'Drop here for a new stage' });
    dropZone(fresh, () => {
      if (dragged?.kind === 'part') ed.setStage(dragged.id, groups.length);
      dragged = null;
    });
    list.replaceChildren(...stages, groups.length ? fresh : h('div', { class: 'empty', text: 'Engines, decouplers and parachutes appear here.' }));
  };
  return { root: h('div', { class: 'hangar-panel hangar-staging pe' }, head, list), refresh };
}
