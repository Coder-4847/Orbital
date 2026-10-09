import { HalfFloatType, LinearFilter, NodeMaterial, QuadMesh, RenderTarget, RGBAFormat, type Node, type Texture, type WebGPURenderer } from 'three/webgpu';
import { Fn, Loop, clamp, exp, float, select, sqrt, uv, vec3, vec4 } from 'three/tsl';
import type { AtmosphereDef } from './atmosphere-model';
import { LutBinding, constantNodes, extinctionNodes, lutLookup, type AtmosphereNodes } from './atmosphere-nodes';

const LUT_WIDTH = 256;
const LUT_HEIGHT = 64;
const STEPS = 48;

/**
 * Precomputed sun transmittance T(r, mu) for one atmosphere (Bruneton parameterisation, baked once on the GPU).
 * The lookup returns zero when the planet blocks the sun, which makes terminators and eclipses fall out for free.
 * Parameter maths runs in kilometres: squared metre values (~4e13) lose too much precision in float32.
 */
export class TransmittanceLut {
  private readonly target = new RenderTarget(LUT_WIDTH, LUT_HEIGHT, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  private readonly binding = new LutBinding(this.target.texture);
  private readonly nodes: AtmosphereNodes;

  constructor(readonly def: AtmosphereDef) {
    this.nodes = constantNodes(def);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  /** Render the LUT (synchronous once the renderer is initialised). */
  bake(renderer: WebGPURenderer): void {
    const material = this.createMaterial();
    const quad = new QuadMesh(material);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
    material.dispose();
  }

  private createMaterial(): NodeMaterial {
    const a = this.nodes;
    // The loop must live inside an Fn so TSL has a statement stack to attach it to.
    const bake = Fn(() => {
      const coord = uv();
      const R = a.radiusKm;
      const Ra = a.topKm;
      const H = a.horizonKm;
      const rho = H.mul(coord.y);
      const r = sqrt(rho.mul(rho).add(R.mul(R)));
      const dMin = Ra.sub(r);
      const dMax = rho.add(H);
      const dist = dMin.add(coord.x.mul(dMax.sub(dMin)));
      const mu = clamp(select(dist.lessThan(1e-4), float(1), H.mul(H).sub(rho.mul(rho)).sub(dist.mul(dist)).div(r.mul(dist).mul(2))), -1, 1);

      const od = vec3(0, 0, 0).toVar();
      Loop(STEPS, ({ i }) => {
        const t = dist.mul(float(i).add(0.5)).div(STEPS);
        const ri = sqrt(r.mul(r).add(t.mul(t)).add(r.mul(mu).mul(t).mul(2)));
        const h = ri.sub(R).mul(1000); // metres
        od.addAssign(extinctionNodes(a, h).mul(dist.div(STEPS).mul(1000)));
      });
      return vec4(exp(od.negate()), 1);
    });

    const material = new NodeMaterial();
    material.fragmentNode = bake();
    return material;
  }

  /** TSL: transmittance from radius `r` (metres) along direction cosine `mu` to the top of the atmosphere (zero in planet shadow). */
  readonly lookup = (r: Node<'float'>, mu: Node<'float'>): Node<'vec3'> => lutLookup(this.nodes, this.binding.sample, r, mu);

  dispose(): void {
    this.target.dispose();
  }
}
