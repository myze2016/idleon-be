import { enemies, type EnemyType } from "../models/enemy.js";
import type { BattleStep, Fighter } from "./battle.service.js";
import { PVP_MELEE_RANGE, simulateDuel } from "./pvp-battle.service.js";

/** Convert shared combat events to the expedition playback and reward format. */
export function simulateExpeditionBattle(team: Fighter[], opponents: { id: string; type: EnemyType }[], roll?: () => number) {
  const teamSize = team.length;
  const engagementX = 60 + (teamSize - 1) * 64 + PVP_MELEE_RANGE;
  const result = simulateDuel([
    ...team.map(fighter => ({ ...fighter, userId: "team", name: fighter.id })),
    ...opponents.map(({ id, type }) => {
      const enemy = enemies[type];
      return { id, userId: "enemy", name: enemy.name, enemyType: type, enemy: enemy.stats, stats: enemy.stats, startX: engagementX };
    }),
  ], roll, undefined, { expedition: true });

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
      enemyIndex, enemyHp: enemyHps[0], enemyHps, teamHp: step.hp.slice(0, teamSize), teamMp: step.mp.slice(0, teamSize),
      teamCasting: step.teamCasting, castEndsAt: step.kind === "cast" && member !== undefined ? step.teamCasting?.[member]?.endsAt : undefined,
      targetIds: step.targets.filter(target => target < teamSize).map(target => team[target].id),
    }];
  });
  const final = result.steps.at(-1);
  const summoned = result.fighters.slice(teamSize + opponents.length).map((fighter, offset) => ({
    type: fighter.enemyType!, index: opponents.length + offset, at: fighter.spawnAt ?? 0,
  }));
  return {
    won: result.winnerId === "team", steps, summoned,
    enemyHps: final?.hp.slice(teamSize) ?? result.fighters.slice(teamSize).map(fighter => fighter.stats.hp),
    teamHp: final?.hp.slice(0, teamSize) ?? team.map(fighter => fighter.hp ?? fighter.stats.hp),
    teamMp: final?.mp.slice(0, teamSize) ?? team.map(fighter => fighter.mp ?? fighter.stats.mp),
  };
}
