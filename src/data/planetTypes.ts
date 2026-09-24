/**
 * Data-driven celestial body definitions. Every type exists to create a different decision,
 * not just a different look. Add new bodies here; physics/rendering read these fields.
 */

export type PlanetTypeId =
  | 'rocky'
  | 'moon'
  | 'giant'
  | 'gasGiant'
  | 'ice'
  | 'volcanic'
  | 'crystal'
  | 'pulsar'
  | 'star'
  | 'gate'
  | 'derelict'
  | 'asteroid'
  | 'rogueGiant'
  | 'beacon';

export type VisualStyle =
  | 'rocky'
  | 'moon'
  | 'ocean'
  | 'banded'
  | 'ice'
  | 'lava'
  | 'crystal'
  | 'pulsar'
  | 'star'
  | 'gate'
  | 'derelict'
  | 'asteroid'
  | 'rogue'
  | 'beacon';

export type AtlasCategory = 'planet' | 'moon' | 'star' | 'anomaly' | 'structure' | 'hazard';

export type BodyBehavior =
  | { kind: 'pulse'; period: number; amplitude: number }
  | { kind: 'erupt'; period: number; duration: number; strength: number; reach: number };

export interface PlanetDefinition {
  id: PlanetTypeId;
  name: string;
  /** One-line gameplay hint shown on scan. */
  hint: string;
  lore: string;
  atlas: AtlasCategory;
  radius: [number, number];
  /** Acceleration at the surface (world units / s^2). mu = g * R^2. */
  surfaceGravity: number;
  /** Sphere of influence as a multiple of radius. Gravity fades to zero at its edge. */
  soiFactor: number;
  restitution: number;
  /** Coulomb-like friction coefficient while sliding on the surface. */
  friction: number;
  landable: boolean;
  lethal: boolean;
  /** Gas giants: fraction of radius that is the lethal core. The rest is atmosphere. */
  coreFactor?: number;
  /** Quadratic drag coefficient inside the atmosphere. */
  atmosphereDrag?: number;
  rotation: [number, number];
  style: VisualStyle;
  palette: { base: string; dark: string; light: string; glow: string };
  rewards: { matter: [number, number]; fuel?: number; energy?: number; data?: number };
  behavior?: BodyBehavior;
  /** 0 safe .. 3 deadly — drives UI danger pips and generator difficulty budget. */
  danger: number;
  /** Deals hull damage on contact above this relative speed (asteroids). */
  damageSpeed?: number;
}

export const PLANET_TYPES: Record<PlanetTypeId, PlanetDefinition> = {
  rocky: {
    id: 'rocky',
    name: 'Rocky World',
    hint: 'Stable gravity. Predictable landings.',
    lore: 'Old stone, older craters. Every explorer learns to trust these.',
    atlas: 'planet',
    radius: [44, 62],
    surfaceGravity: 300,
    soiFactor: 5.4,
    restitution: 0.34,
    friction: 0.9,
    landable: true,
    lethal: false,
    rotation: [0.05, 0.16],
    style: 'rocky',
    palette: { base: '#9a8a7a', dark: '#4a3f38', light: '#d8c8b0', glow: '#ffd9a8' },
    rewards: { matter: [6, 10] },
    danger: 0,
  },
  moon: {
    id: 'moon',
    name: 'Tiny Moon',
    hint: 'Weak pull, easy escape. Often hides fuel ice.',
    lore: 'Pocked little worlds that barely hold on to anything — including you.',
    atlas: 'moon',
    radius: [18, 26],
    surfaceGravity: 170,
    soiFactor: 5.5,
    restitution: 0.3,
    friction: 0.8,
    landable: true,
    lethal: false,
    rotation: [0.1, 0.3],
    style: 'moon',
    palette: { base: '#b9bfcc', dark: '#5b6273', light: '#eef1f7', glow: '#cfe0ff' },
    rewards: { matter: [3, 5], fuel: 35 },
    danger: 0,
  },
  giant: {
    id: 'giant',
    name: 'Ocean Giant',
    hint: 'Huge gravity field. Powerful redirects and slingshots.',
    lore: 'A world so heavy that light bends lazily around its seas.',
    atlas: 'planet',
    radius: [92, 124],
    surfaceGravity: 360,
    soiFactor: 6.2,
    restitution: 0.28,
    friction: 0.95,
    landable: true,
    lethal: false,
    rotation: [0.03, 0.08],
    style: 'ocean',
    palette: { base: '#2f8f9d', dark: '#123a4f', light: '#9ff0e0', glow: '#6fe8ff' },
    rewards: { matter: [12, 18] },
    danger: 1,
  },
  gasGiant: {
    id: 'gasGiant',
    name: 'Gas Giant',
    hint: 'No surface. Skim the atmosphere to brake — the core is lethal.',
    lore: 'Storm bands wider than continents. The deeper layers never let go.',
    atlas: 'planet',
    radius: [86, 112],
    surfaceGravity: 320,
    soiFactor: 6.8,
    restitution: 0,
    friction: 0,
    landable: false,
    lethal: false,
    coreFactor: 0.52,
    atmosphereDrag: 0.0022,
    rotation: [0.04, 0.09],
    style: 'banded',
    palette: { base: '#d9a066', dark: '#7a3f22', light: '#fff0cf', glow: '#ffbf7a' },
    rewards: { matter: [0, 0] },
    danger: 2,
  },
  ice: {
    id: 'ice',
    name: 'Ice World',
    hint: 'Frictionless and springy. You will slide — and bounce.',
    lore: 'A mirror of frozen methane. Landing here is more of a negotiation.',
    atlas: 'planet',
    radius: [40, 56],
    surfaceGravity: 240,
    soiFactor: 5.4,
    restitution: 0.72,
    friction: 0.12,
    landable: true,
    lethal: false,
    rotation: [0.05, 0.14],
    style: 'ice',
    palette: { base: '#bfe9ff', dark: '#4a86b8', light: '#ffffff', glow: '#a8e4ff' },
    rewards: { matter: [8, 12] },
    danger: 1,
  },
  volcanic: {
    id: 'volcanic',
    name: 'Volcanic World',
    hint: 'Rich ore — but it erupts on a rhythm. Leave before the blast.',
    lore: 'Its heartbeat is a column of fire. Count the beats and you can dance with it.',
    atlas: 'planet',
    radius: [42, 58],
    surfaceGravity: 300,
    soiFactor: 5.2,
    restitution: 0.28,
    friction: 0.9,
    landable: true,
    lethal: false,
    rotation: [0.06, 0.14],
    style: 'lava',
    palette: { base: '#3b2622', dark: '#1a0f0e', light: '#ff8a3d', glow: '#ff5a1f' },
    rewards: { matter: [20, 28] },
    behavior: { kind: 'erupt', period: 7, duration: 0.9, strength: 900, reach: 2.4 },
    danger: 2,
  },
  crystal: {
    id: 'crystal',
    name: 'Crystal World',
    hint: 'Stores energy. Land to recharge abilities and gather research.',
    lore: 'Its lattice hums at a frequency your instruments almost understand.',
    atlas: 'planet',
    radius: [30, 42],
    surfaceGravity: 210,
    soiFactor: 5.4,
    restitution: 0.45,
    friction: 0.7,
    landable: true,
    lethal: false,
    rotation: [0.08, 0.2],
    style: 'crystal',
    palette: { base: '#8f6bff', dark: '#2d1f66', light: '#e6dcff', glow: '#b594ff' },
    rewards: { matter: [4, 6], energy: 60, data: 2 },
    danger: 0,
  },
  pulsar: {
    id: 'pulsar',
    name: 'Pulsar World',
    hint: 'Gravity breathes in and out. Time your approach to the pulse.',
    lore: 'Something inside it beats. Your trajectory feels every beat.',
    atlas: 'anomaly',
    radius: [40, 52],
    surfaceGravity: 290,
    soiFactor: 6.4,
    restitution: 0.4,
    friction: 0.85,
    landable: true,
    lethal: false,
    rotation: [0.1, 0.2],
    style: 'pulsar',
    palette: { base: '#e14fd0', dark: '#3b0f40', light: '#ffe3fb', glow: '#ff7ae6' },
    rewards: { matter: [12, 16], data: 3 },
    behavior: { kind: 'pulse', period: 4, amplitude: 0.75 },
    danger: 2,
  },
  star: {
    id: 'star',
    name: 'Dwarf Star',
    hint: 'Immense gravity. Touching it is fatal — passing close is a mighty slingshot.',
    lore: 'A small sun, burning patiently. It will bend you, then it will keep you.',
    atlas: 'star',
    radius: [70, 90],
    surfaceGravity: 600,
    soiFactor: 6.5,
    restitution: 0,
    friction: 0,
    landable: false,
    lethal: true,
    rotation: [0.02, 0.05],
    style: 'star',
    palette: { base: '#ffd27a', dark: '#ff7a1a', light: '#fffbe6', glow: '#ffb347' },
    rewards: { matter: [0, 0] },
    danger: 3,
  },
  gate: {
    id: 'gate',
    name: 'Warp Gate',
    hint: 'Sector exit. Land here to jump deeper.',
    lore: 'Nobody remembers building these. They still work.',
    atlas: 'structure',
    radius: [34, 34],
    surfaceGravity: 210,
    soiFactor: 5.6,
    restitution: 0.25,
    friction: 1,
    landable: true,
    lethal: false,
    rotation: [0.25, 0.25],
    style: 'gate',
    palette: { base: '#1b3b4a', dark: '#0b1a22', light: '#7df9ff', glow: '#5ff3ff' },
    rewards: { matter: [8, 8] },
    danger: 0,
  },
  derelict: {
    id: 'derelict',
    name: 'Derelict Construct',
    hint: 'Artificial. Silent. It was waiting for someone.',
    lore: 'Its hull is covered in orbital diagrams — routes through systems that do not exist yet.',
    atlas: 'structure',
    radius: [26, 26],
    surfaceGravity: 220,
    soiFactor: 5.5,
    restitution: 0.25,
    friction: 1,
    landable: true,
    lethal: false,
    rotation: [0.12, 0.12],
    style: 'derelict',
    palette: { base: '#39404d', dark: '#161a21', light: '#6bffb0', glow: '#6bffb0' },
    rewards: { matter: [25, 25], data: 15 },
    danger: 0,
  },
  asteroid: {
    id: 'asteroid',
    name: 'Asteroid',
    hint: 'No gravity worth mentioning. Hitting one hurts.',
    lore: 'Leftovers. Fast, hard, and indifferent.',
    atlas: 'hazard',
    radius: [7, 13],
    surfaceGravity: 0,
    soiFactor: 1,
    restitution: 0.6,
    friction: 0.3,
    landable: false,
    lethal: false,
    rotation: [0.4, 1.4],
    style: 'asteroid',
    palette: { base: '#7a7068', dark: '#3a332e', light: '#b5a99c', glow: '#b5a99c' },
    rewards: { matter: [0, 0] },
    danger: 1,
    damageSpeed: 70,
  },
  rogueGiant: {
    id: 'rogueGiant',
    name: 'The Rogue Giant',
    hint: 'A wandering world. Its motion is a gift: fly behind it to steal its speed.',
    lore: 'It belongs to no star. Where it passes, orbits rearrange themselves.',
    atlas: 'anomaly',
    radius: [130, 130],
    surfaceGravity: 380,
    soiFactor: 6,
    restitution: 0.28,
    friction: 0.95,
    landable: true,
    lethal: false,
    rotation: [0.05, 0.05],
    style: 'rogue',
    palette: { base: '#7a2a3a', dark: '#240910', light: '#ff9aa8', glow: '#ff5c7a' },
    rewards: { matter: [30, 30], data: 8 },
    danger: 3,
  },
  beacon: {
    id: 'beacon',
    name: 'Region Beacon',
    hint: 'The way onward. Reach it to complete the expedition.',
    lore: 'A lighthouse for travelers who navigate by falling.',
    atlas: 'structure',
    radius: [36, 36],
    surfaceGravity: 220,
    soiFactor: 5.6,
    restitution: 0.25,
    friction: 1,
    landable: true,
    lethal: false,
    rotation: [0.3, 0.3],
    style: 'beacon',
    palette: { base: '#403514', dark: '#1a1406', light: '#fff4c2', glow: '#ffe07a' },
    rewards: { matter: [40, 40], data: 10 },
    danger: 0,
  },
};

export const planetType = (id: PlanetTypeId): PlanetDefinition => PLANET_TYPES[id];
