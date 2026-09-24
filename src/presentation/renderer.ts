import { TAU, clamp, len } from '../core/math';
import { Rng } from '../core/rng';
import { regionById } from '../data/regions';
import type { Game } from '../game/game';
import { BodyFrame, type Body } from '../physics/body';
import { DT, Ev } from '../physics/sim';
import type { Settings } from '../progression/profile';
import { Particles } from './particles';
import { hexA, spritesFor } from './sprites';

const TRAIL = 160;

/** Draws the universe. Reads game state; never mutates gameplay. */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly particles = new Particles(1000);
  dpr = 1;
  w = 1;
  h = 1;
  private starTiles: HTMLCanvasElement[] = [];
  private nebula: HTMLCanvasElement | null = null;
  private nebulaRegion = '';
  private trailX = new Float32Array(TRAIL);
  private trailY = new Float32Array(TRAIL);
  private trailT = new Float32Array(TRAIL);
  private trailS = new Float32Array(TRAIL);
  private trailHead = 0;
  private trailLen = 0;
  private ghostFrame: BodyFrame | null = null;
  private ghostWorld: unknown = null;
  incidentStart = 0;
  highlightBody = -1;
  highlightUntil = 0;
  now = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly game: Game,
    readonly settings: () => Settings,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.buildStars();
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.game.camera.resize(w, h);
  }

  resetTrail(): void {
    this.trailLen = 0;
  }

  private buildStars(): void {
    const rng = new Rng(77);
    for (let layer = 0; layer < 3; layer++) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d')!;
      const n = [140, 70, 28][layer]!;
      for (let i = 0; i < n; i++) {
        const x = rng.range(0, 512);
        const y = rng.range(0, 512);
        const s = rng.range(0.4, 1.1) * (layer + 1) * 0.7;
        const tint = rng.pick(['#ffffff', '#cfe0ff', '#ffe9c9', '#d9d2ff']);
        ctx.globalAlpha = rng.range(0.25, 0.9) * (0.5 + layer * 0.25);
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, TAU);
        ctx.fill();
        if (layer === 2 && rng.chance(0.3)) {
          ctx.globalAlpha = 0.15;
          ctx.beginPath();
          ctx.arc(x, y, s * 4, 0, TAU);
          ctx.fill();
        }
      }
      this.starTiles.push(c);
    }
  }

  private buildNebula(regionId: string): void {
    const color = regionId === 'tutorial' ? '#5f7dff' : regionById(regionId).color;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const rng = new Rng(regionId.length * 97 + 13);
    const colors = [color, '#ff5c9a', '#4a3aff', '#1fb5c9'];
    for (let i = 0; i < 9; i++) {
      const x = rng.range(20, 236);
      const y = rng.range(20, 236);
      const r = rng.range(50, 130);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexA(rng.pick(colors), rng.range(0.05, 0.13)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    this.nebula = c;
    this.nebulaRegion = regionId;
  }

  render(realDt: number, now: number): void {
    this.now = now;
    const g = this.game;
    const ctx = this.ctx;
    const cam = g.camera;
    const set = this.settings();
    this.particles.budget = set.reducedEffects ? 0.35 : 1;
    this.particles.update(realDt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, '#04050d');
    bg.addColorStop(1, '#0a0d22');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const w = g.world;
    if (w && w.meta.regionId !== this.nebulaRegion) this.buildNebula(w.meta.regionId);
    this.drawBackdrop(ctx);
    if (!w) return;

    const z = cam.zoom;
    const f = g.frame;
    // Interpolate the render time between physics steps for buttery motion.
    const rt = g.probe.t + (g.phase === 'flight' ? g.alpha * DT * g.timeScale : 0);
    f.eval(w.bodies, rt);
    const px = g.phase === 'flight' ? g.prevX + (g.probe.x - g.prevX) * g.alpha : g.probe.x;
    const py = g.phase === 'flight' ? g.prevY + (g.probe.y - g.prevY) * g.alpha : g.probe.y;

    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.w / 2 + cam.shakeX - cam.x * z), this.dpr * (this.h / 2 + cam.shakeY - cam.y * z));
    const viewMinX = cam.x - cam.halfW - 50;
    const viewMaxX = cam.x + cam.halfW + 50;
    const viewMinY = cam.y - cam.halfH - 50;
    const viewMaxY = cam.y + cam.halfH + 50;
    const visible = (b: Body, extra: number) => {
      const x = f.x[b.index]!;
      const y = f.y[b.index]!;
      return x + extra > viewMinX && x - extra < viewMaxX && y + extra > viewMinY && y - extra < viewMaxY;
    };

    this.drawBoundary(ctx, z);
    this.drawFields(ctx, visible, z, rt);
    this.drawOrbits(ctx, visible, z);
    if (g.demoPath) this.drawPath(ctx, g.demoPath, g.demoCount, z, 'rgba(255,211,107,', 0.55, true);
    if (g.phase === 'incident') this.drawReplay(ctx, z);
    if (g.prediction && (g.phase === 'flight' || g.aim.valid)) this.drawPrediction(ctx, z, set);
    this.drawBodies(ctx, visible, z, rt);
    this.updateTrail(px, py, rt, g.phase === 'flight');
    this.drawTrail(ctx, z, rt);
    if (g.phase !== 'incident' && g.phase !== 'loading') this.drawProbe(ctx, px, py, z, rt);
    this.particles.draw(ctx, 1.2 / z);

    // Screen-space overlays.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBadges(ctx, rt);
    this.drawOffscreen(ctx, rt);
    this.drawAim(ctx);
    this.drawThrust(ctx);
    this.drawEdgeWarning(ctx, px, py);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const cam = this.game.camera;
    if (this.nebula) {
      const size = Math.max(this.w, this.h) * 1.8;
      const ox = -((cam.x * 0.02) % size);
      const oy = -((cam.y * 0.02) % size);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.nebula, this.w / 2 - size / 2 + ox * 0.5, this.h / 2 - size / 2 + oy * 0.5, size, size);
    }
    const factors = [0.04, 0.09, 0.18];
    for (let l = 0; l < 3; l++) {
      const tile = this.starTiles[l]!;
      const f = factors[l]! * Math.pow(cam.zoom / 0.5, 0.3);
      const s = 512;
      let ox = (-(cam.x * f) % s) - s;
      let oy = (-(cam.y * f) % s) - s;
      if (ox > 0) ox -= s;
      if (oy > 0) oy -= s;
      for (let x = ox; x < this.w; x += s) for (let y = oy; y < this.h; y += s) ctx.drawImage(tile, x, y);
    }
  }

  private drawBoundary(ctx: CanvasRenderingContext2D, z: number): void {
    const b = this.game.world!.bounds;
    ctx.strokeStyle = 'rgba(120,160,255,0.08)';
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([14 / z, 18 / z]);
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.setLineDash([]);
  }

  private drawFields(ctx: CanvasRenderingContext2D, visible: (b: Body, e: number) => boolean, z: number, t: number): void {
    const g = this.game;
    const f = g.frame;
    const dom = g.probe.domBody;
    const reduced = this.settings().reducedEffects;
    for (const b of g.world!.bodies) {
      if (!b.revealed || b.mu <= 0 || !f.active[b.index] || !visible(b, b.soi)) continue;
      const x = f.x[b.index]!;
      const y = f.y[b.index]!;
      const p = b.type.palette;
      const inside = dom === b.index && g.phase === 'flight';
      const strength = f.mu[b.index]! / b.mu;
      // Soft field glow.
      const grad = ctx.createRadialGradient(x, y, b.radius, x, y, b.soi);
      grad.addColorStop(0, hexA(p.glow, (inside ? 0.13 : 0.07) * Math.min(1.6, strength)));
      grad.addColorStop(0.5, hexA(p.glow, inside ? 0.04 : 0.02));
      grad.addColorStop(1, hexA(p.glow, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, b.soi, 0, TAU);
      ctx.fill();
      // Sphere-of-influence ring.
      ctx.strokeStyle = hexA(p.glow, inside ? 0.32 : 0.1);
      ctx.lineWidth = (inside ? 1.6 : 1) / z;
      ctx.setLineDash([6 / z, 10 / z]);
      ctx.beginPath();
      ctx.arc(x, y, b.soi * 0.98, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      const beh = b.type.behavior;
      if (beh?.kind === 'pulse') {
        // Rings travel inward as gravity strengthens.
        const ph = (((t + b.behaviorPhase) / beh.period) % 1 + 1) % 1;
        for (let k = 0; k < (reduced ? 1 : 3); k++) {
          const q = (ph + k / 3) % 1;
          const rr = b.soi - (b.soi - b.radius) * q;
          ctx.strokeStyle = hexA(p.glow, 0.25 * Math.sin(Math.PI * q) * Math.min(1.5, strength));
          ctx.lineWidth = 2 / z;
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, TAU);
          ctx.stroke();
        }
      } else if (beh?.kind === 'erupt') {
        const e = b.eruptionAt(t);
        const reach = b.radius * beh.reach;
        if (e >= 0) {
          ctx.strokeStyle = `rgba(255,140,60,${0.7 * (1 - e)})`;
          ctx.lineWidth = (6 * (1 - e) + 1) / z;
          ctx.beginPath();
          ctx.arc(x, y, b.radius + (reach - b.radius) * e, 0, TAU);
          ctx.stroke();
          const blast = ctx.createRadialGradient(x, y, b.radius, x, y, reach);
          blast.addColorStop(0, `rgba(255,120,40,${0.35 * (1 - e)})`);
          blast.addColorStop(1, 'rgba(255,80,20,0)');
          ctx.fillStyle = blast;
          ctx.beginPath();
          ctx.arc(x, y, reach, 0, TAU);
          ctx.fill();
        } else {
          // Countdown ring fills up before each eruption.
          const left = b.timeToEruption(t);
          const frac = 1 - left / (beh.period - beh.duration);
          ctx.strokeStyle = frac > 0.75 ? 'rgba(255,90,40,0.8)' : 'rgba(255,160,80,0.45)';
          ctx.lineWidth = 3 / z;
          ctx.beginPath();
          ctx.arc(x, y, b.radius * 1.28, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,160,80,0.18)';
          ctx.setLineDash([4 / z, 8 / z]);
          ctx.beginPath();
          ctx.arc(x, y, reach, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (b.type.atmosphereDrag) {
        ctx.strokeStyle = 'rgba(255,90,70,0.35)';
        ctx.lineWidth = 1.5 / z;
        ctx.setLineDash([3 / z, 5 / z]);
        ctx.beginPath();
        ctx.arc(x, y, b.coreRadius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.type.lethal) {
        const flick = reduced ? 0 : Math.sin(t * 7 + b.index) * 0.04;
        const corona = ctx.createRadialGradient(x, y, b.radius * 0.9, x, y, b.radius * 2.3);
        corona.addColorStop(0, hexA(p.glow, 0.55 + flick));
        corona.addColorStop(0.4, hexA(p.base, 0.16));
        corona.addColorStop(1, hexA(p.base, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = corona;
        ctx.beginPath();
        ctx.arc(x, y, b.radius * 2.3, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  private drawOrbits(ctx: CanvasRenderingContext2D, visible: (b: Body, e: number) => boolean, z: number): void {
    const g = this.game;
    const f = g.frame;
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = 'rgba(200,220,255,0.09)';
    for (const b of g.world!.bodies) {
      if (!b.orbit || !b.revealed || !visible(b, b.orbit.radius * 2)) continue;
      const o = b.orbit;
      const cx = o.parent === null ? o.cx : f.x[o.parent]!;
      const cy = o.parent === null ? o.cy : f.y[o.parent]!;
      ctx.beginPath();
      ctx.arc(cx, cy, o.radius, 0, TAU);
      ctx.stroke();
    }
  }

  private drawBodies(ctx: CanvasRenderingContext2D, visible: (b: Body, e: number) => boolean, z: number, t: number): void {
    const g = this.game;
    const f = g.frame;
    for (const b of g.world!.bodies) {
      if (!b.revealed || !f.active[b.index] || !visible(b, b.radius * 2)) continue;
      let x = f.x[b.index]!;
      let y = f.y[b.index]!;
      const sp = spritesFor(b, this.dpr);
      if (b.tags.has('unknown') && !b.identified) {
        this.drawUnknown(ctx, b, x, y, z, t);
        continue;
      }
      // Collapsing worlds shake harder as the fuse burns down.
      let crack = 0;
      if (b.collapseAt < Infinity) {
        const left = b.collapseAt - t;
        crack = clamp(1 - left / Math.max(0.1, b.unstableFuse), 0, 1);
        const amp = crack * crack * 3;
        x += Math.sin(t * 53) * amp;
        y += Math.cos(t * 47) * amp;
      }
      if (b.type.style === 'gate' || b.type.style === 'beacon') {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3);
        const gl = ctx.createRadialGradient(x, y, b.radius * 0.5, x, y, b.radius * (2.2 + pulse * 0.4));
        gl.addColorStop(0, hexA(b.type.palette.glow, 0.35));
        gl.addColorStop(1, hexA(b.type.palette.glow, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(x, y, b.radius * 2.6, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (b.tags.has('secret')) {
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 9);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.rotationAt(t));
      ctx.drawImage(sp.surface, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
      ctx.restore();
      if (sp.shade) ctx.drawImage(sp.shade, x - sp.half, y - sp.half, sp.half * 2, sp.half * 2);
      ctx.globalAlpha = 1;
      if (crack > 0) {
        ctx.strokeStyle = `rgba(255,${Math.round(220 - crack * 120)},${Math.round(160 - crack * 120)},${0.3 + crack * 0.7})`;
        ctx.lineWidth = (1 + crack * 2) / z;
        const rng = new Rng(b.index * 31 + 7);
        for (let i = 0; i < 7; i++) {
          const a = rng.range(0, TAU);
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * b.radius * 0.2, y + Math.sin(a) * b.radius * 0.2);
          ctx.lineTo(x + Math.cos(a + rng.range(-0.3, 0.3)) * b.radius, y + Math.sin(a + rng.range(-0.3, 0.3)) * b.radius);
          ctx.stroke();
        }
      }
      if (this.highlightBody === b.index && this.now < this.highlightUntil) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(x, y, b.radius + 10 / z + Math.sin(this.now * 6) * 3 / z, 0, TAU);
        ctx.stroke();
      }
    }
  }

  private drawUnknown(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, z: number, t: number): void {
    const g = ctx.createRadialGradient(x, y, 0, x, y, b.radius * 1.4);
    g.addColorStop(0, 'rgba(20,24,40,1)');
    g.addColorStop(0.7, 'rgba(12,14,26,1)');
    g.addColorStop(1, 'rgba(12,14,26,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, b.radius * 1.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(160,200,255,${0.35 + 0.25 * Math.sin(t * 4)})`;
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 6 / z]);
    ctx.lineDashOffset = -t * 20 / z;
    ctx.beginPath();
    ctx.arc(x, y, b.radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.fillStyle = 'rgba(190,215,255,0.9)';
    ctx.font = `600 ${b.radius * 0.9}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y + b.radius * 0.05);
  }

  private drawPath(ctx: CanvasRenderingContext2D, pts: Float32Array, count: number, z: number, rgbaPrefix: string, alpha: number, dashed: boolean): void {
    if (count < 2) return;
    ctx.strokeStyle = `${rgbaPrefix}${alpha})`;
    ctx.lineWidth = 2.5 / z;
    if (dashed) ctx.setLineDash([10 / z, 10 / z]);
    ctx.lineDashOffset = -this.now * 30 / z;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 1; i < count; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  private drawPrediction(ctx: CanvasRenderingContext2D, z: number, set: Settings): void {
    const g = this.game;
    const p = g.prediction!;
    const n = p.count;
    if (n < 2) return;
    const hc = set.highContrastPath;
    const color = hc ? [255, 230, 90] : [170, 235, 255];
    const dot = (hc ? 3.4 : 2.4) / z;
    // Dots spaced in time: denser dots = slower motion — speed is readable at a glance.
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const a = (1 - u * 0.85) * (hc ? 1 : 0.9);
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${a})`;
      if (i % 2 === 0) continue;
      const s = dot * (1 - u * 0.4);
      ctx.beginPath();
      ctx.arc(p.points[i * 2]!, p.points[i * 2 + 1]!, s, 0, TAU);
      ctx.fill();
    }
    const st = g.stats;
    const ex = p.endX;
    const ey = p.endY;
    if (st.predictImpact && !p.truncated) {
      if (p.endEvent === Ev.Land) {
        const bounced = p.firstImpactBody >= 0;
        ctx.strokeStyle = bounced ? 'rgba(255,200,90,0.95)' : 'rgba(120,255,160,0.95)';
        ctx.lineWidth = 2.5 / z;
        ctx.beginPath();
        ctx.arc(ex, ey, 11 / z, 0, TAU);
        ctx.stroke();
        if (bounced) {
          ctx.strokeStyle = 'rgba(255,200,90,0.8)';
          ctx.beginPath();
          ctx.arc(p.firstImpactX, p.firstImpactY, 8 / z, 0, TAU);
          ctx.stroke();
        }
      } else if (p.endEvent === Ev.Crash || p.endEvent === Ev.Collapse) {
        this.drawX(ctx, ex, ey, 10 / z, 'rgba(255,80,80,0.95)', 3 / z);
      }
      if (p.firstImpactEvent === Ev.HardImpact || p.firstImpactEvent === Ev.AsteroidHit) this.drawX(ctx, p.firstImpactX, p.firstImpactY, 9 / z, 'rgba(255,120,60,0.95)', 3 / z);
    } else if (p.lost) {
      ctx.fillStyle = 'rgba(255,120,120,0.8)';
      ctx.beginPath();
      ctx.arc(ex, ey, 5 / z, 0, TAU);
      ctx.fill();
    }
    // Future Paths: ghost moving bodies where they will be at the end of the prediction.
    if (st.predictGhosts) {
      const w = g.world!;
      if (this.ghostWorld !== w) {
        this.ghostFrame = w.newFrame();
        this.ghostWorld = w;
      }
      const tEnd = g.probe.t + (n - 1) * 2 * DT + (g.phase === 'landed' ? 0 : 0);
      const gf = this.ghostFrame!;
      gf.t = NaN;
      gf.eval(w.bodies, tEnd);
      ctx.strokeStyle = 'rgba(200,230,255,0.4)';
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([5 / z, 5 / z]);
      for (const b of w.bodies) {
        if (!b.moving || !b.revealed || b.type.id === 'asteroid') continue;
        ctx.beginPath();
        ctx.arc(gf.x[b.index]!, gf.y[b.index]!, b.radius, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  private drawX(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, lw: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();
  }

  private drawReplay(ctx: CanvasRenderingContext2D, z: number): void {
    const g = this.game;
    const rp = g.replayPath();
    const report = g.incident;
    if (!rp || rp.count < 2) {
      if (report) this.drawX(ctx, report.x, report.y, 14 / z, 'rgba(255,80,80,0.95)', 4 / z);
      return;
    }
    const { path, count } = rp;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2 / z;
    ctx.beginPath();
    ctx.moveTo(path[0]!, path[1]!);
    for (let i = 1; i < count; i++) ctx.lineTo(path[i * 2]!, path[i * 2 + 1]!);
    ctx.stroke();
    // Animated replay head.
    const dur = clamp(count / 90, 1.2, 3.2);
    const u = (((this.now - this.incidentStart) / dur) % 1.35) / 1;
    const upto = Math.min(count - 1, Math.floor(u * count));
    ctx.strokeStyle = 'rgba(255,180,120,0.9)';
    ctx.lineWidth = 3 / z;
    ctx.beginPath();
    ctx.moveTo(path[0]!, path[1]!);
    for (let i = 1; i <= upto; i++) ctx.lineTo(path[i * 2]!, path[i * 2 + 1]!);
    ctx.stroke();
    const hx = path[upto * 2]!;
    const hy = path[upto * 2 + 1]!;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hx, hy, 5 / z, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,255,200,0.9)';
    ctx.beginPath();
    ctx.arc(path[0]!, path[1]!, 5 / z, 0, TAU);
    ctx.fill();
    if (report) {
      this.drawX(ctx, report.x, report.y, 14 / z, 'rgba(255,80,80,0.95)', 4 / z);
      if (report.nearMiss) {
        const b = g.world!.bodies[report.nearMiss.body]!;
        const f = g.frame;
        ctx.strokeStyle = 'rgba(120,255,160,0.7)';
        ctx.setLineDash([6 / z, 6 / z]);
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(f.x[b.index]!, f.y[b.index]!, b.radius + 14 / z, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private updateTrail(x: number, y: number, t: number, flying: boolean): void {
    if (!flying) return;
    const i = this.trailHead;
    const g = this.game;
    this.trailX[i] = x;
    this.trailY[i] = y;
    this.trailT[i] = t;
    this.trailS[i] = len(g.probe.vx, g.probe.vy);
    this.trailHead = (i + 1) % TRAIL;
    this.trailLen = Math.min(TRAIL, this.trailLen + 1);
  }

  private drawTrail(ctx: CanvasRenderingContext2D, z: number, t: number): void {
    const n = this.trailLen;
    if (n < 2) return;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 1; k < n; k++) {
      const i0 = (this.trailHead - n + k - 1 + TRAIL * 2) % TRAIL;
      const i1 = (i0 + 1) % TRAIL;
      const age = t - this.trailT[i1]!;
      if (age > 1.6 || age < 0) continue;
      const a = (1 - age / 1.6) * (k / n);
      const sp = this.trailS[i1]!;
      const hot = clamp((sp - 250) / 500, 0, 1);
      ctx.strokeStyle = `rgba(${Math.round(120 + hot * 135)},${Math.round(220 - hot * 90)},255,${a * 0.8})`;
      ctx.lineWidth = (1 + 4 * a) / z;
      ctx.beginPath();
      ctx.moveTo(this.trailX[i0]!, this.trailY[i0]!);
      ctx.lineTo(this.trailX[i1]!, this.trailY[i1]!);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawProbe(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, t: number): void {
    const g = this.game;
    const s = g.probe;
    const f = g.frame;
    const r = Math.max(g.sim.probeRadius, 4 / z);
    if (s.hookBody >= 0 && s.t < s.hookUntil) {
      ctx.strokeStyle = 'rgba(157,255,157,0.7)';
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(f.x[s.hookBody]!, f.y[s.hookBody]!);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (s.lockBody >= 0) {
      ctx.strokeStyle = 'rgba(255,211,107,0.55)';
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath();
      ctx.arc(f.x[s.lockBody]!, f.y[s.lockBody]!, s.lockRadius, 0, TAU);
      ctx.stroke();
    }
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    glow.addColorStop(0, 'rgba(190,245,255,0.7)');
    glow.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4fdff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    // Heading tick.
    const sp = len(s.vx, s.vy);
    if (g.phase === 'flight' && sp > 5) {
      ctx.strokeStyle = 'rgba(40,90,140,0.9)';
      ctx.lineWidth = r * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, Math.atan2(s.vy, s.vx) - 0.9, Math.atan2(s.vy, s.vx) + 0.9);
      ctx.stroke();
    }
    // Thrust flame.
    if (s.thrustX || s.thrustY) {
      const tl = len(s.thrustX, s.thrustY);
      const fx = -s.thrustX / tl;
      const fy = -s.thrustY / tl;
      const flick = 0.8 + Math.random() * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,170,90,0.8)';
      ctx.beginPath();
      ctx.moveTo(x + fy * r * 0.6, y - fx * r * 0.6);
      ctx.lineTo(x + fx * r * 3.2 * flick, y + fy * r * 3.2 * flick);
      ctx.lineTo(x - fy * r * 0.6, y + fx * r * 0.6);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Launch direction arrow while aiming.
    if (g.aim.valid && g.phase === 'landed') {
      const L = (30 + 70 * g.aim.power) / z;
      const ax = x + g.aim.dirX * L;
      const ay = y + g.aim.dirY * L;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5 / z;
      ctx.beginPath();
      ctx.moveTo(x + g.aim.dirX * r * 1.6, y + g.aim.dirY * r * 1.6);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      const h = 8 / z;
      const nx = -g.aim.dirY;
      const ny = g.aim.dirX;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(ax + g.aim.dirX * h, ay + g.aim.dirY * h);
      ctx.lineTo(ax + nx * h * 0.6, ay + ny * h * 0.6);
      ctx.lineTo(ax - nx * h * 0.6, ay - ny * h * 0.6);
      ctx.fill();
    }
    void t;
  }

  private drawBadges(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.game;
    const w = g.world!;
    const f = g.frame;
    const cam = g.camera;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of w.bodies) {
      if (!b.revealed || b.type.id === 'asteroid' || !f.active[b.index]) continue;
      const sx = cam.toScreenX(f.x[b.index]!);
      const sy = cam.toScreenY(f.y[b.index]!);
      const sr = b.radius * cam.zoom;
      if (sx < -80 || sx > this.w + 80 || sy < -80 || sy > this.h + 80) continue;
      const items: { text: string; color: string }[] = [];
      if (b.index === w.goalBody) items.push({ text: w.meta.kind === 'boss' ? '★ BEACON' : '⌂ GATE', color: '#7df9ff' });
      if (b.tags.has('unknown') && !b.identified) items.push({ text: '?', color: '#bcd4ff' });
      else if (b.scanned && !b.collected && b.type.landable && b.index !== w.goalBody && g.mode === 'run') {
        if (b.matter > 0) items.push({ text: `◆${Math.round(b.matter * g.stats.matterMult * (b.type.danger >= 2 ? 1 + g.stats.riskMatter : 1))}`, color: '#ffd9a8' });
        if (b.type.rewards.fuel) items.push({ text: 'FUEL', color: '#9dd8ff' });
        if (b.type.rewards.energy) items.push({ text: 'ϟ', color: '#d6b8ff' });
        if (b.type.rewards.data) items.push({ text: '◈', color: '#b594ff' });
      }
      if (b.scanned && b.tags.has('unstable') && b.identified) items.push({ text: '⚠', color: '#ffb35c' });
      if (b.scanned && b.type.danger >= 2 && !b.type.landable) items.push({ text: '☠', color: '#ff7a7a' });
      if (b.visited && b.collected && b.index !== w.goalBody && b.index !== w.startBody && g.mode === 'run') items.push({ text: '✓', color: 'rgba(160,255,190,0.6)' });
      if (!items.length) continue;
      const fs = 12;
      ctx.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
      let total = 0;
      const widths = items.map((it) => ctx.measureText(it.text).width + 10);
      for (const wv of widths) total += wv + 4;
      let x = sx - total / 2;
      const y = sy + sr + 16;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const bw = widths[i]!;
        ctx.fillStyle = 'rgba(6,10,24,0.62)';
        roundRect(ctx, x, y - 10, bw, 20, 10);
        ctx.fill();
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, x + bw / 2, y + 0.5);
        x += bw + 4;
      }
      // Eruption / collapse countdown text for the world we stand on.
      if (g.probe.landed === b.index) {
        let warn = '';
        if (b.collapseAt < Infinity) warn = `Collapse ${Math.max(0, b.collapseAt - t).toFixed(1)}s`;
        else if (b.type.behavior?.kind === 'erupt') {
          const left = b.timeToEruption(t);
          if (left < 3) warn = `Eruption ${left.toFixed(1)}s`;
        }
        if (warn) {
          ctx.font = '700 13px system-ui, sans-serif';
          ctx.fillStyle = '#ffb35c';
          ctx.fillText(warn, sx, sy - sr - 18);
        }
      }
    }
  }

  private drawOffscreen(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.game;
    const w = g.world!;
    const f = g.frame;
    const cam = g.camera;
    const targets: { x: number; y: number; color: string; label: string }[] = [];
    if (w.goalBody >= 0) targets.push({ x: f.x[w.goalBody]!, y: f.y[w.goalBody]!, color: '#7df9ff', label: w.meta.kind === 'boss' ? '★' : '⌂' });
    for (const b of w.bodies) {
      if (b.tags.has('boss')) targets.push({ x: f.x[b.index]!, y: f.y[b.index]!, color: '#ff5c7a', label: '!' });
      if (!b.revealed && b.hiddenRange > 0 && g.mode === 'run' && g.signaled.has(b.index)) targets.push({ x: f.x[b.index]!, y: f.y[b.index]!, color: `rgba(107,255,176,${0.5 + 0.5 * Math.sin(t * 5)})`, label: '?' });
    }
    // Keep indicators clear of the top bar and bottom controls.
    const m = 24;
    const top = 104;
    const bottom = 150;
    for (const tg of targets) {
      const sx = cam.toScreenX(tg.x);
      const sy = cam.toScreenY(tg.y);
      if (sx > m && sx < this.w - m && sy > 0 && sy < this.h) continue;
      const cx = this.w / 2;
      const cy = (top + this.h - bottom) / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min((this.w / 2 - m) / Math.abs(dx || 1e-6), ((this.h - top - bottom) / 2) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const a = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.fillStyle = tg.color;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-6, 8);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = tg.color;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tg.label, ex - Math.cos(a) * 18, ey - Math.sin(a) * 18);
    }
  }

  private drawAim(ctx: CanvasRenderingContext2D): void {
    const a = this.game.aim;
    if (!a.active) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(a.sx, a.sy, 16, 0, TAU);
    ctx.stroke();
    if (!a.valid) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(a.cx, a.cy);
    ctx.stroke();
    ctx.setLineDash([]);
    // Power arc around the finger.
    ctx.strokeStyle = a.power > 0.98 ? '#ffd36b' : '#aee9ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(a.cx, a.cy, 26, -Math.PI / 2, -Math.PI / 2 + TAU * a.power);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(a.speed)}`, a.cx, a.cy - 42);
  }

  private drawThrust(ctx: CanvasRenderingContext2D): void {
    const th = this.game.thrust;
    if (!th.active) return;
    const noFuel = (this.game.run?.fuel ?? 0) <= 0;
    ctx.strokeStyle = noFuel ? 'rgba(255,120,120,0.5)' : 'rgba(255,190,120,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(th.sx, th.sy, 50, 0, TAU);
    ctx.stroke();
    const kx = th.sx + th.x * th.mag * 50;
    const ky = th.sy + th.y * th.mag * 50;
    ctx.fillStyle = noFuel ? 'rgba(255,120,120,0.7)' : 'rgba(255,190,120,0.8)';
    ctx.beginPath();
    ctx.arc(kx, ky, 12, 0, TAU);
    ctx.fill();
    if (noFuel) {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NO FUEL', th.sx, th.sy - 64);
    }
  }

  private drawEdgeWarning(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const g = this.game;
    if (g.phase !== 'flight') return;
    const b = g.world!.bounds;
    const out = Math.max(b.minX - x, x - b.maxX, b.minY - y, y - b.maxY, 0);
    if (out <= 0) return;
    const a = clamp(out / 520, 0, 1);
    const grad = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    grad.addColorStop(0, 'rgba(255,40,60,0)');
    grad.addColorStop(1, `rgba(255,40,60,${0.45 * a})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = `rgba(255,160,160,${0.5 + 0.5 * a})`;
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`SIGNAL FADING ${Math.round((1 - a) * 100)}%`, this.w / 2, 96);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
