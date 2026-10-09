import { Matrix4, Vector2, Vector3, Vector4, type Node, type PerspectiveCamera } from 'three/webgpu';
import { Fn, If, Loop, abs, clamp, dot, exp, float, max, min, mix, mx_fractal_noise_float, normalize, pow, saturate, select, smoothstep, sqrt, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { atmosphereLighting } from './atmosphere-lighting';
import type { TransmittanceLut } from './atmosphere-lut';
import type { AtmosphereDef } from './atmosphere-model';
import { LutBinding, UniformAtmosphere, extinctionNodes, layerTent, lutLookup, mieLikePhase } from './atmosphere-nodes';
import { CloudLayer } from './clouds';
import { sunVisibility2 } from './eclipse';
import type { ComposeInput } from './gfx';
import { PlanetUniforms } from './planet-uniforms';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

const MULTI_SCATTER_BOOST = 1.3; // cheap stand-in for multiple scattering (brightens the sky towards its real value)
const CLOUD_ALBEDO = 0.92;

/** The atmosphere the pass should draw this frame. All vectors are in render space (camera at the origin). */
export interface ActiveAtmosphere {
  def: AtmosphereDef;
  lut: TransmittanceLut;
  /** Planet centre relative to the camera (m), unit direction to the Sun, Sun irradiance at this body (RGB). */
  centre: Vector3;
  sunDir: Vector3;
  sunE: Vector3;
  /** Eclipse inputs from the body's uniforms: Sun position and up to two occluders (centre, radius), camera-relative. */
  sunPos: Vector3;
  occluderA: Vector4;
  occluderB: Vector4;
  /** Draw the procedural cloud deck (Earth). */
  clouds?: { layer: CloudLayer; altitude: number };
}

/**
 * Full-screen atmosphere + clouds for ONE body at a time (the pass is configured each frame for the body whose
 * atmosphere dominates the view, with no shader recompilation): single-scattering ray march from the camera to the scene
 * (or out of the atmosphere for sky pixels), using the transmittance LUT for sunlight reaching each sample. Gives blue
 * sky, red sunsets, glowing limbs, hazy distances, Venus's opaque yellow deck, Mars's dust: from ground to deep space.
 *
 * The cloud deck is composited *inside* the same integral: the march records in-scatter and transmittance up to the
 * cloud shell, so clouds get correct aerial perspective and the sky behind thin cloud is not wrongly dimmed:
 *   final = S_c + a*T_c*cloud + (1-a)*(S_total - S_c + scene*T_total)
 *
 * Maths runs in kilometres to keep float32 happy (squared planetary radii are ~4e13 m^2 but only 4e7 km^2).
 */
export class AtmospherePass {
  private readonly cameraWorld = uniform(new Matrix4());
  private readonly tanHalf = uniform(new Vector2(1, 1));
  /** Ray-march sample count (runtime uniform, so quality changes need no recompile). */
  readonly samples = uniform(16, 'int');
  /** Shader inputs for the currently active body. */
  private readonly planet = new PlanetUniforms();
  private readonly atmosphere = new UniformAtmosphere();
  private readonly lutBinding: LutBinding;
  private readonly enabled = uniform(0, 'int');
  private readonly cloudsEnabled = uniform(0, 'int');
  private readonly cloudRadiusKm = uniform(1);
  private readonly deckEnabled = uniform(0, 'int');
  private readonly deckAlbedo = uniform(new Vector3(1, 1, 1));
  private activeClouds: CloudLayer | null = null;

  constructor(initial: TransmittanceLut, readonly clouds: CloudLayer) {
    this.lutBinding = new LutBinding(initial.texture);
    this.atmosphere.set(initial.def);
  }

  /** Configure for this frame; pass null to switch the pass off (no atmosphere in view). */
  setActive(a: ActiveAtmosphere | null): void {
    if (!a) {
      this.enabled.value = 0;
      return;
    }
    this.enabled.value = 1;
    this.atmosphere.set(a.def);
    this.lutBinding.set(a.lut.texture);
    this.planet.center.value.copy(a.centre);
    this.planet.sunDir.value.copy(a.sunDir);
    this.planet.sunE.value.copy(a.sunE);
    this.planet.sunPos.value.copy(a.sunPos);
    this.planet.occluderA.value.copy(a.occluderA);
    this.planet.occluderB.value.copy(a.occluderB);
    this.cloudsEnabled.value = a.clouds ? 1 : 0;
    this.activeClouds = a.clouds?.layer ?? null;
    const deck = a.clouds ? undefined : a.def.deck;
    this.deckEnabled.value = deck ? 1 : 0;
    if (deck) this.deckAlbedo.value.fromArray(deck.albedo);
    const shell = a.clouds?.altitude ?? deck?.altitude;
    this.cloudRadiusKm.value = shell !== undefined ? (a.def.radius + shell) / 1000 : 1;
  }

  /** Call every frame after the camera's orientation is set. */
  updateCamera(camera: PerspectiveCamera): void {
    camera.updateMatrixWorld();
    this.cameraWorld.value.copy(camera.matrixWorld);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    this.tanHalf.value.set(tanY * camera.aspect, tanY);
  }

  readonly compose = ({ color, viewZ, isSky }: ComposeInput): Node<'vec4'> => {
    const a = this.atmosphere.nodes;
    const u = this.planet;
    const clouds = this.clouds;
    const sunDir = u.sunDir as V3;
    const sunE = u.sunE as V3;
    const R = a.radiusKm;
    const Ra = a.topKm;
    const lookup = (r: F, mu: F): V3 => lutLookup(a, this.lutBinding.sample, r, mu);

    // Post-quad uv has its origin at the top-left (WebGPU), clip-space +Y is up: flip Y.
    const ndc = vec2(uv().x.mul(2).sub(1), float(1).sub(uv().y.mul(2)));
    const dView = normalize(vec3(ndc.x.mul(this.tanHalf.x), ndc.y.mul(this.tanHalf.y), -1)) as V3;
    const rd = normalize(this.cameraWorld.mul(vec4(dView, 0)).xyz) as V3;
    const sceneKm = select(isSky, float(1e9), viewZ.div(dView.z).div(1000)) as F;

    const shade = Fn(() => {
      const ro = u.center.negate().div(1000).toVar(); // camera relative to planet centre, km
      const ro2 = dot(ro, ro).toVar();
      const b = dot(ro, rd).toVar();

      const discTop = b.mul(b).sub(ro2.sub(Ra.mul(Ra))).toVar();
      const sqTop = sqrt(max(discTop, 0));
      const tStart = max(b.negate().sub(sqTop), 0).toVar();
      const tEnd = b.negate().add(sqTop).toVar();

      const discPlanet = b.mul(b).sub(ro2.sub(R.mul(R)));
      const tPlanet = b.negate().sub(sqrt(max(discPlanet, 0)));
      tEnd.assign(select(discPlanet.greaterThan(0).and(tPlanet.greaterThan(0)), min(tEnd, tPlanet), tEnd));
      tEnd.assign(min(tEnd, sceneKm));

      const result = vec4(color).toVar();
      const sceneRGB = color.rgb.toVar();

      If(this.enabled.greaterThan(0).and(discTop.greaterThan(0)).and(tEnd.greaterThan(tStart)), () => {
        const span = tEnd.sub(tStart).toVar();
        const inside = ro2.lessThan(Ra.mul(Ra));
        const hitsPlanet = discPlanet.greaterThan(0).and(tPlanet.greaterThan(0));

        const cosT = dot(rd, sunDir).toVar();
        const phaseR = float(3 / (16 * Math.PI)).mul(cosT.mul(cosT).add(1));
        const phaseM = mieLikePhase(a.mieG, cosT);
        const phaseL = mieLikePhase(a.layerG, cosT);

        // ---- cloud shell hit along this ray (Earth only) ----
        const tc = float(1e9).toVar(); // distance to the cloud shell (km); 1e9 = none
        const cloudAlpha = float(0).toVar();
        const cloudRadiance = vec3(0).toVar();
        const Rc = this.cloudRadiusKm;
        If(this.cloudsEnabled.greaterThan(0), () => {
          const discC = b.mul(b).sub(ro2.sub(Rc.mul(Rc)));
          const sqC = sqrt(max(discC, 0));
          const below = ro2.lessThan(Rc.mul(Rc));
          const tHit = select(below, b.negate().add(sqC), b.negate().sub(sqC));
          const valid = discC.greaterThan(0).and(tHit.greaterThan(0)).and(tHit.lessThan(tEnd));
          If(valid, () => {
            tc.assign(tHit);
            const pHit = ro.add(rd.mul(tHit));
            const dirC = normalize(pHit) as V3;
            const detailC = smoothstep(1500, 40, tHit);
            const alpha = clouds.alpha(dirC, detailC);
            cloudAlpha.assign(alpha);

            // Lighting of the cloud top (or underside, if we are below the deck).
            const muSun = dot(dirC, sunDir);
            const lighting = atmosphereLighting(sunE, lookup, R.mul(1000), Rc.mul(1000), muSun);
            const lit = smoothstep(-0.12, 0.25, muSun);
            const diffuse = lit.mul(saturate(muSun.add(0.15)).mul(0.75).add(0.25));
            const hg = float(1 - 0.55 * 0.55).div(pow(float(1 + 0.55 * 0.55).sub(cosT.mul(2 * 0.55)), 1.5).mul(4 * Math.PI)); // forward-scatter lobe
            const light = lighting.sunColour.mul(diffuse.add(hg.mul(0.5).mul(lit))).add(lighting.ambient);
            const underside = select(below, float(0.5), float(1));
            const shadowed = select(detailC.greaterThan(0.05).and(muSun.greaterThan(0)), clouds.selfShadow(dirC, sunDir, alpha, detailC), float(1));
            cloudRadiance.assign(light.mul(CLOUD_ALBEDO / Math.PI).mul(CloudLayer.shading(alpha)).mul(shadowed).mul(underside));
          });

          // Cloud shadow on the ground/objects below the deck: where does the sun ray cross the shell?
          const sceneKmClamped = min(sceneKm, 1e4);
          const pS = ro.add(rd.mul(sceneKmClamped));
          const rS = sqrt(dot(pS, pS));
          If(isSky.not().and(rS.lessThan(Rc)).and(sceneKmClamped.lessThan(250)), () => {
            const bS = dot(pS, sunDir);
            const discS = bS.mul(bS).sub(dot(pS, pS).sub(Rc.mul(Rc)));
            const tS = bS.negate().add(sqrt(max(discS, 0)));
            const pCloud = pS.add(sunDir.mul(tS));
            const aS = clouds.alpha(normalize(pCloud) as V3, smoothstep(400, 10, sceneKmClamped));
            const sunUp = smoothstep(0, 0.2, dot(pS.div(rS), sunDir));
            sceneRGB.assign(sceneRGB.mul(float(1).sub(aS.mul(0.62).mul(sunUp))));
          });
        });

        // ---- opaque cloud deck (Venus): the same shell slot as the clouds, fully opaque with soft UV-absorber streaks ----
        If(this.deckEnabled.greaterThan(0), () => {
          const discC = b.mul(b).sub(ro2.sub(Rc.mul(Rc)));
          const sqC = sqrt(max(discC, 0));
          const below = ro2.lessThan(Rc.mul(Rc));
          const tHit = select(below, b.negate().add(sqC), b.negate().sub(sqC));
          If(discC.greaterThan(0).and(tHit.greaterThan(0)).and(tHit.lessThan(tEnd)), () => {
            tc.assign(tHit);
            const dirC = normalize(ro.add(rd.mul(tHit))) as V3;
            cloudAlpha.assign(1);
            const muSun = dot(dirC, sunDir);
            const lighting = atmosphereLighting(sunE, lookup, R.mul(1000), Rc.mul(1000), muSun);
            const diffuse = smoothstep(-0.12, 0.25, muSun).mul(saturate(muSun.add(0.15)).mul(0.75).add(0.25));
            const streak = mx_fractal_noise_float(dirC.mul(vec3(3, 12, 3)), 4, 2.1, 0.5).mul(0.5).add(0.5);
            const albedo = mix(this.deckAlbedo as V3, (this.deckAlbedo as V3).mul(vec3(0.78, 0.8, 0.9)), smoothstep(0.45, 0.8, streak).mul(0.7));
            cloudRadiance.assign(lighting.sunColour.mul(diffuse).add(lighting.ambient).mul(albedo).div(Math.PI));
          });
        });

        // ---- ray march ----
        const optical = vec3(0).toVar();
        const inscatter = vec3(0).toVar();
        const opticalC = vec3(0).toVar(); // up to the cloud shell
        const inscatterC = vec3(0).toVar();
        const n = float(this.samples);

        // Sample spacing: dense where the air is dense (near the camera when inside, near the ground end when looking
        // down from space, around the closest approach for grazing rays).
        const warp = (x: F): F => {
          const centred = abs(x.mul(2).sub(1));
          const grazing = float(0.5).add(float(0.5).mul(pow(centred, 1.8)).mul(select(x.lessThan(0.5), float(-1), float(1))));
          return select(inside, x.mul(x), select(hitsPlanet, float(1).sub(float(1).sub(x).mul(float(1).sub(x))), grazing)) as F;
        };

        Loop({ start: 0, end: this.samples, type: 'int', condition: '<' }, ({ i: index }: { i: Node<'int'> }) => {
          const i = float(index);
          const w0 = warp(i.div(n)).mul(span);
          const w1 = warp(i.add(1).div(n)).mul(span);
          const dt = w1.sub(w0).toVar(); // km
          const t = tStart.add(warp(i.add(0.5).div(n)).mul(span));
          const p = ro.add(rd.mul(t)).toVar();
          const r = sqrt(dot(p, p)).toVar();
          const h = r.sub(R).mul(1000).toVar(); // metres
          const rhoR = exp(h.div(a.rayleighH).negate());
          const rhoM = exp(h.div(a.mieH).negate());
          const tent = layerTent(a, h);
          const sigmaT = extinctionNodes(a, h);
          const dtM = dt.mul(1000);

          const stepOptical = sigmaT.mul(dtM);
          const viewT = exp(optical.add(stepOptical.mul(0.5)).negate());
          optical.addAssign(stepOptical);

          const mu = dot(p.div(r), sunDir);
          const sunT = lookup(r.mul(1000), mu);
          const scatter = a.rayleigh
            .mul(rhoR)
            .mul(phaseR)
            .add(a.mieScattering.mul(rhoM).mul(phaseM))
            .add(a.layerScattering.mul(tent).mul(phaseL));
          const contribution = scatter.mul(sunT).mul(viewT).mul(dtM);
          inscatter.addAssign(contribution);

          // Portion of this step that lies in front of the cloud shell.
          const front = clamp(tc.sub(tStart.add(w0)).div(max(dt, 1e-6)), 0, 1);
          inscatterC.addAssign(contribution.mul(front));
          opticalC.addAssign(stepOptical.mul(front));
        });

        // Air inside an eclipse shadow is dark too: evaluate the Sun's visibility at the middle of the ray's path through it.
        const midpoint = rd.mul(tStart.add(span.mul(0.5)).mul(1000)) as V3;
        const sunSeen = sunVisibility2(midpoint, u.sunPos as V3, u.occluderA as V4, u.occluderB as V4);
        const sky = inscatter.mul(sunE).mul(MULTI_SCATTER_BOOST).mul(sunSeen);
        const transmittance = exp(optical.negate());
        // Stars and the Milky Way live in the sky pixels: daylight sky radiance drowns them (they return at dusk).
        const skyLum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
        const starVisibility = select(isSky, exp(skyLum.mul(-60)), float(1));
        const behind = sky.add(sceneRGB.mul(transmittance).mul(starVisibility)); // everything except the cloud

        const skyC = inscatterC.mul(sunE).mul(MULTI_SCATTER_BOOST);
        const cloudT = exp(opticalC.negate());
        const withCloud = skyC.add(cloudRadiance.mul(cloudT).mul(cloudAlpha)).add(behind.sub(skyC).mul(float(1).sub(cloudAlpha)));
        result.assign(vec4(select(tc.lessThan(1e8), withCloud, behind), color.a));
      });

      return result;
    });

    return shade() as Node<'vec4'>;
  };

  /** Clouds are driven by the planet's rotation; the solar system calls this once per frame while Earth's atmosphere is active. */
  get activeCloudLayer(): CloudLayer | null {
    return this.activeClouds;
  }
}
