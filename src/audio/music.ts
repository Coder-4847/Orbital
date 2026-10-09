/**
 * Ambient music, composed on the fly: slow modal chords on a warm synthesised pad, an occasional soft bell, and a deep
 * drone, all through a long reverb. It never repeats exactly and never gets loud. The harmony (which chord follows which) is
 * plain, testable logic; the sound is made with Web Audio oscillators.
 */
import type { AudioManager } from './audio-manager';

/** A tiny seeded random generator, so the same seed always composes the same piece. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** MIDI note to frequency (A4 = 440 Hz = note 69). */
export const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export interface Chord {
  name: string;
  /** Semitones above the key's root for the bass note and the upper voices. */
  bass: number;
  voices: number[];
}

/** The chord palette: D Aeolian / Dorian colours, all of which sit well after one another. */
export const CHORDS: readonly Chord[] = [
  { name: 'Dm9', bass: 0, voices: [12, 15, 19, 26] },
  { name: 'Bbmaj7', bass: -4, voices: [8, 12, 15, 19].map((n) => n + 0) },
  { name: 'Fmaj7', bass: 3, voices: [12, 16, 19, 24] },
  { name: 'Gm9', bass: 5, voices: [12, 15, 19, 26] },
  { name: 'Csus2', bass: -2, voices: [12, 14, 19, 24] },
  { name: 'Am7', bass: 7, voices: [12, 15, 19, 22] },
  { name: 'Ebmaj7#11', bass: -3, voices: [7, 12, 15, 21] },
  { name: 'Dsus2', bass: 0, voices: [12, 14, 19, 21] },
];

/** Which chords may follow which (indexes into CHORDS): a gentle drift rather than a fixed loop. */
const FOLLOWS: readonly number[][] = [
  [1, 2, 3, 4, 7],
  [0, 2, 3, 6],
  [0, 1, 3, 5],
  [0, 4, 5, 7],
  [0, 1, 2, 7],
  [0, 3, 2, 4],
  [0, 3, 5],
  [0, 1, 2, 3],
];

/** Pick the chord after `current`. */
export function nextChord(current: number, random: () => number): number {
  const options = FOLLOWS[current] ?? [0];
  return options[Math.floor(random() * options.length)]!;
}

/** The root of the key as a MIDI note (D3). */
export const KEY_ROOT = 50;

export type Mood = 'menu' | 'flight' | 'hangar';

const MOOD_LEVEL: Record<Mood, number> = { menu: 1, hangar: 0.8, flight: 0.65 };
const MOOD_BELLS: Record<Mood, number> = { menu: 0.7, hangar: 0.45, flight: 0.3 };

export class MusicPlayer {
  private mood: Mood = 'menu';
  private duck = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chord = 0;
  private readonly random = rng(Math.floor(Math.random() * 1e9));
  private out: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private running = false;

  constructor(private readonly audio: AudioManager) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.audio.whenReady(() => this.build());
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    this.applyLevel();
  }

  /** Make the music duck under loud sounds (0 = none, 1 = nearly silent). */
  setDuck(amount: number): void {
    this.duck = Math.max(0, Math.min(0.85, amount));
    this.applyLevel();
  }

  private applyLevel(): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.out) return;
    this.out.gain.setTargetAtTime(MOOD_LEVEL[this.mood] * (1 - this.duck), ctx.currentTime, 0.8);
  }

  private build(): void {
    const ctx = this.audio.ctx;
    const bus = this.audio.bus('music');
    if (!ctx || !bus || this.out) return;
    this.out = ctx.createGain();
    this.out.connect(bus);
    // a long, dark reverb made from decaying noise
    const length = Math.floor(ctx.sampleRate * 4.5);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2;
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(reverb).connect(wet).connect(this.out);
    this.applyLevel();
    this.schedule(0.5);
  }

  private schedule(inSeconds: number): void {
    this.timer = setTimeout(() => {
      if (!this.running) return;
      this.playChord();
      this.schedule(14 + this.random() * 7);
    }, inSeconds * 1000);
  }

  private playChord(): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.out || !this.reverbSend) return;
    this.chord = nextChord(this.chord, this.random);
    const c = CHORDS[this.chord]!;
    const t0 = ctx.currentTime + 0.05;
    const hold = 17;
    this.voice(midiToHz(KEY_ROOT + c.bass - 12), t0, hold, 0.11, 'sine', 300);
    for (const v of c.voices) {
      const f = midiToHz(KEY_ROOT + v + c.bass);
      this.voice(f, t0 + this.random() * 1.2, hold, 0.032, 'sawtooth', 900);
      this.voice(f * 1.004, t0 + this.random() * 1.2, hold, 0.026, 'triangle', 1400);
    }
    // sparse bells from the chord's tones, an octave or two up
    const bells = this.random() < MOOD_BELLS[this.mood] ? 1 + Math.floor(this.random() * 3) : 0;
    for (let i = 0; i < bells; i++) {
      const note = KEY_ROOT + c.bass + c.voices[Math.floor(this.random() * c.voices.length)]! + 12 * (1 + Math.floor(this.random() * 2));
      this.bell(midiToHz(note), t0 + 2 + this.random() * 11);
    }
  }

  /** A pad voice: slow attack, long release, lowpassed, with a little slow vibrato. */
  private voice(freq: number, t0: number, hold: number, level: number, type: OscillatorType, cutoff: number): void {
    const ctx = this.audio.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18 + this.random() * 0.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * 0.0025;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(level, t0 + 5);
    gain.gain.setValueAtTime(level, t0 + hold - 6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + hold + 5);
    osc.connect(filter).connect(gain);
    gain.connect(this.out!);
    gain.connect(this.reverbSend!);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + hold + 6);
    lfo.stop(t0 + hold + 6);
  }

  private bell(freq: number, t0: number): void {
    const ctx = this.audio.ctx!;
    for (const [mult, level, decay] of [[1, 0.05, 5], [2.76, 0.012, 2.5], [5.4, 0.006, 1.2]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(level, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(gain);
      gain.connect(this.out!);
      gain.connect(this.reverbSend!);
      osc.start(t0);
      osc.stop(t0 + decay + 0.1);
    }
  }
}
