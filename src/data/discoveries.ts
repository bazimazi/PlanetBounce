import { PLANET_TYPES, type AtlasCategory, type PlanetTypeId } from './planetTypes';

/** Cosmic Atlas entries. Some discoveries gate technology — the atlas is a key, not a checklist. */

export type DiscoveryCategory = AtlasCategory | 'phenomenon' | 'region';

export interface DiscoveryDefinition {
  id: string;
  name: string;
  category: DiscoveryCategory;
  text: string;
  data: number;
  planetType?: PlanetTypeId;
  /** Hint shown while undiscovered — curiosity, never pure RNG. */
  hint: string;
}

const planetEntries: DiscoveryDefinition[] = (Object.keys(PLANET_TYPES) as PlanetTypeId[])
  .filter((id) => id !== 'gate')
  .map((id) => ({
    id: `body:${id}`,
    name: PLANET_TYPES[id].name,
    category: PLANET_TYPES[id].atlas,
    text: PLANET_TYPES[id].lore,
    data: PLANET_TYPES[id].atlas === 'anomaly' || PLANET_TYPES[id].atlas === 'structure' ? 6 : 2,
    planetType: id,
    hint: hintFor(id),
  }));

function hintFor(id: PlanetTypeId): string {
  switch (id) {
    case 'derelict':
      return 'Something silent drifts where the scanners do not look.';
    case 'rogueGiant':
      return 'Reach the end of the Inner Belt.';
    case 'beacon':
      return 'Complete an expedition.';
    case 'star':
    case 'gasGiant':
    case 'pulsar':
      return 'Found deeper into an expedition.';
    default:
      return 'Fly close enough to scan one.';
  }
}

export const DISCOVERIES: DiscoveryDefinition[] = [
  ...planetEntries,
  {
    id: 'slingshot',
    name: 'Gravity Assist',
    category: 'phenomenon',
    text: 'You fell past a world and came out faster, bent toward somewhere new. Gravity is propulsion.',
    data: 3,
    hint: 'Pass close to a world without landing on it.',
  },
  {
    id: 'orbit',
    name: 'Orbital Capture',
    category: 'phenomenon',
    text: 'Falling forever and never landing. An orbit is just a miss that keeps missing.',
    data: 4,
    hint: 'Circle a world completely.',
  },
  {
    id: 'aerobrake',
    name: 'Aerobraking',
    category: 'phenomenon',
    text: 'Thick air is a brake that costs no fuel. Skim high — the core does not give back.',
    data: 4,
    hint: 'Pass through a gas giant’s atmosphere and survive.',
  },
  {
    id: 'eruption',
    name: 'Eruption Launch',
    category: 'phenomenon',
    text: 'The volcano threw you. Somewhere in that fury was a direction.',
    data: 3,
    hint: 'Linger on a volcanic world a little too long.',
  },
  {
    id: 'moving',
    name: 'Moving Worlds',
    category: 'phenomenon',
    text: 'Aim where it will be, not where it is. Launching from a moving moon carries its motion with you.',
    data: 3,
    hint: 'Land on a moon that orbits another world.',
  },
  {
    id: 'binary',
    name: 'Binary Pair',
    category: 'phenomenon',
    text: 'Two worlds dancing around nothing. Their combined pull is never still.',
    data: 6,
    hint: 'Found in the Shattered Moons.',
  },
  {
    id: 'signal',
    name: 'Unknown Signal',
    category: 'phenomenon',
    text: 'A pulse, repeating every 7.3 seconds. It is not natural. It is not ours.',
    data: 5,
    hint: 'Listen closely in quiet sectors.',
  },
  {
    id: 'region:innerBelt',
    name: 'The Inner Belt',
    category: 'region',
    text: 'Where every pilot learns to fall. Simple worlds, honest gravity.',
    data: 5,
    hint: 'Complete the Inner Belt.',
  },
  {
    id: 'region:shatteredMoons',
    name: 'The Shattered Moons',
    category: 'region',
    text: 'A system torn apart. Moons chase each other through debris and memory.',
    data: 8,
    hint: 'Complete the Shattered Moons.',
  },
];

export const discoveryById = (id: string): DiscoveryDefinition | undefined => DISCOVERIES.find((d) => d.id === id);

export const LORE_FRAGMENTS: string[] = [
  'Fragment 1 — “The routes were drawn before the worlds existed. Someone planned the falling.”',
  'Fragment 2 — “Every gate hums the same note. Every note is slightly flatter than the last.”',
  'Fragment 3 — “We did not build the gates. We only learned to land on them.”',
  'Fragment 4 — “The rogue worlds are not lost. They are being moved.”',
];
