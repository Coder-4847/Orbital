/**
 * The Hangar's editing session: the craft, undo history, selection, the part being placed, symmetry, clipboard and the
 * build-limit cheat. No DOM and no rendering, so every rule is unit-tested; the scene and panels are thin views over this.
 */
import { cloneCraft, getPart, newCraft, parseCraft, removePart, serializeCraft, symmetrySet, type Craft, type V3 } from './craft';
import { copySubtree, offsetPart, pasteSubtree, placePart, rotatePart, type Clipboard, type Placement } from './edit';
import { History } from './history';
import { limitViolations } from './limits';
import { partDef } from './part-library';
import { autoStage, moveStage, setPartStage, syncStaging } from './staging';

export type Tool = { kind: 'part'; def: string } | { kind: 'paste' } | null;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SYMMETRY_STEPS = [1, 2, 3, 4, 6, 8] as const;
export const AUTOSAVE_KEY = 'orbital.craft.autosave';
export const UNLIMITED_KEY = 'orbital.cheat.unlimitedBuild';

export interface Preview {
  parts: Array<{ def: string; pos: V3; yaw: number; flip: boolean }>;
  ok: boolean;
  reason: string | null;
}

export class HangarEditor {
  craft: Craft;
  selection: string[] = [];
  symmetry = 1;
  tool: Tool = null;
  clipboard: Clipboard | null = null;
  /** Extra turn (radians) applied to a part about to be stacked; flips which end of a part joins when both would fit. */
  ghostYaw = 0;
  ghostFlipped = false;
  /** Cheat: lift the hangar's part-count, size and mass limits. */
  unlimited: boolean;
  /** Bumped whenever a different craft is loaded (not on undo), so views know to re-frame the camera. */
  loadRevision = 0;

  private readonly history: History;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Craft = newCraft(), private readonly store?: KeyValueStore) {
    this.craft = initial;
    this.history = new History(initial);
    this.unlimited = store?.getItem(UNLIMITED_KEY) === '1';
  }

  /** The craft saved automatically last time, if any. */
  static restore(store: KeyValueStore): Craft | null {
    const text = store.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    try {
      return parseCraft(text);
    } catch {
      return null;
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** Record the current craft as an undo step, keep staging consistent, autosave and tell the views. */
  private commit(): void {
    syncStaging(this.craft);
    this.history.push(this.craft);
    this.autosave();
    this.emit();
  }

  private autosave(): void {
    try {
      this.store?.setItem(AUTOSAVE_KEY, serializeCraft(this.craft));
    } catch {
      /* storage full or unavailable: the craft is still safe in memory */
    }
  }

  // ------------------------------------------------------------ tools and symmetry

  /** Pick a part to place (null cancels). */
  setTool(tool: Tool): void {
    this.tool = tool;
    this.ghostYaw = 0;
    this.ghostFlipped = false;
    this.emit();
  }

  setSymmetry(n: number): void {
    this.symmetry = n;
    this.emit();
  }

  cycleSymmetry(): void {
    const i = SYMMETRY_STEPS.indexOf(this.symmetry as (typeof SYMMETRY_STEPS)[number]);
    this.setSymmetry(SYMMETRY_STEPS[(i + 1) % SYMMETRY_STEPS.length]!);
  }

  setUnlimited(on: boolean): void {
    this.unlimited = on;
    try {
      this.store?.setItem(UNLIMITED_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.emit();
  }

  // ------------------------------------------------------------ placement

  private apply(c: Craft, pl: Placement): string[] {
    let ids: string[];
    if (this.tool?.kind === 'paste' && this.clipboard) ids = pasteSubtree(c, this.clipboard, pl);
    else ids = placePart(c, pl, this.symmetry);
    if (ids.length > 0 && this.ghostYaw !== 0 && pl.kind === 'stack') rotatePart(c, ids[0]!, this.ghostYaw);
    return ids;
  }

  /** What would happen if the current tool were placed at `pl` (without changing the craft). */
  preview(pl: Placement): Preview {
    const trial = cloneCraft(this.craft);
    const ids = this.apply(trial, pl);
    if (ids.length === 0) return { parts: [], ok: false, reason: null };
    const parts = ids.map((id) => getPart(trial, id)!).map((p) => ({ def: p.def, pos: p.pos, yaw: p.yaw, flip: p.flip }));
    const over = this.unlimited ? [] : limitViolations(trial);
    return { parts, ok: over.length === 0, reason: over[0] ?? null };
  }

  /** Place the current tool at `pl`. Returns the new part ids, or [] if it does not fit or breaks the limits. */
  place(pl: Placement): string[] {
    const pv = this.preview(pl);
    if (!pv.ok) return [];
    const ids = this.apply(this.craft, pl);
    if (ids.length === 0) return [];
    this.selection = ids;
    this.commit();
    return ids;
  }

  // ------------------------------------------------------------ selection and editing

  select(id: string | null): void {
    this.selection = id && getPart(this.craft, id) ? symmetrySet(this.craft, id) : [];
    this.emit();
  }

  get selected(): string | null {
    return this.selection[0] ?? null;
  }

  deleteSelection(): boolean {
    const id = this.selected;
    if (!id) return false;
    removePart(this.craft, id);
    this.selection = [];
    this.commit();
    return true;
  }

  rotateSelection(dyaw: number): boolean {
    const id = this.selected;
    if (!id || !rotatePart(this.craft, id, dyaw)) return false;
    this.commit();
    return true;
  }

  offsetSelection(dy: number): boolean {
    const id = this.selected;
    if (!id || !offsetPart(this.craft, id, dy)) return false;
    this.commit();
    return true;
  }

  copySelection(): boolean {
    const id = this.selected;
    const clip = id ? copySubtree(this.craft, id) : null;
    if (!clip) return false;
    this.clipboard = clip;
    this.emit();
    return true;
  }

  /** Start pasting the clipboard: the next click places it. */
  beginPaste(): boolean {
    if (!this.clipboard) return false;
    this.setTool({ kind: 'paste' });
    return true;
  }

  setFill(fraction: number): void {
    for (const id of this.selection) {
      const p = getPart(this.craft, id);
      if (p && partDef(p.def).propellant) p.fill = Math.min(1, Math.max(0, fraction));
    }
    this.commit();
  }

  // ------------------------------------------------------------ staging

  setStage(partId: string, stage: number): void {
    setPartStage(this.craft, partId, stage);
    this.commit();
  }

  reorderStage(from: number, to: number): void {
    moveStage(this.craft, from, to);
    this.commit();
  }

  autoStaging(): void {
    autoStage(this.craft);
    this.commit();
  }

  // ------------------------------------------------------------ history and files

  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  undo(): boolean {
    const c = this.history.undo();
    if (!c) return false;
    this.craft = c;
    this.selection = [];
    this.autosave();
    this.emit();
    return true;
  }

  redo(): boolean {
    const c = this.history.redo();
    if (!c) return false;
    this.craft = c;
    this.selection = [];
    this.autosave();
    this.emit();
    return true;
  }

  /** Replace the craft (new, loaded, imported or an example). Starts a fresh undo history. */
  load(craft: Craft): void {
    this.craft = craft;
    this.selection = [];
    this.tool = null;
    this.history.reset(craft);
    this.loadRevision++;
    this.autosave();
    this.emit();
  }

  rename(name: string): void {
    const clean = name.trim() || 'Untitled craft';
    if (clean === this.craft.name) return;
    this.craft.name = clean;
    this.commit();
  }
}
