import { Sprite, SpriteNodeMaterial, AdditiveBlending, Vector3, Vector4, type PerspectiveCamera, type Scene, type Texture, type WebGPURenderer } from 'three/webgpu';
import { exp, float, length, uv, vec2, vec3 } from 'three/tsl';
import { ATMOSPHERES } from '../data/atmospheres';
import { AU, BODIES } from '../data/solar-system';
import { Ephemeris } from '../physics/ephemeris';
import { BODY_PROFILES, maxLevelFor } from '../terrain/body-profiles';
import { TERRAIN_QUALITY } from '../terrain/lod';
import { createTerrainSource } from '../terrain/source-registry';
import { loadEarthData } from '../terrain/terrain-data';
import { TerrainBody } from '../terrain/terrain-body';
import { ChunkWorkerPool } from '../terrain/worker-pool';
import { AtmospherePass, type ActiveAtmosphere } from './atmosphere-pass';
import { TransmittanceLut } from './atmosphere-lut';
import { SUN_IRRADIANCE } from './atmosphere-model';
import { BodyMarkers } from './body-markers';
import { createGasGiantMaterial, createRockyMaterial, createSunMaterial } from './body-materials';
import { CloudLayer } from './clouds';
import { createDetailTexture } from './detail-texture';
import { GAS_PALETTES } from './gas-palettes';
import { Planet } from './planet';
import { PlanetUniforms } from './planet-uniforms';
import { createRasterTexture } from './raster-texture';
import { createRings } from './rings';
import { createEarthMaterial, createMoonMaterial } from './terrain-material';
import { uploaded } from './uploaded';

const SUN_RADIUS = BODIES[0]!.radius;
const CLOUD_ALTITUDE = 2800;
/** Atmospheres with a top subtending less than this (radians) are not worth a ray march. */
const ATMOSPHERE_MIN_ANGLE = 0.0008;

/**
 * Every body in the catalogue: ephemeris poses, terrain/shaders per body, the shared worker pool, the one full-screen
 * atmosphere pass (pointed at whichever atmosphere dominates the view), and point markers for worlds too small to resolve.
 */
export class SolarSystem {
  readonly ephemeris = new Ephemeris();
  readonly byId = new Map<string, Planet>();
  readonly markers: BodyMarkers;
  /** The Sun's glare, visible while the Sun is resolved. */
  private readonly sunHalo: Sprite;
  private readonly activeAtmosphere: ActiveAtmosphere;
  private readonly scratch = new Vector3();

  private constructor(
    readonly planets: Planet[],
    private readonly pool: ChunkWorkerPool,
    readonly atmosphere: AtmospherePass,
    private readonly clouds: CloudLayer,
    private readonly disposables: Array<{ dispose(): void }>,
    scene: Scene,
    earthLut: TransmittanceLut,
  ) {
    for (const p of planets) this.byId.set(p.id, p);
    this.markers = new BodyMarkers(planets);
    scene.add(this.markers);

    const haloMaterial = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const r = length(uv().sub(vec2(0.5, 0.5))).mul(2);
    const glow = exp(r.mul(-6)).mul(0.8).add(exp(r.mul(-1.8)).mul(0.1)).mul(float(1).sub(r.clamp(0, 1).pow(4)));
    haloMaterial.colorNode = vec3(1.0, 0.91, 0.78).mul(glow).mul(6);
    this.sunHalo = new Sprite(haloMaterial);
    this.sunHalo.scale.setScalar(SUN_RADIUS * 28);
    this.sunHalo.renderOrder = -4;
    this.sunHalo.frustumCulled = false;
    scene.add(this.sunHalo);

    this.activeAtmosphere = { def: earthLut.def, lut: earthLut, centre: new Vector3(), sunDir: new Vector3(), sunE: new Vector3(), sunPos: new Vector3(), occluderA: new Vector4(), occluderB: new Vector4() };
  }

  static async create(renderer: WebGPURenderer, scene: Scene, terrainDetail: number, atmosphereQuality: number): Promise<SolarSystem> {
    const earthData = await loadEarthData();
    const pool = new ChunkWorkerPool(ChunkWorkerPool.defaultSize(), earthData);
    const detail: Texture = createDetailTexture(256);
    const lightsTexture = createRasterTexture(earthData.lights);
    const disposables: Array<{ dispose(): void }> = [detail, lightsTexture];

    // One transmittance LUT per atmosphere, baked now.
    const luts = new Map<string, TransmittanceLut>();
    for (const [id, def] of Object.entries(ATMOSPHERES)) {
      const lut = new TransmittanceLut(def);
      lut.bake(renderer);
      luts.set(id, lut);
      disposables.push(lut);
    }
    const clouds = new CloudLayer(CLOUD_ALTITUDE);

    const planets: Planet[] = [];
    for (const def of BODIES) {
      const uniforms = new PlanetUniforms();
      const lut = def.atmosphere ? luts.get(def.atmosphere) : undefined;
      let material;
      if (def.id === 'earth') material = createEarthMaterial({ uniforms, lut: lut!, detail, lights: lightsTexture });
      else if (def.id === 'moon') material = createMoonMaterial({ uniforms, detail });
      else if (def.render === 'sun') material = createSunMaterial(uniforms);
      else if (def.render === 'gas') material = createGasGiantMaterial({ uniforms, lut: lut!, palette: GAS_PALETTES[def.id]!, ringShadow: !!def.rings });
      else material = createRockyMaterial({ uniforms, detail, palette: BODY_PROFILES[def.id]!.palette, maxHeight: BODY_PROFILES[def.id]!.maxHeight, lut });
      disposables.push(material);

      const source = createTerrainSource(def.id, earthData);
      const terrain = new TerrainBody({
        id: def.id,
        radius: source.radius,
        maxHeight: source.maxHeight,
        maxLevel: Math.min(21, maxLevelFor(source.radius)),
        material,
        pool,
        isUploaded: (attribute) => uploaded(renderer, attribute),
        unused: def.id === 'earth' ? ['aSurfB'] : [], // the Earth material takes its lights from a raster
      });
      terrain.setActive(false);
      scene.add(terrain.group);
      const planet = new Planet({ def, source, terrain, uniforms, atmosphere: def.atmosphere ? { def: ATMOSPHERES[def.atmosphere]!, lut: lut! } : undefined });
      if (def.rings) terrain.group.add(createRings(def.rings, uniforms, def.radius));
      planets.push(planet);
    }

    const system = new SolarSystem(planets, pool, new AtmospherePass(luts.get('earth')!, clouds), clouds, disposables, scene, luts.get('earth')!);
    system.setTerrainDetail(terrainDetail);
    system.setAtmosphereQuality(atmosphereQuality);
    return system;
  }

  /** Terrain level of detail (0..3): split distance and chunk budgets. */
  setTerrainDetail(level: number): void {
    const q = TERRAIN_QUALITY[Math.max(0, Math.min(3, Math.round(level)))]!;
    for (const p of this.planets) p.terrain.setQuality(q);
  }

  /** Atmosphere ray-march sample count by quality level 0..3. */
  setAtmosphereQuality(level: number): void {
    this.atmosphere.samples.value = [10, 16, 24, 32][Math.max(0, Math.min(3, Math.round(level)))]!;
  }

  get workerStats() {
    return this.pool.stats;
  }

  get(id: string): Planet {
    return this.byId.get(id)!;
  }

  /** Move every body to universal time `ut` (heliocentric positions and orientations). Does not touch rendering state. */
  advance(ut: number): void {
    this.ephemeris.update(ut);
    for (const p of this.planets) {
      const st = this.ephemeris.get(p.id);
      p.position.set(st.pos[0], st.pos[1], st.pos[2]);
      p.orientation.set(st.q[0], st.q[1], st.q[2], st.q[3]);
    }
  }

  /** Irradiance ratio relative to Earth's distance: how much brighter sunlight is at this body (1/d^2 in AU). */
  irradianceScale(p: Planet): number {
    const d = Math.max(p.position.length(), SUN_RADIUS);
    return (AU / d) ** 2;
  }

  /** Place everything relative to the camera (floating origin), refresh LOD, shader inputs and the active atmosphere. */
  place(camera: PerspectiveCamera, cameraWorld: Vector3, elapsed: number, viewportHeight: number): void {
    this.clouds.update(this.get('earth').orientation, elapsed);
    const sunRel = this.scratch.copy(cameraWorld).negate(); // the Sun sits at the heliocentric origin

    for (const p of this.planets) {
      const u = p.uniforms;
      const d = Math.max(p.position.length(), SUN_RADIUS);
      u.sunDir.value.copy(p.position).negate().divideScalar(d);
      u.sunE.value.set(SUN_IRRADIANCE[0], SUN_IRRADIANCE[1], SUN_IRRADIANCE[2]).multiplyScalar((AU / d) ** 2);
      u.sunPos.value.copy(sunRel);
      u.time.value = elapsed;
      this.setOccluders(p, cameraWorld);
      p.update(cameraWorld);
    }

    this.sunHalo.position.copy(this.get('sun').relative);
    this.sunHalo.visible = this.get('sun').resolved;
    this.markers.update(camera, viewportHeight, cameraWorld);
    this.selectAtmosphere();
  }

  /** Bodies that can shadow `p`: its parent planet and its largest moon. Radius 0 marks an unused slot. */
  private setOccluders(p: Planet, cameraWorld: Vector3): void {
    const a = p.uniforms.occluderA.value;
    const b = p.uniforms.occluderB.value;
    a.set(0, 0, 0, 0);
    b.set(0, 0, 0, 0);
    const parent = p.def.parent && p.def.parent !== 'sun' ? this.byId.get(p.def.parent) : undefined;
    if (parent) a.set(parent.position.x - cameraWorld.x, parent.position.y - cameraWorld.y, parent.position.z - cameraWorld.z, parent.radius);
    let moon: Planet | undefined;
    for (const id of this.ephemeris.childrenOf(p.id)) {
      const c = this.byId.get(id)!;
      if (!moon || c.radius > moon.radius) moon = c;
    }
    if (moon) b.set(moon.position.x - cameraWorld.x, moon.position.y - cameraWorld.y, moon.position.z - cameraWorld.z, moon.radius);
  }

  /** Point the atmosphere pass at the body whose atmosphere subtends the largest angle, or switch it off. */
  private selectAtmosphere(): void {
    let best: Planet | null = null;
    let bestAngle = ATMOSPHERE_MIN_ANGLE;
    for (const p of this.planets) {
      if (!p.atmosphere) continue;
      const d = Math.max(p.relative.length(), 1);
      const angle = Math.asin(Math.min(1, p.atmosphere.def.topRadius / d));
      if (angle > bestAngle) {
        bestAngle = angle;
        best = p;
      }
    }
    this.atmosphereBody = best;
    if (!best) {
      this.atmosphere.setActive(null);
      return;
    }
    const a = this.activeAtmosphere;
    a.def = best.atmosphere!.def;
    a.lut = best.atmosphere!.lut;
    a.centre.copy(best.relative);
    a.sunDir.copy(best.uniforms.sunDir.value);
    a.sunE.copy(best.uniforms.sunE.value);
    a.sunPos.copy(best.uniforms.sunPos.value);
    a.occluderA.copy(best.uniforms.occluderA.value);
    a.occluderB.copy(best.uniforms.occluderB.value);
    a.clouds = best.id === 'earth' ? { layer: this.clouds, altitude: CLOUD_ALTITUDE } : undefined;
    this.atmosphere.setActive(a);
  }

  /** The planet whose atmosphere is currently drawn, if any. */
  atmosphereBody: Planet | null = null;

  dispose(): void {
    for (const p of this.planets) p.terrain.dispose();
    this.markers.release();
    this.disposables.forEach((d) => d.dispose());
    this.pool.dispose();
  }
}
