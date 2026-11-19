import { defaultBaseStats } from "../models/character-stats.js";
import { defaultSkills, type SkillDefinition } from "../models/skills.js";
import { type BalanceConfig } from "../models/balance-context.js";
import { HttpError } from "../utils/http-error.js";
import { defaultEnemies, type EnemyStats } from "../models/enemy.js";
import { defaultEconomy, validateEconomy, normalizeEconomy } from "../models/economy.js";

export function defaultBalance(): BalanceConfig {
  return structuredClone({ economy: defaultEconomy, stats: defaultBaseStats, skills: Object.fromEntries(Object.values(defaultSkills).flat().map(s => [s.id, s])), enemies: Object.fromEntries(Object.entries(defaultEnemies).map(([id, enemy]) => [id, enemy.stats])), rewards: Object.fromEntries(Object.entries(defaultEnemies).map(([id, enemy]) => [id, { gold: enemy.gold, experience: 1 }])) });
}
export function normalizeBalance(config: BalanceConfig): BalanceConfig { const defaults = defaultBalance(); return { ...config, economy: normalizeEconomy(config.economy), enemies: { ...defaults.enemies, ...config.enemies }, rewards: { ...defaults.rewards, ...config.rewards } }; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function number(value: unknown, min: number, max: number, integer = false) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}
/** Accept only known fields and ranges; preserve mechanics, names and damage scaling. */
export function validateBalance(input: unknown): BalanceConfig {
  const defaults = defaultBalance();
  if (!record(input) || Object.keys(input).some(k => !["stats", "skills", "enemies", "rewards", "economy"].includes(k)) || !record(input.stats) || !record(input.skills)) throw new HttpError(400, "Invalid balance configuration");
  defaults.economy = validateEconomy(normalizeEconomy(input.economy));
  if (!record(input.rewards) || Object.keys(input.rewards).sort().join() !== Object.keys(defaults.rewards).sort().join()) throw new HttpError(400, "Include every enemy's rewards. Reload the balance editor if needed.");
  for (const id of Object.keys(defaults.rewards)) {
    const reward = input.rewards[id];
    if (!record(reward) || Object.keys(reward).sort().join() !== "experience,gold" || !number(reward.gold, 0, 1000000, true) || !number(reward.experience, 0, 1000000, true)) throw new HttpError(400, `Invalid ${id} rewards. Use whole amounts from 0 to 1,000,000.`);
    defaults.rewards[id] = { gold: reward.gold as number, experience: reward.experience as number };
  }
  if (input.enemies === undefined) throw new HttpError(400, "Include every enemy in the balance configuration");
  {
    if (!record(input.enemies) || Object.keys(input.enemies).sort().join() !== Object.keys(defaults.enemies).sort().join()) throw new HttpError(400, "Include every enemy");
    function validateEnemy(candidate: unknown, original: Record<string, unknown>, path: string) {
      if (!record(candidate) || Object.keys(candidate).sort().join() !== Object.keys(original).sort().join()) throw new HttpError(400, `Invalid ${path} fields`);
      for (const [key, value] of Object.entries(original)) {
        const next = candidate[key];
        if (record(value)) validateEnemy(next, value, `${path} ${key}`);
        else if (typeof value === "number") {
          const min = key === "hp" ? 1 : key === "cooldown" ? .1 : 0;
          const max = key === "blockChance" ? 1 : key === "speed" ? 1000 : ["duration", "cooldown"].includes(key) ? 300 : 100000;
          if (!number(next, min, max, !["blockChance", "duration", "cooldown"].includes(key))) throw new HttpError(400, `Invalid ${path} ${key}`);
        } else if (next !== value) throw new HttpError(400, `Cannot change ${path} ${key}`);
      }
    }
    for (const [id, stats] of Object.entries(defaults.enemies)) { validateEnemy(input.enemies[id], stats as unknown as Record<string, unknown>, id); defaults.enemies[id] = structuredClone(input.enemies[id]) as EnemyStats; }
  }
  if (Object.keys(input.stats).sort().join() !== Object.keys(defaults.stats).sort().join() || Object.keys(input.skills).sort().join() !== Object.keys(defaults.skills).sort().join()) throw new HttpError(400, "Include every character and skill");
  for (const [weapon, stats] of Object.entries(defaults.stats)) {
    const candidate = input.stats[weapon];
    if (!record(candidate) || Object.keys(candidate).sort().join() !== Object.keys(stats).sort().join()) throw new HttpError(400, "Invalid character stats");
    for (const key of Object.keys(stats)) {
      const value = candidate[key];
      if (key === "range") { if (value !== stats.range) throw new HttpError(400, "Attack range mechanics cannot be changed"); }
      else if (!number(value, key === "hp" ? 1 : 0, key === "speed" ? 1000 : 100000, true)) throw new HttpError(400, `Invalid ${weapon} ${key}`);
    }
    defaults.stats[weapon] = { ...candidate } as unknown as typeof stats;
  }
  for (const [id, skill] of Object.entries(defaults.skills)) {
    const candidate = input.skills[id];
    if (!record(candidate) || Object.keys(candidate).sort().join() !== Object.keys(skill).sort().join()) throw new HttpError(400, `Invalid ${id} fields`);
    for (const [key, original] of Object.entries(skill)) {
      const value = candidate[key];
      if (key === "damage") {
        if (!record(value) || Object.keys(value).sort().join() !== "base,stat" || value.stat !== skill.damage!.stat || !number(value.base, 0, 100000, true)) throw new HttpError(400, `Invalid ${id} damage`);
      } else if (typeof original === "number") {
        const fixed = skill.passive && ["mpCost", "hpCost", "baseCastTime", "cooldown"].includes(key);
        const min = ["baseCastTime", "cooldown"].includes(key) && !skill.passive ? .1 : 0;
        const max = fixed ? 0 : key === "chance" ? 1 : key === "bounces" ? 10 : key === "multiplier" ? 10 : ["duration", "cooldown", "baseCastTime"].includes(key) ? 300 : 100000;
        if (!number(value, min, max, ["mpCost", "hpCost", "power", "bounces"].includes(key))) throw new HttpError(400, `Invalid ${id} ${key}`);
      } else if (value !== original) throw new HttpError(400, `Cannot change ${id} ${key}`);
    }
    defaults.skills[id] = structuredClone(candidate) as unknown as SkillDefinition;
  }
  return defaults;
}
