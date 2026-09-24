/** Mastery challenges celebrate interesting behavior and teach advanced technique. */

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  teaches: string;
  reward: { matter: number; data: number };
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: 'firstSlingshot',
    name: 'Falling With Style',
    description: 'Complete your first gravity assist.',
    teaches: 'Worlds you pass are tools, not obstacles.',
    reward: { matter: 10, data: 2 },
  },
  {
    id: 'perfectSlingshot',
    name: 'Perfect Slingshot',
    description: 'Land after a gravity assist using no fuel and no abilities.',
    teaches: 'The right launch needs no corrections.',
    reward: { matter: 20, data: 4 },
  },
  {
    id: 'tripleAssist',
    name: 'Triple Assist',
    description: 'Use three different worlds in a single flight.',
    teaches: 'Chain wells to reach what direct flight never could.',
    reward: { matter: 40, data: 8 },
  },
  {
    id: 'gravityPilot',
    name: 'Gravity Pilot',
    description: 'Clear a whole sector without burning any fuel.',
    teaches: 'Fuel is for emergencies. Gravity is for travel.',
    reward: { matter: 35, data: 6 },
  },
  {
    id: 'deepOrbit',
    name: 'Deep Orbit',
    description: 'Complete three orbits in a single flight.',
    teaches: 'An orbit is a waiting room — leave when the door lines up.',
    reward: { matter: 25, data: 5 },
  },
  {
    id: 'sunDiver',
    name: 'Sun Diver',
    description: 'Pass within half a radius of a star’s surface and survive.',
    teaches: 'The closer the pass, the harder the bend.',
    reward: { matter: 30, data: 6 },
  },
  {
    id: 'momentumMaster',
    name: 'Momentum Master',
    description: 'Reach 750 u/s.',
    teaches: 'Stack slingshots and bursts to go truly fast.',
    reward: { matter: 25, data: 4 },
  },
  {
    id: 'featherTouch',
    name: 'Feather Touch',
    description: 'Touch down under 25 u/s without bouncing.',
    teaches: 'Arrive along the surface, not into it.',
    reward: { matter: 15, data: 3 },
  },
  {
    id: 'ricochet',
    name: 'Ricochet',
    description: 'Bounce off one world and land on another in the same flight.',
    teaches: 'Bounces are trajectories too.',
    reward: { matter: 20, data: 3 },
  },
  {
    id: 'skimmer',
    name: 'Skimmer',
    description: 'Aerobrake through a gas giant and land in the same flight.',
    teaches: 'Atmosphere is free braking.',
    reward: { matter: 25, data: 5 },
  },
  {
    id: 'eruptionRider',
    name: 'Eruption Rider',
    description: 'Get thrown by an eruption and land elsewhere without recalling.',
    teaches: 'Even disasters have vectors.',
    reward: { matter: 20, data: 4 },
  },
  {
    id: 'untouched',
    name: 'Untouched',
    description: 'Finish an expedition without losing any hull.',
    teaches: 'Mastery is the absence of accidents.',
    reward: { matter: 60, data: 10 },
  },
  {
    id: 'giantTamer',
    name: 'Giant Tamer',
    description: 'Reach the Beacon past the Rogue Giant.',
    teaches: 'A moving world is a free engine.',
    reward: { matter: 50, data: 10 },
  },
];

export const achievementById = (id: string): AchievementDefinition | undefined => ACHIEVEMENTS.find((a) => a.id === id);
