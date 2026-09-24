import type { PlayerStats } from '../progression/stats';

/**
 * Run modules: temporary equipment found during an expedition. Each one should change HOW you
 * play (a new behavior or trade-off), not only nudge a number.
 */

export type ModuleSlot = 'core' | 'propulsion' | 'gravity' | 'defense' | 'navigation' | 'energy' | 'passive';
export type Archetype = 'slingshot' | 'tank' | 'speed' | 'explorer' | 'precision' | 'orbital' | 'risk' | 'energy' | 'bounce';

export interface ModuleDefinition {
  id: string;
  name: string;
  slot: ModuleSlot;
  archetype: Archetype;
  description: string;
  /** Short trade-off line shown in red when a module has a downside. */
  drawback?: string;
  rarity: 1 | 2 | 3;
  /** Needs an unlock flag (from tech or discovery) to appear in the pool. */
  requires?: string;
  apply(s: PlayerStats): void;
}

export const MODULES: ModuleDefinition[] = [
  {
    id: 'heavyCore',
    name: 'Heavy Core',
    slot: 'core',
    archetype: 'tank',
    description: 'Gravity bends you less. Launches hit harder. +1 hull.',
    drawback: 'Harder to capture into orbits.',
    rarity: 1,
    apply: (s) => {
      s.sim.gravityScale *= 0.8;
      s.maxLaunch *= 1.12;
      s.hullMax += 1;
    },
  },
  {
    id: 'lightCore',
    name: 'Light Core',
    slot: 'core',
    archetype: 'precision',
    description: 'Gravity grips you 25% harder — sharper slingshots. Thrusters are 60% stronger.',
    drawback: 'Wells are harder to escape.',
    rarity: 1,
    apply: (s) => {
      s.sim.gravityScale *= 1.25;
      s.thrust *= 1.6;
    },
  },
  {
    id: 'slingCoils',
    name: 'Slingshot Coils',
    slot: 'gravity',
    archetype: 'slingshot',
    description: 'Every close pass (under 2 radii) adds +10% speed and 8 energy.',
    rarity: 2,
    apply: (s) => {
      s.slingshotBoost += 0.1;
      s.slingshotEnergy += 8;
    },
  },
  {
    id: 'softLander',
    name: 'Soft Landing Gear',
    slot: 'defense',
    archetype: 'precision',
    description: 'Absorbs impacts up to 60 u/s faster before bouncing. Settles on slopes sooner.',
    rarity: 1,
    apply: (s) => {
      s.sim.landSpeed += 60;
      s.sim.settleSpeed += 20;
    },
  },
  {
    id: 'bouncePlating',
    name: 'Bounce Plating',
    slot: 'defense',
    archetype: 'bounce',
    description: 'Much springier bounces, hard impacts no longer hurt, and every bounce chips off 2 matter.',
    drawback: 'Landing takes finesse.',
    rarity: 2,
    apply: (s) => {
      s.sim.restitutionBonus += 0.25;
      s.sim.hardImpact += 400;
      s.bounceMatter += 2;
    },
  },
  {
    id: 'fuelCell',
    name: 'Auxiliary Fuel Cell',
    slot: 'propulsion',
    archetype: 'precision',
    description: '+50 fuel capacity for course corrections.',
    rarity: 1,
    apply: (s) => {
      s.fuelMax += 50;
    },
  },
  {
    id: 'harvester',
    name: 'Gravity Harvester',
    slot: 'energy',
    archetype: 'orbital',
    description: 'Deep inside gravity wells you slowly regain fuel. Orbiting refuels you.',
    rarity: 2,
    apply: (s) => {
      s.harvestFuel += 7;
    },
  },
  {
    id: 'longPredictor',
    name: 'Long-Range Predictor',
    slot: 'navigation',
    archetype: 'explorer',
    description: '+1.5 seconds of trajectory prediction.',
    rarity: 1,
    apply: (s) => {
      s.prediction += 1.5;
    },
  },
  {
    id: 'capacitor',
    name: 'Orbital Capacitor',
    slot: 'energy',
    archetype: 'orbital',
    description: 'Each full orbit around a body charges 25 energy.',
    rarity: 2,
    apply: (s) => {
      s.orbitEnergy += 25;
    },
  },
  {
    id: 'aerobrake',
    name: 'Aerobrake Shell',
    slot: 'defense',
    archetype: 'speed',
    description: 'Gas giant atmospheres brake you twice as hard, and every skim scoops 4 matter.',
    rarity: 2,
    apply: (s) => {
      s.sim.dragScale *= 2;
      s.aeroMatter += 4;
    },
  },
  {
    id: 'phaseSkin',
    name: 'Phase Skin',
    slot: 'defense',
    archetype: 'tank',
    description: 'The first two asteroid hits each sector pass harmlessly through you.',
    rarity: 1,
    apply: (s) => {
      s.asteroidShield += 2;
    },
  },
  {
    id: 'anchor',
    name: 'Momentum Anchor',
    slot: 'propulsion',
    archetype: 'speed',
    description: 'Stores 35% of your arrival speed on landing and adds it to your next launch.',
    rarity: 2,
    apply: (s) => {
      s.momentumAnchor += 0.35;
    },
  },
  {
    id: 'prospector',
    name: 'Prospector Drill',
    slot: 'passive',
    archetype: 'explorer',
    description: '+50% matter from every deposit.',
    rarity: 1,
    apply: (s) => {
      s.matterMult *= 1.5;
    },
  },
  {
    id: 'riskEngine',
    name: 'Risk Engine',
    slot: 'passive',
    archetype: 'risk',
    description: 'Double matter from dangerous worlds (volcanic, pulsar, giants).',
    drawback: '−1 hull.',
    rarity: 2,
    apply: (s) => {
      s.riskMatter += 1;
      s.hullMax = Math.max(1, s.hullMax - 1);
    },
  },
  {
    id: 'resonance',
    name: 'Resonance Coil',
    slot: 'energy',
    archetype: 'energy',
    description: 'Ancient tech: abilities cost 40% less while inside a gravity well.',
    rarity: 3,
    requires: 'ancientArchive',
    apply: (s) => {
      s.wellDiscount = Math.max(s.wellDiscount, 0.4);
    },
  },
  {
    id: 'capacitorBank',
    name: 'Capacitor Bank',
    slot: 'energy',
    archetype: 'energy',
    description: '+50 max energy, and landings recharge 10 more.',
    rarity: 1,
    apply: (s) => {
      s.energyMax += 50;
      s.energyPerLanding += 10;
    },
  },
];

export const moduleById = (id: string): ModuleDefinition | undefined => MODULES.find((m) => m.id === id);
