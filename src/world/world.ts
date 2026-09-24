import { Body, BodyFrame, type BodyInit } from '../physics/body';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type SectorKind = 'tutorial' | 'normal' | 'boss';

export interface SectorMeta {
  kind: SectorKind;
  name: string;
  subtitle: string;
  regionId: string;
  index: number;
  seed: number;
  /** Tutorial / onboarding text shown at sector start. */
  prompt?: string;
}

/** A playable space: immutable layout + mutable per-body gameplay state. */
export class World {
  readonly bodies: Body[] = [];
  readonly bounds: Bounds;
  readonly meta: SectorMeta;
  startBody = 0;
  goalBody = -1;
  /** Pre-computed validated routes between bodies (for hints and fairness checks). */
  validatedEdges: [number, number][] = [];
  /** Which generation attempt produced this layout (lets a worker validate, main thread rebuild). */
  attempt = 0;

  constructor(meta: SectorMeta, bounds: Bounds) {
    this.meta = meta;
    this.bounds = bounds;
  }

  add(init: BodyInit): Body {
    if (init.orbit && init.orbit.parent !== null && init.orbit.parent >= this.bodies.length) {
      throw new Error('Orbit parent must be added before its child');
    }
    const b = new Body(this.bodies.length, init);
    this.bodies.push(b);
    return b;
  }

  newFrame(): BodyFrame {
    return new BodyFrame(this.bodies.length);
  }

  /** Probe is considered lost once it is well outside the playable bounds. */
  isLost(x: number, y: number, margin = 520): boolean {
    const b = this.bounds;
    return x < b.minX - margin || x > b.maxX + margin || y < b.minY - margin || y > b.maxY + margin;
  }
}
