/** Maps the flight physics' events to the synthesised one-shot sounds. */
import type { AudioManager } from './audio-manager';

export function playEventSound(audio: AudioManager, kind: string, size: number): void {
  if (kind === 'explosion') audio.effect('explosion', size / 4);
  else if (kind === 'separation') audio.effect('separation');
  else if (kind === 'ignition') audio.effect('ignition', size / 3);
  else if (kind === 'liftoff') audio.effect('liftoff');
  else if (kind === 'touchdown') audio.effect('touchdown');
  else if (kind === 'chute') audio.effect('chute');
}
