import { Emitter } from '../core/events';
import { clamp, dist, len, wrapAngle } from '../core/math';
import { Rng, hash2 } from '../core/rng';
import { ABILITIES, type AbilityId } from '../data/abilities';
import { discoveryById } from '../data/discoveries';
import { achievementById } from '../data/achievements';
import { regionById } from '../data/regions';
import { BodyFrame } from '../physics/body';
import { Predictor, type Prediction } from '../physics/predictor';
import { DT, Ev, clampLaunchDir, copyProbe, launch, makeProbe, step, attachLanded, type ProbeState, type SimParams } from '../physics/sim';
import { RouteSolver } from '../physics/solver';
import { Camera } from '../presentation/camera';
import { computeStats, discover, rollModules, unlockAchievement } from '../progression/progression';
import { addJournal, clearRun, saveProfile, saveRunJson, type Profile } from '../progression/profile';
import type { PlayerStats } from '../progression/stats';
import { analyzeFailure, type FailureCause, type FailureReport } from '../run/analysis';
import { FlightTracker, type FlightEvent, type Maneuver } from '../run/flight';
import { newRun, runScore, type RunData } from '../run/runState';
import { SectorLoader } from '../world/sectorLoader';
import { TUTORIAL, type TutorialStep } from '../world/tutorial';
import type { World } from '../world/world';
import { moduleById, type ModuleDefinition } from '../data/modules';

export type GamePhase = 'idle' | 'loading' | 'landed' | 'flight' | 'incident' | 'transition';
export type RunOutcome = 'complete' | 'extracted' | 'lost';

export interface RewardInfo {
  x: number;
  y: number;
  matter: number;
  fuel: number;
  energy: number;
  data: number;
  multiplier: number;
  maneuvers: Maneuver[];
  first: boolean;
}

export interface RunSummary {
  outcome: RunOutcome;
  run: RunData;
  score: number;
  banked: number;
  bankedData: number;
  keptFraction: number;
  report?: FailureReport;
  newBest: boolean;
}

export type GameEvents = {
  launch: { speed: number; x: number; y: number; dirX: number; dirY: number };
  bounce: { body: number; speed: number; x: number; y: number };
  land: { body: number; speed: number; x: number; y: number; first: boolean };
  impact: { body: number; speed: number; x: number; y: number; damaged: boolean; asteroid: boolean };
  crash: { body: number; x: number; y: number };
  eject: { body: number; x: number; y: number };
  collapse: { body: number; x: number; y: number };
  assist: { body: number; gain: number; x: number; y: number };
  orbit: { body: number; count: number; x: number; y: number };
  closePass: { body: number; x: number; y: number; boosted: boolean };
  aerobrake: { body: number; x: number; y: number };
  enterWell: { body: number };
  ability: { id: AbilityId; x: number; y: number };
  abilityFail: { id: AbilityId; reason: string };
  reward: RewardInfo;
  discovery: { id: string; name: string; text: string };
  achievement: { id: string; name: string; description: string };
  signal: { body: number };
  reveal: { body: number; x: number; y: number };
  hint: { text: string; key: string };
  incident: { report: FailureReport; final: boolean; hullCost: number };
  hull: { hull: number; max: number; delta: number };
  sectorStart: { world: World; resumed: boolean };
  sectorComplete: { final: boolean; choices: ModuleDefinition[] };
  tutorialStep: { index: number; step: TutorialStep };
  tutorialAdvance: { text: string; done: boolean };
  tutorialFail: { text: string; demo: boolean };
  runEnd: RunSummary;
  inspect: { body: number };
  recall: { body: number };
  speedRecord: { speed: number };
};

interface AimState {
  active: boolean;
  pointer: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  startTime: number;
  dirX: number;
  dirY: number;
  power: number;
  speed: number;
  valid: boolean;
}

interface ThrustState {
  active: boolean;
  pointer: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  startTime: number;
  x: number;
  y: number;
  mag: number;
}

const TAP_MAX_MOVE = 12;
const TAP_MAX_TIME = 320;

export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly camera = new Camera();
  readonly loader = new SectorLoader();

  world: World | null = null;
  frame!: BodyFrame;
  private aimFrame!: BodyFrame;
  predictor: Predictor | null = null;
  prediction: Prediction | null = null;
  readonly probe: ProbeState = makeProbe();
  private aimProbe: ProbeState = makeProbe();
  prevX = 0;
  prevY = 0;
  alpha = 0;

  phase: GamePhase = 'idle';
  mode: 'tutorial' | 'run' | 'none' = 'none';
  paused = false;
  stats: PlayerStats;
  run: RunData | null = null;
  tracker: FlightTracker | null = null;
  lastTracker: FlightTracker | null = null;
  incident: FailureReport | null = null;
  incidentFinal = false;

  tutorialIndex = 0;
  tutorialFails = 0;
  demoPath: Float32Array | null = null;
  demoCount = 0;
  prompt = '';

  readonly aim: AimState = { active: false, pointer: -1, sx: 0, sy: 0, cx: 0, cy: 0, startTime: 0, dirX: 0, dirY: -1, power: 0, speed: 0, valid: false };
  readonly thrust: ThrustState = { active: false, pointer: -1, sx: 0, sy: 0, cx: 0, cy: 0, startTime: 0, x: 0, y: 0, mag: 0 };
  readonly cooldowns: Record<AbilityId, number> = { brake: 0, hook: 0, orbitLock: 0, burst: 0 };

  time = 0;
  flightTime = 0;
  timeScale = 1;
  /** Dev/test only: simulation speed multiplier. */
  devSpeed = 1;
  private slowmoUntil = 0;
  private acc = 0;
  private safeBody = 0;
  private safeAngle = -Math.PI / 2;
  private scanTimer = 0;
  readonly signaled = new Set<number>();
  private simEvents: { ev: Ev; body: number; speed: number }[] = [];
  private flightEvents: FlightEvent[] = [];
  private predictTimer = 0;
  private asteroidShield = 0;
  private ejectedFrom = -1;
  private sectorLoadToken = 0;
  /** World-space surface angle the probe crawls toward while aiming (NaN = stay put). */
  private crawlTarget = NaN;

  constructor(public profile: Profile) {
    this.stats = computeStats(profile);
  }

  // ───────────────────────────── Setup ─────────────────────────────

  get sim(): SimParams {
    return this.stats.sim;
  }

  get fuel(): number {
    return this.run?.fuel ?? 0;
  }

  get energy(): number {
    return this.run?.energy ?? 0;
  }

  get tutorialStep(): TutorialStep | null {
    return this.mode === 'tutorial' ? TUTORIAL[this.tutorialIndex] ?? null : null;
  }

  get predictionSeconds(): number {
    const base = this.tutorialStep ? this.tutorialStep.prediction : this.stats.prediction;
    return base + (this.profile.settings.aimAssist ? 1.5 : 0);
  }

  equippedAbilities(): AbilityId[] {
    if (this.mode !== 'run' || !this.run) return [];
    return this.run.equipped.filter((a) => this.stats.unlockedAbilities.includes(a)).slice(0, this.stats.abilitySlots);
  }

  applyStats(): void {
    this.stats = computeStats(this.profile, this.run?.modules ?? []);
    if (this.profile.settings.aimAssist) this.stats.sim.landSpeed += 40;
  }

  private setWorld(world: World, bodyIndex: number, angle: number, t: number): void {
    this.world = world;
    this.frame = world.newFrame();
    this.aimFrame = world.newFrame();
    this.predictor = new Predictor(world, 14, 2);
    this.prediction = null;
    this.time = t;
    Object.assign(this.probe, makeProbe());
    this.probe.t = t;
    this.probe.landed = bodyIndex;
    this.probe.landAngle = angle - world.bodies[bodyIndex]!.rotationAt(t);
    this.frame.eval(world.bodies, t);
    attachLanded(world.bodies, this.frame, this.probe, this.sim);
    this.prevX = this.probe.x;
    this.prevY = this.probe.y;
    this.safeBody = bodyIndex;
    this.safeAngle = angle;
    this.tracker = null;
    this.lastTracker = null;
    this.incident = null;
    this.signaled.clear();
    this.phase = 'landed';
    this.cancelInput();
    const b = world.bodies[bodyIndex]!;
    b.visited = true;
    b.collected = true;
    this.frameLanded(true);
    this.camera.snap();
    this.scan();
  }

  startTutorial(index = 0): void {
    this.mode = 'tutorial';
    this.run = null;
    this.tutorialIndex = index;
    this.tutorialFails = 0;
    this.demoPath = null;
    this.applyStats();
    const st = TUTORIAL[index]!;
    this.setWorld(st.build(), 0, -Math.PI / 2 + 0.25, 0);
    this.prompt = st.prompt;
    this.events.emit('tutorialStep', { index, step: st });
  }

  startRun(seed: number, regionId: string, daily?: string): void {
    this.mode = 'run';
    this.run = newRun(seed, regionId, [...this.profile.equipped], daily);
    this.applyStats();
    const r = this.run;
    r.hull = this.stats.hullMax;
    r.fuel = this.stats.fuelMax;
    r.energy = this.stats.energyStart;
    r.freeRecalls = this.stats.freeRecalls;
    this.profile.stats.runs++;
    saveProfile(this.profile);
    void this.loadSector(false);
  }

  resumeRun(data: RunData): void {
    this.mode = 'run';
    this.run = data;
    this.applyStats();
    void this.loadSector(true);
  }

  private async loadSector(resumed: boolean): Promise<void> {
    const r = this.run!;
    const token = ++this.sectorLoadToken;
    this.phase = 'loading';
    const opts = { regionId: r.regionId, sectorIndex: r.sectorIndex, runSeed: r.seed };
    const world = await this.loader.load(opts);
    if (token !== this.sectorLoadToken || this.mode !== 'run' || this.run !== r) return;
    this.asteroidShield = this.stats.asteroidShield;
    if (resumed) {
      for (const i of r.collected) if (world.bodies[i]) world.bodies[i]!.collected = true;
      for (const i of r.visited) if (world.bodies[i]) world.bodies[i]!.visited = true;
      const idx = world.bodies[r.bodyIndex]?.type.landable ? r.bodyIndex : world.startBody;
      this.setWorld(world, idx, r.landAngle, r.sectorTime);
    } else {
      r.collected = [world.startBody];
      r.visited = [world.startBody];
      r.sectorFuelUsed = 0;
      r.sectorProgress = 0;
      this.setWorld(world, world.startBody, -Math.PI / 2, 0);
    }
    this.prompt = '';
    this.events.emit('sectorStart', { world, resumed });
    const region = regionById(r.regionId);
    if (r.sectorIndex + 1 <= region.sectors.length) this.loader.prefetch({ ...opts, sectorIndex: r.sectorIndex + 1 });
    if (r.pendingChoice) {
      this.phase = 'transition';
      const choices = r.pendingChoice.map((id) => moduleById(id)).filter((m): m is ModuleDefinition => !!m);
      this.events.emit('sectorComplete', { final: false, choices });
    } else {
      this.hintOnce('goal', r.sectorIndex >= region.sectors.length ? 'Reach the Beacon at the top of the sector' : 'Reach the Warp Gate at the top of the sector');
      this.saveRun();
    }
  }

  stop(): void {
    this.mode = 'none';
    this.phase = 'idle';
    this.world = null;
    this.run = null;
    this.sectorLoadToken++;
  }

  // ───────────────────────────── Input ─────────────────────────────

  cancelInput(): void {
    this.crawlTarget = NaN;
    this.aim.active = false;
    this.aim.pointer = -1;
    this.thrust.active = false;
    this.thrust.pointer = -1;
    this.thrust.mag = 0;
    this.probe.thrustX = 0;
    this.probe.thrustY = 0;
  }

  pointerDown(id: number, sx: number, sy: number, now: number): void {
    if (this.paused || !this.world) return;
    if (this.phase === 'landed' && !this.aim.active) {
      Object.assign(this.aim, { active: true, pointer: id, sx, sy, cx: sx, cy: sy, startTime: now, power: 0, valid: false });
    } else if (this.phase === 'flight' && !this.thrust.active) {
      Object.assign(this.thrust, { active: true, pointer: id, sx, sy, cx: sx, cy: sy, startTime: now, mag: 0 });
    }
  }

  pointerMove(id: number, sx: number, sy: number): void {
    if (this.aim.active && id === this.aim.pointer) {
      this.aim.cx = sx;
      this.aim.cy = sy;
      this.updateAim();
    } else if (this.thrust.active && id === this.thrust.pointer) {
      this.thrust.cx = sx;
      this.thrust.cy = sy;
      const dx = sx - this.thrust.sx;
      const dy = sy - this.thrust.sy;
      const l = len(dx, dy);
      const dead = 10;
      if (l > dead) {
        this.thrust.x = dx / l;
        this.thrust.y = dy / l;
        this.thrust.mag = clamp((l - dead) / 40, 0, 1);
      } else this.thrust.mag = 0;
    }
  }

  pointerUp(id: number, sx: number, sy: number, now: number): void {
    if (this.aim.active && id === this.aim.pointer) {
      const moved = len(sx - this.aim.sx, sy - this.aim.sy);
      if (moved < TAP_MAX_MOVE && now - this.aim.startTime < TAP_MAX_TIME) {
        this.aim.active = false;
        this.tapAt(sx, sy);
        return;
      }
      this.aim.cx = sx;
      this.aim.cy = sy;
      this.updateAim();
      if (this.aim.valid) this.doLaunch();
      this.aim.active = false;
      this.aim.pointer = -1;
      this.prediction = null;
    } else if (this.thrust.active && id === this.thrust.pointer) {
      const moved = len(sx - this.thrust.sx, sy - this.thrust.sy);
      this.thrust.active = false;
      this.thrust.pointer = -1;
      this.thrust.mag = 0;
      if (moved < TAP_MAX_MOVE && now - this.thrust.startTime < TAP_MAX_TIME) this.tapAt(sx, sy);
    }
  }

  private tapAt(sx: number, sy: number): void {
    const w = this.world;
    if (!w) return;
    const wx = this.camera.toWorldX(sx);
    const wy = this.camera.toWorldY(sy);
    let best = -1;
    let bestD = Infinity;
    for (const b of w.bodies) {
      if (!b.revealed || b.type.id === 'asteroid') continue;
      const d = dist(wx, wy, this.frame.x[b.index]!, this.frame.y[b.index]!) - b.radius;
      if (d < 36 / this.camera.zoom && d < bestD) {
        bestD = d;
        best = b.index;
      }
    }
    if (best >= 0) this.events.emit('inspect', { body: best });
  }

  /** Converts the drag gesture into a launch vector and refreshes the prediction. */
  private updateAim(): void {
    const w = this.world!;
    const a = this.aim;
    let dx = a.cx - a.sx;
    let dy = a.cy - a.sy;
    if (this.profile.settings.aimMode === 'pull') {
      dx = -dx;
      dy = -dy;
    }
    const l = len(dx, dy);
    const dead = 16;
    const full = Math.max(110, Math.min(this.camera.width, this.camera.height) * 0.3);
    if (l < dead) {
      a.valid = false;
      a.power = 0;
      this.prediction = null;
      return;
    }
    a.power = clamp((l - dead) / (full - dead), 0, 1);
    const s = this.probe;
    const b = w.bodies[s.landed]!;
    const nx = (s.x - this.frame.x[b.index]!) / (b.radius + this.sim.probeRadius);
    const ny = (s.y - this.frame.y[b.index]!) / (b.radius + this.sim.probeRadius);
    // Aiming away from the surface makes the probe crawl around the world so it can launch
    // that way — landing on the "wrong side" never strands you.
    const normalAng = Math.atan2(ny, nx);
    const aimAng = Math.atan2(dy, dx);
    const diff = wrapAngle(aimAng - normalAng);
    const limit = 1.15;
    this.crawlTarget = Math.abs(diff) > limit ? aimAng - Math.sign(diff) * limit : NaN;
    const out = { x: 0, y: 0 };
    clampLaunchDir(nx, ny, dx / l, dy / l, out);
    a.dirX = out.x;
    a.dirY = out.y;
    a.speed = this.stats.minLaunch + (this.stats.maxLaunch - this.stats.minLaunch) * a.power + (this.run?.anchor ?? 0);
    a.valid = true;
    this.refreshAimPrediction();
  }

  private refreshAimPrediction(): void {
    const w = this.world!;
    if (!this.aim.valid || this.phase !== 'landed') return;
    copyProbe(this.aimProbe, this.probe);
    this.aimFrame.t = NaN;
    launch(w.bodies, this.aimFrame, this.aimProbe, this.aim.dirX, this.aim.dirY, this.aim.speed, this.sim);
    this.prediction = this.predictor!.run(this.aimProbe, this.sim, this.predictionSeconds);
  }

  private doLaunch(): void {
    const w = this.world!;
    const s = this.probe;
    const from = s.landed;
    launch(w.bodies, this.frame, s, this.aim.dirX, this.aim.dirY, this.aim.speed, this.sim);
    this.phase = 'flight';
    this.flightTime = 0;
    this.tracker = new FlightTracker(w, from, s.t);
    this.ejectedFrom = -1;
    if (this.run) this.run.anchor = 0;
    this.profile.stats.launches++;
    this.events.emit('launch', { speed: this.aim.speed, x: s.x, y: s.y, dirX: this.aim.dirX, dirY: this.aim.dirY });
    if (this.mode === 'run' && this.run && this.run.fuel > 0) this.hintOnce('thrust', 'In flight: hold and drag to thrust. Fuel is limited — trust gravity first');
  }

  // ───────────────────────────── Abilities ─────────────────────────────

  abilityCost(id: AbilityId): number {
    const base = ABILITIES[id].energy;
    return this.probe.domBody >= 0 && this.stats.wellDiscount > 0 ? Math.round(base * (1 - this.stats.wellDiscount)) : base;
  }

  abilityReady(id: AbilityId): boolean {
    if (this.phase !== 'flight' || !this.run) return false;
    if (id === 'orbitLock' && this.probe.lockBody >= 0) return true;
    return this.cooldowns[id] <= 0 && this.run.energy >= this.abilityCost(id);
  }

  useAbility(id: AbilityId): void {
    const r = this.run;
    const w = this.world;
    if (!r || !w || this.phase !== 'flight' || this.paused) return;
    const s = this.probe;
    if (id === 'orbitLock' && s.lockBody >= 0) {
      s.lockBody = -1;
      s.ax = NaN;
      this.events.emit('ability', { id, x: s.x, y: s.y });
      return;
    }
    if (this.cooldowns[id] > 0) return;
    const cost = this.abilityCost(id);
    if (r.energy < cost) {
      this.events.emit('abilityFail', { id, reason: 'Not enough energy' });
      return;
    }
    const f = this.frame;
    f.eval(w.bodies, s.t);
    switch (id) {
      case 'brake': {
        const d = s.domBody;
        const bvx = d >= 0 ? f.vx[d]! : 0;
        const bvy = d >= 0 ? f.vy[d]! : 0;
        s.vx = bvx + (s.vx - bvx) * 0.45;
        s.vy = bvy + (s.vy - bvy) * 0.45;
        break;
      }
      case 'hook': {
        let best = -1;
        let bestScore = Infinity;
        const sp = len(s.vx, s.vy) || 1;
        for (const b of w.bodies) {
          if (!b.type.landable || !b.revealed || !f.active[b.index]) continue;
          if (this.tracker && b.index === this.tracker.from && this.flightTime < 1.5) continue;
          const dx = f.x[b.index]! - s.x;
          const dy = f.y[b.index]! - s.y;
          const d = len(dx, dy) - b.radius;
          if (d > 900) continue;
          const ahead = (dx * s.vx + dy * s.vy) / (sp * (len(dx, dy) || 1));
          const score = d * (1.6 - ahead);
          if (score < bestScore) {
            bestScore = score;
            best = b.index;
          }
        }
        if (best < 0) {
          this.events.emit('abilityFail', { id, reason: 'No world in range' });
          return;
        }
        s.hookBody = best;
        s.hookUntil = s.t + 1.2;
        s.hookStrength = 430;
        break;
      }
      case 'orbitLock': {
        const d = s.domBody;
        if (d < 0) {
          this.events.emit('abilityFail', { id, reason: 'No gravity well nearby' });
          return;
        }
        const b = w.bodies[d]!;
        const rx = s.x - f.x[d]!;
        const ry = s.y - f.y[d]!;
        const r0 = len(rx, ry);
        const rvx = s.vx - f.vx[d]!;
        const rvy = s.vy - f.vy[d]!;
        s.lockBody = d;
        s.lockRadius = clamp(r0, b.radius + this.sim.probeRadius + 12, b.soi * 0.7);
        s.lockDir = rx * rvy - ry * rvx >= 0 ? 1 : -1;
        s.lockUntil = s.t + 6;
        break;
      }
      case 'burst': {
        const sp = len(s.vx, s.vy) || 1;
        const add = Math.max(sp * 0.4, 120);
        s.vx += (s.vx / sp) * add;
        s.vy += (s.vy / sp) * add;
        break;
      }
    }
    s.ax = NaN;
    r.energy -= cost;
    this.cooldowns[id] = ABILITIES[id].cooldown;
    if (this.tracker) this.tracker.abilityUsed = true;
    this.events.emit('ability', { id, x: s.x, y: s.y });
  }

  // ───────────────────────────── Simulation ─────────────────────────────

  update(realDt: number): void {
    if (!this.world || this.phase === 'loading') {
      this.camera.update(realDt);
      return;
    }
    if (!this.paused) {
      if (this.time > this.slowmoUntil) this.timeScale = Math.min(1, this.timeScale + realDt * 2.5);
      const dt = Math.min(realDt, 0.1) * this.timeScale * this.devSpeed;
      this.acc += dt;
      let steps = 0;
      const maxSteps = 16 * this.devSpeed;
      while (this.acc >= DT && steps < maxSteps) {
        this.prevX = this.probe.x;
        this.prevY = this.probe.y;
        this.fixedStep();
        this.acc -= DT;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
      this.alpha = this.acc / DT;
      for (const k of Object.keys(this.cooldowns) as AbilityId[]) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

      this.scanTimer -= realDt;
      if (this.scanTimer <= 0) {
        this.scanTimer = 0.2;
        this.scan();
      }
      this.predictTimer -= realDt;
      if (this.phase === 'flight' && this.predictTimer <= 0) {
        this.predictTimer = 1 / 30;
        this.prediction = this.predictor!.run(this.probe, this.sim, this.predictionSeconds);
      } else if (this.phase === 'landed' && this.aim.valid && this.predictTimer <= 0) {
        // The world keeps moving while you aim — keep the preview honest.
        this.predictTimer = 1 / 30;
        this.refreshAimPrediction();
      }
    }
    this.updateCamera(realDt);
    this.camera.update(realDt);
  }

  private fixedStep(): void {
    const w = this.world!;
    const s = this.probe;
    this.time = s.t;
    if (this.phase === 'landed' || this.phase === 'transition') {
      if (this.phase === 'landed' && this.aim.active && !Number.isNaN(this.crawlTarget) && s.landed >= 0) {
        const b = w.bodies[s.landed]!;
        const cur = s.landAngle + b.rotationAt(s.t);
        const d = wrapAngle(this.crawlTarget - cur);
        const stepMax = (170 / b.radius) * DT; // ~170 u/s along the surface
        s.landAngle += Math.sign(d) * Math.min(Math.abs(d), stepMax);
        if (Math.abs(d) < 1e-3) this.crawlTarget = NaN;
      }
      const ev = step(w.bodies, this.frame, s, this.sim, DT, (e, b, sp) => this.simEvents.push({ ev: e, body: b, speed: sp }));
      this.time = s.t;
      if (ev !== Ev.None) this.flushSimEvents();
      else this.simEvents.length = 0;
      return;
    }
    if (this.phase !== 'flight') {
      s.t += DT;
      this.time = s.t;
      return;
    }

    // Thrust
    const r = this.run;
    s.thrustX = 0;
    s.thrustY = 0;
    if (this.thrust.active && this.thrust.mag > 0 && r && r.fuel > 0) {
      const burn = this.stats.fuelBurn * this.thrust.mag * DT;
      r.fuel = Math.max(0, r.fuel - burn);
      r.sectorFuelUsed += burn;
      if (this.tracker) this.tracker.fuelUsed += burn;
      s.thrustX = this.thrust.x * this.stats.thrust * this.thrust.mag;
      s.thrustY = this.thrust.y * this.stats.thrust * this.thrust.mag;
    }

    step(w.bodies, this.frame, s, this.sim, DT, (e, b, sp) => this.simEvents.push({ ev: e, body: b, speed: sp }));
    this.time = s.t;
    this.flightTime += DT;
    const speed = len(s.vx, s.vy);

    if (this.tracker && this.phase === 'flight') {
      this.flightEvents.length = 0;
      this.tracker.update(w, this.frame, s, this.flightEvents);
      for (const fe of this.flightEvents) this.onFlightEvent(fe);
    }
    this.flushSimEvents();
    if (this.phase !== 'flight') return;

    if (r) {
      if (this.stats.harvestFuel > 0 && s.domAccel > 55) r.fuel = Math.min(this.stats.fuelMax, r.fuel + this.stats.harvestFuel * DT);
      if (speed > r.maxSpeed) r.maxSpeed = speed;
      if (speed > 750) this.achieve('momentumMaster');
      const gate = w.goalBody >= 0 ? w.bodies[w.goalBody]! : null;
      if (gate) {
        const p = clamp((0 - s.y) / Math.max(1, 0 - gate.y0), 0, 1);
        if (p > r.sectorProgress) r.sectorProgress = p;
      }
    }
    if (speed > this.profile.stats.bestSpeed) this.profile.stats.bestSpeed = speed;

    if (w.isLost(s.x, s.y)) this.fail('lost', -1, speed);
    else if (this.flightTime > 12 && this.flightTime - DT <= 12) this.hintOnce('recall', 'Drifting? Tap Recall to return to your last world');
  }

  private flushSimEvents(): void {
    const evs = this.simEvents;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]!;
      this.onSimEvent(e.ev, e.body, e.speed);
      if (this.phase === 'incident' || this.phase === 'transition' || this.phase === 'idle') break;
    }
    evs.length = 0;
  }

  private onSimEvent(ev: Ev, body: number, speed: number): void {
    const w = this.world!;
    const s = this.probe;
    switch (ev) {
      case Ev.Bounce:
        if (this.tracker) {
          this.tracker.bounces++;
          this.tracker.bouncedOn.add(body);
        }
        if (this.run) {
          this.run.bounces++;
          if (this.stats.bounceMatter > 0 && w.bodies[body]!.type.landable) this.run.matter += this.stats.bounceMatter;
        }
        this.profile.stats.bounces++;
        this.events.emit('bounce', { body, speed, x: s.x, y: s.y });
        break;
      case Ev.HardImpact:
        if (this.tracker) {
          this.tracker.bounces++;
          this.tracker.bouncedOn.add(body);
        }
        this.events.emit('impact', { body, speed, x: s.x, y: s.y, damaged: this.mode === 'run', asteroid: false });
        if (this.mode === 'run' && this.damage(1)) this.fail('destroyed', body, speed);
        break;
      case Ev.AsteroidHit: {
        const shielded = this.asteroidShield > 0;
        if (shielded) this.asteroidShield--;
        this.events.emit('impact', { body, speed, x: s.x, y: s.y, damaged: !shielded && this.mode === 'run', asteroid: true });
        if (!shielded && this.mode === 'run' && this.damage(1)) this.fail('asteroid', body, speed);
        break;
      }
      case Ev.Land:
        this.onLand(body, speed);
        break;
      case Ev.Crash:
        this.events.emit('crash', { body, x: s.x, y: s.y });
        this.fail('crash', body, speed);
        break;
      case Ev.Eject:
        this.phase = 'flight';
        this.flightTime = 0;
        this.tracker = new FlightTracker(w, body, s.t);
        this.tracker.ejected = true;
        this.ejectedFrom = body;
        this.cancelInput();
        this.discover('eruption');
        this.events.emit('eject', { body, x: s.x, y: s.y });
        break;
      case Ev.Collapse:
        this.events.emit('collapse', { body, x: s.x, y: s.y });
        this.fail('collapse', body, 0);
        break;
      default:
        break;
    }
  }

  private onFlightEvent(fe: FlightEvent): void {
    const w = this.world!;
    const s = this.probe;
    switch (fe.type) {
      case 'assist':
        if (this.run) this.run.assists++;
        this.profile.stats.assists++;
        this.discover('slingshot');
        this.achieve('firstSlingshot');
        this.events.emit('assist', { body: fe.body, gain: fe.gain, x: s.x, y: s.y });
        break;
      case 'orbit':
        if (this.run) {
          this.run.orbits++;
          if (this.stats.orbitEnergy > 0) this.run.energy = Math.min(this.stats.energyMax, this.run.energy + this.stats.orbitEnergy);
        }
        this.profile.stats.orbits++;
        this.discover('orbit');
        this.events.emit('orbit', { body: fe.body, count: fe.count, x: s.x, y: s.y });
        break;
      case 'closePass': {
        let boosted = false;
        if (this.run && this.stats.slingshotBoost > 0 && !w.bodies[fe.body]!.type.lethal) {
          s.vx *= 1 + this.stats.slingshotBoost;
          s.vy *= 1 + this.stats.slingshotBoost;
          s.ax = NaN;
          this.run.energy = Math.min(this.stats.energyMax, this.run.energy + this.stats.slingshotEnergy);
          boosted = true;
        }
        this.events.emit('closePass', { body: fe.body, x: s.x, y: s.y, boosted });
        break;
      }
      case 'aerobrake':
        this.discover('aerobrake');
        if (this.run && this.stats.aeroMatter > 0) this.run.matter += this.stats.aeroMatter;
        this.events.emit('aerobrake', { body: fe.body, x: s.x, y: s.y });
        break;
      case 'enterWell':
        this.events.emit('enterWell', { body: fe.body });
        break;
    }
  }

  // ───────────────────────────── Landing & rewards ─────────────────────────────

  private onLand(bodyIdx: number, touchSpeed: number): void {
    const w = this.world!;
    const b = w.bodies[bodyIdx]!;
    const s = this.probe;
    const tracker = this.tracker;
    this.phase = 'landed';
    this.cancelInput();
    this.prediction = null;
    s.hookBody = -1;
    s.lockBody = -1;
    const first = !b.visited;
    b.visited = true;
    if (!b.identified) b.identified = true;
    if (tracker) {
      this.profile.stats.flightSeconds += tracker.duration;
      if (this.run) this.run.flightSeconds += tracker.duration;
      tracker.arrivalSpeed = touchSpeed;
    }
    this.lastTracker = tracker;
    this.tracker = null;
    const angle = s.landAngle + b.rotationAt(s.t);
    if (!b.tags.has('unstable')) {
      this.safeBody = bodyIdx;
      this.safeAngle = angle;
    }

    // Tutorial flow.
    if (this.mode === 'tutorial') {
      this.events.emit('land', { body: bodyIdx, speed: touchSpeed, x: s.x, y: s.y, first });
      if (bodyIdx === w.goalBody) {
        const st = this.tutorialStep!;
        const done = this.tutorialIndex >= TUTORIAL.length - 1;
        if (tracker?.assists.length) this.discover('slingshot');
        this.events.emit('tutorialAdvance', { text: st.successText, done });
        this.phase = 'transition';
        this.demoPath = null;
      } else if (bodyIdx !== w.startBody) {
        this.tutorialFailure();
      }
      return;
    }

    const r = this.run!;
    const maneuvers = tracker && bodyIdx !== tracker.from ? tracker.maneuvers(bodyIdx, touchSpeed) : [];
    let mult = 1;
    for (const m of maneuvers) mult += m.weight;
    for (const m of maneuvers) {
      r.maneuvers++;
      if (m.weight > r.bestManeuverWeight) {
        r.bestManeuverWeight = m.weight;
        r.bestManeuver = m.name;
      }
      if (achievementById(m.id)) this.achieve(m.id);
    }
    if (maneuvers.some((m) => m.id === 'perfectSlingshot')) this.achieve('perfectSlingshot');

    let matter = 0;
    let fuel = 0;
    let energy = 0;
    let data = 0;
    if (!b.collected) {
      b.collected = true;
      r.collected.push(bodyIdx);
      const risk = b.type.danger >= 2 ? 1 + this.stats.riskMatter : 1;
      matter = Math.round(b.matter * this.stats.matterMult * risk * mult);
      fuel = b.type.rewards.fuel ?? 0;
      energy = (b.type.rewards.energy ?? 0) + this.stats.energyPerLanding;
      data = Math.round((b.type.rewards.data ?? 0) * this.stats.dataMult);
      r.planets++;
      this.profile.stats.planetsVisited++;
      r.visited.push(bodyIdx);
    } else if (maneuvers.length) {
      // Revisits still reward skill, just not the deposit.
      matter = Math.round(4 * (mult - 1) * this.stats.matterMult);
    }
    r.matter += matter;
    r.data += data;
    r.fuel = Math.min(this.stats.fuelMax, r.fuel + fuel);
    r.energy = Math.min(this.stats.energyMax, r.energy + energy);
    if (this.stats.momentumAnchor > 0 && tracker) r.anchor = Math.min(150, tracker.maxSpeed * this.stats.momentumAnchor);

    this.events.emit('land', { body: bodyIdx, speed: touchSpeed, x: s.x, y: s.y, first });
    if (matter || fuel || energy || data || maneuvers.length)
      this.events.emit('reward', { x: s.x, y: s.y, matter, fuel, energy, data, multiplier: mult, maneuvers, first });

    // Discoveries tied to landing.
    if (b.orbit?.parent !== undefined && b.orbit.parent !== null) this.discover('moving');
    if (b.type.id === 'derelict') this.onDerelict();
    if (this.ejectedFrom >= 0 && bodyIdx !== this.ejectedFrom) this.achieve('eruptionRider');
    this.ejectedFrom = -1;

    // Contextual hints.
    if (b.tags.has('unstable')) {
      b.collapseAt = s.t + b.unstableFuse;
      this.hintOnce('unstable', 'This world is crumbling — launch before it collapses!', true);
    }
    if (b.type.behavior?.kind === 'erupt') this.hintOnce('volcanic', 'It erupts on a rhythm — watch the ring and leave before it fills');
    if (this.stats.unlockedAbilities.length && r.energy >= this.abilityCost(this.equippedAbilities()[0] ?? 'brake'))
      this.hintOnce('ability', 'Abilities bend physics. Use them in flight — they cost energy');

    if (bodyIdx === w.goalBody) {
      this.completeSector();
      return;
    }
    r.bodyIndex = bodyIdx;
    r.landAngle = angle;
    this.saveRun();
    saveProfile(this.profile);
  }

  private onDerelict(): void {
    const p = this.profile;
    const lore = Math.min(p.lore, 3);
    p.lore = Math.min(4, p.lore + 1);
    addJournal(p, 'secret', `Landed on a Derelict Construct and recovered a data fragment (${lore + 1}/4).`);
    this.discover('signal');
  }

  private completeSector(): void {
    const r = this.run!;
    const w = this.world!;
    const region = regionById(r.regionId);
    r.sectorsCleared++;
    if (r.sectorFuelUsed <= 0.01) this.achieve('gravityPilot');
    const prog = (this.profile.regionProgress[region.id] ??= { bestSector: 0, completed: false });
    prog.bestSector = Math.max(prog.bestSector, r.sectorIndex + 1);
    const final = w.meta.kind === 'boss';
    this.phase = 'transition';
    this.cancelInput();
    if (final) {
      if (region.id === 'innerBelt') this.achieve('giantTamer');
      if (r.hullLost === 0) this.achieve('untouched');
      prog.completed = true;
      this.discover(`region:${region.id}`);
      this.events.emit('sectorComplete', { final: true, choices: [] });
      saveProfile(this.profile);
      return;
    }
    const rng = new Rng(hash2(r.seed, 9000 + r.sectorIndex));
    const choices = rollModules(rng, this.profile, r.modules, this.stats.moduleChoices);
    r.pendingChoice = choices.map((c) => c.id);
    this.saveRun();
    saveProfile(this.profile);
    this.events.emit('sectorComplete', { final: false, choices });
  }

  /** Called by UI after the sector-complete screen. */
  chooseModule(id: string | null): void {
    const r = this.run;
    if (!r) return;
    const before = this.stats.hullMax;
    if (id && !r.modules.includes(id)) r.modules.push(id);
    r.pendingChoice = undefined;
    this.applyStats();
    r.hull = Math.min(this.stats.hullMax, r.hull + Math.max(0, this.stats.hullMax - before));
    r.fuel = Math.min(this.stats.fuelMax, r.fuel + this.stats.fuelMax * 0.35);
    r.energy = Math.min(this.stats.energyMax, r.energy + 20);
    r.sectorIndex++;
    r.sectorTime = 0;
    r.bodyIndex = 0;
    r.landAngle = -Math.PI / 2;
    this.events.emit('hull', { hull: r.hull, max: this.stats.hullMax, delta: 0 });
    void this.loadSector(false);
  }

  finishRun(outcome: RunOutcome, report?: FailureReport): RunSummary | null {
    const r = this.run;
    if (!r) return null;
    const p = this.profile;
    const keptFraction = outcome === 'lost' ? 0.7 : 1;
    const banked = Math.round(r.matter * keptFraction);
    const score = runScore(r);
    p.matter += banked;
    p.data += r.data;
    p.stats.totalMatter += banked;
    if (outcome === 'complete') p.stats.completions++;
    if (outcome === 'extracted') p.stats.extractions++;
    const newBest = score > p.stats.bestScore;
    if (newBest) p.stats.bestScore = score;
    p.runs.push({ t: Date.now(), score, region: r.regionId, seed: r.seed, sectors: r.sectorsCleared, outcome, daily: r.daily });
    if (p.runs.length > 50) p.runs.shift();
    if (r.daily) p.daily[r.daily] = Math.max(p.daily[r.daily] ?? 0, score);
    const region = regionById(r.regionId);
    addJournal(
      p,
      'run',
      outcome === 'complete'
        ? `Completed an expedition through ${region.name} (score ${score}).`
        : outcome === 'extracted'
          ? `Extracted safely after ${r.sectorsCleared} sector${r.sectorsCleared === 1 ? '' : 's'} (score ${score}).`
          : `Lost an expedition in ${region.name} after ${r.sectorsCleared} sector${r.sectorsCleared === 1 ? '' : 's'}.`,
    );
    clearRun();
    saveProfile(p);
    const summary: RunSummary = { outcome, run: r, score, banked, bankedData: r.data, keptFraction, report, newBest };
    this.phase = 'idle';
    this.events.emit('runEnd', summary);
    return summary;
  }

  // ───────────────────────────── Failure ─────────────────────────────

  /** Returns true if the hull is destroyed. */
  private damage(n: number): boolean {
    const r = this.run;
    if (!r) return false;
    r.hull = Math.max(0, r.hull - n);
    r.hullLost += n;
    this.events.emit('hull', { hull: r.hull, max: this.stats.hullMax, delta: -n });
    return r.hull <= 0;
  }

  private fail(cause: FailureCause, body: number, speed: number): void {
    if (this.phase === 'incident') return;
    const w = this.world!;
    const s = this.probe;
    const report = analyzeFailure(w, this.tracker, cause, { x: s.x, y: s.y, body, speed, t: s.t, hardImpact: this.sim.hardImpact });
    this.lastTracker = this.tracker;
    this.tracker = null;
    this.incident = report;
    this.phase = 'incident';
    this.cancelInput();
    this.prediction = null;
    s.vx = 0;
    s.vy = 0;
    s.lockBody = -1;
    s.hookBody = -1;
    let hullCost = 0;
    let final = false;
    if (this.mode === 'run' && this.run) {
      const alreadyDestroyed = this.run.hull <= 0;
      if (alreadyDestroyed) final = true;
      else if (this.run.freeRecalls > 0 && cause !== 'destroyed' && cause !== 'asteroid') {
        this.run.freeRecalls--;
      } else if (cause !== 'destroyed' && cause !== 'asteroid') {
        hullCost = 1;
        final = this.damage(1);
      }
      if (cause === 'asteroid' || cause === 'destroyed') final = this.run.hull <= 0;
    } else if (this.mode === 'tutorial') {
      this.tutorialFails++;
    }
    this.incidentFinal = final;
    this.events.emit('incident', { report, final, hullCost });
  }

  private tutorialFailure(): void {
    const st = this.tutorialStep!;
    this.tutorialFails++;
    const demo = this.tutorialFails >= st.demoAfter;
    if (demo) this.buildDemo();
    this.events.emit('tutorialFail', { text: st.failPrompt, demo });
    this.phase = 'transition';
    setTimeout(() => this.resetTutorialStep(), 900);
  }

  /** Uses the route solver to show a ghost path the player can copy. */
  private buildDemo(): void {
    const w = this.world!;
    const solver = new RouteSolver(w);
    const r = solver.solve(w.startBody, w.goalBody, this.sim, { maxSpeed: this.stats.maxLaunch * 0.95, seconds: 8, angleSteps: 41, speedSteps: 14, surfaceOffsets: [0, 0.5, -0.5] });
    if (!r.ok) return;
    const s = makeProbe();
    s.t = r.t0;
    s.landed = w.startBody;
    s.landAngle = r.landAngle;
    const f = w.newFrame();
    f.eval(w.bodies, r.t0);
    attachLanded(w.bodies, f, s, this.sim);
    launch(w.bodies, f, s, r.dirX, r.dirY, r.speed, this.sim);
    const pred = new Predictor(w, 10, 3).run(s, this.sim, r.flightTime + 0.5);
    this.demoPath = pred.points.slice(0, pred.count * 2);
    this.demoCount = pred.count;
    this.demoStart = { angle: r.landAngle + w.bodies[w.startBody]!.rotationAt(r.t0) };
  }

  demoStart: { angle: number } | null = null;

  private resetTutorialStep(): void {
    if (this.mode !== 'tutorial' || !this.world) return;
    const w = this.world;
    const angle = this.demoStart ? this.demoStart.angle : -Math.PI / 2 + 0.25;
    const demo = this.demoPath;
    const demoCount = this.demoCount;
    this.setWorld(w, w.startBody, angle, 0);
    this.demoPath = demo;
    this.demoCount = demoCount;
    this.prompt = this.tutorialStep!.failPrompt;
  }

  nextTutorialStep(): boolean {
    if (this.tutorialIndex + 1 >= TUTORIAL.length) return false;
    this.demoStart = null;
    this.startTutorial(this.tutorialIndex + 1);
    return true;
  }

  /** Recall to the last safe world. Costs hull in expeditions (already charged for incidents). */
  recall(): void {
    const w = this.world;
    if (!w) return;
    if (this.phase === 'incident') {
      if (this.incidentFinal) return;
      if (this.mode === 'tutorial') {
        const st = this.tutorialStep!;
        const demo = this.tutorialFails >= st.demoAfter;
        if (demo && !this.demoPath) this.buildDemo();
        this.resetTutorialStep();
        this.events.emit('tutorialFail', { text: st.failPrompt, demo });
        return;
      }
    } else if (this.phase === 'flight') {
      if (this.mode === 'run' && this.run) {
        if (this.run.freeRecalls > 0) this.run.freeRecalls--;
        else if (this.damage(1)) {
          this.fail('lost', -1, len(this.probe.vx, this.probe.vy));
          return;
        }
      } else if (this.mode === 'tutorial') {
        this.tutorialFails++;
        this.resetTutorialStep();
        return;
      }
    } else return;
    if (this.run) {
      this.run.recalls++;
      this.profile.stats.recalls++;
    }
    let target = this.safeBody;
    if (!w.bodies[target]!.isActive(this.probe.t)) target = w.startBody;
    const t = this.probe.t;
    const keepCollected = w.bodies.map((b) => b.collected);
    const keepVisited = w.bodies.map((b) => b.visited);
    this.setWorld(w, target, this.safeAngle, t);
    w.bodies.forEach((b, i) => {
      b.collected = keepCollected[i]!;
      b.visited = keepVisited[i]!;
    });
    this.events.emit('recall', { body: target });
    this.saveRun();
  }

  // ───────────────────────────── Scanning & discovery ─────────────────────────────

  private scan(): void {
    const w = this.world;
    if (!w) return;
    const s = this.probe;
    this.frame.eval(w.bodies, s.t);
    for (const b of w.bodies) {
      const d = dist(s.x, s.y, this.frame.x[b.index]!, this.frame.y[b.index]!) - b.radius;
      if (!b.revealed) {
        const range = b.hiddenRange * this.stats.hiddenSense;
        if (d < range) {
          b.revealed = true;
          this.discover(`body:${b.type.id}`);
          this.slowmo(0.8, 0.35);
          this.events.emit('reveal', { body: b.index, x: this.frame.x[b.index]!, y: this.frame.y[b.index]! });
          if (this.run && !this.run.discoveries.includes(b.type.id)) this.run.discoveries.push(b.type.id);
        } else if (d < range * 2.4 && !this.signaled.has(b.index) && this.mode === 'run') {
          this.signaled.add(b.index);
          this.discover('signal');
          this.events.emit('signal', { body: b.index });
        }
        continue;
      }
      if (b.type.id === 'asteroid') {
        if (d < this.stats.scanRadius * 0.6) this.hintOnce('asteroid', 'Asteroid stream — impacts cost hull. Time your launch through a gap');
        continue;
      }
      if (d < this.stats.scanRadius && !b.scanned) {
        b.scanned = true;
        if (b.tags.has('unknown')) {
          if (this.stats.deepScan) b.identified = true;
          else this.hintOnce('unknown', 'Unknown signal “?” — land on it to find out what it is');
        }
        if (b.identified) {
          const isNew = this.discover(`body:${b.type.id}`);
          if (isNew && this.run && !this.run.discoveries.includes(b.type.id)) this.run.discoveries.push(b.type.id);
        }
        if (b.orbit && b.orbit.parent === null && !b.tags.has('boss')) this.discover('binary');
        if (b.type.id === 'gasGiant') this.hintOnce('gasGiant', 'Gas giant: no surface. Skim its haze to brake — the core is lethal');
        if (b.type.id === 'star') this.hintOnce('star', 'Never touch a star. Pass close for a powerful slingshot');
        if (b.type.id === 'pulsar') this.hintOnce('pulsar', 'Pulsar: its gravity breathes. Watch the rings to time your pass');
      } else if (b.scanned && !b.identified && this.stats.deepScan && b.tags.has('unknown')) {
        b.identified = true;
        this.discover(`body:${b.type.id}`);
      }
    }
  }

  private discover(id: string): boolean {
    // Onboarding stays quiet: only the slingshot insight is celebrated during the tutorial.
    if (this.mode === 'tutorial' && id !== 'slingshot') return false;
    const isNew = discover(this.profile, id);
    if (isNew) {
      const def = discoveryById(id)!;
      if (this.run && !this.run.discoveries.includes(id) && !id.startsWith('body:')) this.run.discoveries.push(id);
      this.events.emit('discovery', { id, name: def.name, text: def.text });
      saveProfile(this.profile);
    }
    return isNew;
  }

  private achieve(id: string): void {
    if (this.mode !== 'run') return;
    if (unlockAchievement(this.profile, id)) {
      const def = achievementById(id)!;
      this.events.emit('achievement', { id, name: def.name, description: def.description });
      saveProfile(this.profile);
    }
  }

  hintOnce(key: string, text: string, always = false): void {
    if (!always && this.profile.hints.includes(key)) return;
    if (!this.profile.hints.includes(key)) this.profile.hints.push(key);
    this.events.emit('hint', { text, key });
  }

  slowmo(duration: number, scale: number): void {
    if (this.profile.settings.reducedEffects) return;
    this.timeScale = scale;
    this.slowmoUntil = this.time + duration * scale;
  }

  // ───────────────────────────── Camera ─────────────────────────────

  private frameLanded(includeAim: boolean): void {
    const w = this.world!;
    const s = this.probe;
    let minX = s.x - 300;
    let maxX = s.x + 300;
    let minY = s.y - 300;
    let maxY = s.y + 300;
    const extend = (x: number, y: number, r = 0) => {
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    };
    const lb = s.landed >= 0 ? w.bodies[s.landed]! : null;
    if (lb) extend(this.frame.x[lb.index]!, this.frame.y[lb.index]!, lb.radius + 60);
    const pred = this.prediction;
    if (includeAim && pred && this.aim.valid) {
      for (let i = 0; i < pred.count; i += 4) extend(pred.points[i * 2]!, pred.points[i * 2 + 1]!, 40);
      extend(pred.endX, pred.endY, 60);
    } else {
      // Show the neighbourhood: nearest unvisited worlds.
      const near = w.bodies
        .filter((b) => b.revealed && b.type.id !== 'asteroid' && b.index !== s.landed)
        .map((b) => ({ b, d: dist(s.x, s.y, this.frame.x[b.index]!, this.frame.y[b.index]!) }))
        .filter((o) => o.d < 720)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      for (const o of near) extend(this.frame.x[o.b.index]!, this.frame.y[o.b.index]!, o.b.radius + 20);
    }
    this.camera.frameBox(minX, minY, maxX, maxY, 1.15, 760, 1900);
  }

  private updateCamera(dt: number): void {
    const w = this.world;
    if (!w) return;
    const s = this.probe;
    const cam = this.camera;
    cam.followRate = 3.2;
    cam.zoomRate = 1.8;
    if (this.phase === 'landed' || this.phase === 'transition') {
      this.frameLanded(true);
      cam.followRate = 2.4;
    } else if (this.phase === 'flight') {
      const sp = len(s.vx, s.vy);
      const view = clamp(820 + sp * 1.05, 820, 2100);
      let minX = s.x + s.vx * 0.45 - view / 2;
      let maxX = s.x + s.vx * 0.45 + view / 2;
      let minY = s.y + s.vy * 0.45 - view / 2;
      let maxY = s.y + s.vy * 0.45 + view / 2;
      if (s.domBody >= 0) {
        const b = w.bodies[s.domBody]!;
        const bx = this.frame.x[b.index]!;
        const by = this.frame.y[b.index]!;
        minX = Math.min(minX, bx - b.radius * 1.4);
        maxX = Math.max(maxX, bx + b.radius * 1.4);
        minY = Math.min(minY, by - b.radius * 1.4);
        maxY = Math.max(maxY, by + b.radius * 1.4);
      }
      cam.frameBox(minX, minY, maxX, maxY, 1, 760, 2600);
      cam.followRate = 5;
    } else if (this.phase === 'incident') {
      const t = this.lastTracker;
      if (t && t.pathCount > 1) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < t.pathCount; i += 3) {
          minX = Math.min(minX, t.path[i * 2]!);
          maxX = Math.max(maxX, t.path[i * 2]!);
          minY = Math.min(minY, t.path[i * 2 + 1]!);
          maxY = Math.max(maxY, t.path[i * 2 + 1]!);
        }
        cam.frameBox(minX, minY, maxX, maxY, 1.3, 800, 3200);
        cam.followRate = 2;
      }
    }
    void dt;
  }

  // ───────────────────────────── Persistence ─────────────────────────────

  saveRun(): void {
    const r = this.run;
    const w = this.world;
    if (!r || !w || this.mode !== 'run') return;
    if (this.phase === 'landed' && this.probe.landed >= 0) {
      const b = w.bodies[this.probe.landed]!;
      if (b.type.landable && !b.tags.has('unstable')) {
        r.bodyIndex = this.probe.landed;
        r.landAngle = this.probe.landAngle + b.rotationAt(this.probe.t);
        r.sectorTime = this.probe.t;
      } else {
        r.bodyIndex = this.safeBody;
        r.landAngle = this.safeAngle;
        r.sectorTime = this.probe.t;
      }
    }
    saveRunJson(r);
  }

  /** Recall the flight path for replay rendering. */
  replayPath(): { path: Float32Array; count: number } | null {
    const t = this.lastTracker;
    return t ? { path: t.path, count: t.pathCount } : null;
  }
}
