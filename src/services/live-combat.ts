import { createHmac, randomBytes } from "node:crypto";
import { currentBalance, withBalance, type BalanceConfig } from "../models/balance-context.js";
import { skills } from "../models/skills.js";
import { defaultBalance } from "./balance.service.js";
import { simulateDuel, type DuelFighter, type DuelResult } from "./pvp-battle.service.js";

export interface Skill2Change { fighterId: string; at: number; enabled: boolean }
export interface LiveCombat { seed: string; balance: BalanceConfig; fighters: DuelFighter[]; changes: Skill2Change[] }
export interface LivePvpResult extends DuelResult {
  live?: LiveCombat;
}

export function latestSkill2Change(changes: readonly Skill2Change[], fighterId: string, at = Infinity) {
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    if (change.fighterId === fighterId && change.at <= at) return change;
  }
}

export function hasActiveSkill2(fighter: DuelFighter, balance: BalanceConfig) {
  const weapon = fighter.weapon;
  return !!fighter.skill2Unlocked && !!weapon && withBalance(balance, () => skills[weapon]?.[1]?.passive === false);
}

export function replayCombat(live: LiveCombat, continuousSeconds?: number): DuelResult {
  let draw = 0;
  const roll = () => createHmac("sha256", live.seed).update(String(draw++)).digest().readUInt32BE() / 2 ** 32;
  const byFighter = new Map<string, Skill2Change[]>();
  for (const change of live.changes) {
    const history = byFighter.get(change.fighterId) ?? [];
    history.push(change);
    byFighter.set(change.fighterId, history);
  }
  return withBalance(live.balance, () => simulateDuel(live.fighters, roll, continuousSeconds, {
    skill2EnabledAt: (fighter, at) => latestSkill2Change(byFighter.get(fighter.id) ?? [], fighter.id, at)?.enabled,
  }));
}

export function replayPvpBattle(live: LiveCombat): LivePvpResult {
  return { ...replayCombat(live), live };
}

export function startLivePvpBattle(fighters: DuelFighter[]) {
  return replayPvpBattle({ fighters, seed: randomBytes(24).toString("hex"), balance: currentBalance() ?? defaultBalance(), changes: [] });
}
