import { currentBalance } from "./balance-context.js";
import { characterUpgrades } from "./character-upgrade.js";
import type { WeaponType } from "./character.js";
import { HttpError } from "../utils/http-error.js";

export const shopStats = ["hp", "mp", "atk", "def", "magic", "magicDef", "speed"] as const;
export interface UpgradeStep { cost: number; gain: number }
export interface EconomySettings {
  shopPrices: Record<string, number>;
  levelExp: number[];
  artifactEnhancements: UpgradeStep[];
  characterUpgrades: Record<string, UpgradeStep[]>;
  skillUnlockCost: number;
}
export const defaultEconomy: EconomySettings = {
  shopPrices: Object.fromEntries(shopStats.map(stat => [stat, 500])),
  levelExp: Array.from({ length: 28 }, (_, index) => 10 * 2 ** index),
  artifactEnhancements: Array.from({ length: 20 }, () => ({ cost: 1000, gain: 2 })),
  characterUpgrades: Object.fromEntries(Object.entries(characterUpgrades).map(([weapon, upgrade]) => [weapon, Array.from({ length: 20 }, () => ({ cost: 1000, gain: upgrade.amount }))])),
  skillUnlockCost: 1000,
};
const legacyCache = new WeakMap<object, EconomySettings>();
/** Translate previously saved multiplier settings into editable direct rows. */
export function normalizeEconomy(input?: unknown): EconomySettings {
  if (!input || typeof input !== "object") return defaultEconomy;
  if ("levelExp" in input) return input as EconomySettings;
  const cached = legacyCache.get(input); if (cached) return cached;
  const old = input as { shopPrices?: Record<string, number>; expGrowth?: number; artifactEnhanceMultiplier?: number; characterUpgradeMultiplier?: number; skillUnlockCost?: number };
  const result = structuredClone(defaultEconomy);
  result.shopPrices = { ...result.shopPrices, ...old.shopPrices };
  result.skillUnlockCost = old.skillUnlockCost ?? 1000;
  result.levelExp = [];
  let required = 10, total = 0;
  while (total <= 2147483647 && result.levelExp.length < 1000) {
    result.levelExp.push(Math.min(2147483647, required)); total += required;
    required = Math.ceil(required * (old.expGrowth ?? 2));
  }
  const cost = (multiplier: number, level: number) => Math.min(1_000_000_000, Math.ceil(1000 * multiplier ** level));
  if ((old.artifactEnhanceMultiplier ?? 1) !== 1) result.artifactEnhancements = Array.from({ length: 1000 }, (_, i) => ({ cost: cost(old.artifactEnhanceMultiplier!, i), gain: 2 }));
  if ((old.characterUpgradeMultiplier ?? 1) !== 1) for (const [weapon, upgrade] of Object.entries(characterUpgrades)) result.characterUpgrades[weapon] = Array.from({ length: 1000 }, (_, i) => ({ cost: cost(old.characterUpgradeMultiplier!, i), gain: upgrade.amount }));
  legacyCache.set(input, result); return result;
}
export function economySettings(): EconomySettings { return normalizeEconomy(currentBalance()?.economy); }
export function upgradeStep(steps: UpgradeStep[], level: number): UpgradeStep { return steps[Math.min(level, steps.length - 1)]; }
export function upgradeBonus(steps: UpgradeStep[], level: number) {
  const count = Math.min(level, steps.length);
  return steps.slice(0, count).reduce((sum, step) => sum + step.gain, 0) + Math.max(0, level - steps.length) * steps[steps.length - 1].gain;
}
export const artifactPrice = (stat: string) => economySettings().shopPrices[stat];
export const artifactEnhanceCost = (level: number) => upgradeStep(economySettings().artifactEnhancements, level).cost;
export const artifactEnhanceGain = (level: number) => upgradeStep(economySettings().artifactEnhancements, level).gain;
export const artifactEnhanceBonus = (level: number) => upgradeBonus(economySettings().artifactEnhancements, level);
export const characterUpgradeCost = (level: number, weapon: WeaponType = "sword-and-shield") => upgradeStep(economySettings().characterUpgrades[weapon], level).cost;
export const characterUpgradeGain = (weapon: WeaponType, level: number) => upgradeStep(economySettings().characterUpgrades[weapon], level).gain;
export const characterUpgradeBonus = (weapon: WeaponType, level: number) => upgradeBonus(economySettings().characterUpgrades[weapon], level);
export const skillUnlockCost = () => economySettings().skillUnlockCost;
export function validateEconomy(input: unknown): EconomySettings {
  const value = input as EconomySettings;
  const integer = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
  const steps = (rows: unknown): rows is UpgradeStep[] => Array.isArray(rows) && rows.length >= 1 && rows.length <= 1000 && rows.every(row => row && typeof row === "object" && Object.keys(row).sort().join() === "cost,gain" && integer(row.cost, 0, 1_000_000_000) && integer(row.gain, 0, 10000));
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== Object.keys(defaultEconomy).sort().join()
    || !value.shopPrices || Object.keys(value.shopPrices).sort().join() !== [...shopStats].sort().join() || !shopStats.every(stat => integer(value.shopPrices[stat], 0, 1_000_000))
    || !Array.isArray(value.levelExp) || value.levelExp.length < 1 || value.levelExp.length > 1000 || !value.levelExp.every(exp => integer(exp, 1, 2147483647))
    || !steps(value.artifactEnhancements) || !value.characterUpgrades || Object.keys(value.characterUpgrades).sort().join() !== Object.keys(characterUpgrades).sort().join()
    || !Object.values(value.characterUpgrades).every(steps) || !integer(value.skillUnlockCost, 0, 1_000_000)) {
    throw new HttpError(400, "Provide 1-1000 rows per table. EXP must be whole amounts from 1 to 2,147,483,647; upgrade costs 0-1 billion gold; stat gains 0-10,000; shop and skill prices 0-1,000,000.");
  }
  return structuredClone(value);
}
