import { DEFAULT_SIM_PARAMS, type SimParams } from '../physics/sim';
import type { AbilityId } from '../data/abilities';

/**
 * Everything that tech, modules and cores can change about the probe. Most fields are
 * capabilities (booleans, new behaviors) rather than percentages.
 */
export interface PlayerStats {
  sim: SimParams;
  minLaunch: number;
  maxLaunch: number;
  /** Seconds of trajectory prediction. */
  prediction: number;
  /** Show predicted impact point with landing quality. */
  predictImpact: boolean;
  /** Show future positions of moving bodies at the prediction's end. */
  predictGhosts: boolean;
  /** Radius within which planet rewards/hazards are identified. */
  scanRadius: number;
  /** Unknown (?) bodies reveal what they are once scanned. */
  deepScan: boolean;
  /** Multiplier on the range at which hidden structures appear. */
  hiddenSense: number;
  fuelMax: number;
  thrust: number;
  fuelBurn: number;
  energyMax: number;
  energyStart: number;
  energyPerLanding: number;
  hullMax: number;
  abilitySlots: number;
  unlockedAbilities: AbilityId[];
  matterMult: number;
  dataMult: number;
  moduleChoices: number;
  // Behavior hooks (0 / false = off).
  slingshotBoost: number;
  slingshotEnergy: number;
  orbitEnergy: number;
  bounceMatter: number;
  asteroidShield: number;
  freeRecalls: number;
  harvestFuel: number;
  momentumAnchor: number;
  aeroMatter: number;
  riskMatter: number;
  wellDiscount: number;
}

export function baseStats(): PlayerStats {
  return {
    sim: { ...DEFAULT_SIM_PARAMS },
    minLaunch: 60,
    maxLaunch: 430,
    prediction: 1.4,
    predictImpact: false,
    predictGhosts: false,
    scanRadius: 520,
    deepScan: false,
    hiddenSense: 1,
    fuelMax: 100,
    thrust: 240,
    fuelBurn: 32,
    energyMax: 100,
    energyStart: 60,
    energyPerLanding: 12,
    hullMax: 3,
    abilitySlots: 1,
    unlockedAbilities: ['brake'],
    matterMult: 1,
    dataMult: 1,
    moduleChoices: 3,
    slingshotBoost: 0,
    slingshotEnergy: 0,
    orbitEnergy: 0,
    bounceMatter: 0,
    asteroidShield: 0,
    freeRecalls: 0,
    harvestFuel: 0,
    momentumAnchor: 0,
    aeroMatter: 0,
    riskMatter: 0,
    wellDiscount: 0,
  };
}

export function cloneStats(s: PlayerStats): PlayerStats {
  return { ...s, sim: { ...s.sim }, unlockedAbilities: [...s.unlockedAbilities] };
}
