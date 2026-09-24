import type { PlanetTypeId } from './planetTypes';

/**
 * Regions introduce mechanics gradually: each sector config is a "difficulty through complexity"
 * budget rather than bigger numbers.
 */

export type Weights = Partial<Record<PlanetTypeId, number>>;

export interface SectorConfig {
  /** Number of main-route worlds between the start and the gate. */
  spine: [number, number];
  spacing: [number, number];
  lateral: number;
  spineTypes: Weights;
  branches: [number, number];
  branchTypes: Weights;
  /** Chance of a big gravity well placed beside the route (slingshot shortcut). */
  shortcut: number;
  shortcutTypes: Weights;
  moonChance: number;
  asteroidStreams: [number, number];
  unstableChance: number;
  unknowns: number;
  secretChance: number;
  binaryChance: number;
  /** Mechanics this sector introduces, surfaced on the sector card. */
  introduces?: string;
}

export type BossId = 'rogueGiant' | 'twinGiants';

export interface RegionDefinition {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  requires?: string;
  sectors: SectorConfig[];
  boss: { id: BossId; name: string; subtitle: string };
}

export const REGIONS: RegionDefinition[] = [
  {
    id: 'innerBelt',
    name: 'The Inner Belt',
    subtitle: 'Where every pilot learns to fall.',
    color: '#7df9ff',
    sectors: [
      {
        spine: [3, 4],
        spacing: [340, 430],
        lateral: 200,
        spineTypes: { rocky: 6, moon: 2 },
        branches: [1, 2],
        branchTypes: { crystal: 3, rocky: 2, ice: 1 },
        shortcut: 0.6,
        shortcutTypes: { giant: 1 },
        moonChance: 0.25,
        asteroidStreams: [0, 0],
        unstableChance: 0,
        unknowns: 1,
        secretChance: 0,
        binaryChance: 0,
        introduces: 'Giants bend your path',
      },
      {
        spine: [4, 5],
        spacing: [360, 470],
        lateral: 260,
        spineTypes: { rocky: 4, moon: 2, ice: 2, giant: 1 },
        branches: [2, 3],
        branchTypes: { crystal: 2, volcanic: 3, ice: 1, rocky: 1 },
        shortcut: 0.8,
        shortcutTypes: { giant: 2, gasGiant: 2 },
        moonChance: 0.45,
        asteroidStreams: [0, 1],
        unstableChance: 0.2,
        unknowns: 1,
        secretChance: 0.6,
        binaryChance: 0,
        introduces: 'Moving moons · volcanic rhythms',
      },
      {
        spine: [5, 6],
        spacing: [380, 500],
        lateral: 300,
        spineTypes: { rocky: 3, moon: 2, ice: 2, giant: 1, pulsar: 1 },
        branches: [2, 3],
        branchTypes: { volcanic: 2, crystal: 2, pulsar: 2, ice: 1 },
        shortcut: 1,
        shortcutTypes: { gasGiant: 2, star: 1, giant: 1 },
        moonChance: 0.5,
        asteroidStreams: [1, 1],
        unstableChance: 0.25,
        unknowns: 2,
        secretChance: 0.5,
        binaryChance: 0,
        introduces: 'Pulsars · stars · asteroid streams',
      },
    ],
    boss: { id: 'rogueGiant', name: 'The Rogue Giant', subtitle: 'A wandering world sweeps the sector.' },
  },
  {
    id: 'shatteredMoons',
    name: 'The Shattered Moons',
    subtitle: 'Moons chase each other through debris and memory.',
    color: '#b594ff',
    requires: 'region:innerBelt',
    sectors: [
      {
        spine: [4, 5],
        spacing: [380, 480],
        lateral: 280,
        spineTypes: { moon: 4, rocky: 2, ice: 2 },
        branches: [2, 3],
        branchTypes: { crystal: 2, volcanic: 2, pulsar: 1 },
        shortcut: 0.8,
        shortcutTypes: { giant: 2, gasGiant: 1 },
        moonChance: 0.7,
        asteroidStreams: [1, 1],
        unstableChance: 0.3,
        unknowns: 1,
        secretChance: 0.4,
        binaryChance: 0.6,
        introduces: 'Binary pairs',
      },
      {
        spine: [5, 6],
        spacing: [400, 520],
        lateral: 320,
        spineTypes: { moon: 3, rocky: 2, ice: 2, pulsar: 1 },
        branches: [2, 4],
        branchTypes: { crystal: 2, volcanic: 2, pulsar: 2 },
        shortcut: 1,
        shortcutTypes: { gasGiant: 2, star: 2 },
        moonChance: 0.8,
        asteroidStreams: [1, 2],
        unstableChance: 0.35,
        unknowns: 2,
        secretChance: 0.4,
        binaryChance: 0.8,
        introduces: 'Crowded wells',
      },
    ],
    boss: { id: 'twinGiants', name: 'The Twin Giants', subtitle: 'Two worlds, one chaotic dance.' },
  },
];

export const regionById = (id: string): RegionDefinition => REGIONS.find((r) => r.id === id) ?? REGIONS[0]!;
