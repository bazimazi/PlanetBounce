import { PLANET_TYPES, type PlanetTypeId } from '../data/planetTypes';
import type { BodyInit } from '../physics/body';
import { World } from './world';

/**
 * Hand-built onboarding. No menus, no text walls: each step isolates one idea and lets the
 * player discover it by doing.
 */

export interface TutorialStep {
  name: string;
  prompt: string;
  /** Shown after the first failure on this step. */
  failPrompt: string;
  successText: string;
  /** Show the solver's demonstration path after this many failures. */
  demoAfter: number;
  prediction: number;
  build(): World;
}

function body(type: PlanetTypeId, x: number, y: number, radius: number, extra: Partial<BodyInit> = {}): BodyInit {
  const t = PLANET_TYPES[type];
  return { type: t, x, y, radius, rotSpeed: 0.06, rot0: 0, matter: Math.round(t.rewards.matter[0]), ...extra };
}

function world(name: string, index: number, inits: BodyInit[], goal: number, prompt: string): World {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of inits) {
    minX = Math.min(minX, b.x - b.radius);
    maxX = Math.max(maxX, b.x + b.radius);
    minY = Math.min(minY, b.y - b.radius);
    maxY = Math.max(maxY, b.y + b.radius);
  }
  const w = new World(
    { kind: 'tutorial', name, subtitle: 'First Light', regionId: 'tutorial', index, seed: 1000 + index, prompt },
    { minX: minX - 380, maxX: maxX + 380, minY: minY - 380, maxY: maxY + 380 },
  );
  for (const i of inits) w.add(i);
  w.startBody = 0;
  w.goalBody = goal;
  return w;
}

export const TUTORIAL: TutorialStep[] = [
  {
    name: 'First Light',
    prompt: 'Drag back anywhere, then release',
    failPrompt: 'Pull back further for more power',
    successText: 'Touchdown',
    demoAfter: 3,
    prediction: 1.6,
    build: () =>
      world('First Light', 0, [body('rocky', 0, 0, 52, { tags: ['start'] }), body('rocky', 70, -360, 50, { tags: ['gate'] })], 1, 'Drag back anywhere, then release'),
  },
  {
    name: 'The Pull',
    prompt: 'Worlds pull on you. Watch the path bend',
    failPrompt: 'Aim wide of the giant — its pull curves you in',
    successText: 'Gravity bent your path',
    demoAfter: 2,
    prediction: 1.6,
    build: () =>
      world(
        'The Pull',
        1,
        [body('rocky', 0, 0, 52, { tags: ['start'] }), body('giant', 330, -260, 70), body('crystal', 420, -620, 38, { tags: ['gate'] })],
        2,
        'Worlds pull on you. Watch the path bend',
      ),
  },
  {
    name: 'Slingshot',
    prompt: 'Reach the world hidden behind the giant',
    failPrompt: 'Aim beside the giant. Let it swing you around',
    successText: 'You just used gravity as propulsion',
    demoAfter: 1,
    prediction: 1.4,
    build: () =>
      world(
        'Slingshot',
        2,
        [body('rocky', 0, 0, 52, { tags: ['start'] }), body('giant', 0, -430, 104, { rotSpeed: 0.03 }), body('ice', 20, -880, 44, { tags: ['gate'] })],
        2,
        'Reach the world hidden behind the giant',
      ),
  },
];
