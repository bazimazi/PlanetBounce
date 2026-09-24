import { clamp, damp } from '../core/math';

/** Smooth, gameplay-first camera. Framing targets are set by the game; the camera eases toward them. */
export class Camera {
  x = 0;
  y = 0;
  /** Pixels per world unit (CSS pixels). */
  zoom = 0.5;
  tx = 0;
  ty = 0;
  tzoom = 0.5;
  width = 1;
  height = 1;
  shakeAmp = 0;
  shakeX = 0;
  shakeY = 0;
  shakeScale = 1;
  followRate = 4;
  zoomRate = 2.2;
  private shakeT = 0;

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }

  /** Zoom that fits `size` world units into the smaller screen dimension. */
  zoomFor(size: number): number {
    return Math.min(this.width, this.height) / size;
  }

  /** Frame a world-space box (with padding), respecting zoom limits. */
  frameBox(minX: number, minY: number, maxX: number, maxY: number, pad = 1.25, minView = 720, maxView = 2600): void {
    this.tx = (minX + maxX) / 2;
    this.ty = (minY + maxY) / 2;
    const w = Math.max(1, (maxX - minX) * pad);
    const h = Math.max(1, (maxY - minY) * pad);
    const zoom = Math.min(this.width / w, this.height / h);
    const zMin = this.zoomFor(maxView);
    const zMax = this.zoomFor(minView);
    this.tzoom = clamp(zoom, zMin, zMax);
  }

  snap(): void {
    this.x = this.tx;
    this.y = this.ty;
    this.zoom = this.tzoom;
  }

  shake(amount: number): void {
    this.shakeAmp = Math.min(24, Math.max(this.shakeAmp, amount * this.shakeScale));
  }

  update(dt: number): void {
    this.x = damp(this.x, this.tx, this.followRate, dt);
    this.y = damp(this.y, this.ty, this.followRate, dt);
    // Zoom in log space so zooming in and out feel symmetric.
    this.zoom = Math.exp(damp(Math.log(this.zoom), Math.log(this.tzoom), this.zoomRate, dt));
    this.shakeT += dt;
    this.shakeAmp = damp(this.shakeAmp, 0, 7, dt);
    this.shakeX = Math.sin(this.shakeT * 71) * this.shakeAmp;
    this.shakeY = Math.cos(this.shakeT * 57) * this.shakeAmp;
  }

  toScreenX(wx: number): number {
    return (wx - this.x) * this.zoom + this.width / 2 + this.shakeX;
  }

  toScreenY(wy: number): number {
    return (wy - this.y) * this.zoom + this.height / 2 + this.shakeY;
  }

  toWorldX(sx: number): number {
    return (sx - this.width / 2 - this.shakeX) / this.zoom + this.x;
  }

  toWorldY(sy: number): number {
    return (sy - this.height / 2 - this.shakeY) / this.zoom + this.y;
  }

  /** Visible world rect half-extents. */
  get halfW(): number {
    return this.width / 2 / this.zoom;
  }

  get halfH(): number {
    return this.height / 2 / this.zoom;
  }
}
