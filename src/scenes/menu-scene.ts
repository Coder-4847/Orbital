import { Group, MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { AppContext, GameScene } from '../core/scene-manager';
import { createDemoRocket } from '../render/demo-rocket';
import { SPACE_FAR, SpaceView } from '../render/space-view';
import { openHowToPlay } from '../ui/help/how-to-play';
import { openAbout } from '../ui/menu/dialogs';
import { openSaveManager } from '../ui/menu/save-manager';
import { buildMainMenu } from '../ui/menu/main-menu';
import { openSettings } from '../ui/settings/settings-panel';

const ROCKET_HEIGHT = 14.5;
const ROCKET_SCREEN_FRACTION = 0.46; // share of frame height the hero rocket occupies

/** Main menu: Earth rising over the limb, a rocket in the foreground, slow camera drift. */
export class MenuScene implements GameScene {
  readonly id = 'menu' as const;

  private ctx!: AppContext;
  private space!: SpaceView;
  private camera!: PerspectiveCamera;
  private rocketHolder!: Group;
  private rocket!: Group;
  private unsubscribe: Array<() => void> = [];

  async enter(ctx: AppContext, ui: HTMLElement): Promise<void> {
    this.ctx = ctx;
    this.space = new SpaceView();
    // Sun just above the limb, right of centre: the rocket is rim-lit against the glare, the menu column stays on the night side.
    this.space.setSun(new Vector3(0.3, -0.045, -0.95));

    this.camera = new PerspectiveCamera(ctx.settings.get().graphics.fov, 16 / 9, 0.5, SPACE_FAR);
    this.rocket = createDemoRocket();
    this.rocket.position.y = -ROCKET_HEIGHT / 2;
    this.rocketHolder = new Group();
    this.rocketHolder.add(this.rocket);
    this.camera.add(this.rocketHolder);
    this.space.scene.add(this.camera);

    ctx.gfx.setView(this.space.scene, this.camera, { bloom: { strength: 0.38, radius: 0.25, threshold: 2.4 } });
    this.unsubscribe.push(
      ctx.settings.subscribe((next, prev) => {
        if (next.graphics.fov !== prev.graphics.fov) this.applyFov();
      }),
    );

    const latest = await ctx.saves.latest().catch(() => undefined);
    const hasSaves = !!latest;
    ctx.music.setMood('menu');

    const { root, buttons } = buildMainMenu({
      rendererLabel: ctx.rendererLabel,
      items: [
        { id: 'launch', label: hasSaves ? 'Continue' : 'Launch', hint: hasSaves ? latest.name : undefined, onSelect: () => void ctx.scenes.goto('flight', hasSaves ? { saveId: latest.id } : {}) },
        ...(hasSaves ? [{ id: 'new', label: 'New flight', onSelect: () => void ctx.scenes.goto('flight') }] : []),
        { id: 'hangar', label: 'Hangar', onSelect: () => void ctx.scenes.goto('hangar') },
        { id: 'explorer', label: 'Explorer', onSelect: () => void ctx.scenes.goto('explorer') },
        { id: 'load', label: 'Load game', onSelect: () => openSaveManager(ctx, { onLoad: (s) => void ctx.scenes.goto('flight', { saveId: s.id }) }) },
        { id: 'help', label: 'How to play', onSelect: () => openHowToPlay(ctx) },
        { id: 'settings', label: 'Settings', onSelect: () => openSettings(ctx) },
        { id: 'about', label: 'About', onSelect: () => openAbout(ctx) },
      ],
    });
    ui.appendChild(root);
    buttons.get('launch')?.focus({ preventScroll: true });
  }

  private applyFov(): void {
    this.camera.fov = this.ctx.settings.get().graphics.fov;
    this.layoutRocket();
    this.camera.updateProjectionMatrix();
  }

  /** Keep the rocket at a constant share of the frame, on the right-hand side of wide screens. */
  private layoutRocket(): void {
    const tanHalf = Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    const distance = ROCKET_HEIGHT / ROCKET_SCREEN_FRACTION / (2 * tanHalf);
    const halfWidth = distance * tanHalf * this.camera.aspect;
    const wide = this.camera.aspect > 1.3;
    this.rocketHolder.position.set(wide ? halfWidth * 0.55 : halfWidth * 0.1, wide ? -distance * tanHalf * 0.06 : 0, -distance);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.layoutRocket();
  }

  update(_dt: number, elapsed: number): void {
    // Slow, never-quite-repeating drift: sums of low-frequency sines on yaw/pitch/roll.
    const yaw = Math.sin(elapsed * 0.071) * 0.016 + Math.sin(elapsed * 0.031 + 1.3) * 0.01;
    const pitch = MathUtils.degToRad(-12.5) + Math.sin(elapsed * 0.053 + 0.6) * 0.008;
    const roll = Math.sin(elapsed * 0.037 + 2.1) * 0.012;
    this.camera.rotation.set(pitch, yaw, roll, 'YXZ');

    // Gentle intro: the camera eases in from slightly further back over the first seconds.
    const intro = 1 - Math.exp(-elapsed * 0.55);
    this.camera.position.set(0, 0, (1 - intro) * 6);

    this.rocket.rotation.y = elapsed * 0.05;
    this.rocketHolder.rotation.z = -0.2 + Math.sin(elapsed * 0.09) * 0.02;
    this.rocketHolder.rotation.x = 0.1;

    this.space.update(this.camera, elapsed);
  }

  exit(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe = [];
    this.space.dispose();
  }
}
