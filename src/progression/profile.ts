import type { AbilityId } from '../data/abilities';

/** Everything that persists between runs. Plain JSON so it survives app updates via migration. */

export interface Settings {
  sfx: number;
  music: number;
  haptics: boolean;
  shake: number;
  reducedEffects: boolean;
  leftHanded: boolean;
  highContrastPath: boolean;
  uiScale: number;
  aimAssist: boolean;
  /** 'pull' = slingshot (drag back to launch forward); 'push' = drag toward the target. */
  aimMode: 'pull' | 'push';
  telemetry: boolean;
}

export type JournalKind = 'discovery' | 'maneuver' | 'run' | 'secret' | 'achievement' | 'region' | 'tech';

export interface JournalEntry {
  t: number;
  kind: JournalKind;
  text: string;
}

export interface LifetimeStats {
  runs: number;
  completions: number;
  extractions: number;
  planetsVisited: number;
  launches: number;
  assists: number;
  orbits: number;
  bounces: number;
  recalls: number;
  bestSpeed: number;
  bestScore: number;
  totalMatter: number;
  flightSeconds: number;
}

export interface RunRecord {
  t: number;
  score: number;
  region: string;
  seed: number;
  sectors: number;
  outcome: 'complete' | 'extracted' | 'lost';
  daily?: string;
}

export interface Profile {
  version: 1;
  createdAt: number;
  tutorialDone: boolean;
  matter: number;
  data: number;
  tech: string[];
  discoveries: Record<string, number>;
  achievements: Record<string, number>;
  stats: LifetimeStats;
  regionProgress: Record<string, { bestSector: number; completed: boolean }>;
  journal: JournalEntry[];
  hints: string[];
  equipped: AbilityId[];
  selectedRegion: string;
  daily: Record<string, number>;
  runs: RunRecord[];
  lore: number;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  sfx: 0.8,
  music: 0.5,
  haptics: true,
  shake: 1,
  reducedEffects: false,
  leftHanded: false,
  highContrastPath: false,
  uiScale: 1,
  aimAssist: false,
  aimMode: 'pull',
  telemetry: true,
};

export function newProfile(): Profile {
  return {
    version: 1,
    createdAt: Date.now(),
    tutorialDone: false,
    matter: 0,
    data: 0,
    tech: [],
    discoveries: {},
    achievements: {},
    stats: {
      runs: 0,
      completions: 0,
      extractions: 0,
      planetsVisited: 0,
      launches: 0,
      assists: 0,
      orbits: 0,
      bounces: 0,
      recalls: 0,
      bestSpeed: 0,
      bestScore: 0,
      totalMatter: 0,
      flightSeconds: 0,
    },
    regionProgress: {},
    journal: [],
    hints: [],
    equipped: ['brake'],
    selectedRegion: 'innerBelt',
    daily: {},
    runs: [],
    lore: 0,
    settings: { ...DEFAULT_SETTINGS },
  };
}

const PROFILE_KEY = 'planetbounce.profile.v1';
const RUN_KEY = 'planetbounce.run.v1';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Fills in any fields added in later versions so old saves keep working. */
export function migrateProfile(raw: unknown): Profile {
  const base = newProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Profile>;
  return {
    ...base,
    ...p,
    stats: { ...base.stats, ...(p.stats ?? {}) },
    settings: { ...base.settings, ...(p.settings ?? {}) },
    discoveries: { ...(p.discoveries ?? {}) },
    achievements: { ...(p.achievements ?? {}) },
    regionProgress: { ...(p.regionProgress ?? {}) },
    journal: Array.isArray(p.journal) ? p.journal.slice(-300) : [],
    hints: Array.isArray(p.hints) ? p.hints : [],
    tech: Array.isArray(p.tech) ? p.tech : [],
    equipped: Array.isArray(p.equipped) && p.equipped.length ? p.equipped : base.equipped,
    runs: Array.isArray(p.runs) ? p.runs.slice(-50) : [],
    daily: { ...(p.daily ?? {}) },
    version: 1,
  };
}

export function loadProfile(): Profile {
  const s = storage();
  if (!s) return newProfile();
  try {
    const txt = s.getItem(PROFILE_KEY);
    return txt ? migrateProfile(JSON.parse(txt)) : newProfile();
  } catch {
    return newProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    storage()?.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage full or unavailable — the game keeps running */
  }
}

export function loadRunJson<T>(): T | null {
  try {
    const txt = storage()?.getItem(RUN_KEY);
    return txt ? (JSON.parse(txt) as T) : null;
  } catch {
    return null;
  }
}

export function saveRunJson(v: unknown): void {
  try {
    storage()?.setItem(RUN_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function clearRun(): void {
  try {
    storage()?.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function addJournal(p: Profile, kind: JournalKind, text: string): void {
  p.journal.push({ t: Date.now(), kind, text });
  if (p.journal.length > 300) p.journal.splice(0, p.journal.length - 300);
}

export function relativeTime(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 90) return 'Moments ago';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} minutes ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  const d = h / 24;
  if (d < 2) return 'Yesterday';
  if (d < 30) return `${Math.round(d)} days ago`;
  return `${Math.round(d / 30)} month${Math.round(d / 30) === 1 ? '' : 's'} ago`;
}

/** Surfaces a past moment for the hub ("Three days ago you discovered your first..."). */
export function pickMemory(p: Profile, now = Date.now()): string | null {
  const old = p.journal.filter((j) => now - j.t > 6 * 3600 * 1000 && (j.kind === 'discovery' || j.kind === 'secret' || j.kind === 'achievement' || j.kind === 'region'));
  if (!old.length) return null;
  const e = old[Math.floor((now / 86400000) % old.length)]!;
  const text = e.text.charAt(0).toLowerCase() + e.text.slice(1);
  return `${relativeTime(e.t, now)} you ${text.replace(/\.$/, '')}.`;
}
