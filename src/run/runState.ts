import type { AbilityId } from '../data/abilities';

/** Serializable expedition state. Saved on every landing so a run survives interruptions. */
export interface RunData {
  version: 1;
  seed: number;
  regionId: string;
  daily?: string;
  sectorIndex: number;
  modules: string[];
  equipped: AbilityId[];
  hull: number;
  fuel: number;
  energy: number;
  matter: number;
  data: number;
  freeRecalls: number;
  anchor: number;
  // Position
  bodyIndex: number;
  landAngle: number;
  sectorTime: number;
  collected: number[];
  visited: number[];
  // Stats
  planets: number;
  bounces: number;
  assists: number;
  orbits: number;
  maxSpeed: number;
  sectorFuelUsed: number;
  hullLost: number;
  recalls: number;
  discoveries: string[];
  maneuvers: number;
  bestManeuver: string;
  bestManeuverWeight: number;
  sectorsCleared: number;
  startedAt: number;
  flightSeconds: number;
  /** Furthest progress toward the current sector gate, 0..1. */
  sectorProgress: number;
  /** If set, the player was choosing modules when the run was saved. */
  pendingChoice?: string[];
}

export function newRun(seed: number, regionId: string, equipped: AbilityId[], daily?: string): RunData {
  return {
    version: 1,
    seed,
    regionId,
    daily,
    sectorIndex: 0,
    modules: [],
    equipped,
    hull: 3,
    fuel: 100,
    energy: 60,
    matter: 0,
    data: 0,
    freeRecalls: 0,
    anchor: 0,
    bodyIndex: 0,
    landAngle: -Math.PI / 2,
    sectorTime: 0,
    collected: [0],
    visited: [0],
    planets: 0,
    bounces: 0,
    assists: 0,
    orbits: 0,
    maxSpeed: 0,
    sectorFuelUsed: 0,
    hullLost: 0,
    recalls: 0,
    discoveries: [],
    maneuvers: 0,
    bestManeuver: '',
    bestManeuverWeight: 0,
    sectorsCleared: 0,
    startedAt: Date.now(),
    flightSeconds: 0,
    sectorProgress: 0,
  };
}

export function runScore(r: RunData): number {
  return Math.round(r.matter + r.sectorsCleared * 60 + r.maneuvers * 8 + r.planets * 4 + r.discoveries.length * 15 + r.sectorProgress * 40);
}
