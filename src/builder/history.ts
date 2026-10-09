import { cloneCraft, type Craft } from './craft';

/** Undo/redo as a stack of craft snapshots (crafts are small, so snapshots are simpler and safer than commands). */
export class History {
  private readonly past: string[] = [];
  private future: string[] = [];
  private current: string;

  constructor(initial: Craft, private readonly limit = 200) {
    this.current = JSON.stringify(initial);
  }

  /** Record a new state after an edit; clears the redo stack. A no-op edit is ignored. */
  push(c: Craft): void {
    const next = JSON.stringify(c);
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }

  /** Replace the whole history (after loading a different craft). */
  reset(c: Craft): void {
    this.past.length = 0;
    this.future = [];
    this.current = JSON.stringify(c);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): Craft | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return JSON.parse(prev) as Craft;
  }

  redo(): Craft | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return JSON.parse(next) as Craft;
  }

  snapshot(): Craft {
    return cloneCraft(JSON.parse(this.current) as Craft);
  }
}
