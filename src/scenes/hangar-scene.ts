import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  GridHelper,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardNodeMaterial,
  MOUSE,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { craftBounds, getPart } from '../builder/craft';
import { CraftRepository } from '../builder/craft-store';
import type { Placement } from '../builder/edit';
import { HangarEditor, type Tool } from '../builder/editor';
import { starterCraft } from '../builder/examples';
import { createToolbar, toast } from '../builder/hangar-dialogs';
import { createPalette, createStagingPanel, createStatsPanel, type Panel } from '../builder/hangar-panels';
import { CraftView } from '../builder/hangar-view';
import { PartFactory } from '../builder/part-meshes';
import { partDef } from '../builder/part-library';
import { computeStats } from '../builder/stats';
import { findStackSnap, surfaceFromHit } from '../builder/snap';
import type { AppContext, GameScene } from '../core/scene-manager';
import { disposeTree } from '../render/dispose';
import { button } from '../ui/kit/controls';
import { h } from '../ui/kit/dom';
import { HintCard } from '../ui/hint-card';
import { openCheats } from '../ui/cheats/cheats-panel';
import { isModalOpen } from '../ui/kit/modal';

const CLICK_SLOP = 5; // px: less movement than this between press and release is a click, not a camera drag

const HINT_IDLE = 'Pick a part from the list  ·  click a part to select it  ·  right-drag orbit  ·  middle-drag pan  ·  wheel zoom  ·  Del delete  ·  Ctrl+Z undo  ·  C centres';
const HINT_PLACING = 'Click to place  ·  Q E turn  ·  F flip  ·  X symmetry  ·  Esc cancel  ·  right-drag orbit';

/**
 * The Hangar: build rockets from parts. This class owns the 3D scene, the camera and the pointer/keyboard handling; the rules
 * live in HangarEditor and the panels are views over it.
 */
export class HangarScene implements GameScene {
  readonly id = 'hangar' as const;

  private scene = new Scene();
  private camera!: PerspectiveCamera;
  private controls!: OrbitControls;
  private editor!: HangarEditor;
  private view!: CraftView;
  private canvas!: HTMLCanvasElement;
  private panels: Panel[] = [];
  private hint = h('div', { class: 'hangar-hint', text: HINT_IDLE });
  private root = h('div', { class: 'hangar-ui' });
  private unsubscribe: Array<() => void> = [];
  private ndc = new Vector2(2, 2); // off-screen until the pointer enters
  private downAt: { x: number; y: number; button: number } | null = null;
  private showMarkers = true;
  private framedRevision = -1;
  private pointerInside = false;
  private escToMenu: () => void = () => undefined;
  private pmrem: PMREMGenerator | null = null;
  private onKey = (ev: KeyboardEvent): void => this.handleKey(ev);
  private ctx!: AppContext;
  private hints!: HintCard;

  enter(ctx: AppContext, ui: HTMLElement): void {
    this.canvas = ctx.gfx.canvas;
    const bg = new Color(0x05070b);
    this.scene.background = bg;
    this.scene.fog = new FogExp2(bg, 0.007);
    this.buildStage(ctx);

    this.camera = new PerspectiveCamera(ctx.settings.get().graphics.fov, 16 / 9, 0.1, 600);
    this.camera.position.set(-17, 9, 23);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 140;
    this.controls.maxPolarAngle = MathUtils.degToRad(92);
    this.controls.rotateSpeed = ctx.settings.get().controls.mouseSensitivity;
    // Left button places and selects; right drag orbits, middle drag pans.
    this.controls.mouseButtons = { LEFT: -1 as MOUSE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };

    const factory = new PartFactory();
    this.view = new CraftView(factory);
    this.scene.add(this.view.root);

    this.editor = new HangarEditor(HangarEditor.restore(localStorage) ?? starterCraft(), localStorage);
    this.editor.setUnlimited(ctx.cheats.get().unlimitedBuild);
    this.ctx = ctx;
    ctx.music.setMood('hangar');
    const repo = new CraftRepository();
    const stats = createStatsPanel(this.editor, { getShowMarkers: () => this.showMarkers, setShowMarkers: (on) => this.setMarkers(on) });
    const palette = createPalette(this.editor);
    const staging = createStagingPanel(this.editor);
    const toolbar = createToolbar(this.editor, {
      repo,
      host: this.root,
      onLaunch: () => void ctx.scenes.goto('flight'),
    });
    this.panels = [palette, stats, staging, toolbar];

    const bar = h('div', { class: 'scene-bar' }, button({ label: '← Menu', variant: 'quiet', tip: 'Back to main menu (Esc when nothing is selected)', onClick: () => void ctx.scenes.goto('menu') }), h('h1', { text: 'Hangar' }));
    this.root.append(bar, toolbar.root, palette.root, h('div', { class: 'hangar-right' }, stats.root, staging.root), this.hint);
    ui.append(this.root);

    ctx.gfx.setView(this.scene, this.camera, { bloom: { strength: 0.12, radius: 0.5, threshold: 1.6 } });
    this.unsubscribe.push(
      ctx.settings.subscribe((next, prev) => {
        if (next.graphics.fov !== prev.graphics.fov) {
          this.camera.fov = next.graphics.fov;
          this.camera.updateProjectionMatrix();
        }
        this.controls.rotateSpeed = next.controls.mouseSensitivity;
      }),
      this.editor.onChange(() => this.onEditorChange()),
      ctx.cheats.subscribe((next) => {
        if (next.unlimitedBuild !== this.editor.unlimited) this.editor.setUnlimited(next.unlimitedBuild);
      }),
    );
    this.hints = new HintCard(ctx.settings);
    ui.append(this.hints.root);
    this.hints.root.classList.add('hint-card--bottom');
    if (ctx.settings.get().gameplay.hints && !this.hints.seen.has('hangar')) setTimeout(() => this.hints.show('hangar'), 1200);

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKey);
    this.escToMenu = () => void ctx.scenes.goto('menu');
    this.onEditorChange();
  }

  private buildStage(ctx: AppContext): void {
    const floor = new Mesh(new CircleGeometry(60, 96), new MeshStandardNodeMaterial({ color: 0x0b0e14, metalness: 0.1, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this.scene.add(floor, new GridHelper(80, 80, 0x4a5b72, 0x1b2430));

    const key = new DirectionalLight(0xfff1e0, 3.2);
    key.position.set(-14, 22, 16);
    const rim = new DirectionalLight(0x8fb4ff, 2.0);
    rim.position.set(18, 10, -20);
    this.scene.add(key, rim, new HemisphereLight(0x8aa3c7, 0x0a0d12, 0.7), new AmbientLight(0x1a2230, 0.6));

    // Image-based lighting makes the metals read as metal. If it cannot be built the direct lights above still carry the scene.
    try {
      this.pmrem = new PMREMGenerator(ctx.gfx.renderer);
      this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
    } catch {
      /* no environment map */
    }
  }

  // ------------------------------------------------------------------ editor -> view

  private onEditorChange(): void {
    const ed = this.editor;
    if (ed.unlimited !== this.ctx.cheats.get().unlimitedBuild) this.ctx.cheats.setCheat('unlimitedBuild', ed.unlimited);
    this.view.sync(ed.craft);
    this.view.setSelection(ed.selection);
    const stats = computeStats(ed.craft);
    this.view.setMarkers(stats.com, stats.cop, this.showMarkers);
    for (const p of this.panels) p.refresh();
    this.hint.textContent = ed.tool ? HINT_PLACING : HINT_IDLE;
    this.canvas.style.cursor = ed.tool ? 'crosshair' : 'default';
    this.updateGhost();
    if (this.framedRevision !== ed.loadRevision) this.frameCraft();
  }

  private setMarkers(on: boolean): void {
    this.showMarkers = on;
    const stats = computeStats(this.editor.craft);
    this.view.setMarkers(stats.com, stats.cop, on);
  }

  /** Aim the camera at the craft from a pleasant angle, far enough to see all of it. */
  private frameCraft(): void {
    const c = this.editor.craft;
    this.framedRevision = this.editor.loadRevision;
    if (c.parts.length === 0) {
      this.controls.target.set(0, 2, 0);
      this.camera.position.set(-8, 5, 11);
      return;
    }
    const b = craftBounds(c);
    const height = b.max[1] - b.min[1];
    const width = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    const size = Math.max(height, width * 1.5, 6);
    this.controls.target.set(0, height * 0.5, 0);
    const dist = ((size * 0.75) / Math.tan(MathUtils.degToRad(this.camera.fov / 2))) * 1.15;
    this.camera.position.set(-dist * 0.55, height * 0.55 + dist * 0.1, dist * 0.8);
  }

  // ------------------------------------------------------------------ pointer

  private aim = (r: Raycaster): void => r.setFromCamera(this.ndc, this.camera);

  private setNdc(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private onPointerMove = (ev: PointerEvent): void => {
    this.pointerInside = true;
    this.setNdc(ev);
    if (this.editor.tool) this.updateGhost();
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
    this.view.clearGhosts();
  };

  private onPointerDown = (ev: PointerEvent): void => {
    this.downAt = { x: ev.clientX, y: ev.clientY, button: ev.button };
  };

  private onPointerUp = (ev: PointerEvent): void => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP) return;
    this.setNdc(ev);
    if (d.button === 0) this.leftClick();
    else if (d.button === 2 && this.editor.tool) this.editor.setTool(null); // right click cancels placing
  };

  private onContextMenu = (ev: Event): void => ev.preventDefault();

  private leftClick(): void {
    const ed = this.editor;
    if (ed.tool) {
      const pl = this.currentPlacement();
      if (!pl) return;
      const ids = ed.place(pl);
      if (ids.length === 0) {
        const why = ed.preview(pl).reason;
        if (why) toast(this.root, why);
      }
      return;
    }
    const hit = this.view.pick(this.aim);
    ed.select(hit?.partId ?? null);
  }

  // ------------------------------------------------------------------ placement

  /** Where the current tool would go, given where the pointer is. */
  private currentPlacement(): Placement | null {
    const ed = this.editor;
    const tool: Tool = ed.tool;
    if (!tool || !this.pointerInside) return null;
    const defId = tool.kind === 'part' ? tool.def : ed.clipboard?.parts[0]?.def;
    if (!defId) return null;
    if (ed.craft.parts.length === 0) return tool.kind === 'part' ? { kind: 'root', def: defId } : null;
    const def = partDef(defId);
    const ray = this.view.rayInCraftFrame(this.aim);
    const reach = Math.max(0.8, def.radius * 0.9);
    const stack = findStackSnap(ed.craft, defId, ray, reach, ed.ghostFlipped);
    if (def.surface) {
      // Boosters hang on the ends of radial decouplers; everything else bolts to the side of what is under the pointer.
      if (stack && stack.target.nodeId === 'outer') return stack;
      const hit = this.view.pick(this.aim);
      const parent = hit ? getPart(ed.craft, hit.partId) : undefined;
      if (hit && parent && partDef(parent.def).hostsSurface) return surfaceFromHit(ed.craft, defId, hit.partId, hit.point);
      return null;
    }
    return stack;
  }

  private updateGhost(): void {
    const ed = this.editor;
    if (!ed.tool || !this.pointerInside) {
      this.view.clearGhosts();
      return;
    }
    const pl = this.currentPlacement();
    if (!pl) {
      this.view.clearGhosts();
      return;
    }
    const pv = ed.preview(pl);
    if (pv.parts.length === 0) this.view.clearGhosts();
    else this.view.showGhosts(pv.parts, pv.ok ? 'ok' : 'bad');
  }

  // ------------------------------------------------------------------ keyboard

  private handleKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (isModalOpen() || target?.closest('input,textarea,select,[contenteditable="true"]')) return;
    const ed = this.editor;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const turn = ev.shiftKey ? Math.PI / 4 : Math.PI / 12;
    if (ev.code === this.ctx.settings.get().controls.bindings.cheats) {
      ev.preventDefault();
      openCheats(this.ctx);
      return;
    }
    switch (ev.code) {
      case 'Escape':
        if (ed.tool) ed.setTool(null);
        else if (ed.selection.length) ed.select(null);
        else this.escToMenu();
        return;
      case 'Delete':
      case 'Backspace':
        ev.preventDefault();
        ed.deleteSelection();
        return;
      case 'KeyZ':
        if (ctrl) {
          ev.preventDefault();
          if (ev.shiftKey) ed.redo();
          else ed.undo();
        }
        return;
      case 'KeyY':
        if (ctrl) {
          ev.preventDefault();
          ed.redo();
        }
        return;
      case 'KeyC':
        if (ctrl) {
          if (ed.copySelection()) toast(this.root, 'Copied. Ctrl+V to place a copy.');
        } else {
          this.setMarkers(!this.showMarkers);
          this.panels.forEach((p) => p.refresh());
        }
        return;
      case 'KeyV':
        if (ctrl && !ed.beginPaste()) toast(this.root, 'Nothing copied yet.');
        return;
      case 'KeyQ':
      case 'KeyE': {
        const sign = ev.code === 'KeyQ' ? 1 : -1;
        if (ed.tool) {
          ed.ghostYaw += sign * turn;
          this.updateGhost();
        } else ed.rotateSelection(sign * turn);
        return;
      }
      case 'KeyR':
        if (!ed.tool) ed.offsetSelection(0.1);
        return;
      case 'KeyF':
        if (ed.tool) {
          ed.ghostFlipped = !ed.ghostFlipped;
          this.updateGhost();
        } else ed.offsetSelection(-0.1);
        return;
      case 'KeyX':
        ed.cycleSymmetry();
        return;
      case 'Home':
        this.frameCraft();
        return;
      default:
    }
  }

  // ------------------------------------------------------------------ frame loop

  update(): void {
    this.controls.update();
    this.view.refreshSelection();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    this.hints?.dispose();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.style.cursor = '';
    this.unsubscribe.forEach((fn) => fn());
    this.controls.dispose();
    this.view.dispose();
    this.scene.environment?.dispose();
    this.pmrem?.dispose();
    disposeTree(this.scene);
    this.root.remove();
  }
}

