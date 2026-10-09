/**
 * The game's audio: one AudioContext (started by the first click or key press, as browsers require), a master bus and three
 * mixing buses (effects, ambience, music) whose levels follow Settings > Audio, plus a handful of synthesised one-shots for
 * the interface and for events in flight. Everything is generated: there are no sound files.
 */
import type { SettingsStore } from '../save/settings';

export type UiSound = 'click' | 'hover' | 'confirm' | 'back' | 'error' | 'toggle' | 'notify' | 'open';
export type EffectSound = 'stage' | 'separation' | 'ignition' | 'explosion' | 'touchdown' | 'chute' | 'liftoff';

export type Bus = 'effects' | 'ambience' | 'music';

/** Slider position 0..1 to gain: squared, which is closer to how loudness is heard. */
export const volumeToGain = (v: number): number => Math.max(0, Math.min(1, v)) ** 2;

export class AudioManager {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private readyCallbacks: Array<(a: AudioManager) => void> = [];
  private lastHover = 0;
  muted = false;
  /** A noise buffer shared by every noise burst. */
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private readonly settings: SettingsStore) {
    settings.subscribe((next, prev) => {
      if (next.audio !== prev.audio) this.applyVolumes();
    });
  }

  /** Create the context. Safe to call on every user gesture; only the first one does anything. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return; // no audio available: everything stays silent
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.buses = { effects: ctx.createGain(), ambience: ctx.createGain(), music: ctx.createGain() };
      for (const bus of Object.values(this.buses)) bus.connect(this.master);
      this.applyVolumes(true);
      const length = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const callbacks = this.readyCallbacks;
      this.readyCallbacks = [];
      callbacks.forEach((fn) => fn(this));
    }
    void this.ctx.resume();
  }

  /** Run `fn` once the context exists (immediately if it already does). */
  whenReady(fn: (a: AudioManager) => void): void {
    if (this.ctx) fn(this);
    else this.readyCallbacks.push(fn);
  }

  bus(name: Bus): GainNode | null {
    return this.buses?.[name] ?? null;
  }

  private applyVolumes(immediate = false): void {
    if (!this.ctx || !this.master || !this.buses) return;
    const a = this.settings.get().audio;
    const t = this.ctx.currentTime;
    const set = (node: GainNode, value: number) => (immediate ? (node.gain.value = value) : node.gain.setTargetAtTime(value, t, 0.04));
    set(this.master, this.muted ? 0 : volumeToGain(a.master));
    set(this.buses.effects, volumeToGain(a.effects));
    set(this.buses.ambience, volumeToGain(a.ambience));
    set(this.buses.music, volumeToGain(a.music));
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  // ---------------------------------------------------------------- building blocks

  /** A short enveloped tone. `slideTo` glides the pitch. */
  tone(freq: number, duration: number, opts: { type?: OscillatorType; gain?: number; bus?: Bus; slideTo?: number; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    const bus = this.bus(opts.bus ?? 'effects');
    if (!ctx || !bus) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + duration);
    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(bus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** A burst of filtered noise. */
  noise(duration: number, opts: { filter?: BiquadFilterType; freq?: number; freqTo?: number; q?: number; gain?: number; bus?: Bus; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    const bus = this.bus(opts.bus ?? 'effects');
    if (!ctx || !bus || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter ?? 'lowpass';
    filter.frequency.setValueAtTime(opts.freq ?? 800, t0);
    if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, t0 + duration);
    filter.Q.value = opts.q ?? 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + (opts.attack ?? 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(bus);
    src.start(t0, Math.random());
    src.stop(t0 + duration + 0.05);
  }

  // ---------------------------------------------------------------- interface sounds

  ui(kind: UiSound): void {
    if (!this.ctx) return;
    switch (kind) {
      case 'click':
        this.tone(1500, 0.045, { type: 'triangle', gain: 0.07, slideTo: 900 });
        this.noise(0.02, { filter: 'highpass', freq: 3000, gain: 0.025 });
        break;
      case 'hover': {
        const now = performance.now();
        if (now - this.lastHover < 70) return;
        this.lastHover = now;
        this.tone(2600, 0.02, { type: 'sine', gain: 0.018 });
        break;
      }
      case 'confirm':
        this.tone(660, 0.12, { type: 'sine', gain: 0.09 });
        this.tone(990, 0.2, { type: 'sine', gain: 0.08, delay: 0.07 });
        break;
      case 'back':
        this.tone(740, 0.1, { type: 'sine', gain: 0.07, slideTo: 520 });
        break;
      case 'error':
        this.tone(160, 0.18, { type: 'sawtooth', gain: 0.07, slideTo: 110 });
        this.tone(150, 0.18, { type: 'square', gain: 0.03, slideTo: 100, delay: 0.02 });
        break;
      case 'toggle':
        this.tone(1100, 0.05, { type: 'sine', gain: 0.07, slideTo: 1500 });
        break;
      case 'notify':
        this.tone(1320, 0.4, { type: 'sine', gain: 0.07 });
        this.tone(1980, 0.5, { type: 'sine', gain: 0.045, delay: 0.09 });
        break;
      case 'open':
        this.noise(0.18, { filter: 'bandpass', freq: 500, freqTo: 2400, q: 1.2, gain: 0.05, attack: 0.06 });
        break;
    }
  }

  // ---------------------------------------------------------------- flight event sounds

  effect(kind: EffectSound, size = 1): void {
    if (!this.ctx) return;
    const s = Math.min(3, Math.max(0.3, size));
    switch (kind) {
      case 'stage':
        this.tone(95, 0.22, { type: 'square', gain: 0.1, slideTo: 55 });
        this.noise(0.12, { filter: 'lowpass', freq: 1800, gain: 0.18 });
        break;
      case 'separation':
        this.noise(0.09, { filter: 'bandpass', freq: 1200, q: 2, gain: 0.2 });
        this.tone(140, 0.25, { type: 'triangle', gain: 0.1, slideTo: 70 });
        break;
      case 'ignition':
        this.noise(0.9 * s, { filter: 'lowpass', freq: 400, freqTo: 1600, gain: 0.25 * s, attack: 0.12 });
        break;
      case 'explosion':
        this.noise(1.6 * s, { filter: 'lowpass', freq: 1400, freqTo: 120, gain: 0.7, attack: 0.004 });
        this.tone(70, 1.2 * s, { type: 'sine', gain: 0.4, slideTo: 28 });
        break;
      case 'touchdown':
        this.tone(80, 0.3, { type: 'sine', gain: 0.35, slideTo: 40 });
        this.noise(0.25, { filter: 'lowpass', freq: 600, gain: 0.3 });
        break;
      case 'chute':
        this.noise(1.2, { filter: 'bandpass', freq: 300, freqTo: 1800, q: 0.8, gain: 0.3, attack: 0.15 });
        break;
      case 'liftoff':
        this.noise(2.2, { filter: 'lowpass', freq: 250, freqTo: 900, gain: 0.35, attack: 0.5 });
        break;
    }
  }
}
