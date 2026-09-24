/** Abilities manipulate physics — they are tools for steering momentum, not spells. */

export type AbilityId = 'brake' | 'hook' | 'orbitLock' | 'burst';

export interface AbilityDefinition {
  id: AbilityId;
  name: string;
  short: string;
  description: string;
  energy: number;
  cooldown: number;
  glyph: string;
  color: string;
}

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  brake: {
    id: 'brake',
    name: 'Gravity Brake',
    short: 'Brake',
    description: 'Bleed off 55% of your speed relative to the nearest gravity well. Save a landing, tighten an orbit.',
    energy: 30,
    cooldown: 1.2,
    glyph: '⏸',
    color: '#7fd1ff',
  },
  hook: {
    id: 'hook',
    name: 'Gravity Hook',
    short: 'Hook',
    description: 'For 1.2s, pull hard toward the nearest world ahead of you. Turns near misses into captures.',
    energy: 40,
    cooldown: 3,
    glyph: '⚓',
    color: '#9dff9d',
  },
  orbitLock: {
    id: 'orbitLock',
    name: 'Orbit Lock',
    short: 'Lock',
    description: 'Snap into a perfect circular orbit around the dominant body. Tap again to release on the tangent you choose.',
    energy: 45,
    cooldown: 2,
    glyph: '◎',
    color: '#ffd36b',
  },
  burst: {
    id: 'burst',
    name: 'Momentum Burst',
    short: 'Burst',
    description: 'Convert stored energy into +40% forward velocity instantly. Best fired at the bottom of a slingshot.',
    energy: 45,
    cooldown: 3,
    glyph: '»',
    color: '#ff8ad8',
  },
};
