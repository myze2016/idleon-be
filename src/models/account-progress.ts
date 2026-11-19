import { economySettings } from "./economy.js";
export const WISHES_PER_LEVEL = 100;

export function accountProgress(experience: number) {
  const rows = economySettings().levelExp;
  let level = 1, remaining = experience;
  for (const required of rows) {
    if (remaining < required) return { level, totalExp: experience, exp: remaining, expToNextLevel: required };
    remaining -= required; level++;
  }
  const required = rows[rows.length - 1];
  const extra = Math.floor(remaining / required);
  return { level: level + extra, totalExp: experience, exp: remaining % required, expToNextLevel: required };
}
export function experienceForLevel(level: number) {
  const rows = economySettings().levelExp, count = Math.min(level - 1, rows.length);
  return rows.slice(0, count).reduce((sum, exp) => sum + exp, 0) + Math.max(0, level - 1 - rows.length) * rows[rows.length - 1];
}
export function levelUpReward(beforeExp: number, afterExp: number) {
  const levelsGained = Math.max(0, accountProgress(afterExp).level - accountProgress(beforeExp).level);
  return { levelsGained, wishEarned: levelsGained * WISHES_PER_LEVEL };
}
