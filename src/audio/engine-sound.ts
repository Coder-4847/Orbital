/**
 * Procedural engine and wind sound: filtered noise whose loudness follows thrust and whose pitch and body follow ambient
 * pressure (a deep roar at sea level, a thin hiss in vacuum), plus a low rumble and wind from airspeed. It plays through the
 * shared audio manager, so the effects and ambience volume settings apply.
 */
import type { AudioManager } from './audio-manager';

export class EngineSound {
  private roar: GainNode | null = null;
  private rumble: GainNode | null = null;
  private wind: GainNode | null = null;
  private roarFilter: BiquadFilterNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private nodes: AudioNode[] = [];

  constructor(private readonly audio: AudioManager) {
    audio.whenReady(() => this.build());
  }

  private noise(ctx: AudioContext): AudioBufferSourceNode {
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.28; // brownish noise: more low end than white
      data[i] = last;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  private build(): void {
    const ctx = this.audio.ctx;
    const effects = this.audio.bus('effects');
    const ambience = this.audio.bus('ambience');
    if (!ctx || !effects || !ambience) return;
    const chain = (type: BiquadFilterType, freq: number, bus: GainNode): { gain: GainNode; filter: BiquadFilterNode } => {
      const src = this.noise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(bus);
      src.start();
      this.sources.push(src);
      this.nodes.push(filter, gain);
      return { gain, filter };
    };
    const roar = chain('lowpass', 900, effects);
    this.roar = roar.gain;
    this.roarFilter = roar.filter;
    this.rumble = chain('lowpass', 90, effects).gain;
    this.wind = chain('bandpass', 700, ambience).gain;
  }

  /**
   * `thrust` 0..1 relative loudness of what is burning, `pressure` fraction of sea level, `airspeed` m/s, `density` kg/m^3.
   * `camera` distance factor 0..1 (1 = close).
   */
  update(thrust: number, pressure: number, airspeed: number, density: number, closeness = 1): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.roar || !this.rumble || !this.wind || !this.roarFilter) return;
    const t = ctx.currentTime;
    const body = 0.35 + 0.65 * pressure; // in vacuum the plume is quiet: you only hear it through the structure
    this.roar.gain.setTargetAtTime(Math.min(1, thrust) * body * 0.9 * closeness, t, 0.08);
    this.roarFilter.frequency.setTargetAtTime(500 + 1800 * (1 - pressure) + 600 * thrust, t, 0.2);
    this.rumble.gain.setTargetAtTime(Math.min(1, thrust) * 0.8 * (0.4 + 0.6 * pressure), t, 0.15);
    this.wind.gain.setTargetAtTime(Math.min(0.5, (density * airspeed * airspeed) / 60000) * closeness, t, 0.2);
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    for (const n of this.nodes) n.disconnect();
    this.sources = [];
    this.nodes = [];
    this.roar = this.rumble = this.wind = null;
  }
}
