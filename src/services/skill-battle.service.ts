import { randomInt } from "node:crypto";
import type { Fighter, BattleStep } from "./battle.service.js";
import type { CharacterStats } from "../models/character-stats.js";
import { skills, COUNTER_CHANCE, CRITICAL_CHANCE, CRITICAL_MULTIPLIER, type SkillDefinition } from "../models/skills.js";
import { actionDuration, spellCastTime } from "../models/action-timing.js";

interface Buff { kind: "attack" | "speed" | "hero" | "burst"; amount: number; expires: number }
interface Unit {
  fighter: Fighter; hp: number; mp: number; nextAt: number; ready: [number, number]; buffs: Buff[];
  casting: { slot: number; skill: SkillDefinition; starts: number; ends: number; target: number } | null;
}

export function simulateSkillBattle(team: Fighter[], opponents: CharacterStats | CharacterStats[], roll = () => randomInt(1_000_000) / 1_000_000) {
  const units: Unit[] = team.map((fighter) => ({ fighter, hp: Math.max(0, Math.min(fighter.stats.hp, fighter.hp ?? fighter.stats.hp)), mp: Math.max(0, Math.min(fighter.stats.mp, fighter.mp ?? fighter.stats.mp)),
    nextAt: actionDuration(fighter.stats.speed), ready: [0, 0], buffs: [], casting: null }));
  const steps: BattleStep[] = [];
  const enemies = Array.isArray(opponents) ? opponents : [opponents];
  const enemyHps = enemies.map((enemy) => enemy.hp), enemyNext = enemies.map((enemy) => actionDuration(enemy.speed)), stunUntil = enemies.map(() => 0);
  let at = 0;
  const poisons: Record<number, { source: number; until: number; next: number }> = {};
  function targetEnemy() { return enemyHps.findIndex((hp) => hp > 0); }
  function stats(unit: Unit): CharacterStats {
    const result = { ...unit.fighter.stats };
    for (const buff of unit.buffs) {
      if (buff.kind === "attack" || buff.kind === "hero") result.atk += buff.amount;
      if (buff.kind === "hero") result.def += buff.amount;
      if (buff.kind === "speed" || buff.kind === "burst") result.speed += buff.amount;
    }
    return result;
  }
  function emit(index: number, actor: "team" | "enemy", damage: number, kind: NonNullable<BattleStep["kind"]>, label: string, extra: Partial<BattleStep> = {}) {
    const enemyIndex = extra.enemyIndex ?? Math.max(0, targetEnemy());
    steps.push({ at, actor, characterId: units[index].fighter.id, damage, kind, label,
      enemyIndex, enemyHp: enemyHps[enemyIndex], enemyHps: [...enemyHps], teamHp: units.map((unit) => unit.hp), teamMp: units.map((unit) => unit.mp),
      teamCasting: units.map((unit) => unit.casting ? { name: unit.casting.skill.name, startedAt: unit.casting.starts, endsAt: unit.casting.ends } : null), ...extra });
  }
  function hit(index: number, raw: number, magic: boolean, kind: NonNullable<BattleStep["kind"]>, label: string, critical = false, enemyIndex = targetEnemy()) {
    if (enemyIndex < 0) return;
    const enemy = enemies[enemyIndex];
    const amount = Math.max(1, raw - (magic ? enemy.magicDef : enemy.def)) * (critical ? CRITICAL_MULTIPLIER : 1);
    enemyHps[enemyIndex] = Math.max(0, enemyHps[enemyIndex] - amount);
    emit(index, "team", amount, kind, label, { critical, enemyIndex });
  }
  function basic(index: number, kind: "attack" | "counter" | "double" = "attack", enemyIndex = targetEnemy()) {
    if (enemyIndex < 0) return;
    const enemy = enemies[enemyIndex];
    const unit = units[index], current = stats(unit);
    const physical = Math.max(1, current.atk - enemy.def), magical = Math.max(1, current.magic - enemy.magicDef);
    const amount = Math.max(physical, magical);
    enemyHps[enemyIndex] = Math.max(0, enemyHps[enemyIndex] - amount);
    emit(index, "team", amount, kind, kind === "counter" ? "Counterattack" : kind === "double" ? "Dual Shot" : "Attack", { enemyIndex });
    if (unit.fighter.weapon === "bow" && enemyHps[enemyIndex] > 0) {
      if (poisons[enemyIndex]) { poisons[enemyIndex].until = at + 5; poisons[enemyIndex].source = index; }
      else poisons[enemyIndex] = { source: index, until: at + 5, next: at + 1 };
    }
  }
  function changeBuff(index: number, buff: Buff | null, removeExpired = false) {
    const unit = units[index], before = stats(unit).speed;
    if (removeExpired) unit.buffs = unit.buffs.filter((entry) => entry.expires > at + 1e-8);
    if (buff) unit.buffs.push(buff);
    const after = stats(unit).speed;
    // Preserve progress when a speed buff starts or expires, including an in-flight cast.
    if (before !== after) {
      const ratio = actionDuration(after) / actionDuration(before);
      if (unit.casting) unit.casting.ends = at + Math.max(0, unit.casting.ends - at) * ratio;
      else unit.nextAt = at + Math.max(0, unit.nextAt - at) * ratio;
    }
  }
  function living() { return units.flatMap((unit, index) => unit.hp > 0 ? [index] : []); }
  function targetFor(skill: SkillDefinition, caster: number) {
    const alive = living();
    if (skill.id === "heal") return alive.filter((index) => units[index].hp < units[index].fighter.stats.hp).sort((a, b) => units[a].hp - units[b].hp)[0] ?? -1;
    if (skill.id === "mass-heal") return alive.some((index) => units[index].hp < units[index].fighter.stats.hp) ? caster : -1;
    if (skill.id === "attack-buff" || skill.id === "speed-buff") {
      const kind = skill.id === "attack-buff" ? "attack" : "speed";
      const candidates = alive.filter((index) => !units[index].buffs.some((buff) => buff.kind === kind));
      return candidates.length ? candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))] : -1;
    }
    if (skill.id === "hero" || skill.id === "burst-fire") {
      const kind = skill.id === "hero" ? "hero" : "burst";
      if (units[caster].buffs.some((buff) => buff.kind === kind)) return -1;
    }
    if (skill.id === "shackle" && stunUntil[targetEnemy()] > at) return -1;
    return caster;
  }
  function finishCast(index: number) {
    const unit = units[index], casting = unit.casting!;
    unit.casting = null;
    const { skill, target } = casting;
    unit.ready[casting.slot] = at + skill.cooldown;
    let effectTarget = target;
    if ((skill.id === "heal" || skill.id === "attack-buff" || skill.id === "speed-buff") && units[target]?.hp <= 0) effectTarget = targetFor(skill, index);
    const critical = unit.fighter.weapon === "rifle" && !!unit.fighter.skill2Unlocked && roll() < CRITICAL_CHANCE;
    switch (skill.id) {
      case "shackle": {
        const target = targetEnemy();
        stunUntil[target] = at + 1; enemyNext[target] = Math.max(enemyNext[target], stunUntil[target]);
        emit(index, "team", 0, "skill", "Shackle · Stun 1s", { enemyIndex: target }); break;
      }
      case "heal": case "mass-heal": {
        const targets = skill.id === "mass-heal" ? living() : effectTarget >= 0 ? [effectTarget] : [];
        let healed = 0;
        for (const recipient of targets) {
          const before = units[recipient].hp;
          units[recipient].hp = Math.min(units[recipient].fighter.stats.hp, before + (skill.id === "heal" ? 30 : 20));
          healed += units[recipient].hp - before;
        }
        emit(index, "team", 0, "heal", skill.name, { healing: healed, targetIds: targets.map((recipient) => units[recipient].fighter.id) }); break;
      }
      case "attack-buff": case "speed-buff":
        if (effectTarget >= 0) {
          changeBuff(effectTarget, { kind: skill.id === "attack-buff" ? "attack" : "speed", amount: skill.id === "attack-buff" ? 5 : 20, expires: at + 7 });
          emit(index, "team", 0, "buff", skill.name, { targetIds: [units[effectTarget].fighter.id] });
        } break;
      case "hero": case "burst-fire":
        changeBuff(index, { kind: skill.id === "hero" ? "hero" : "burst", amount: skill.id === "hero" ? 20 : 40, expires: at + (skill.id === "hero" ? 7 : 3) });
        emit(index, "team", 0, "buff", skill.name, { targetIds: [unit.fighter.id] }); break;
      default: {
        if (!skill.damage) break;
        const raw = skill.damage.base + stats(unit)[skill.damage.stat];
        if (skill.id === "inferno") {
          for (let target = 0; target < enemies.length; target++) if (enemyHps[target] > 0) hit(index, raw, true, "skill", skill.name, critical, target);
        } else hit(index, raw, skill.damage.stat === "magic", "skill", skill.name, critical);
      }
    }
    unit.nextAt = at + actionDuration(stats(unit).speed);
  }

  for (let event = 0; event < 10000 && targetEnemy() >= 0 && living().length > 0; event++) {
    const events = [
      ...units.flatMap((unit, index) => unit.hp > 0 ? [{ time: unit.casting?.ends ?? unit.nextAt, type: "unit" as const, index, priority: index }] : []),
      ...enemies.flatMap((_, index) => enemyHps[index] > 0 ? [{ time: Math.max(enemyNext[index], stunUntil[index]), type: "enemy" as const, index, priority: units.length + index }] : []),
      ...units.flatMap((unit, index) => unit.buffs.map((buff) => ({ time: buff.expires, type: "expiry" as const, index, priority: -2 }))),
      ...Object.entries(poisons).flatMap(([key, poison]) => enemyHps[Number(key)] > 0 && poison.next <= poison.until + 1e-8 ? [{ time: poison.next, type: "poison" as const, index: Number(key), priority: -1 }] : []),
    ].sort((a, b) => a.time - b.time || a.priority - b.priority);
    const next = events[0]; at = next.time;
    if (next.type === "expiry") {
      changeBuff(next.index, null, true);
      emit(next.index, "team", 0, "buff", "Buff expired"); continue;
    }
    if (next.type === "poison") {
      const poison = poisons[next.index];
      enemyHps[next.index] = Math.max(0, enemyHps[next.index] - 5); emit(poison.source, "team", 5, "poison", "Poison", { enemyIndex: next.index });
      poison.next += 1; if (poison.next > poison.until + 1e-8) delete poisons[next.index]; continue;
    }
    if (next.type === "enemy") {
      const enemy = enemies[next.index];
      enemyNext[next.index] = at + actionDuration(enemy.speed);
      const target = living()[0], unit = units[target];
      if (unit.fighter.weapon === "sword-and-shield" && roll() < 0.3) {
        emit(target, "enemy", 0, "block", "Block", { enemyIndex: next.index });
        if (unit.fighter.skill2Unlocked && roll() < COUNTER_CHANCE) basic(target, "counter", next.index);
      } else {
        const current = stats(unit), amount = Math.max(1, enemy.atk - current.def, enemy.magic - current.magicDef);
        unit.hp = Math.max(0, unit.hp - amount);
        if (unit.hp <= 0) unit.casting = null;
        emit(target, "enemy", amount, "attack", "Enemy attack", { enemyIndex: next.index });
      }
      continue;
    }
    const unit = units[next.index];
    if (unit.casting) { finishCast(next.index); continue; }
    const definitions = unit.fighter.weapon ? skills[unit.fighter.weapon] : [];
    let cast = false;
    for (const slot of [1, 0] as const) {
      const skill = definitions[slot];
      if (!skill || skill.passive || (slot === 1 && !unit.fighter.skill2Unlocked) || at < unit.ready[slot] || unit.mp < skill.mpCost || unit.hp <= skill.hpCost) continue;
      const target = targetFor(skill, next.index);
      if (target < 0) continue;
      unit.mp -= skill.mpCost; unit.hp -= skill.hpCost;
      const ends = at + spellCastTime(stats(unit).speed, skill.baseCastTime);
      unit.casting = { slot, skill, starts: at, ends, target };
      emit(next.index, "team", 0, "cast", `Casting ${skill.name}`, { castEndsAt: ends });
      cast = true; break;
    }
    if (!cast) {
      basic(next.index);
      if (targetEnemy() >= 0 && (unit.fighter.weapon === "dual-gun" || unit.fighter.weapon === "dual-knife") && roll() < 0.3) basic(next.index, "double");
      unit.nextAt = at + actionDuration(stats(unit).speed);
    }
  }
  return { won: targetEnemy() < 0, steps, enemyHps, teamHp: units.map((unit) => unit.hp), teamMp: units.map((unit) => unit.mp) };
}
