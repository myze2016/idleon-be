import { AsyncLocalStorage } from "node:async_hooks";
import type { CharacterStats } from "./character-stats.js";
import type { SkillDefinition } from "./skills.js";
import type { EnemyStats } from "./enemy.js";
export interface BalanceConfig {
  stats: Record<string, CharacterStats>;
  skills: Record<string, SkillDefinition>;
  enemies: Record<string, EnemyStats>;
  rewards: Record<string, { gold: number; experience: number }>;
}
const context = new AsyncLocalStorage<BalanceConfig>();
export const currentBalance = () => context.getStore();
export function withBalance<T>(config: BalanceConfig, work: () => T): T { return context.run(config, work); }
