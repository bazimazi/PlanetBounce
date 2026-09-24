import { TAU, dist } from '../core/math';
import { Rng, hash2 } from '../core/rng';
import { PLANET_TYPES, type PlanetTypeId } from '../data/planetTypes';
import { regionById, type RegionDefinition, type SectorConfig, type BossId } from '../data/regions';
import type { BodyInit, BodyTag } from '../physics/body';
import { DEFAULT_SIM_PARAMS, type SimParams } from '../physics/sim';
import { RouteSolver } from '../physics/solver';
import { World, type Bounds } from './world';

/**
 * Curated procedural generation. Layouts are built from intent (a main route, side branches,
 * a slingshot shortcut, mysteries) and then VALIDATED with the real physics: the gate must be
 * reachable, and every optional world must be reachable and escapable. Unfair layouts are
 * regenerated — the generator is fixed, never the player blamed.
 */

interface Placed {
  x: number;
  y: number;
  extent: number;
}

interface Draft {
  inits: BodyInit[];
  placed: Placed[];
  spine: number[];
  gate: number;
}

const VALIDATION_PARAMS: SimParams = { ...DEFAULT_SIM_PARAMS };
const VALIDATION_MAX_SPEED = 400; // below the base launch cap: every route has slack

const SYLLABLES = ['ka', 've', 'lor', 'tis', 'mar', 'on', 'eri', 'dun', 'sol', 'rho', 'thal', 'ix', 'ne', 'vos', 'ar', 'cy', 'lum', 'ta'];

export function sectorName(rng: Rng): string {
  const n = rng.int(2, 3);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
  const suffix = rng.pick(['Drift', 'Reach', 'Expanse', 'Verge', 'Shallows', 'Cascade', 'Hollow', 'Span']);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${suffix}`;
}

function makeInit(rng: Rng, type: PlanetTypeId, x: number, y: number, extra: Partial<BodyInit> = {}): BodyInit {
  const t = PLANET_TYPES[type];
  return {
    type: t,
    x,
    y,
    radius: Math.round(rng.range(t.radius[0], t.radius[1])),
    rotSpeed: rng.range(t.rotation[0], t.rotation[1]) * rng.sign(),
    rot0: rng.range(0, TAU),
    matter: Math.round(rng.range(t.rewards.matter[0], t.rewards.matter[1])),
    behaviorPhase: rng.range(0, 10),
    ...extra,
  };
}

function fits(d: Draft, x: number, y: number, extent: number, gap = 120): boolean {
  for (const p of d.placed) {
    if (dist(x, y, p.x, p.y) < extent + p.extent + gap) return false;
  }
  return true;
}

function push(d: Draft, init: BodyInit, extent: number): number {
  d.inits.push(init);
  d.placed.push({ x: init.x, y: init.y, extent });
  return d.inits.length - 1;
}

function computeBounds(inits: BodyInit[], margin = 420): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of inits) {
    if (b.drift) continue;
    const ext = b.radius + (b.orbit ? b.orbit.radius : 0);
    const cx = b.orbit && b.orbit.parent === null ? b.orbit.cx : b.x;
    const cy = b.orbit && b.orbit.parent === null ? b.orbit.cy : b.y;
    minX = Math.min(minX, cx - ext);
    maxX = Math.max(maxX, cx + ext);
    minY = Math.min(minY, cy - ext);
    maxY = Math.max(maxY, cy + ext);
  }
  return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
}

/** Adds a moon on a circular orbit around body `parent`. */
function addMoon(rng: Rng, d: Draft, parent: number): void {
  const p = d.inits[parent]!;
  const moonType = PLANET_TYPES.moon;
  const mr = Math.round(rng.range(moonType.radius[0], moonType.radius[1]));
  const orbitR = p.radius * rng.range(2.3, 2.9) + mr;
  const extent = orbitR + mr;
  // Grow the parent's footprint rather than placing the moon as a separate point.
  const placedParent = d.placed[parent]!;
  const needed = extent;
  // Only add if the grown footprint still fits among other placements.
  const others = d.placed.filter((_, i) => i !== parent);
  for (const o of others) {
    if (dist(o.x, o.y, placedParent.x, placedParent.y) < needed + o.extent + 60) return;
  }
  placedParent.extent = Math.max(placedParent.extent, extent);
  const period = rng.range(10, 16) * rng.sign();
  d.inits.push(
    makeInit(rng, 'moon', p.x + orbitR, p.y, {
      radius: mr,
      orbit: { parent, cx: 0, cy: 0, radius: orbitR, period, phase: rng.range(0, TAU) },
      tags: ['fuel'],
    }),
  );
  d.placed.push({ x: p.x, y: p.y, extent: 0 });
}

function addBinary(rng: Rng, d: Draft, x: number, y: number, tags: BodyTag[]): number {
  const a: PlanetTypeId = rng.pick(['rocky', 'ice', 'moon'] as PlanetTypeId[]);
  const b: PlanetTypeId = rng.pick(['rocky', 'crystal', 'moon'] as PlanetTypeId[]);
  const ia = makeInit(rng, a, x, y);
  const ib = makeInit(rng, b, x, y);
  const sep = (ia.radius + ib.radius) * 1.25 + 40;
  const period = rng.range(9, 13) * rng.sign();
  const phase = rng.range(0, TAU);
  ia.orbit = { parent: null, cx: x, cy: y, radius: sep, period, phase };
  ib.orbit = { parent: null, cx: x, cy: y, radius: sep, period, phase: phase + Math.PI };
  ia.tags = [...tags, 'rich'];
  ib.tags = [...tags];
  ia.name = `${PLANET_TYPES[a].name} (Binary)`;
  ib.name = `${PLANET_TYPES[b].name} (Binary)`;
  const extent = sep + Math.max(ia.radius, ib.radius);
  const first = push(d, ia, extent);
  d.inits.push(ib);
  d.placed.push({ x, y, extent: 0 });
  return first;
}

function draftNormal(rng: Rng, cfg: SectorConfig, depth: number): Draft {
  const d: Draft = { inits: [], placed: [], spine: [], gate: -1 };
  const start = makeInit(rng, 'rocky', 0, 0, { tags: ['start'], radius: 52 });
  d.spine.push(push(d, start, start.radius));

  const spineCount = rng.int(cfg.spine[0], cfg.spine[1]);
  let x = 0;
  let y = 0;
  let lastDanger = 0;
  for (let i = 0; i < spineCount; i++) {
    let placedIdx = -1;
    for (let attempt = 0; attempt < 12 && placedIdx < 0; attempt++) {
      const ny = y - rng.range(cfg.spacing[0], cfg.spacing[1]);
      const nx = Math.max(-cfg.lateral, Math.min(cfg.lateral, x + rng.range(-260, 260)));
      if (cfg.binaryChance > 0 && i > 0 && rng.chance(cfg.binaryChance * 0.5)) {
        if (fits(d, nx, ny, 170)) {
          placedIdx = addBinary(rng, d, nx, ny, []);
          x = nx;
          y = ny;
          lastDanger = 1;
          break;
        }
        continue;
      }
      let type = rng.weighted<PlanetTypeId>(cfg.spineTypes);
      if (PLANET_TYPES[type].danger >= 2 && lastDanger >= 2) type = 'rocky';
      const init = makeInit(rng, type, nx, ny);
      if (!fits(d, nx, ny, init.radius)) continue;
      if (rng.chance(cfg.unstableChance) && (type === 'rocky' || type === 'ice')) {
        init.unstableFuse = rng.range(4.5, 6.5);
        init.tags = [...(init.tags ?? []), 'unstable'];
        init.matter = Math.round((init.matter ?? 0) * 1.8);
      }
      placedIdx = push(d, init, init.radius);
      lastDanger = PLANET_TYPES[type].danger;
      x = nx;
      y = ny;
    }
    if (placedIdx >= 0) d.spine.push(placedIdx);
  }

  // Gate at the top.
  const gy = y - rng.range(cfg.spacing[0], cfg.spacing[1]);
  const gx = Math.max(-cfg.lateral, Math.min(cfg.lateral, x + rng.range(-200, 200)));
  const gate = makeInit(rng, 'gate', gx, gy, { tags: ['gate'] });
  d.gate = push(d, gate, gate.radius);
  d.spine.push(d.gate);

  // Slingshot shortcut: a heavy world beside the route between two spine nodes.
  if (rng.chance(cfg.shortcut) && d.spine.length >= 3) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const k = rng.int(0, d.spine.length - 3);
      const a = d.inits[d.spine[k]!]!;
      const b = d.inits[d.spine[k + 2]!]!;
      const type = rng.weighted<PlanetTypeId>(cfg.shortcutTypes);
      const side = rng.sign();
      const sx = (a.x + b.x) / 2 + side * rng.range(280, 380);
      const sy = (a.y + b.y) / 2 + rng.range(-60, 60);
      const init = makeInit(rng, type, sx, sy, { tags: ['shortcut'] });
      if (fits(d, sx, sy, init.radius, 90)) {
        push(d, init, init.radius);
        break;
      }
    }
  }

  // Side branches: resource-rich or unknown worlds off the main route.
  const branchCount = rng.int(cfg.branches[0], cfg.branches[1]);
  let unknownsLeft = cfg.unknowns;
  for (let i = 0; i < branchCount; i++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const k = rng.int(0, d.spine.length - 2);
      const a = d.inits[d.spine[k]!]!;
      const b = d.inits[d.spine[k + 1]!]!;
      const side = rng.sign();
      const bx = (a.x + b.x) / 2 + side * rng.range(360, 480);
      const by = (a.y + b.y) / 2 + rng.range(-80, 80);
      const unknown = unknownsLeft > 0 && rng.chance(0.6);
      let type = rng.weighted<PlanetTypeId>(cfg.branchTypes);
      const tags: BodyTag[] = [];
      let matterMul = 1.3;
      if (unknown) {
        type = rng.weighted<PlanetTypeId>({ crystal: 2, pulsar: depth >= 2 ? 2 : 0, volcanic: 1, rocky: 2 });
        tags.push('unknown');
        matterMul = 2.2;
      }
      if (type === 'volcanic' || type === 'pulsar') tags.push('rich');
      const init = makeInit(rng, type, bx, by, { tags });
      init.matter = Math.round((init.matter ?? 0) * matterMul);
      if (unknown && type === 'rocky' && rng.chance(0.5)) {
        init.unstableFuse = rng.range(4, 6);
        tags.push('unstable');
      }
      if (!fits(d, bx, by, init.radius)) continue;
      push(d, init, init.radius);
      if (unknown) unknownsLeft--;
      break;
    }
  }

  // Moons orbiting some worlds (moving targets, fuel ice).
  const count = d.inits.length;
  for (let i = 1; i < count; i++) {
    const init = d.inits[i]!;
    if (init.orbit || init.tags?.includes('gate')) continue;
    const t = init.type.id;
    if ((t === 'rocky' || t === 'giant' || t === 'ice' || t === 'gasGiant') && rng.chance(cfg.moonChance)) addMoon(rng, d, i);
  }

  return d;
}

function addSecret(rng: Rng, d: Draft): void {
  for (let attempt = 0; attempt < 12; attempt++) {
    const k = rng.int(1, Math.max(1, d.spine.length - 2));
    const a = d.inits[d.spine[k]!]!;
    const side = rng.sign();
    const sx = a.x + side * rng.range(560, 720);
    const sy = a.y + rng.range(-150, 150);
    const init = makeInit(rng, 'derelict', sx, sy, { tags: ['secret'], hiddenRange: 420, name: 'Derelict Construct' });
    if (fits(d, sx, sy, init.radius, 140)) {
      push(d, init, init.radius);
      return;
    }
  }
}

function addAsteroidStreams(rng: Rng, d: Draft, count: number, bounds: Bounds): void {
  if (count <= 0) return;
  const solids = d.inits.filter((b) => !b.drift);
  const bandOk = (y: number) =>
    solids.every((b) => {
      const cy = b.orbit && b.orbit.parent === null ? b.orbit.cy : b.y;
      let ext = b.radius + (b.orbit ? b.orbit.radius : 0);
      if (b.orbit && b.orbit.parent !== null) {
        const p = d.inits[b.orbit.parent]!;
        return Math.abs(p.y - y) > b.orbit.radius + b.radius + 40;
      }
      ext += 40;
      return Math.abs(cy - y) > ext;
    });
  let made = 0;
  for (let attempt = 0; attempt < 20 && made < count; attempt++) {
    const k = rng.int(1, Math.max(1, d.spine.length - 2));
    const a = d.inits[d.spine[k - 1]!]!;
    const b = d.inits[d.spine[k]!]!;
    const y = (a.y + b.y) / 2 + rng.range(-40, 40);
    if (!bandOk(y)) continue;
    const minX = bounds.minX - 200;
    const maxX = bounds.maxX + 200;
    const w = maxX - minX;
    const n = Math.round(w / rng.range(150, 200));
    const vx = rng.sign() * rng.range(45, 80);
    for (let i = 0; i < n; i++) {
      if (rng.chance(0.18)) continue; // gaps make timing readable
      d.inits.push(
        makeInit(rng, 'asteroid', minX + (i / n) * w + rng.range(-20, 20), y + rng.range(-14, 14), {
          drift: { vx, vy: 0, minX, maxX, minY: 0, maxY: 0 },
        }),
      );
      d.placed.push({ x: 0, y: -1e9, extent: 0 });
    }
    made++;
  }
}

function buildWorld(d: Draft, meta: World['meta'], bounds?: Bounds): World {
  const w = new World(meta, bounds ?? computeBounds(d.inits));
  for (const init of d.inits) w.add(init);
  w.startBody = 0;
  w.goalBody = d.gate;
  return w;
}

export interface ValidationReport {
  ok: boolean;
  reachable: Set<number>;
  edges: [number, number][];
  traps: number[];
  unreachable: number[];
}

/** Physics-validated reachability over landable worlds. */
export function validateWorld(w: World, params: SimParams = VALIDATION_PARAMS): ValidationReport {
  const solver = new RouteSolver(w);
  const nodes = w.bodies.filter((b) => b.type.landable && !b.drift).map((b) => b.index);
  const reachable = new Set<number>([w.startBody]);
  const edges: [number, number][] = [];
  const outgoing = new Set<number>();
  const queue = [w.startBody];
  const f = w.newFrame();
  f.eval(w.bodies, 0);
  const dynamic = w.bodies.some((b) => b.mu > 0 && (!!b.drift || b.tags.has('boss')));
  const tryEdge = (u: number, v: number): boolean => {
    const moving = dynamic || w.bodies[u]!.moving || w.bodies[v]!.moving;
    const r = solver.solve(u, v, params, {
      maxSpeed: VALIDATION_MAX_SPEED,
      times: moving ? [0, 4, 8] : [0],
      angleSteps: 21,
      speedSteps: 9,
      seconds: 6,
    });
    if (r.ok) {
      edges.push([u, v]);
      outgoing.add(u);
    }
    return r.ok;
  };
  const d = (a: number, b: number) => dist(f.x[a]!, f.y[a]!, f.x[b]!, f.y[b]!);

  while (queue.length) {
    const u = queue.shift()!;
    const candidates = nodes.filter((v) => v !== u && !reachable.has(v) && d(u, v) < 1000).sort((a, b) => d(u, a) - d(u, b));
    for (const v of candidates) {
      if (reachable.has(v)) continue;
      if (tryEdge(u, v)) {
        reachable.add(v);
        queue.push(v);
      }
    }
  }

  // Every reached world (except the goal) must have a way out.
  const traps: number[] = [];
  for (const u of reachable) {
    if (u === w.goalBody || outgoing.has(u)) continue;
    const candidates = nodes.filter((v) => v !== u && d(u, v) < 1000).sort((a, b) => d(u, a) - d(u, b));
    if (!candidates.some((v) => tryEdge(u, v))) traps.push(u);
  }
  const unreachable = nodes.filter((n) => !reachable.has(n));
  return {
    ok: reachable.has(w.goalBody) && traps.length === 0 && unreachable.length === 0,
    reachable,
    edges,
    traps,
    unreachable,
  };
}

export interface GenerateOptions {
  regionId: string;
  sectorIndex: number;
  runSeed: number;
  /** Skip physics validation (tests of layout determinism only). */
  skipValidation?: boolean;
  /** Rebuild a specific attempt that was already validated elsewhere (e.g. in a worker). */
  forceAttempt?: number;
}

export function sectorSeed(runSeed: number, regionId: string, index: number): number {
  let h = hash2(runSeed, index + 1);
  for (let i = 0; i < regionId.length; i++) h = hash2(h, regionId.charCodeAt(i));
  return h;
}

export function generateSector(o: GenerateOptions): World {
  const region = regionById(o.regionId);
  const seed = sectorSeed(o.runSeed, region.id, o.sectorIndex);
  if (o.sectorIndex >= region.sectors.length) return generateBoss(region, seed, o.sectorIndex, o.forceAttempt);
  const cfg = region.sectors[o.sectorIndex]!;
  const nameRng = new Rng(seed).fork('name');
  const meta = {
    kind: 'normal' as const,
    name: sectorName(nameRng),
    subtitle: cfg.introduces ?? region.subtitle,
    regionId: region.id,
    index: o.sectorIndex,
    seed,
  };

  let best: World | null = null;
  const forced = o.forceAttempt;
  if (forced !== undefined && forced < 0) return fallbackSector(meta);
  const first = forced ?? 0;
  const last = forced ?? 13;
  for (let attempt = first; attempt <= last; attempt++) {
    const rng = new Rng(hash2(seed, attempt));
    const d = draftNormal(rng, cfg, o.sectorIndex);
    if (rng.chance(cfg.secretChance)) addSecret(rng, d);
    const bounds = computeBounds(d.inits);
    // Validate before asteroids are appended: streams are timing hazards with gaps, and leaving
    // them out keeps indices identical while making validation several times cheaper.
    const report = o.skipValidation || forced !== undefined ? null : validateWorld(buildWorld(d, meta, bounds));
    addAsteroidStreams(rng, d, rng.int(cfg.asteroidStreams[0], cfg.asteroidStreams[1]), bounds);
    const w = buildWorld(d, meta, bounds);
    w.attempt = attempt;
    if (!report) return w;
    w.validatedEdges = report.edges;
    if (report.ok) return w;
    if (!best && report.reachable.has(w.goalBody) && report.traps.length === 0) best = w;
  }
  return best ?? fallbackSector(meta);
}

/** Result a worker can post back cheaply; the main thread rebuilds the exact same world. */
export interface GeneratedRef {
  attempt: number;
  edges: [number, number][];
}

export function generateRef(o: GenerateOptions): GeneratedRef {
  const w = generateSector(o);
  return { attempt: w.attempt, edges: w.validatedEdges };
}

export function rebuildFromRef(o: GenerateOptions, ref: GeneratedRef): World {
  const w = generateSector({ ...o, forceAttempt: ref.attempt });
  w.validatedEdges = ref.edges;
  return w;
}

/** Guaranteed-fair minimal sector, used only if every attempt failed validation. */
function fallbackSector(meta: World['meta']): World {
  const rng = new Rng(meta.seed ^ 0xabcdef);
  const d: Draft = { inits: [], placed: [], spine: [], gate: -1 };
  push(d, makeInit(rng, 'rocky', 0, 0, { tags: ['start'], radius: 52 }), 52);
  push(d, makeInit(rng, 'rocky', 140, -380), 60);
  push(d, makeInit(rng, 'crystal', -120, -760), 40);
  d.gate = push(d, makeInit(rng, 'gate', 60, -1140, { tags: ['gate'] }), 34);
  const w = buildWorld(d, meta);
  w.attempt = -1;
  return w;
}

function generateBoss(region: RegionDefinition, seed: number, index: number, forced?: number): World {
  const meta = {
    kind: 'boss' as const,
    name: region.boss.name,
    subtitle: region.boss.subtitle,
    regionId: region.id,
    index,
    seed,
  };
  const first = forced ?? 0;
  const last = forced ?? 9;
  for (let attempt = first; attempt <= last && attempt >= 0; attempt++) {
    const rng = new Rng(hash2(seed, attempt + 100));
    const d = draftBoss(rng, region.boss.id);
    const w = buildWorld(d, meta, computeBounds(d.inits.filter((b) => !b.tags?.includes('boss')), 520));
    w.attempt = attempt;
    if (forced !== undefined) return w;
    const report = validateWorld(w);
    w.validatedEdges = report.edges;
    if (report.reachable.has(w.goalBody)) return w;
  }
  const rng = new Rng(seed);
  const d = draftBoss(rng, region.boss.id, true);
  const w = buildWorld(d, meta, computeBounds(d.inits.filter((b) => !b.tags?.includes('boss')), 520));
  w.attempt = -2;
  return w;
}

function draftBoss(rng: Rng, id: BossId, easy = false): Draft {
  const d: Draft = { inits: [], placed: [], spine: [], gate: -1 };
  d.spine.push(push(d, makeInit(rng, 'rocky', 0, 0, { tags: ['start'], radius: 54 }), 54));
  if (id === 'rogueGiant') {
    // Stepping stones on alternating sides; the Rogue Giant sweeps horizontally between them.
    const stones: [number, number, PlanetTypeId][] = [
      [rng.range(-340, -260), -420, 'moon'],
      [rng.range(260, 340), -820, 'rocky'],
      [rng.range(-320, -240), -1230, easy ? 'rocky' : 'ice'],
      [rng.range(200, 300), -1640, 'crystal'],
    ];
    for (const [x, y, t] of stones) d.spine.push(push(d, makeInit(rng, t, x, y), 60));
    d.gate = push(d, makeInit(rng, 'beacon', 0, -2060, { tags: ['gate'] }), 36);
    d.spine.push(d.gate);
    const giant = makeInit(rng, 'rogueGiant', 0, -1030, {
      tags: ['boss'],
      name: 'The Rogue Giant',
      drift: { vx: easy ? 70 : 95, vy: 0, minX: -1500, maxX: 1500, minY: 0, maxY: 0 },
    });
    d.inits.push(giant);
    d.placed.push({ x: 0, y: -1e9, extent: 0 });
  } else {
    const stones: [number, number, PlanetTypeId][] = [
      [rng.range(-300, -220), -440, 'rocky'],
      [rng.range(420, 520), -1050, 'moon'],
      [rng.range(-520, -420), -1050, 'crystal'],
      [rng.range(-80, 80), -1660, 'ice'],
    ];
    for (const [x, y, t] of stones) d.spine.push(push(d, makeInit(rng, t, x, y), 60));
    d.gate = push(d, makeInit(rng, 'beacon', 0, -2080, { tags: ['gate'] }), 36);
    const period = easy ? 18 : 14;
    const phase = rng.range(0, TAU);
    for (const k of [0, 1]) {
      const g = makeInit(rng, 'giant', 0, -1050, {
        tags: ['boss'],
        name: k === 0 ? 'Twin Giant Castor' : 'Twin Giant Pollux',
        orbit: { parent: null, cx: 0, cy: -1050, radius: 170, period, phase: phase + k * Math.PI },
        radius: 70,
      });
      d.inits.push(g);
      d.placed.push({ x: 0, y: -1e9, extent: 0 });
    }
  }
  return d;
}
