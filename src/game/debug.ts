import { RouteSolver } from '../physics/solver';
import { attachLanded } from '../physics/sim';
import type { Game } from './game';

/**
 * Dev-only automation hooks (window.__pb). Lets scripted play-tests fly real routes through
 * the real simulation — the same solver that validates sectors.
 */
export function installDebug(game: Game, app: unknown): void {
  const api = {
    app,
    game,
    /** Launch from the current world toward body `to` using the route solver. Returns success. */
    flyTo(to: number): boolean {
      const w = game.world;
      if (!w || game.phase !== 'landed') return false;
      const from = game.probe.landed;
      const solver = new RouteSolver(w);
      // Mirror a player crawling to the side facing the target.
      const r = solver.solve(from, to, game.sim, {
        times: [game.probe.t],
        surfaceOffsets: [0, 0.6, -0.6],
        maxSpeed: game.stats.maxLaunch,
        minSpeed: game.stats.minLaunch,
        angleSteps: 61,
        speedSteps: 16,
        fan: 1.5,
        seconds: 8,
      });
      if (!r.ok) return false;
      const b = w.bodies[from]!;
      game.probe.landAngle = r.landAngle + b.rotationAt(r.t0) - b.rotationAt(game.probe.t);
      game.frame.t = NaN;
      game.frame.eval(w.bodies, game.probe.t);
      attachLanded(w.bodies, game.frame, game.probe, game.sim);
      const a = game.aim;
      a.dirX = r.dirX;
      a.dirY = r.dirY;
      a.speed = r.speed;
      a.valid = true;
      (game as unknown as { doLaunch(): void }).doLaunch();
      a.valid = false;
      return true;
    },
    /** Next body along validated edges toward the goal (BFS). */
    nextHop(): number {
      const w = game.world!;
      const from = game.probe.landed;
      const adj = new Map<number, number[]>();
      for (const [u, v] of w.validatedEdges) adj.set(u, [...(adj.get(u) ?? []), v]);
      const prev = new Map<number, number>([[from, -1]]);
      const q = [from];
      while (q.length) {
        const u = q.shift()!;
        if (u === w.goalBody) break;
        for (const v of adj.get(u) ?? []) if (!prev.has(v)) {
          prev.set(v, u);
          q.push(v);
        }
      }
      let cur = w.goalBody;
      if (!prev.has(cur)) return w.goalBody;
      while (prev.get(cur) !== from && prev.get(cur) !== -1) cur = prev.get(cur)!;
      return cur;
    },
  };
  (window as unknown as { __pb: typeof api }).__pb = api;
}
