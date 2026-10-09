/** Turns what happened in the physics world this frame into HUD messages, particles and sounds. */
import type { AudioManager } from '../audio/audio-manager';
import { playEventSound } from '../audio/event-sounds';
import { FlightEffects } from '../flight/effects';
import type { FlightEnv } from '../flight/env';
import type { FlightWorld } from '../flight/flight-world';
import type { FlightHud } from '../flight/hud';
import type { FlightLighting } from '../flight/scene-lighting';

export interface EventHost {
  world: FlightWorld;
  env: FlightEnv;
  effects: FlightEffects;
  lighting: FlightLighting;
  hud: FlightHud;
  audio: AudioManager;
  /** Called when the vessel crossed into another sphere of influence. */
  enteredSoi(): void;
  /** Time warp is on rails (no sounds then). */
  rails: boolean;
}

/** Messages and effects from what happened this frame. */
export function drainFlightEvents(host: EventHost): void {
  const { world, env, effects, hud } = host;
  for (const e of world.events.splice(0)) {
    if (e.kind === 'soi') {
      const [now, was] = (e.text ?? '').split('|');
      hud.message(`Entering ${now}'s sphere of influence (leaving ${was}).`, 'info');
      effects.clear();
      host.lighting.snap = true;
      host.enteredSoi();
      continue;
    }
    const bf = FlightEffects.toBodyFixed(env.planetQuat, e.pos);
    if (!host.rails) playEventSound(host.audio, e.kind, e.size);
    if (e.kind === 'explosion') effects.explosion(bf, [0, 0, 0], e.size);
    else if (e.kind === 'separation') for (let i = 0; i < 6; i++) effects.spawn(true, bf, [Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4], e.size * 0.6, e.size * 1.6, 0.5, 0.8, 2);
    else if (e.kind === 'ignition') effects.spawn(true, bf, [0, 0, 0], e.size * 1.2, e.size * 3, 0.5, 0.9, 1);
    else if (e.kind === 'liftoff') hud.message('Liftoff!');
  }
  for (const v of world.vessels) {
    for (const text of v.log.splice(0)) if (!v.debris) hud.message(text, /Crash|Structural|torn|burned|Crushed/.test(text) ? 'bad' : 'info');
  }
}
