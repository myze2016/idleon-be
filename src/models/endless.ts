import { defaultEnemies, type EnemyStats, type EnemyType } from "./enemy.js";
import { HttpError } from "../utils/http-error.js";

export interface EndlessConfig { enabled: boolean; enemyPool: EnemyType[]; statMultiplier: number }
export const defaultEndless: EndlessConfig = { enabled: true, enemyPool: ["slime", "boar", "plant"], statMultiplier: 1.1 };
export const ENDLESS_CHECKPOINT_SECONDS = 12;
export const ENDLESS_METERS_PER_SECOND = 10;
export const ENDLESS_STAT_STEP_METERS = 500;
export function endlessDistanceStats(base: EnemyStats, distance: number, multiplier: number) {
  return endlessEnemyStats(base, 1 + Math.floor(Math.max(0, distance) / ENDLESS_STAT_STEP_METERS), multiplier);
}
export function endlessSpawnInterval(roll = Math.random) {
  return 2 + roll();
}
export function validateEndless(input: unknown): EndlessConfig {
  const value = input as EndlessConfig;
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "enabled,enemyPool,statMultiplier"
    || typeof value.enabled !== "boolean" || !Array.isArray(value.enemyPool) || !value.enemyPool.length || value.enemyPool.length > Object.keys(defaultEnemies).length
    || value.enemyPool.some(id => typeof id !== "string" || !Object.hasOwn(defaultEnemies, id)) || new Set(value.enemyPool).size !== value.enemyPool.length
    || typeof value.statMultiplier !== "number" || !Number.isFinite(value.statMultiplier) || value.statMultiplier < 1.01 || value.statMultiplier > 3) {
    throw new HttpError(400, "Choose at least one known enemy and a stat multiplier from 1.01 to 3.");
  }
  return { enabled: value.enabled, enemyPool: [...value.enemyPool].sort(), statMultiplier: value.statMultiplier };
}
export function endlessEnemyStats(base: EnemyStats, wave: number, multiplier: number): EnemyStats {
  const result = structuredClone(base);
  const factor = Math.min(1_000_000, multiplier ** (wave - 1));
  // Avoid promoting exact values such as 50 × 1.1 to 56 due to floating-point noise.
  const scaled = (value: number, cap = 1_000_000) => Math.max(0, Math.ceil(Math.min(cap, value * factor) - 1e-9));
  for (const key of ["hp", "mp", "atk", "def", "magic", "magicDef", "speed"] as const) {
    result[key] = scaled(base[key], key === "speed" ? 1000 : 1_000_000);
  }
  // Scale native ability power as well, keeping costs, timing and chance mechanics intact.
  if (result.skill?.damage !== undefined) result.skill.damage = scaled(result.skill.damage);
  for (const key of ["burnAll", "slashAll", "bubbleBeam"] as const) if (result[key]) result[key]!.damage = scaled(result[key]!.damage);
  return result;
}
