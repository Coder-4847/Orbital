/**
 * The navball, drawn in software on a 2D canvas: a sphere shaded sky and ground against the local horizon, with pitch ladder,
 * compass meridians and the prograde / retrograde / normal / radial markers. The maths lives in navball-math.ts.
 */
import { ballPointToBody, project, type HorizonFrame } from './navball-math';
import { qrot, vdot, type Quat, type V3 } from './math3';

export type MarkerKind = 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radialOut' | 'radialIn' | 'maneuver';
export interface BallMarker {
  kind: MarkerKind;
  /** World direction (unit). */
  dir: V3;
}

const COLOURS: Record<MarkerKind, string> = {
  prograde: '#7dff7a',
  retrograde: '#7dff7a',
  normal: '#c58bff',
  antinormal: '#c58bff',
  radialOut: '#59d8ff',
  radialIn: '#59d8ff',
  maneuver: '#ff7ad9',
};

export class Navball {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly size: number;

  constructor(cssSize = 180) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.round(cssSize * dpr * 0.75); // the ball is drawn at 3/4 resolution: it is soft by nature
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.canvas.style.width = this.canvas.style.height = `${cssSize}px`;
    this.canvas.className = 'navball';
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(this.size, this.size);
  }

  draw(q: Quat, h: HorizonFrame, markers: BallMarker[]): void {
    const S = this.size;
    const data = this.image.data;
    // Rotation matrix of the vessel (body -> world) from its quaternion.
    const bx = qrot(q, [1, 0, 0]);
    const by = qrot(q, [0, 1, 0]);
    const bz = qrot(q, [0, 0, 1]);
    const R = S / 2;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = (i + 0.5 - R) / R;
        const y = -(j + 0.5 - R) / R;
        const r2 = x * x + y * y;
        const o = (j * S + i) * 4;
        if (r2 > 1) {
          data[o + 3] = 0;
          continue;
        }
        const b = ballPointToBody(x, y);
        const d: V3 = [bx[0] * b[0] + by[0] * b[1] + bz[0] * b[2], bx[1] * b[0] + by[1] * b[1] + bz[1] * b[2], bx[2] * b[0] + by[2] * b[1] + bz[2] * b[2]];
        const u = vdot(d, h.up);
        const el = Math.asin(Math.max(-1, Math.min(1, u)));
        const elDeg = (el * 180) / Math.PI;
        const bearing = ((Math.atan2(vdot(d, h.east), vdot(d, h.north)) * 180) / Math.PI + 360) % 360;
        let cr: number;
        let cg: number;
        let cb: number;
        if (u >= 0) {
          const t = Math.pow(u, 0.6);
          cr = 90 - 55 * t;
          cg = 160 - 70 * t;
          cb = 235 - 40 * t;
        } else {
          const t = Math.pow(-u, 0.6);
          cr = 150 - 70 * t;
          cg = 100 - 50 * t;
          cb = 55 - 25 * t;
        }
        const mark = Math.abs(elDeg) < 80;
        if (Math.abs(elDeg) < 0.8) {
          cr = cg = cb = 255; // horizon
        } else if (mark && Math.abs(((elDeg + 7.5) % 15) - 7.5) < 0.5 && Math.abs(elDeg) > 1) {
          cr = cr * 0.45 + 140;
          cg = cg * 0.45 + 140;
          cb = cb * 0.45 + 140; // pitch ladder every 15 degrees
        } else if (Math.abs(elDeg) < 78 && Math.min(bearing % 30, 30 - (bearing % 30)) < 0.9 / Math.max(0.25, Math.cos(el))) {
          cr = cr * 0.55 + 100;
          cg = cg * 0.55 + 100;
          cb = cb * 0.55 + 100;
        }
        if (Math.abs(elDeg) < 78 && (bearing < 1.6 || bearing > 358.4)) {
          cr = 255;
          cg = 70;
          cb = 60; // north
        }
        const shade = 0.5 + 0.5 * Math.pow(1 - r2, 0.35);
        data[o] = cr * shade;
        data[o + 1] = cg * shade;
        data[o + 2] = cb * shade;
        data[o + 3] = 255;
      }
    }
    const ctx = this.ctx;
    ctx.putImageData(this.image, 0, 0);
    ctx.lineWidth = Math.max(1.5, S / 70);
    for (const m of markers) {
      const p = project(q, m.dir);
      if (!p.front) continue;
      this.drawMarker(m.kind, R + p.x * R * 0.96, R - p.y * R * 0.96, S / 17);
    }
    // the vessel's nose marker at the centre
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = Math.max(2, S / 45);
    ctx.beginPath();
    ctx.arc(R, R, S / 40, 0, Math.PI * 2);
    ctx.moveTo(R - S / 7, R);
    ctx.lineTo(R - S / 22, R);
    ctx.moveTo(R + S / 7, R);
    ctx.lineTo(R + S / 22, R);
    ctx.moveTo(R, R - S / 22);
    ctx.lineTo(R, R - S / 9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(10,14,20,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(R, R, R - 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawMarker(kind: MarkerKind, x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = COLOURS[kind];
    ctx.fillStyle = COLOURS[kind];
    ctx.beginPath();
    if (kind === 'prograde' || kind === 'retrograde') {
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x, y - r * 1.9);
      ctx.lineTo(x, y - r);
      ctx.moveTo(x - r * 1.9, y);
      ctx.lineTo(x - r, y);
      ctx.moveTo(x + r * 1.9, y);
      ctx.lineTo(x + r, y);
      if (kind === 'retrograde') {
        ctx.moveTo(x - r * 0.7, y - r * 0.7);
        ctx.lineTo(x + r * 0.7, y + r * 0.7);
        ctx.moveTo(x + r * 0.7, y - r * 0.7);
        ctx.lineTo(x - r * 0.7, y + r * 0.7);
      } else {
        ctx.moveTo(x + 1, y);
        ctx.arc(x, y, 1, 0, Math.PI * 2);
      }
      ctx.stroke();
    } else if (kind === 'normal' || kind === 'antinormal') {
      const dir = kind === 'normal' ? -1 : 1;
      ctx.moveTo(x, y + dir * r);
      ctx.lineTo(x - r, y - dir * r * 0.8);
      ctx.lineTo(x + r, y - dir * r * 0.8);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === 'maneuver') {
      ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
      ctx.moveTo(x + r * 0.45, y);
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        ctx.moveTo(x + dx * r * 1.15, y + dy * r * 1.15);
        ctx.lineTo(x + dx * r * 1.8, y + dy * r * 1.8);
      }
      ctx.stroke();
    } else {
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
      ctx.moveTo(x - r * 0.5, y);
      ctx.lineTo(x + r * 0.5, y);
      if (kind === 'radialOut') {
        ctx.moveTo(x, y - r * 0.5);
        ctx.lineTo(x, y + r * 0.5);
      }
      ctx.stroke();
    }
  }
}
