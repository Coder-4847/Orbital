export interface LoopStats {
  fps: number;
  frameMs: number;
}

export interface LoopHandlers {
  /** Fixed-step simulation tick (physics lives here from Phase 5). */
  fixed(dt: number): void;
  /** Once per rendered frame; `dt` is the real elapsed time, clamped. */
  frame(dt: number): void;
}

/**
 * requestAnimationFrame loop with an optional frame cap and a fixed-step accumulator.
 * dt is clamped so a backgrounded tab does not produce one enormous step on return.
 */
export class GameLoop {
  static readonly FIXED_DT = 1 / 120;
  private static readonly MAX_FRAME_DT = 0.1;
  private static readonly MAX_SUBSTEPS = 8;

  readonly stats: LoopStats = { fps: 0, frameMs: 0 };

  /** 0 = uncapped (display refresh rate). */
  frameCap = 0;

  private running = false;
  private rafId = 0;
  private last = 0;
  private accumulator = 0;
  private fpsFrames = 0;
  private fpsClock = 0;

  constructor(private handlers: LoopHandlers) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const elapsed = now - this.last;
    // Skip this vsync if we are ahead of the cap (small tolerance avoids aliasing at 60/120).
    if (this.frameCap > 0 && elapsed < 1000 / this.frameCap - 1.5) return;
    this.last = now;

    const dt = Math.min(elapsed / 1000, GameLoop.MAX_FRAME_DT);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= GameLoop.FIXED_DT && steps < GameLoop.MAX_SUBSTEPS) {
      this.handlers.fixed(GameLoop.FIXED_DT);
      this.accumulator -= GameLoop.FIXED_DT;
      steps++;
    }
    if (steps === GameLoop.MAX_SUBSTEPS) this.accumulator = 0; // spiral-of-death guard

    const t0 = performance.now();
    this.handlers.frame(dt);
    this.stats.frameMs += (performance.now() - t0 - this.stats.frameMs) * 0.1;

    this.fpsFrames++;
    this.fpsClock += dt;
    if (this.fpsClock >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsClock;
      this.fpsFrames = 0;
      this.fpsClock = 0;
    }
  };
}
