/**
 * Pooled particle system (struct-of-arrays, zero allocation per frame). Particles live in
 * world space and are drawn with the world transform already applied.
 */
export class Particles {
  readonly cap: number;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private drag: Float32Array;
  private color: string[];
  private additive: Uint8Array;
  private count = 0;
  budget = 1;

  constructor(cap = 900) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.color = new Array<string>(cap).fill('#fff');
    this.additive = new Uint8Array(cap);
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, additive = true, drag = 1.5): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.color[i] = color;
    this.additive[i] = additive ? 1 : 0;
    this.drag[i] = drag;
  }

  burst(x: number, y: number, n: number, speed: number, life: number, size: number, color: string, opts: { dirX?: number; dirY?: number; spread?: number; additive?: boolean; drag?: number } = {}): void {
    n = Math.round(n * this.budget);
    const spread = opts.spread ?? Math.PI * 2;
    const base = opts.dirX !== undefined ? Math.atan2(opts.dirY ?? 0, opts.dirX) : 0;
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * spread;
      const sp = speed * (0.35 + Math.random() * 0.8);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.5 + Math.random() * 0.7), size * (0.5 + Math.random()), color, opts.additive ?? true, opts.drag ?? 1.5);
    }
  }

  ring(x: number, y: number, radius: number, n: number, speed: number, life: number, size: number, color: string): void {
    n = Math.round(n * this.budget);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn(x + Math.cos(a) * radius, y + Math.sin(a) * radius, Math.cos(a) * speed, Math.sin(a) * speed, life, size, color, true, 2);
    }
  }

  clear(): void {
    this.count = 0;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        const last = --this.count;
        if (i !== last) {
          this.x[i] = this.x[last]!;
          this.y[i] = this.y[last]!;
          this.vx[i] = this.vx[last]!;
          this.vy[i] = this.vy[last]!;
          this.life[i] = this.life[last]!;
          this.max[i] = this.max[last]!;
          this.size[i] = this.size[last]!;
          this.color[i] = this.color[last]!;
          this.additive[i] = this.additive[last]!;
          this.drag[i] = this.drag[last]!;
        }
        continue;
      }
      const k = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= k;
      this.vy[i]! *= k;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      i++;
    }
  }

  draw(ctx: CanvasRenderingContext2D, minSize: number): void {
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass === 1 ? 'lighter' : 'source-over';
      for (let i = 0; i < this.count; i++) {
        if (this.additive[i] !== pass) continue;
        const t = this.life[i]! / this.max[i]!;
        const s = Math.max(minSize, this.size[i]! * (0.4 + 0.6 * t));
        ctx.globalAlpha = Math.min(1, t * 1.4);
        ctx.fillStyle = this.color[i]!;
        ctx.fillRect(this.x[i]! - s / 2, this.y[i]! - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
