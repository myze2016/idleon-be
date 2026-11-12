import type { CharacterStats } from "../models/character-stats.js";
import { actionDuration } from "../models/action-timing.js";
import type { WeaponType } from "../models/character.js";
import { simulateSkillBattle } from "./skill-battle.service.js";

export interface Fighter { id: string; stats: CharacterStats; weapon?: WeaponType; skill2Unlocked?: boolean; hp?: number; mp?: number }
export interface BattleStep {
  at: number;
  actor: "team" | "enemy"; characterId: string; damage: number; enemyHp: number; teamHp: number[];
  kind?: "attack" | "cast" | "skill" | "heal" | "buff" | "poison" | "block" | "counter" | "double" | "mana" | "bleed";
  label?: string; teamMp?: number[]; healing?: number; castEndsAt?: number; targetIds?: string[]; critical?: boolean;
  teamCasting?: ({ name: string; startedAt: number; endsAt: number } | null)[];
  enemyIndex?: number; enemyHps?: number[];
}

export function simulateGroupBattle(team: Fighter[], enemies: CharacterStats[], random?: () => number) {
  return simulateSkillBattle(team, enemies, random);
}

function damage(attacker: CharacterStats, defender: CharacterStats) {
  return Math.max(1, attacker.atk - defender.def, attacker.magic - defender.magicDef);
}

export function simulateBattle(team: Fighter[], enemy: CharacterStats, random?: () => number) {
  if (team.some((member) => member.weapon || (member.mp ?? member.stats.mp) < member.stats.mp)) return simulateSkillBattle(team, enemy, random);
  const hp = team.map((member) => Math.max(0, Math.min(member.stats.hp, member.hp ?? member.stats.hp)));
  let enemyHp = enemy.hp;
  const steps: BattleStep[] = [];
  const schedule = [
    ...team.map((member, index) => ({ index, priority: index, interval: actionDuration(member.stats.speed), nextAt: actionDuration(member.stats.speed) })),
    { index: -1, priority: team.length, interval: actionDuration(enemy.speed), nextAt: actionDuration(enemy.speed) },
  ];
  for (let action = 0; action < 10000 && enemyHp > 0 && hp.some((value) => value > 0); action++) {
    const turn = schedule.filter((entry) => entry.index === -1 || hp[entry.index] > 0)
      .sort((a, b) => a.nextAt - b.nextAt || a.priority - b.priority)[0];
    const at = turn.nextAt;
    turn.nextAt += turn.interval;
    if (turn.index === -1) {
        const target = hp.findIndex((value) => value > 0), hit = damage(enemy, team[target].stats);
        hp[target] = Math.max(0, hp[target] - hit);
        steps.push({ at, actor: "enemy", characterId: team[target].id, damage: hit, enemyHp, teamHp: [...hp] });
      } else if (hp[turn.index] > 0) {
        const hit = damage(team[turn.index].stats, enemy);
        enemyHp = Math.max(0, enemyHp - hit);
        steps.push({ at, actor: "team", characterId: team[turn.index].id, damage: hit, enemyHp, teamHp: [...hp] });
      }
  }
  return { won: enemyHp <= 0, steps };
}
