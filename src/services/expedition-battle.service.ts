import { enemies, type EnemyType } from "../models/enemy.js";
import type { BattleStep, Fighter } from "./battle.service.js";
import { PVP_MELEE_RANGE, simulateDuel, type DuelFighter, type DuelResult } from "./pvp-battle.service.js";
import { replayCombat, type LiveCombat } from "./live-combat.js";

export function expeditionFighters(team: (Fighter & { name?: string })[], opponents: { id: string; type: EnemyType }[], approachDistance = PVP_MELEE_RANGE): DuelFighter[] {
  const firstLiving = Math.max(0, team.findIndex(fighter => (fighter.hp ?? fighter.stats.hp) > 0));
  const engagementX = 60 + (team.length - 1 - firstLiving) * 64 + approachDistance;
  return [
    ...team.map(fighter => ({ ...fighter, userId: "team", name: fighter.name ?? fighter.id })),
    ...opponents.map(({ id, type }, index) => {
      const enemy = enemies[type];
      const startX = engagementX + (approachDistance > PVP_MELEE_RANGE ? index * 72 : 0);
      return { id, userId: "enemy", name: enemy.name, enemyType: type, enemy: enemy.stats, stats: enemy.stats, startX };
    }),
  ];
}

function expeditionMovement(result: DuelResult, initialCount: number) {
  const initial = result.steps[0];
  const frames: { at: number; x: number[]; travel?: number; cameraWorld?: number }[] = [
    { at: 0, x: result.fighters.slice(0, initialCount).map(fighter => fighter.startX ?? 0),
      ...(initial?.cameraWorld && initial.cameraTravel ? { travel: 0, cameraWorld: initial.cameraWorld[0] - initial.cameraTravel[0] } : {}) },
  ];
  let casting = false;
  for (const step of result.steps) {
    const nowCasting = step.teamCasting?.some(Boolean) ?? false;
    if (step.kind === "move" || nowCasting !== casting || step.x.length !== frames[frames.length - 1].x.length) {
      frames.push({ at: step.at, x: step.x, travel: step.cameraTravel?.[0], cameraWorld: step.cameraWorld?.[0] });
    }
    casting = nowCasting;
  }
  return frames;
}

export function simulateExpeditionBattle(team: Fighter[], opponents: { id: string; type: EnemyType }[], roll?: () => number, approachDistance?: number) {
  const fighters = expeditionFighters(team, opponents, approachDistance);
  const result = simulateDuel(fighters, roll, undefined, { expedition: true });
  return { ...expeditionResult(result, team, opponents.length), movement: expeditionMovement(result, fighters.length) };
}

export function replayExpedition(live: LiveCombat) {
  const team = live.fighters.filter(fighter => fighter.userId === "team");
  const result = replayCombat(live, undefined, true);
  return { ...expeditionResult(result, team, live.fighters.length - team.length), movement: expeditionMovement(result, live.fighters.length) };
}

/** Convert shared combat events to the expedition playback and reward format. */
function expeditionResult(result: DuelResult, team: Fighter[], opponentCount: number) {
  const teamSize = team.length;
  const steps: BattleStep[] = result.steps.flatMap(step => {
    if (step.kind === "move" || step.kind === "spawn") return [];
    const friendly = step.actor < teamSize;
    const enemyIndex = friendly
      ? (step.targets.find(target => target >= teamSize) ?? teamSize) - teamSize
      : step.actor - teamSize;
    const member = friendly ? step.actor : step.targets.find(target => target < teamSize);
    const enemyHps = step.hp.slice(teamSize);
    return [{
      at: step.at, actor: friendly ? "team" : "enemy", characterId: member === undefined ? "" : team[member].id,
      kind: step.kind, label: step.label, damage: step.damage, healing: step.healing, critical: step.critical,
      enemyIndex, enemyHp: enemyHps[0], enemyHps, enemyMps: step.mp.slice(teamSize), teamHp: step.hp.slice(0, teamSize), teamMp: step.mp.slice(0, teamSize),
      teamCasting: step.teamCasting, castEndsAt: step.kind === "cast" && member !== undefined ? step.teamCasting?.[member]?.endsAt : undefined,
      ...(step.statuses ? { statuses: step.statuses } : {}),
      targetIds: step.targets.filter(target => target < teamSize).map(target => team[target].id),
    }];
  });
  const final = result.steps.at(-1);
  const summoned = result.fighters.slice(teamSize + opponentCount).map((fighter, offset) => ({
    type: fighter.enemyType!, index: opponentCount + offset, at: fighter.spawnAt ?? 0,
  }));
  return {
    won: result.winnerId === "team", steps, summoned, duration: steps.at(-1)?.at ?? 0,
    enemyHps: final?.hp.slice(teamSize) ?? result.fighters.slice(teamSize).map(fighter => fighter.stats.hp),
    teamHp: final?.hp.slice(0, teamSize) ?? team.map(fighter => fighter.hp ?? fighter.stats.hp),
    teamMp: final?.mp.slice(0, teamSize) ?? team.map(fighter => fighter.mp ?? fighter.stats.mp),
  };
}
