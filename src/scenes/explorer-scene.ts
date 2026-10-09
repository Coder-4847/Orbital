import { MathUtils, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three/webgpu';
import { BODIES } from '../data/solar-system';
import type { AppContext, GameScene } from '../core/scene-manager';
import { MAX_FLIGHT_WARP_INDEX, MAX_WARP_INDEX, WARP_RATES, clampWarpIndex } from '../core/warp';
import { createDebugOverlay, type OverlayInfo } from '../flight/debug-overlay';
import { adaptExposure, targetExposure } from '../flight/exposure';
import { FreeCamera, type CameraEnvironment } from '../flight/free-camera';
import { MapView } from '../flight/map-view';
import { applyPreset } from '../flight/presets';
import { placeLookingAt } from '../flight/teleport';
import { createTimePanel } from '../flight/time-panel';
import type { Planet } from '../render/planet';
import { SkyBackdrop } from '../render/sky-backdrop';
import { SolarSystem } from '../render/solar-system';
import { buildSceneChrome } from '../ui/scene-chrome';

/** Reversed-Z float depth makes this 1e14 range workable: 10 cm near plane, far beyond Pluto's orbit. */
const NEAR = 0.1;
const FAR = 1e13;

/** Real current time at launch, as universal time (seconds since J2000). */
const nowUT = (): number => (Date.now() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 1000;

/**
 * The explorer: a free-fly camera and a map over the whole real-scale solar system. It is the "Explorer" entry in the main menu;
 * flying a rocket is the 'flight' scene.
 */
export class ExplorerScene implements GameScene {
  readonly id = 'explorer' as const;

  private ctx!: AppContext;
  private scene = new Scene();
  private camera!: PerspectiveCamera;
  private system!: SolarSystem;
  private sky = new SkyBackdrop();
  private free!: FreeCamera;
  private map!: MapView;
  private overlay = createDebugOverlay();
  private chrome!: { dispose(): void };
  private timePanel!: ReturnType<typeof createTimePanel>;
  private unsubscribe: Array<() => void> = [];
  private onKey!: (ev: KeyboardEvent) => void;

  private ut = nowUT();
  private warpIndex = 0;
  private exposure = 1;
  /** Set by teleports: the next exposure update jumps straight to its target instead of adapting. */
  private snapExposure = true;
  private overlayTimer = 0;
  private viewport = { width: 1, height: 1 };
  private env: CameraEnvironment = { altitude: 1e7, up: new Vector3(0, 1, 0), nearSurface: false };
  private nearest!: Planet;
  private altitudeAboveTerrain = 0;
  private bodyIndex = 3; // Tab cycles from Earth
  private readonly localPos = new Vector3();
  private readonly localQuat = new Quaternion();
  private readonly inverse = new Quaternion();
  /** Where the flight camera was when the map opened, relative to the nearest body, so it can be restored. */
  private savedFlight: { id: string; local: Vector3; locked: boolean; quat: Quaternion } | null = null;

  async enter(ctx: AppContext, ui: HTMLElement): Promise<void> {
    ctx.music.setMood('menu');
    this.ctx = ctx;
    const g = ctx.settings.get().graphics;
    this.camera = new PerspectiveCamera(g.fov, 16 / 9, NEAR, FAR);
    this.scene.add(this.sky);
    this.system = await SolarSystem.create(ctx.gfx.renderer, this.scene, g.terrainDetail, g.cloudQuality);
    this.nearest = this.system.get('earth');

    this.free = new FreeCamera(ctx.gfx.canvas);
    this.free.sensitivity = ctx.settings.get().controls.mouseSensitivity;
    this.free.invertY = ctx.settings.get().controls.invertY;

    // Start on Earth's day side, in orbit.
    this.system.advance(this.ut);
    this.teleport(1);

    ctx.gfx.setView(this.scene, this.camera, { bloom: { strength: 0.12, radius: 0.4, threshold: 6 }, compose: this.system.atmosphere.compose });
    this.unsubscribe.push(
      ctx.settings.subscribe((next, prev) => {
        if (next.graphics.fov !== prev.graphics.fov) {
          this.camera.fov = next.graphics.fov;
          this.camera.updateProjectionMatrix();
        }
        if (next.graphics.terrainDetail !== prev.graphics.terrainDetail) this.system.setTerrainDetail(next.graphics.terrainDetail);
        if (next.graphics.cloudQuality !== prev.graphics.cloudQuality) this.system.setAtmosphereQuality(next.graphics.cloudQuality);
        this.free.sensitivity = next.controls.mouseSensitivity;
        this.free.invertY = next.controls.invertY;
      }),
    );

    const chrome = buildSceneChrome('Explorer', '', () => void ctx.scenes.goto('menu'));
    this.chrome = chrome;
    chrome.root.querySelector('.scene-note')?.remove();

    this.map = new MapView({ system: this.system, scene: this.scene, camera: this.camera, ui, surface: ctx.gfx.canvas, onGoto: (id) => this.goTo(id) });
    this.timePanel = createTimePanel({
      getUT: () => this.ut,
      setUT: (t) => (this.ut = t),
      getWarpIndex: () => this.warpIndex,
      setWarpIndex: (i) => (this.warpIndex = clampWarpIndex(i, this.maxWarpIndex())),
      maxWarpIndex: () => this.maxWarpIndex(),
    });
    ui.append(chrome.root, this.timePanel.root, this.overlay.root);

    this.onKey = (ev) => this.handleKey(ev);
    window.addEventListener('keydown', this.onKey);
  }

  private maxWarpIndex(): number {
    return this.map?.active ? MAX_WARP_INDEX : MAX_FLIGHT_WARP_INDEX;
  }

  private handleKey(ev: KeyboardEvent): void {
    if ((ev.target as HTMLElement | null)?.closest?.('input,textarea,select,[role="dialog"]')) return;
    if (ev.repeat) return;
    const shift = ev.shiftKey;
    switch (ev.code) {
      case 'F3':
        ev.preventDefault();
        this.overlay.toggle();
        break;
      case 'KeyM':
        this.toggleMap();
        break;
      case 'Tab':
        if (!this.map.active) {
          ev.preventDefault();
          this.bodyIndex = (this.bodyIndex + (shift ? BODIES.length - 1 : 1)) % BODIES.length;
          this.goTo(BODIES[this.bodyIndex]!.id);
        }
        break;
      case 'Comma':
        this.warpIndex = clampWarpIndex(this.warpIndex - 1, this.maxWarpIndex());
        break;
      case 'Period':
        this.warpIndex = clampWarpIndex(this.warpIndex + 1, this.maxWarpIndex());
        break;
      case 'Slash':
        this.warpIndex = 0;
        break;
      case 'BracketLeft':
        this.ut -= shift ? 86400 : 3600;
        break;
      case 'BracketRight':
        this.ut += shift ? 86400 : 3600;
        break;
      case 'KeyG':
        this.free.groundCollision = !this.free.groundCollision;
        break;
      default:
        if (!this.map.active && /^Digit[0-9]$/.test(ev.code)) this.teleport(Number(ev.code.slice(5)));
    }
  }

  private toggleMap(): void {
    if (!this.map.active) {
      this.captureFlight();
      this.free.enabled = false;
      document.exitPointerLock?.();
      this.map.enter(this.free.position, this.nearest.id);
      this.overlay.root.classList.add('is-map');
    } else {
      this.map.exit();
      this.overlay.root.classList.remove('is-map');
      this.free.enabled = true;
      this.warpIndex = clampWarpIndex(this.warpIndex, MAX_FLIGHT_WARP_INDEX);
      this.restoreFlight();
    }
  }

  /** Remember the flight camera relative to its nearest body (surface-fixed when close), so closing the map returns there. */
  private captureFlight(): void {
    const b = this.nearest;
    const locked = this.altitudeAboveTerrain < b.radius * 0.4;
    const local = new Vector3().copy(this.free.position).sub(b.position);
    const quat = new Quaternion().copy(this.free.orientation);
    if (locked) {
      this.inverse.copy(b.orientation).invert();
      local.applyQuaternion(this.inverse);
      quat.premultiply(this.inverse);
    }
    this.savedFlight = { id: b.id, local, locked, quat };
  }

  private restoreFlight(): void {
    const s = this.savedFlight;
    if (!s) return;
    const b = this.system.get(s.id);
    this.free.position.copy(s.local);
    this.free.orientation.copy(s.quat);
    if (s.locked) {
      this.free.position.applyQuaternion(b.orientation);
      this.free.orientation.premultiply(b.orientation);
    }
    this.free.position.add(b.position);
  }

  /** Leave the map (if open) and fly to a viewpoint on a body. */
  private goTo(id: string): void {
    if (this.map.active) {
      this.map.exit();
      this.overlay.root.classList.remove('is-map');
      this.free.enabled = true;
      this.warpIndex = clampWarpIndex(this.warpIndex, MAX_FLIGHT_WARP_INDEX);
    }
    this.system.advance(this.ut);
    this.snapExposure = true;
    placeLookingAt(this.free, this.system.get(id), id === 'sun' ? 5 : 4);
    this.bodyIndex = BODIES.findIndex((b) => b.id === id);
  }

  /** Preset viewpoints (keys 0-9) that exercise every scale; see flight/presets.ts. */
  private teleport(n: number): void {
    this.snapExposure = true;
    const host = {
      ut: this.ut,
      system: this.system,
      camera: this.camera,
      free: this.free,
      viewportHeight: this.viewport.height,
      goTo: (id: string) => this.goTo(id),
    };
    applyPreset(n, host);
    this.ut = host.ut;
  }

  update(dt: number, elapsed: number): void {
    const warp = WARP_RATES[this.warpIndex]!;
    this.ut += dt * warp;
    this.viewport.width = this.ctx.gfx.width;
    this.viewport.height = this.ctx.gfx.height;

    if (this.map.active) {
      this.system.advance(this.ut);
      const camPos = this.map.update(dt, this.ut, this.camera, this.viewport);
      this.free.position.copy(camPos);
      this.free.orientation.copy(this.camera.quaternion);
      this.updateEnvironment();
    } else {
      this.updateEnvironment();
      this.free.update(dt, this.env);

      // Reference frame: glue the camera to the nearest body's surface frame when close (so the ground does not slide
      // past at 465 m/s on Earth, or the Moon drift away at 1 km/s), and let it follow the body's translation within
      // ~30 body radii. Bodies are advanced to the new time and the camera is re-expressed in the same frame.
      const anchor = this.nearest;
      const locked = this.altitudeAboveTerrain < anchor.radius * 0.4;
      const follows = anchor.distanceFrom(this.free.position) < anchor.radius * 30;
      if (follows) {
        this.localPos.copy(this.free.position).sub(anchor.position);
        if (locked) {
          this.localPos.applyQuaternion(this.inverse.copy(anchor.orientation).invert());
          this.localQuat.copy(this.inverse).multiply(this.free.orientation);
        }
      }
      this.system.advance(this.ut);
      if (follows) {
        if (locked) {
          this.free.position.copy(this.localPos).applyQuaternion(anchor.orientation).add(anchor.position);
          this.free.orientation.copy(anchor.orientation).multiply(this.localQuat);
        } else {
          this.free.position.copy(this.localPos).add(anchor.position);
        }
      }
      this.camera.position.set(0, 0, 0);
      this.camera.quaternion.copy(this.free.orientation);
    }

    if (!this.ctx.gfx.reversedDepth) this.fitDepthRange();
    this.system.place(this.camera, this.free.position, elapsed, this.viewport.height);
    this.system.atmosphere.updateCamera(this.camera);
    this.updateExposure(dt);

    this.timePanel.update();
    this.overlayTimer -= dt;
    if (this.overlayTimer <= 0) {
      this.overlayTimer = 0.2;
      this.overlay.update(this.collectInfo(warp));
    }
  }

  /**
   * Fallback for a standard (non-reversed) depth buffer, which cannot span 0.1 m .. 1e13 m: keep near proportional to
   * altitude and far just beyond the Moon, and scale the sky backdrop so it stays inside the far plane. (Planets farther
   * than `far` are not drawn in this fallback; their point markers are.)
   */
  private fitDepthRange(): void {
    const near = MathUtils.clamp(this.env.altitude * 0.05, 0.2, 5e5);
    const far = 1.2e9;
    if (Math.abs(near - this.camera.near) / near > 0.05) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.sky.setDistanceScale((far * 0.45) / 5e10);
  }

  /** Altitude/up relative to the closest surface, for camera speed and collision. */
  private updateEnvironment(): void {
    let best: Planet = this.system.get('earth');
    let bestAlt = Infinity;
    for (const p of this.system.planets) {
      const d = p.distanceFrom(this.free.position);
      let alt = d - p.radius;
      if (alt < 200_000 && p.def.render === 'terrain') alt -= p.surfaceHeightUnder(this.free.position);
      if (alt < bestAlt) {
        bestAlt = alt;
        best = p;
      }
    }
    this.nearest = best;
    this.altitudeAboveTerrain = bestAlt;
    this.env.altitude = Math.max(bestAlt, 0.1);
    this.env.up.subVectors(this.free.position, best.position).normalize();
    // Only solid worlds stop you: you can dive into a gas giant or the Sun.
    this.env.nearSurface = bestAlt < 50_000 && best.def.render === 'terrain';
  }

  private updateExposure(dt: number): void {
    const p = this.nearest;
    const target = targetExposure({
      isStar: p.def.kind === 'star',
      atmosphereHeight: p.atmosphere ? p.atmosphere.def.topRadius - p.atmosphere.def.radius : 0,
      bodyRadius: p.radius,
      altitude: this.env.altitude,
      sinSun: this.env.up.dot(p.uniforms.sunDir.value),
      irradianceScale: this.system.irradianceScale(p),
    });
    this.exposure = adaptExposure(this.exposure, target, dt, this.snapExposure);
    this.snapExposure = false;
    this.ctx.gfx.exposure.value = this.exposure;
    // Stars would vanish at an exposure set for sunlit Saturn; keep them faintly visible rather than washing out.
    this.sky.setBrightness(Math.min(1, 4 / this.exposure));
  }

  private collectInfo(warp: number): OverlayInfo {
    const ll = this.nearest.lonLatUnder(this.free.position);
    let drawn = 0;
    let resident = 0;
    let pending = 0;
    let bodies = 0;
    for (const p of this.system.planets) {
      if (!p.resolved) continue;
      bodies++;
      drawn += p.terrain.stats.drawn;
      resident += p.terrain.stats.resident;
      pending += p.terrain.stats.pending;
    }
    const loop = this.ctx.loopStats;
    const w = this.system.workerStats;
    const pos = this.free.position;
    return {
      fps: loop.fps,
      frameMs: loop.frameMs,
      gpuMs: this.ctx.gfx.gpuMs,
      backend: this.ctx.gfx.backend,
      body: this.nearest.def.name,
      altitude: this.altitudeAboveTerrain,
      speed: this.free.speed,
      lat: ll.lat,
      lon: ll.lon,
      warp,
      exposure: this.exposure,
      terrain: { drawn, resident, pending, level: this.nearest.terrain.stats.deepestLevel, bodies },
      soi: this.system.ephemeris.dominantBody([pos.x, pos.y, pos.z]),
      atmosphere: this.system.atmosphereBody?.def.name ?? 'none',
      workers: { count: w.workers, avgMs: w.avgMs },
      depth: this.ctx.gfx.reversedDepth ? 'reversed-Z' : 'standard',
    };
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    window.removeEventListener('keydown', this.onKey);
    this.unsubscribe.forEach((fn) => fn());
    this.chrome.dispose();
    this.map.dispose();
    this.free.dispose();
    this.system.dispose();
  }
}
