import { createHmac, randomBytes } from "node:crypto";
import { currentBalance, withBalance, type BalanceConfig } from "../models/balance-context.js";
import { skills } from "../models/skills.js";
import { defaultBalance } from "./balance.service.js";
import { COMBAT_ENCOUNTER_DISTANCE, COMBAT_VISIBLE_DISTANCE, PVP_RANGED_RANGE, simulateDuel, type DuelFighter, type DuelResult, type EndlessSpawnSchedule } from "./pvp-battle.service.js";

export interface Skill2Change { fighterId: string; at: number; enabled: boolean }
export const LIVE_COMBAT_RULES_VERSION = 15;
export interface LiveCombat { seed: string; balance: BalanceConfig; fighters: DuelFighter[]; changes: Skill2Change[]; endlessSpawns?: EndlessSpawnSchedule; rulesVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | typeof LIVE_COMBAT_RULES_VERSION }

export function liveCombatDistances(rulesVersion: LiveCombat["rulesVersion"]) {
  return (rulesVersion ?? 0) >= 5
    ? { rangedRange: PVP_RANGED_RANGE, encounterDistance: COMBAT_ENCOUNTER_DISTANCE, visibleDistance: COMBAT_VISIBLE_DISTANCE }
    : { rangedRange: rulesVersion === 4 ? 780 : 600, encounterDistance: rulesVersion === 4 ? 900 : 600, visibleDistance: Infinity };
}
export interface LivePvpResult extends DuelResult {
  live?: LiveCombat;
}

export function latestSkill2Change(changes: readonly Skill2Change[], fighterId: string, at = Infinity) {
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    if (change.fighterId === fighterId && change.at <= at) return change;
  }
}

function activeSkill2(fighter: DuelFighter) {
  const weapon = fighter.weapon;
  if (!fighter.skill2Unlocked || !weapon) return;
  const skill = skills[weapon]?.[1];
  if (skill && !skill.passive) return skill;
}

export function hasActiveSkill2(fighter: DuelFighter, balance: BalanceConfig) {
  return withBalance(balance, () => !!activeSkill2(fighter));
}

export function liveSkill2Controls(userId: string, live: LiveCombat) {
  return withBalance(live.balance, () => live.fighters.flatMap(fighter => {
    if (fighter.userId !== userId) return [];
    const skill = activeSkill2(fighter);
    if (!skill) return [];
    const enabled = latestSkill2Change(live.changes, fighter.id)?.enabled ?? fighter.skill2Enabled !== false;
    return [{ id: fighter.id, name: fighter.name, skillId: skill.id, skillName: skill.name, enabled }];
  }));
}

export function replayCombat(live: LiveCombat, continuousSeconds?: number, expedition = false): DuelResult {
  let draw = 0;
  const roll = () => createHmac("sha256", live.seed).update(String(draw++)).digest().readUInt32BE() / 2 ** 32;
  const byFighter = new Map<string, Skill2Change[]>();
  for (const change of live.changes) {
    const history = byFighter.get(change.fighterId) ?? [];
    history.push(change);
    byFighter.set(change.fighterId, history);
  }
  return withBalance(live.balance, () => simulateDuel(live.fighters, roll, continuousSeconds, {
    expedition, legacyRules: live.rulesVersion === undefined, sharedEncounterDistance: (live.rulesVersion ?? 0) >= 3,
    walkToRange: (live.rulesVersion ?? 0) >= 6, individualEngagement: (live.rulesVersion ?? 0) >= 7,
    pacedApproach: (live.rulesVersion ?? 0) >= 8,
    holdRangedPosition: (live.rulesVersion ?? 0) >= 9,
    marchingFormation: (live.rulesVersion ?? 0) >= 10,
    rangedCasterFormation: (live.rulesVersion ?? 0) >= 11,
    mobileSpearThrow: live.rulesVersion === 12,
    pauseFormationDuringCast: live.rulesVersion === 13,
    spearCastCamera: live.rulesVersion === 14,
    unifiedMovement: (live.rulesVersion ?? 0) >= 15,
    endlessSpawns: live.endlessSpawns,
    ...liveCombatDistances(live.rulesVersion),
    skill2EnabledAt: (fighter, at) => latestSkill2Change(byFighter.get(fighter.id) ?? [], fighter.id, at)?.enabled,
  }));
}

export function replayPvpBattle(live: LiveCombat): LivePvpResult {
  return { ...replayCombat(live), live };
}

export function startLivePvpBattle(fighters: DuelFighter[]) {
  return replayPvpBattle({ fighters, seed: randomBytes(24).toString("hex"), balance: currentBalance() ?? defaultBalance(), changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION });
}
