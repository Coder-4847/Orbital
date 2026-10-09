/**
 * Saving and loading a flight for the flight scene: named saves, the quick-save slot, the autosave (every couple of minutes
 * and when leaving), and applying a loaded save. The scene supplies what a save contains and what to do with a loaded one.
 */
import type { Craft } from '../builder/craft';
import type { AppContext } from '../core/scene-manager';
import { systemHost } from '../flight/earth-env';
import type { FlightWorld } from '../flight/flight-world';
import type { ManeuverNode } from '../flight/maneuver';
import { SAVE_SCHEMA_VERSION, type SaveKind, type SaveRecord, type SaveSummary } from '../save/saves';
import { captureFlight, restoreFlight, worldFor, type FlightExtras, type FlightSaveData } from '../save/flight-state';
import type { SolarSystem } from '../render/solar-system';

export const AUTOSAVE_ID = 'autosave';
export const QUICKSAVE_ID = 'quicksave';
export const AUTOSAVE_SECONDS = 120;

export interface SaveHost {
  ctx: AppContext;
  system(): SolarSystem;
  world(): FlightWorld | null;
  nodes(): ManeuverNode[];
  target(): string | null;
  craft(): Craft | null;
  initialFuel(): number;
  cameraMode(): 'orbit' | 'pad' | 'nose';
  /** A save was loaded: switch the scene over to this world. */
  adopt(world: FlightWorld, extras: FlightExtras): void;
  /** Has the vessel left the ground at least once (an untouched pad is not worth an autosave)? */
  hasFlown(): boolean;
  message(text: string, level?: 'info' | 'warn' | 'bad'): void;
}

export class FlightSaves {
  private sinceAuto = 0;
  private busy = false;

  constructor(private readonly host: SaveHost) {}

  /** Write the running flight as a save. `thumbnail` false skips the screenshot (leaving the scene: the frame is black). */
  async save(kind: SaveKind, name: string, id: string = crypto.randomUUID(), thumbnail = true): Promise<SaveSummary> {
    const world = this.host.world();
    if (!world?.active) throw new Error('there is no vessel to save');
    const { ctx } = this.host;
    const data = captureFlight(world, { nodes: this.host.nodes(), target: this.host.target(), craft: this.host.craft(), initialFuel: this.host.initialFuel(), camera: this.host.cameraMode() });
    const image = thumbnail ? ((await ctx.gfx.capture(320)) ?? undefined) : undefined;
    const now = Date.now();
    const existing = await ctx.saves.get(id).catch(() => undefined);
    const rec: SaveRecord = { id, name, kind, schemaVersion: SAVE_SCHEMA_VERSION, createdAt: existing?.createdAt ?? now, updatedAt: now, gameTime: world.ut, thumbnail: image ?? existing?.thumbnail, data };
    await ctx.saves.put(rec);
    const { data: _data, ...summary } = rec;
    void _data;
    return summary;
  }

  /** A save the player names (or overwrites). */
  saveNamed(name: string, overwriteId?: string): Promise<SaveSummary> {
    return this.save('manual', name, overwriteId);
  }

  async quicksave(): Promise<void> {
    try {
      await this.save('quick', 'Quicksave', QUICKSAVE_ID);
      this.host.message('Quick saved.');
      this.host.ctx.audio.ui('confirm');
    } catch (err) {
      this.host.message(`Could not save: ${(err as Error).message}`, 'bad');
    }
  }

  async quickload(): Promise<void> {
    const rec = await this.host.ctx.saves.get(QUICKSAVE_ID).catch(() => undefined);
    if (!rec) return this.host.message('There is no quick save yet: press F5 first.', 'warn');
    await this.load(rec.id);
  }

  /** Called every frame while flying: writes the autosave when it is due. */
  tick(dt: number, paused: boolean): void {
    this.sinceAuto += dt;
    if (this.sinceAuto < AUTOSAVE_SECONDS || paused || this.busy) return;
    this.sinceAuto = 0;
    if (!this.host.hasFlown() || !this.host.world()?.active) return;
    this.busy = true;
    this.save('auto', 'Autosave', AUTOSAVE_ID)
      .catch(() => undefined)
      .finally(() => (this.busy = false));
  }

  /** Leaving the scene: one last autosave (without a picture). */
  async autosaveNow(): Promise<void> {
    if (!this.host.hasFlown() || !this.host.world()?.active) return;
    await this.save('auto', 'Autosave', AUTOSAVE_ID, false).catch(() => undefined);
  }

  /** Load a save into the scene. Returns false (and says why) if it cannot be read. */
  async load(id: string): Promise<boolean> {
    try {
      const rec = await this.host.ctx.saves.get(id);
      if (!rec) throw new Error('that save no longer exists');
      const data = rec.data as FlightSaveData;
      const world = worldFor(data, systemHost(this.host.system()));
      const extras = restoreFlight(data, world);
      this.host.adopt(world, extras);
      this.host.message(`Loaded “${rec.name}”.`);
      this.sinceAuto = 0;
      return true;
    } catch (err) {
      this.host.message(`Could not load: ${(err as Error).message}`, 'bad');
      this.host.ctx.audio.ui('error');
      return false;
    }
  }
}
