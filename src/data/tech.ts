import type { PlayerStats } from '../progression/stats';

/**
 * Permanent technology. Tiers unlock capabilities (a longer/smarter prediction, new abilities,
 * new module pools) instead of +5% steps. Some nodes are gated by discoveries or mastery so
 * progression is earned by playing, not grinding.
 */

export type Branch = 'navigation' | 'propulsion' | 'gravity' | 'survival' | 'exploration';

export interface TechGate {
  discovery?: string;
  achievement?: string;
  text: string;
}

export interface TechNode {
  id: string;
  branch: Branch;
  tier: number;
  lane: number;
  name: string;
  description: string;
  cost: { matter: number; data: number };
  requires: string[];
  gate?: TechGate;
  /** Flags other systems check (module pools, recall rules...). */
  flags?: string[];
  apply(s: PlayerStats): void;
}

export const BRANCHES: { id: Branch; name: string; color: string }[] = [
  { id: 'navigation', name: 'Navigation', color: '#7df9ff' },
  { id: 'gravity', name: 'Gravity Control', color: '#ffd36b' },
  { id: 'propulsion', name: 'Propulsion', color: '#ff8ad8' },
  { id: 'survival', name: 'Survival', color: '#9dff9d' },
  { id: 'exploration', name: 'Exploration', color: '#b594ff' },
];

export const TECH: TechNode[] = [
  // Navigation — prediction lane
  {
    id: 'nav.wide',
    branch: 'navigation',
    tier: 1,
    lane: 0,
    name: 'Wide Prediction',
    description: 'Trajectory preview extends from 1.4s to 2.4s.',
    cost: { matter: 30, data: 0 },
    requires: [],
    apply: (s) => {
      s.prediction += 1;
    },
  },
  {
    id: 'nav.impact',
    branch: 'navigation',
    tier: 2,
    lane: 0,
    name: 'Impact Forecast',
    description: 'Predicts where you will hit and whether you will land, bounce or crash.',
    cost: { matter: 60, data: 0 },
    requires: ['nav.wide'],
    apply: (s) => {
      s.predictImpact = true;
    },
  },
  {
    id: 'nav.future',
    branch: 'navigation',
    tier: 3,
    lane: 0,
    name: 'Future Paths',
    description: 'See where moving worlds will be when you arrive. Prediction +1.2s.',
    cost: { matter: 110, data: 10 },
    requires: ['nav.impact'],
    apply: (s) => {
      s.predictGhosts = true;
      s.prediction += 1.2;
    },
  },
  // Navigation — scanner lane
  {
    id: 'scan.analysis',
    branch: 'navigation',
    tier: 1,
    lane: 1,
    name: 'Planetary Analysis',
    description: 'Scanner range 520 → 900. Identify rewards and hazards from farther away.',
    cost: { matter: 25, data: 0 },
    requires: [],
    apply: (s) => {
      s.scanRadius = Math.max(s.scanRadius, 900);
    },
  },
  {
    id: 'scan.deep',
    branch: 'navigation',
    tier: 2,
    lane: 1,
    name: 'Deep Scan',
    description: 'Unknown signals (?) reveal what they are once in scanner range.',
    cost: { matter: 60, data: 5 },
    requires: ['scan.analysis'],
    apply: (s) => {
      s.deepScan = true;
    },
  },
  {
    id: 'scan.hidden',
    branch: 'navigation',
    tier: 3,
    lane: 1,
    name: 'Hidden Worlds',
    description: 'Cloaked structures appear from three times farther away.',
    cost: { matter: 90, data: 15 },
    requires: ['scan.deep'],
    gate: { discovery: 'signal', text: 'Detect an unknown signal' },
    apply: (s) => {
      s.hiddenSense = 3;
    },
  },
  // Gravity
  {
    id: 'grav.hook',
    branch: 'gravity',
    tier: 1,
    lane: 0,
    name: 'Gravity Hook',
    description: 'Unlocks the Gravity Hook ability: yank yourself toward the nearest world ahead.',
    cost: { matter: 40, data: 0 },
    requires: [],
    apply: (s) => {
      if (!s.unlockedAbilities.includes('hook')) s.unlockedAbilities.push('hook');
    },
  },
  {
    id: 'grav.lock',
    branch: 'gravity',
    tier: 2,
    lane: 0,
    name: 'Orbit Lock',
    description: 'Unlocks Orbit Lock: snap into a perfect orbit and release on your chosen tangent.',
    cost: { matter: 70, data: 6 },
    requires: ['grav.hook'],
    gate: { discovery: 'orbit', text: 'Complete a full orbit around any world' },
    apply: (s) => {
      if (!s.unlockedAbilities.includes('orbitLock')) s.unlockedAbilities.push('orbitLock');
    },
  },
  {
    id: 'grav.twin',
    branch: 'gravity',
    tier: 3,
    lane: 0,
    name: 'Twin Modules',
    description: 'Equip two abilities at once. Combinations become possible.',
    cost: { matter: 130, data: 12 },
    requires: ['grav.lock'],
    apply: (s) => {
      s.abilitySlots = Math.max(s.abilitySlots, 2);
    },
  },
  // Propulsion
  {
    id: 'prop.tanks',
    branch: 'propulsion',
    tier: 1,
    lane: 0,
    name: 'Vector Tanks',
    description: '+40 fuel capacity.',
    cost: { matter: 30, data: 0 },
    requires: [],
    apply: (s) => {
      s.fuelMax += 40;
    },
  },
  {
    id: 'prop.efficient',
    branch: 'propulsion',
    tier: 2,
    lane: 0,
    name: 'Efficient Burn',
    description: 'Thrusters burn 30% less fuel and push 20% harder.',
    cost: { matter: 65, data: 0 },
    requires: ['prop.tanks'],
    apply: (s) => {
      s.fuelBurn *= 0.7;
      s.thrust *= 1.2;
    },
  },
  {
    id: 'prop.burst',
    branch: 'propulsion',
    tier: 3,
    lane: 0,
    name: 'Momentum Burst',
    description: 'Unlocks Momentum Burst: convert energy into +40% forward velocity.',
    cost: { matter: 90, data: 8 },
    requires: ['prop.efficient'],
    gate: { achievement: 'perfectSlingshot', text: 'Land a Perfect Slingshot (assist, no fuel)' },
    apply: (s) => {
      if (!s.unlockedAbilities.includes('burst')) s.unlockedAbilities.push('burst');
    },
  },
  // Survival
  {
    id: 'surv.hull',
    branch: 'survival',
    tier: 1,
    lane: 0,
    name: 'Reinforced Hull',
    description: '+1 hull integrity each expedition.',
    cost: { matter: 50, data: 0 },
    requires: [],
    apply: (s) => {
      s.hullMax += 1;
    },
  },
  {
    id: 'surv.absorb',
    branch: 'survival',
    tier: 2,
    lane: 0,
    name: 'Shock Absorbers',
    description: 'Absorb 30 u/s faster touchdowns; hard-impact threshold +120.',
    cost: { matter: 60, data: 0 },
    requires: ['surv.hull'],
    apply: (s) => {
      s.sim.landSpeed += 30;
      s.sim.hardImpact += 120;
    },
  },
  {
    id: 'surv.recall',
    branch: 'survival',
    tier: 3,
    lane: 0,
    name: 'Recall Beacon',
    description: 'Your first recall each expedition costs no hull.',
    cost: { matter: 100, data: 8 },
    requires: ['surv.absorb'],
    apply: (s) => {
      s.freeRecalls += 1;
    },
  },
  // Exploration
  {
    id: 'exp.prospect',
    branch: 'exploration',
    tier: 1,
    lane: 0,
    name: 'Prospector Protocols',
    description: '+25% matter from every deposit.',
    cost: { matter: 40, data: 0 },
    requires: [],
    apply: (s) => {
      s.matterMult *= 1.25;
    },
  },
  {
    id: 'exp.lab',
    branch: 'exploration',
    tier: 2,
    lane: 0,
    name: 'Field Lab',
    description: '+50% research data, and one extra module to choose from between sectors.',
    cost: { matter: 75, data: 6 },
    requires: ['exp.prospect'],
    apply: (s) => {
      s.dataMult *= 1.5;
      s.moduleChoices = Math.max(s.moduleChoices, 4);
    },
  },
  {
    id: 'exp.ancient',
    branch: 'exploration',
    tier: 3,
    lane: 0,
    name: 'Ancient Archive',
    description: 'Decode the derelict. Resonance Coils can appear in expeditions; +30 max energy.',
    cost: { matter: 60, data: 20 },
    requires: ['exp.lab'],
    gate: { discovery: 'body:derelict', text: 'Find a Derelict Construct' },
    flags: ['ancientArchive'],
    apply: (s) => {
      s.energyMax += 30;
    },
  },
];

export const techById = (id: string): TechNode | undefined => TECH.find((t) => t.id === id);
