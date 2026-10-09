/** Burn guidance and the orbit cheat: small pieces of flight logic that read the world and the navigator, with no drawing. */
import { fmtCountdown } from './format-time';
import type { FlightWorld } from './flight-world';
import type { HudState } from './hud';
import { burnEstimate, nodeMagnitude } from './maneuver';
import { vlen, vscale } from './math3';
import type { Navigator } from './navigator';

/**
 * Keep the maneuver direction for SAS up to date and retire a node whose burn is done.
 * Returns a message when a node was completed.
 */
export function guideBurn(world: FlightWorld, nav: Navigator, now: number): string | null {
  const node = nav.activeNode();
  world.maneuverDir = null;
  if (!node || !world.active) return null;
  nav.refresh(now, 0.25);
  const rem = nav.remainingBurn(node);
  if (!rem) return null;
  const m = vlen(rem);
  if (m > 0.05) world.maneuverDir = vscale(rem, 1 / m);
  if (node.ut < world.ut && m < 0.3) {
    nav.removeNode(node.id);
    return 'Maneuver complete.';
  }
  return null;
}

/** What the HUD says about the node being flown. */
export function nodeInfo(world: FlightWorld, nav: Navigator): HudState['node'] {
  const node = nav.activeNode();
  const v = world.active;
  if (!node || !v) return null;
  const eta = node.ut - world.ut;
  const dv = nodeMagnitude(node);
  const burn = burnEstimate(v).burnTime(dv);
  const burnText = Number.isFinite(burn) ? `burn ${fmtCountdown(burn)}` : 'burn: no engine or more than one stage';
  const rem = nav.remainingBurn(node);
  return {
    text: eta > 0 ? `Node in ${fmtCountdown(eta)} · Δv ${dv.toFixed(0)} m/s · ${burnText}` : `Maneuver underway · Δv ${dv.toFixed(0)} m/s`,
    remaining: rem && eta < (Number.isFinite(burn) ? burn / 2 : 0) + 120 ? `${vlen(rem).toFixed(1)} m/s` : null,
  };
}
