/** Keeps the flight guide card (ui/flight/guide-panel) in step with the flight: which step, whether it shows, the switch in Settings. */
import type { AppContext } from '../core/scene-manager';
import { formatLength } from '../core/units';
import type { FlightWorld } from '../flight/flight-world';
import { guide, GUIDE_COVERS } from '../flight/guide';
import { guideState } from '../flight/hint-state';
import type { HintState } from '../flight/hints';
import { GuidePanel } from '../ui/flight/guide-panel';
import { openHowToPlay } from '../ui/help/how-to-play';

export class FlightGuide {
  readonly panel: GuidePanel;
  /** The vessel has been in a stable orbit during this flight: a low periapsis afterwards means coming home, not still climbing. */
  private reachedOrbit = false;

  constructor(private readonly ctx: AppContext) {
    this.panel = new GuidePanel({
      help: () => openHowToPlay(ctx, 'orbit'),
      hide: () => this.toggle(),
      bindings: () => ctx.settings.get().controls.bindings,
    });
  }

  get enabled(): boolean {
    return this.ctx.settings.get().gameplay.guide;
  }

  /** Hints that would only repeat the card: treated as seen while it is on. */
  get covers(): readonly string[] {
    return this.enabled ? GUIDE_COVERS : [];
  }

  toggle(): void {
    this.ctx.settings.patch('gameplay', { guide: !this.enabled });
  }

  /** A new flight on the pad. */
  reset(): void {
    this.reachedOrbit = false;
  }

  /** `hint` is null when there is no vessel left to guide. */
  update(world: FlightWorld, hint: HintState | null, mapOpen: boolean, fuelLeft: number): void {
    const s = hint ? guideState(world, hint, this.reachedOrbit, fuelLeft) : null;
    this.panel.show(this.enabled && !!s && !mapOpen);
    if (!s) return;
    if (s.bodyId !== 'earth' || (s.periapsis > s.atmosphereTop + 3000 && Number.isFinite(s.apoapsis) && s.apoapsis > s.periapsis)) this.reachedOrbit = true;
    if (s.situation === 'rest' && !s.everLiftedOff) this.reachedOrbit = false;
    const units = this.ctx.settings.get().gameplay.units;
    // Whole kilometres read better in a sentence than the HUD's "100.0 km".
    const fmt = (m: number): string => (units === 'metric' && Math.abs(m) >= 10_000 && Math.abs(m) < 1e6 ? `${Math.round(m / 1000)} km` : formatLength(m, units));
    this.panel.update(guide({ ...s, reachedOrbit: this.reachedOrbit }, fmt));
  }
}
