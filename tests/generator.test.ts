import { describe, expect, it } from 'vitest';
import { REGIONS } from '../src/data/regions';
import { DEFAULT_SIM_PARAMS } from '../src/physics/sim';
import { RouteSolver } from '../src/physics/solver';
import { generateRef, generateSector, rebuildFromRef, validateWorld } from '../src/world/generator';
import { TUTORIAL } from '../src/world/tutorial';

const layout = (seed: number, idx: number) =>
  generateSector({ regionId: 'innerBelt', sectorIndex: idx, runSeed: seed, skipValidation: true }).bodies.map((b) => [b.type.id, Math.round(b.x0), Math.round(b.y0), b.radius]);

describe('sector generator', () => {
  it('is deterministic for a seed', () => {
    expect(layout(8392741, 1)).toEqual(layout(8392741, 1));
    expect(layout(8392741, 1)).not.toEqual(layout(8392742, 1));
  });

  it('produces validated, fair sectors across many seeds', () => {
    for (const region of REGIONS) {
      for (let idx = 0; idx <= region.sectors.length; idx++) {
        for (let seed = 1; seed <= 4; seed++) {
          const w = generateSector({ regionId: region.id, sectorIndex: idx, runSeed: seed * 7919 });
          const report = validateWorld(w);
          expect(report.reachable.has(w.goalBody), `${region.id}#${idx} seed ${seed}: gate reachable`).toBe(true);
          expect(report.traps, `${region.id}#${idx} seed ${seed}: no traps`).toEqual([]);
        }
      }
    }
  }, 120_000);

  it('rebuilds the identical validated layout from a worker reference', () => {
    const o = { regionId: 'innerBelt', sectorIndex: 1, runSeed: 424242 };
    const ref = generateRef(o);
    const a = generateSector(o).bodies.map((b) => [b.type.id, b.x0, b.y0]);
    const b = rebuildFromRef(o, ref).bodies.map((b) => [b.type.id, b.x0, b.y0]);
    expect(b).toEqual(a);
  });
});

describe('tutorial design', () => {
  it('every step is solvable with base stats', () => {
    for (const step of TUTORIAL) {
      const w = step.build();
      const r = new RouteSolver(w).solve(w.startBody, w.goalBody, DEFAULT_SIM_PARAMS, { maxSpeed: 400, seconds: 8, angleSteps: 41, speedSteps: 14 });
      expect(r.ok, step.name).toBe(true);
    }
  });

  it('the slingshot step cannot be done by aiming straight at the target', () => {
    const step = TUTORIAL[2]!;
    const w = step.build();
    const r = new RouteSolver(w).solve(w.startBody, w.goalBody, DEFAULT_SIM_PARAMS, { maxSpeed: 430, seconds: 8, fan: 0.08, angleSteps: 3, speedSteps: 20 });
    expect(r.ok).toBe(false);
  });
});
