import { AmbientLight, MathUtils, PerspectiveCamera, PMREMGenerator, Quaternion, Scene, Vector3 } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EngineSound } from '../audio/engine-sound';
import { craftBounds, type Craft } from '../builder/craft';
import { HangarEditor } from '../builder/editor';
import { starterCraft } from '../builder/examples';
import { PartFactory } from '../builder/part-meshes';
import type { AppContext, GameScene, SceneParams } from '../core/scene-manager';
import { DEFAULT_SITE } from '../data/sites';
import type { Planet } from '../render/planet';
import { SkyBackdrop } from '../render/sky-backdrop';
import { SolarSystem } from '../render/solar-system';
import { bodyFlightEnv } from '../flight/body-env';
import { systemHost } from '../flight/earth-env';
import type { FlightEnv } from '../flight/env';
import { bindCameraInput, FlightCamera } from '../flight/flight-camera';
import { applyCommand, hudState, setSasMode } from '../flight/flight-commands';
import { FlightEffects } from '../flight/effects';
import { ExhaustEmitter } from '../flight/exhaust';
import { FlightInput } from '../flight/flight-input';
import { FlightMap, vesselWorldPosition } from '../flight/flight-map';
import { FlightWorld } from '../flight/flight-world';
import { FlightHud } from '../flight/hud';
import { FlightLighting, markShadows } from '../flight/scene-lighting';
import { guideBurn, nodeInfo } from '../flight/guidance';
import { Navigator } from '../flight/navigator';
import { PlasmaEffect } from '../flight/plasma';
import { PlumeFactory } from '../flight/plume';
import { LaunchPad } from '../flight/pad';
import { vnorm } from '../flight/math3';
import { solarTimeAt } from '../flight/teleport';
import type { Vessel } from '../flight/vessel';
import { VesselViews } from '../flight/vessel-view';
import { Warp } from '../flight/warp';
import { createDebugOverlay } from '../flight/debug-overlay';
import { hintState } from '../flight/hint-state';
import { nextHint } from '../flight/hints';
import { openCheats } from '../ui/cheats/cheats-panel';
import { HintCard } from '../ui/hint-card';
import { isModalOpen } from '../ui/kit/modal';
import { openSaveManager } from '../ui/menu/save-manager';
import { openPauseMenu } from '../ui/flight/pause-menu';
import { openHowToPlay } from '../ui/help/how-to-play';
import { openSettings } from '../ui/settings/settings-panel';
import type { FlightExtras } from '../save/flight-state';
import { cheatActions, currentFlags } from './flight-cheats';
import { collectOverlayInfo } from './flight-diagnostics';
import { FlightGuide } from './flight-guide';
import { FlightSaves } from './flight-saves';
import { fitFlightDepth, fitMapDepth, MAP_FAR } from './flight-depth';
import { drainFlightEvents } from './flight-events';
import { navballMarkers, soundLevels, warpText } from './flight-readouts';
import { advanceTime, type Stepper } from './flight-time';

const NEAR = 0.1;
const LOOK_DOWN = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.1);

const nowUT = (): number => (Date.now() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 1000;

/**
 * Flying a rocket: the craft from the Hangar on the launch pad at Kennedy, then anywhere in the solar system. Full vessel physics
 * (up to 4x physics warp), time warp on rails with patched-conic navigation, an orbit map with maneuver nodes, a flight HUD
 * with a navball, three cameras, re-entry plasma and engine sound.
 */
export class FlightScene implements GameScene {
  readonly id = 'flight' as const;

  private ctx!: AppContext;
  private scene = new Scene();
  private camera!: PerspectiveCamera;
  private system!: SolarSystem;
  private world!: FlightWorld;
  private nav!: Navigator;
  private warp = new Warp();
  private sky = new SkyBackdrop();
  private views!: VesselViews;
  private pad!: LaunchPad;
  private effects!: FlightEffects;
  private plasma!: PlasmaEffect;
  private exhaust = new ExhaustEmitter();
  private lighting!: FlightLighting;
  private hud!: FlightHud;
  private input!: FlightInput;
  private sound!: EngineSound;
  private map!: FlightMap;
  private cam = new FlightCamera();
  private plumes!: PlumeFactory;
  private pmrem: PMREMGenerator | null = null;
  private unsubscribe: Array<() => void> = [];
  private disposers: Array<() => void> = [];

  private readonly stepper: Stepper = { accumulator: 0 };
  private lastStageAt = 0;
  private hudTimer = 0;
  private ballTimer = 0;
  private initialFuel = 1;
  private viewport = { width: 1, height: 1 };
  private readonly camWorld = new Vector3();
  private readonly camQuat = new Quaternion();
  private readonly rel = new Vector3();
  private readonly vesselWorld = new Vector3();
  private lost = false;
  private hints!: HintCard;
  private guide!: FlightGuide;
  private saves!: FlightSaves;
  private overlay = createDebugOverlay(null);
  private overlayTimer = 0;
  private hintTimer = 0;
  private launchCraft: Craft | null = null;
  private everLiftedOff = false;
  private enteredSoi = false;
  private lastCheats: unknown = null;
  private lastGameplay: unknown = null;
  private shadowTimer = 0;
  private qualityTimer = 0;

  private get planet(): Planet {
    return this.system.get(this.world.bodyId);
  }
  private get env(): FlightEnv {
    return this.world.env;
  }

  async enter(ctx: AppContext, ui: HTMLElement, params: SceneParams = {}): Promise<void> {
    this.ctx = ctx;
    const g = ctx.settings.get().graphics;
    this.camera = new PerspectiveCamera(g.fov, 16 / 9, NEAR, MAP_FAR);
    this.scene.add(this.sky, new AmbientLight(0x000000, 0));
    this.system = await SolarSystem.create(ctx.gfx.renderer, this.scene, g.terrainDetail, g.cloudQuality);
    try {
      this.pmrem = new PMREMGenerator(ctx.gfx.renderer);
      this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch {
      /* direct lights alone */
    }

    this.plumes = new PlumeFactory();
    this.views = new VesselViews(this.scene, new PartFactory(), this.plumes);
    this.pad = new LaunchPad(this.scene, DEFAULT_SITE, this.system.get('earth').radius);
    this.effects = new FlightEffects(this.scene);
    this.plasma = new PlasmaEffect(this.scene);
    this.lighting = new FlightLighting(this.scene, this.sky, this.effects, ctx.gfx.exposure);
    this.input = new FlightInput({
      bindings: () => ctx.settings.get().controls.bindings,
      gamepad: () => ({ enabled: ctx.settings.get().controls.gamepad, deadzone: ctx.settings.get().controls.gamepadDeadzone }),
    });
    this.sound = new EngineSound(ctx.audio);
    ctx.music.setMood('flight');
    this.hints = new HintCard(ctx.settings);
    this.guide = new FlightGuide(ctx);
    this.hud = new FlightHud({
      stage: () => this.command('stage'),
      toggleSas: () => this.command('sas'),
      setSasMode: (m) => this.world.active && setSasMode(this.world.active, m),
      toggleRcs: () => this.command('rcs'),
      toggleGear: () => this.command('gear'),
      toggleBrakes: () => this.command('brakes'),
      chutes: () => this.command('chutes'),
      setThrottle: (t) => this.world.active && (this.world.active.throttle = t),
      cycleCamera: () => this.hud.message(`Camera: ${this.cam.cycle()}`),
      warp: (d) => this.changeWarp(d),
      pause: () => this.pauseMenu(),
      mute: () => this.hud.message(ctx.audio.toggleMute() ? 'Sound off' : 'Sound on'),
      toggleMap: () => this.toggleMap(),
      toggleGuide: () => this.guide.toggle(),
      help: () => !isModalOpen() && openHowToPlay(ctx),
    });
    this.overlay.show(false);
    ui.append(this.hud.root, this.guide.panel.root, this.hints.root, this.overlay.root);
    this.nav = new Navigator(() => this.world);
    this.saves = new FlightSaves({
      ctx,
      system: () => this.system,
      world: () => this.world ?? null,
      nodes: () => this.nav.nodes,
      target: () => this.nav.target,
      craft: () => this.launchCraft,
      initialFuel: () => this.initialFuel,
      cameraMode: () => (this.cam.mode === 'chase' ? 'orbit' : this.cam.mode),
      adopt: (world, extras) => this.adopt(world, extras),
      hasFlown: () => this.everLiftedOff,
      message: (t, l) => this.hud.message(t, l),
    });
    this.map = new FlightMap({
      system: this.system,
      scene: this.scene,
      camera: this.camera,
      ui,
      surface: ctx.gfx.canvas,
      nav: this.nav,
      world: () => this.world,
      warpTo: (ut) => this.warp.warpTo(ut),
      vesselPosition: () => vesselWorldPosition(this.world, this.vesselWorld),
      message: (t) => this.hud.message(t),
      units: () => ctx.settings.get().gameplay.units,
    });
    this.applyQuality();
    if (params.saveId) {
      this.start(); // a fresh pad first, so a failed load still leaves something to fly
      await this.saves.load(params.saveId);
    } else this.start();

    ctx.gfx.setView(this.scene, this.camera, { bloom: { strength: 0.14, radius: 0.45, threshold: 6 }, compose: this.system.atmosphere.compose });
    this.unsubscribe.push(
      ctx.settings.subscribe((next, prev) => {
        if (next.graphics.fov !== prev.graphics.fov) {
          this.camera.fov = next.graphics.fov;
          this.camera.updateProjectionMatrix();
        }
        if (next.graphics.terrainDetail !== prev.graphics.terrainDetail) this.system.setTerrainDetail(next.graphics.terrainDetail);
        if (next.graphics.cloudQuality !== prev.graphics.cloudQuality) this.system.setAtmosphereQuality(next.graphics.cloudQuality);
        // Not in the same frame as a rebuilt post-processing graph: switching shadows on while MSAA comes on too made WebGPU
        // reject the frame ("depth" texture used as attachment and as binding) and the screen stayed black.
        if (next.graphics.shadowQuality !== prev.graphics.shadowQuality || next.graphics.particleScale !== prev.graphics.particleScale) this.qualityTimer = 0.25;
      }),
    );
    this.disposers.push(
      bindCameraInput(ctx.gfx.canvas, this.cam, {
        enabled: () => !this.map.active,
        sensitivity: () => ({ mouse: ctx.settings.get().controls.mouseSensitivity, invertY: ctx.settings.get().controls.invertY }),
      }),
    );
  }

  // ------------------------------------------------------------------ session

  private craft(): Craft {
    const saved = HangarEditor.restore(localStorage);
    return saved && saved.parts.length > 0 ? saved : starterCraft();
  }

  /** (Re)start the flight: a fresh world with the craft on the pad, at about 8:30 local solar time. */
  private start(): void {
    const host = systemHost(this.system);
    const ut = solarTimeAt(nowUT(), DEFAULT_SITE.lon, 8.5, 'earth');
    this.world = new FlightWorld(bodyFlightEnv(host, 'earth'), ut, host);
    this.nav.clearNodes();
    this.nav.setTarget(null);
    this.nav.trajectory = null;
    if (this.map.active) this.toggleMap();
    const up = vnorm(this.pad.frame.center);
    this.launchCraft = this.craft();
    this.everLiftedOff = false;
    this.guide.reset();
    const v = this.world.launch(this.launchCraft, { direction: up, headingDeg: DEFAULT_SITE.heading });
    v.sas.enabled = this.ctx.settings.get().gameplay.sasDefault;
    this.initialFuel = Math.max(1, v.parts.reduce((s, p) => s + (p.def.propellant?.kind === 'solid' ? 0 : p.fuel), 0));
    this.lost = false;
    this.stepper.accumulator = 0;
    this.warp.reset();
    this.cam.mode = 'pad';
    this.fitPad(this.launchCraft);
    this.pad.group.visible = true;
    this.effects.clear();
    this.lighting.snap = true;
    this.hud.setBanner(null);
  }

  /** Size the tower and the pad camera to the rocket. */
  private fitPad(craft: Craft | null): void {
    const b = craft && craft.parts.length > 0 ? craftBounds(craft) : null;
    const height = b ? b.max[1] - b.min[1] + 2 : 20;
    this.cam.distance = Math.max(30, height * 1.8);
    this.cam.rocketHeight = height;
    this.pad.fitTower(height);
  }

  /** A loaded save replaces the running flight. */
  private adopt(world: FlightWorld, extras: FlightExtras): void {
    if (this.map.active) this.toggleMap();
    this.world = world;
    this.launchCraft = extras.craft;
    this.nav.restore(extras.nodes, extras.target);
    this.initialFuel = extras.initialFuel;
    this.everLiftedOff = true;
    this.lost = !world.active;
    this.stepper.accumulator = 0;
    this.warp.reset();
    this.cam.mode = extras.camera === 'pad' && world.bodyId !== 'earth' ? 'orbit' : extras.camera;
    this.fitPad(extras.craft);
    this.effects.clear();
    this.lighting.snap = true;
    this.hud.setBanner(world.active ? null : 'Vessel lost: Esc for options');
  }

  /** The vessel was moved by a cheat: reset what depends on where it is. */
  private moved(onPad: boolean): void {
    this.effects.clear();
    this.lighting.snap = true;
    this.warp.reset();
    this.everLiftedOff = this.everLiftedOff || !onPad;
    this.cam.mode = onPad ? 'pad' : this.cam.mode === 'pad' ? 'orbit' : this.cam.mode;
    this.nav.refresh(performance.now() / 1000, 0, true);
  }

  private command(cmd: Parameters<typeof applyCommand>[2]): void {
    const v = this.world.active;
    if (!v) return;
    if (cmd === 'stage') {
      // A double tap (or a held key repeating) must not throw away the stage that has only just lit.
      const now = performance.now();
      if (now - this.lastStageAt < 700) return;
      this.lastStageAt = now;
    }
    const msg = applyCommand(this.world, v, cmd);
    if (msg) this.hud.message(msg);
  }

  private changeWarp(delta: number): void {
    const msg = this.warp.change(delta, this.nav.railsBlocker());
    if (msg) this.hud.message(msg, 'warn');
  }

  private toggleMap(): void {
    if (this.map.active) {
      this.map.exit();
      this.views.root.visible = true;
    } else {
      this.map.enter(this.camWorld.clone(), this.world.bodyId);
      this.views.root.visible = false;
    }
    this.hud.root.classList.toggle('in-map', this.map.active);
  }

  private pauseMenu(): void {
    if (isModalOpen()) return;
    this.ctx.audio.ui('open');
    openPauseMenu(this.ctx, {
      save: () => this.saveDialog(),
      quicksave: () => void this.saves.quicksave(),
      quickload: () => void this.saves.quickload(),
      settings: () => openSettings(this.ctx),
      cheats: () => this.cheatsMenu(),
      restart: () => this.start(),
      hangar: () => void this.ctx.scenes.goto('hangar'),
      menu: () => void this.ctx.scenes.goto('menu'),
    });
  }

  private saveDialog(): void {
    openSaveManager(this.ctx, {
      saveCurrent: (name, overwriteId) => this.saves.saveNamed(name, overwriteId),
      defaultName: this.world.active?.name ?? 'My flight',
      onLoad: (save) => void this.saves.load(save.id),
    });
  }

  private cheatsMenu(): void {
    if (isModalOpen()) return;
    openCheats(this.ctx, cheatActions({ ctx: this.ctx, world: () => this.world, nav: () => this.nav, moved: (onPad) => this.moved(onPad) }));
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, elapsed: number): void {
    if (!this.world) return;
    const now = performance.now() / 1000;
    const modal = isModalOpen();
    for (const cmd of this.input.drainCommands()) {
      if (cmd === 'pause') this.pauseMenu();
      else if (cmd === 'camera') this.hud.message(`Camera: ${this.cam.cycle()}`);
      else if (cmd === 'warpUp') this.changeWarp(1);
      else if (cmd === 'warpDown') this.changeWarp(-1);
      else if (cmd === 'warpReset') this.warp.reset();
      else if (cmd === 'mute') this.hud.message(this.ctx.audio.toggleMute() ? 'Sound off' : 'Sound on');
      else if (cmd === 'hud') this.hud.root.classList.toggle('is-hidden');
      else if (cmd === 'map') this.toggleMap();
      else if (cmd === 'quicksave' && !modal) void this.saves.quicksave();
      else if (cmd === 'quickload' && !modal) void this.saves.quickload();
      else if (cmd === 'cheats') this.cheatsMenu();
      else if (cmd === 'debug') this.ctx.cheats.setCheat('debugOverlay', !this.ctx.cheats.get().debugOverlay);
      else if (!modal) this.command(cmd);
    }
    this.syncCheats();
    if (this.qualityTimer > 0 && (this.qualityTimer -= dt) <= 0) this.applyQuality();
    const frame = this.input.read(dt);
    const active = this.world.active;
    if (active && !modal) {
      active.controls = frame.controls;
      if (frame.throttleSet !== null) active.throttle = frame.throttleSet;
      active.throttle = MathUtils.clamp(active.throttle + frame.throttleDelta, 0, 1);
    }
    const done = guideBurn(this.world, this.nav, now);
    if (done) this.hud.message(done);
    if (!modal) this.advanceTime(dt, now);
    this.drainEvents();
    if (this.world.active?.situation === 'flying') this.everLiftedOff = true;
    this.saves.tick(dt, modal);
    this.updateHints(dt, modal);

    const focus = this.world.active ?? this.pickFocus();
    if (!focus) return;
    this.viewport.width = this.ctx.gfx.width;
    this.viewport.height = this.ctx.gfx.height;
    const planet = this.planet;
    const onEarth = this.world.bodyId === 'earth';

    if (this.map.active) {
      this.camWorld.copy(this.map.update(dt, this.camera, this.viewport));
      this.camera.position.set(0, 0, 0);
      if (!this.ctx.gfx.reversedDepth) this.fitMapDepth();
    } else {
      this.cam.place(focus, this.env, planet.position, onEarth ? this.pad.frame : null, this.camWorld, this.camQuat);
      this.camera.position.set(0, 0, 0);
      this.camera.quaternion.copy(this.camQuat);
      if (this.cam.mode === 'orbit') this.camera.quaternion.multiply(LOOK_DOWN); // vessel sits above the navball, not behind it
      if (!this.ctx.gfx.reversedDepth) fitFlightDepth(this.camera, this.sky, planet.position, this.camWorld, focus.pos);
    }
    this.system.place(this.camera, this.camWorld, elapsed, this.viewport.height);
    this.system.atmosphere.updateCamera(this.camera);

    this.views.sync(this.world.vessels, (v) => this.rel.set(v.pos[0] + planet.position.x - this.camWorld.x, v.pos[1] + planet.position.y - this.camWorld.y, v.pos[2] + planet.position.z - this.camWorld.z));
    this.pad.group.visible = onEarth;
    if (onEarth) this.pad.update(this.env.planetQuat, planet.position, this.camWorld);
    this.plumes.time.value = elapsed;
    const physics = !this.warp.rails;
    if (physics) this.exhaust.emit(this.world.vessels, this.env, this.effects, dt);
    this.plasma.update(this.world.vessels, this.env, planet.position, this.camWorld, this.effects, dt, physics && !this.map.active);
    this.effects.update(dt, this.env.planetQuat, planet.position, this.camWorld);
    this.lighting.update(focus.pos, this.env, this.world.bodyId, planet.position, dt);
    this.updateHud(dt, focus);
    this.updateSound(focus);
    this.updateOverlay(dt, focus);
    this.updateShadowFlags(dt);
  }

  /** Shadows and particle density follow the graphics settings. */
  private applyQuality(): void {
    const g = this.ctx.settings.get().graphics;
    this.lighting.setShadows(g.shadowQuality, Math.max(25, Math.min(140, this.cam.rocketHeight * 1.1 + 25)));
    this.effects.density = Math.min(1, g.particleScale);
    this.shadowTimer = 0;
  }

  /** Tell every part and pad mesh whether it casts or receives shadows (new vessels appear when stages separate). */
  private updateShadowFlags(dt: number): void {
    this.shadowTimer -= dt;
    if (this.shadowTimer > 0) return;
    this.shadowTimer = 1;
    markShadows(this.ctx.settings.get().graphics.shadowQuality > 0, this.views.root, this.pad.group);
  }

  /** Copy the cheat switches and the safety setting into the physics world when either changed. */
  private syncCheats(): void {
    const cheats = this.ctx.cheats.get();
    const gameplay = this.ctx.settings.get().gameplay;
    if (cheats !== this.lastCheats || gameplay !== this.lastGameplay) {
      this.lastCheats = cheats;
      this.lastGameplay = gameplay;
      this.world.cheats = currentFlags(this.ctx);
      this.overlay.show(cheats.debugOverlay);
    }
    if (this.world.cheats.maxWarp !== currentFlags(this.ctx).maxWarp) this.world.cheats = currentFlags(this.ctx);
  }

  private updateHints(dt: number, modal: boolean): void {
    this.hintTimer -= dt;
    if (this.hintTimer > 0 || modal) return;
    this.hintTimer = 0.3;
    const covered = this.guide.covers;
    const s = hintState(this.world, this.nav, {
      enabled: this.ctx.settings.get().gameplay.hints,
      seen: covered.length > 0 ? new Set([...this.hints.seen, ...covered]) : this.hints.seen,
      busy: this.hints.busy,
      mapOpen: this.map.active,
      enteredSoi: this.enteredSoi,
      atRealTime: this.warp.rate === 1,
      everLiftedOff: this.everLiftedOff,
    });
    this.enteredSoi = false;
    const fuel = this.world.active?.parts.reduce((t, p) => t + (p.def.propellant?.kind === 'solid' ? 0 : p.fuel), 0) ?? 0;
    this.guide.update(this.world, s, this.map.active, fuel / this.initialFuel);
    this.hud.setGuideOn(this.guide.enabled);
    const id = s ? nextHint(s) : null;
    if (id) {
      this.hints.show(id);
      this.ctx.audio.ui('notify');
    }
  }

  private updateOverlay(dt: number, v: Vessel): void {
    if (!this.ctx.cheats.get().debugOverlay) return;
    this.overlayTimer -= dt;
    if (this.overlayTimer > 0) return;
    this.overlayTimer = 0.25;
    this.overlay.update(
      collectOverlayInfo({
        ctx: this.ctx,
        system: this.system,
        planet: this.planet,
        world: this.world,
        vessel: v,
        warpRate: this.warp.rate,
        rails: this.warp.rails,
        exposure: this.lighting.exposure,
        patches: this.nav.trajectory?.patches.length ?? 0,
      }),
    );
  }

  private advanceTime(dt: number, now: number): void {
    for (const m of advanceTime(this.world, this.nav, this.warp, this.stepper, dt, now)) this.hud.message(m.text, m.level);
  }

  private fitMapDepth(): void {
    const v = this.world.active;
    const p = this.planet.position;
    fitMapDepth(this.camera, this.sky, this.camWorld, v ? this.vesselWorld.set(v.pos[0] + p.x, v.pos[1] + p.y, v.pos[2] + p.z) : null);
  }

  private pickFocus(): Vessel | null {
    return this.world.vessels.reduce<Vessel | null>((best, v) => (!best || v.mass.mass > best.mass.mass ? v : best), null);
  }

  /** Messages and effects from what happened this frame, and whether the vessel was lost. */
  private drainEvents(): void {
    drainFlightEvents({
      world: this.world,
      env: this.env,
      effects: this.effects,
      lighting: this.lighting,
      hud: this.hud,
      audio: this.ctx.audio,
      rails: this.warp.rails,
      enteredSoi: () => {
        this.enteredSoi = true;
        if (this.cam.mode === 'pad') this.cam.mode = 'orbit';
        this.nav.refresh(performance.now() / 1000, 0, true);
      },
    });
    const lost = !this.world.active;
    if (lost !== this.lost) {
      this.lost = lost;
      this.hud.setBanner(lost ? 'Vessel lost: Esc for options' : null);
      if (lost) {
        this.hud.message('The command part is gone.', 'bad');
        this.warp.reset();
      }
    }
  }

  private updateHud(dt: number, v: Vessel): void {
    this.hudTimer -= dt;
    this.ballTimer -= dt;
    if (this.hudTimer > 0 && this.ballTimer > 0) return;
    const state = hudState(this.world, v, this.cam.mode, warpText(this.warp), nodeInfo(this.world, this.nav), this.ctx.audio.muted, this.initialFuel, this.ctx.settings.get().gameplay.units);
    this.hud.setCheatBadge(this.ctx.cheats.anyActive);
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.hud.update(state);
    }
    if (this.ballTimer <= 0) {
      this.ballTimer = 1 / 30;
      const f = state.fv;
      const markers = navballMarkers(f, this.world.maneuverDir);
      this.hud.navball.draw(v.q, f, markers);
    }
  }

  private updateSound(v: Vessel): void {
    const l = soundLevels(v, this.env, this.warp.rails, this.cam.mode, this.cam.distance);
    this.sound.update(l.level, l.ratio, l.speed, l.density, l.close);
    this.ctx.music.setDuck(l.level * 0.7 * Math.min(1, l.ratio + 0.3));
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    void this.saves?.autosaveNow();
    this.hints?.hide();
    this.hints?.dispose();
    this.ctx.music.setDuck(0);
    this.unsubscribe.forEach((fn) => fn());
    this.disposers.forEach((fn) => fn());
    this.input?.dispose();
    this.sound?.dispose();
    this.hud?.root.remove();
    this.guide?.panel.root.remove();
    this.map?.dispose();
    this.views?.dispose();
    this.effects?.dispose();
    this.plasma?.dispose();
    this.lighting?.dispose();
    this.pad?.dispose();
    this.scene.environment?.dispose();
    this.pmrem?.dispose();
    this.system?.dispose();
  }
}
