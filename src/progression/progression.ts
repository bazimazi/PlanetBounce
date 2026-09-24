import { ACHIEVEMENTS, achievementById } from '../data/achievements';
import { discoveryById } from '../data/discoveries';
import { moduleById, MODULES, type ModuleDefinition } from '../data/modules';
import { TECH, techById, type TechNode } from '../data/tech';
import type { Rng } from '../core/rng';
import { addJournal, type Profile } from './profile';
import { baseStats, type PlayerStats } from './stats';

/** Pure progression rules — tested without any rendering. */

export function techFlags(p: Profile): Set<string> {
  const flags = new Set<string>();
  for (const id of p.tech) for (const f of techById(id)?.flags ?? []) flags.add(f);
  return flags;
}

export function computeStats(p: Profile, modules: string[] = []): PlayerStats {
  const s = baseStats();
  for (const node of TECH) if (p.tech.includes(node.id)) node.apply(s);
  for (const id of modules) moduleById(id)?.apply(s);
  s.hullMax = Math.max(1, Math.round(s.hullMax));
  return s;
}

export type TechStatus = 'owned' | 'available' | 'locked' | 'gated' | 'unaffordable';

export function techStatus(p: Profile, node: TechNode): { status: TechStatus; reason?: string } {
  if (p.tech.includes(node.id)) return { status: 'owned' };
  const missing = node.requires.filter((r) => !p.tech.includes(r));
  if (missing.length) return { status: 'locked', reason: `Requires ${missing.map((m) => techById(m)?.name ?? m).join(', ')}` };
  if (node.gate) {
    const ok = (node.gate.discovery ? !!p.discoveries[node.gate.discovery] : true) && (node.gate.achievement ? !!p.achievements[node.gate.achievement] : true);
    if (!ok) return { status: 'gated', reason: node.gate.text };
  }
  if (p.matter < node.cost.matter || p.data < node.cost.data) return { status: 'unaffordable', reason: 'Not enough resources' };
  return { status: 'available' };
}

export function buyTech(p: Profile, id: string): boolean {
  const node = techById(id);
  if (!node || techStatus(p, node).status !== 'available') return false;
  p.matter -= node.cost.matter;
  p.data -= node.cost.data;
  p.tech.push(id);
  addJournal(p, 'tech', `Researched ${node.name}.`);
  return true;
}

/** Suggestions for "What do you want to improve next?" — closest meaningful unlocks first. */
export function nextGoals(p: Profile, limit = 3): { node: TechNode; progress: number; status: TechStatus; reason?: string }[] {
  return TECH.filter((n) => !p.tech.includes(n.id) && n.requires.every((r) => p.tech.includes(r)))
    .map((node) => {
      const st = techStatus(p, node);
      const need = node.cost.matter + node.cost.data * 5;
      const have = Math.min(p.matter, node.cost.matter) + Math.min(p.data, node.cost.data) * 5;
      return { node, progress: need > 0 ? have / need : 1, status: st.status, reason: st.reason };
    })
    .sort((a, b) => (a.status === 'gated' ? 1 : 0) - (b.status === 'gated' ? 1 : 0) || b.progress - a.progress)
    .slice(0, limit);
}

export function discover(p: Profile, id: string): boolean {
  if (p.discoveries[id]) return false;
  const def = discoveryById(id);
  if (!def) return false;
  p.discoveries[id] = Date.now();
  p.data += def.data;
  const kind = id === 'body:derelict' || id === 'signal' ? 'secret' : def.category === 'region' ? 'region' : 'discovery';
  addJournal(p, kind, def.category === 'region' ? `Charted ${def.name}.` : `Discovered your first ${def.name}.`);
  return true;
}

export function unlockAchievement(p: Profile, id: string): boolean {
  if (p.achievements[id]) return false;
  const def = achievementById(id);
  if (!def) return false;
  p.achievements[id] = Date.now();
  p.matter += def.reward.matter;
  p.data += def.reward.data;
  addJournal(p, 'achievement', `Earned “${def.name}”.`);
  return true;
}

export function achievementProgress(p: Profile): { done: number; total: number } {
  return { done: ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length, total: ACHIEVEMENTS.length };
}

/** Offer N modules, weighted toward rarity 1, never duplicating owned ones, respecting unlock flags. */
export function rollModules(rng: Rng, p: Profile, owned: string[], count: number): ModuleDefinition[] {
  const flags = techFlags(p);
  const pool = MODULES.filter((m) => !owned.includes(m.id) && (!m.requires || flags.has(m.requires)));
  const picks: ModuleDefinition[] = [];
  const bag = [...pool];
  while (picks.length < count && bag.length) {
    const weights = bag.map((m) => (m.rarity === 1 ? 5 : m.rarity === 2 ? 3 : 2));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    let i = 0;
    for (; i < bag.length; i++) {
      r -= weights[i]!;
      if (r <= 0) break;
    }
    const m = bag.splice(Math.min(i, bag.length - 1), 1)[0]!;
    // Avoid offering two modules of the same slot in one choice — keep choices distinct.
    if (picks.some((x) => x.slot === m.slot) && bag.some((b) => !picks.some((x) => x.slot === b.slot))) continue;
    picks.push(m);
  }
  return picks;
}
