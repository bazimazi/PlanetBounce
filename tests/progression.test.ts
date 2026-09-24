import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { TECH } from '../src/data/tech';
import { buyTech, computeStats, discover, nextGoals, rollModules, techStatus, unlockAchievement } from '../src/progression/progression';
import { migrateProfile, newProfile } from '../src/progression/profile';
import { newRun, runScore } from '../src/run/runState';

describe('technology', () => {
  it('requires prerequisites and resources, and deducts cost', () => {
    const p = newProfile();
    expect(buyTech(p, 'nav.wide')).toBe(false);
    p.matter = 100;
    expect(buyTech(p, 'nav.impact')).toBe(false); // missing prerequisite
    expect(buyTech(p, 'nav.wide')).toBe(true);
    expect(p.matter).toBe(70);
    expect(computeStats(p).prediction).toBeCloseTo(2.4);
  });

  it('discovery-gated nodes stay locked until the discovery happens', () => {
    const p = newProfile();
    p.matter = 1000;
    p.data = 100;
    buyTech(p, 'grav.hook');
    const lock = TECH.find((t) => t.id === 'grav.lock')!;
    expect(techStatus(p, lock).status).toBe('gated');
    discover(p, 'orbit');
    expect(techStatus(p, lock).status).toBe('available');
    expect(buyTech(p, 'grav.lock')).toBe(true);
    expect(computeStats(p).unlockedAbilities).toContain('orbitLock');
  });

  it('suggests next goals for the post-run screen', () => {
    const p = newProfile();
    p.matter = 35;
    const goals = nextGoals(p, 3);
    expect(goals.length).toBe(3);
    expect(goals[0]!.status).toBe('available');
  });
});

describe('run modules', () => {
  it('roll deterministically, without duplicates, respecting unlocks', () => {
    const p = newProfile();
    const a = rollModules(new Rng(5), p, [], 3).map((m) => m.id);
    const b = rollModules(new Rng(5), p, [], 3).map((m) => m.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a).not.toContain('resonance'); // needs Ancient Archive
    expect(computeStats(p, ['bouncePlating']).sim.restitutionBonus).toBeGreaterThan(0);
  });
});

describe('persistence', () => {
  it('migrates partial/old saves without losing data', () => {
    const p = migrateProfile({ matter: 42, tech: ['nav.wide'], settings: { sfx: 0.2 } });
    expect(p.matter).toBe(42);
    expect(p.settings.sfx).toBe(0.2);
    expect(p.settings.haptics).toBe(true);
    expect(p.stats.runs).toBe(0);
  });

  it('round-trips a run through JSON', () => {
    const r = newRun(8392741, 'innerBelt', ['brake']);
    r.matter = 50;
    r.sectorsCleared = 2;
    const back = JSON.parse(JSON.stringify(r));
    expect(back).toEqual(r);
    expect(runScore(back)).toBeGreaterThan(0);
  });

  it('achievements pay out once', () => {
    const p = newProfile();
    expect(unlockAchievement(p, 'featherTouch')).toBe(true);
    const m = p.matter;
    expect(unlockAchievement(p, 'featherTouch')).toBe(false);
    expect(p.matter).toBe(m);
  });
});
