import { randomInt } from "node:crypto";
import type { Fighter, BattleStep } from "./battle.service.js";
import type { CharacterStats } from "../models/character-stats.js";
import { enemies as enemyCatalog, type EnemyStats } from "../models/enemy.js";
import { skills, COUNTER_CHANCE, CRITICAL_CHANCE, CRITICAL_MULTIPLIER, type SkillDefinition } from "../models/skills.js";
import { actionDuration, spellCastTime } from "../models/action-timing.js";

interface Buff { kind: "attack" | "speed" | "hero" | "burst"; amount: number; expires: number }
interface Unit {
  fighter: Fighter; hp: number; mp: number; nextAt: number; ready: [number, number]; buffs: Buff[];
  casting: { slot: number; skill: SkillDefinition; starts: number; ends: number; target: number } | null;
}

export function simulateSkillBattle(team: Fighter[], opponents: EnemyStats | EnemyStats[], roll = () => randomInt(1_000_000) / 1_000_000) {
  const units: Unit[] = team.map((fighter) => ({ fighter, hp: Math.max(0, Math.min(fighter.stats.hp, fighter.hp ?? fighter.stats.hp)), mp: Math.max(0, Math.min(fighter.stats.mp, fighter.mp ?? fighter.stats.mp)),
    nextAt: actionDuration(fighter.stats.speed), ready: [0, 0], buffs: [], casting: null }));
  const steps: BattleStep[] = [];
  const enemies: EnemyStats[] = Array.isArray(opponents) ? [...opponents] : [opponents];
  const enemyHps = enemies.map((enemy) => enemy.hp), enemyNext = enemies.map((enemy) => actionDuration(enemy.speed)), stunUntil = enemies.map(() => 0);
  const enemyMp = enemies.map((enemy) => enemy.mp);
  const enemyReady = enemies.map(() => 0), guardUntil = enemies.map(() => 0), shieldUntil = enemies.map(() => 0);
  const summoned: { type: "fishpeople-knight"; index: number; at: number }[] = [];
  enemies.forEach((enemy, index) => { if (enemy.bubbleBeam && enemy.mp >= enemy.bubbleBeam.mana) enemyNext[index] = enemy.bubbleBeam.cooldown; });
  let at = 0, nextManaTick = 1;
  const poisons: Record<number, { source: number; until: number; next: number }> = {};
  const bleeds: Record<number, { source: number; stacks: number; next: number }> = {};
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
    if (enemy.blockChance && roll() < enemy.blockChance) { emit(index, "team", 0, "block", enemy.fishpeople ? "Knight Block" : "Hermit Block", { enemyIndex }); return; }
    const amount = Math.max(1, raw - (magic ? enemy.magicDef : enemy.def + (at < guardUntil[enemyIndex] ? 10 : 0))) * (critical ? CRITICAL_MULTIPLIER : 1);
    enemyHps[enemyIndex] = Math.max(0, enemyHps[enemyIndex] - amount);
    emit(index, "team", amount, kind, label, { critical, enemyIndex });
    restoreShield(index, enemyIndex);
  }
  function restoreShield(source: number, enemyIndex: number) {
    if (enemyHps[enemyIndex] <= 0 || at >= shieldUntil[enemyIndex]) return;
    const before = enemyHps[enemyIndex];
    enemyHps[enemyIndex] = Math.min(enemies[enemyIndex].hp, before + 5);
    emit(source, "enemy", 0, "heal", "Restorative Shield", { enemyIndex, healing: enemyHps[enemyIndex] - before });
  }
  function basic(index: number, kind: "attack" | "counter" | "double" = "attack", enemyIndex = targetEnemy(), cleave = true) {
    if (enemyIndex < 0) return;
    const enemy = enemies[enemyIndex];
    if (enemy.blockChance && roll() < enemy.blockChance) {
      emit(index, "team", 0, "block", enemy.fishpeople ? "Knight Block" : "Hermit Block", { enemyIndex });
      if (units[index].fighter.weapon === "glaive" && cleave) {
        const second = enemyHps.findIndex((hp, target) => hp > 0 && target !== enemyIndex);
        if (second >= 0) basic(index, kind, second, false);
      }
      return;
    }
    const unit = units[index], current = stats(unit);
    const physical = Math.max(1, current.atk - enemy.def - (at < guardUntil[enemyIndex] ? 10 : 0)), magical = Math.max(1, current.magic - enemy.magicDef);
    const amount = Math.max(physical, magical);
    enemyHps[enemyIndex] = Math.max(0, enemyHps[enemyIndex] - amount);
    emit(index, "team", amount, kind, kind === "counter" ? "Counterattack" : kind === "double" ? "Dual Shot" : "Attack", { enemyIndex });
    restoreShield(index, enemyIndex);
    if (unit.fighter.weapon === "dual-axe" && enemyHps[enemyIndex] > 0) {
      if (bleeds[enemyIndex]) { bleeds[enemyIndex].stacks += 1; bleeds[enemyIndex].source = index; }
      else bleeds[enemyIndex] = { source: index, stacks: 1, next: at + 1 };
    }
    if (unit.fighter.weapon === "glaive" && cleave) {
      const second = enemyHps.findIndex((hp, target) => hp > 0 && target !== enemyIndex);
      if (second >= 0) basic(index, kind, second, false);
    }
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
    if (skill.id === "hero" || skill.id === "burst-fire" || skill.id === "axe-frenzy") {
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
      case "hero": case "burst-fire": case "axe-frenzy":
        changeBuff(index, { kind: skill.id === "hero" ? "hero" : "burst", amount: skill.id === "hero" ? 20 : 40, expires: at + (skill.id === "hero" ? 7 : 3) });
        emit(index, "team", 0, "buff", skill.name, { targetIds: [unit.fighter.id] }); break;
      default: {
        if (!skill.damage) break;
        const raw = skill.damage.base + stats(unit)[skill.damage.stat];
        if (skill.id === "freeze" || skill.id === "freeze-all") {
          const targets = skill.id === "freeze-all" ? enemyHps.flatMap((hp, target) => hp > 0 ? [target] : []) : [targetEnemy()];
          for (const target of targets) {
            hit(index, raw, true, "skill", skill.name, false, target);
            if (enemyHps[target] > 0) { stunUntil[target] = Math.max(stunUntil[target], at + 2); enemyNext[target] = Math.max(enemyNext[target], stunUntil[target]); }
          }
        } else if (skill.id === "bouncing-glaive") {
          let target = targetEnemy();
          for (let bounce = 0; bounce <= 4 && target >= 0; bounce++) {
            hit(index, raw, false, "skill", skill.name, false, target);
            const alternatives = enemyHps.flatMap((hp, other) => hp > 0 && other !== target ? [other] : []);
            target = alternatives.length ? alternatives[Math.min(alternatives.length - 1, Math.floor(roll() * alternatives.length))] : -1;
          }
        } else if (skill.id === "inferno") {
          for (let target = 0; target < enemies.length; target++) if (enemyHps[target] > 0) hit(index, raw, true, "skill", skill.name, critical, target);
        } else hit(index, raw, skill.damage.stat === "magic", "skill", skill.name, critical);
      }
    }
    unit.nextAt = at + actionDuration(stats(unit).speed);
  }

  for (let event = 0; event < 10000 && targetEnemy() >= 0 && living().length > 0; event++) {
    const events = [
      { time: nextManaTick, type: "mana" as const, index: 0, priority: -3 },
      ...units.flatMap((unit, index) => unit.hp > 0 ? [{ time: unit.casting?.ends ?? unit.nextAt, type: "unit" as const, index, priority: index }] : []),
      ...enemies.flatMap((_, index) => enemyHps[index] > 0 ? [{ time: Math.max(enemyNext[index], stunUntil[index]), type: "enemy" as const, index, priority: units.length + index }] : []),
      ...units.flatMap((unit, index) => unit.buffs.map((buff) => ({ time: buff.expires, type: "expiry" as const, index, priority: -2 }))),
      ...Object.entries(poisons).flatMap(([key, poison]) => enemyHps[Number(key)] > 0 && poison.next <= poison.until + 1e-8 ? [{ time: poison.next, type: "poison" as const, index: Number(key), priority: -1 }] : []),
      ...Object.entries(bleeds).flatMap(([key, bleed]) => enemyHps[Number(key)] > 0 ? [{ time: bleed.next, type: "bleed" as const, index: Number(key), priority: -1 }] : []),
    ].sort((a, b) => a.time - b.time || a.priority - b.priority);
    const next = events[0]; at = next.time;
    if (next.type === "mana") {
      nextManaTick += 1;
      const restored: number[] = [];
      units.forEach((unit, index) => {
        if (unit.hp <= 0) return;
        const before = unit.mp;
        unit.mp = Math.min(unit.fighter.stats.mp, unit.mp + 5);
        if (unit.mp > before) restored.push(index);
      });
      if (restored.length) emit(restored[0], "team", 0, "mana", "Mana regeneration", { targetIds: restored.map((index) => units[index].fighter.id) });
      continue;
    }
    if (next.type === "expiry") {
      changeBuff(next.index, null, true);
      emit(next.index, "team", 0, "buff", "Buff expired"); continue;
    }
    if (next.type === "poison") {
      const poison = poisons[next.index];
      enemyHps[next.index] = Math.max(0, enemyHps[next.index] - 5); emit(poison.source, "team", 5, "poison", "Poison", { enemyIndex: next.index });
      poison.next += 1; if (poison.next > poison.until + 1e-8) delete poisons[next.index]; continue;
    }
    if (next.type === "bleed") {
      const bleed = bleeds[next.index], amount = bleed.stacks * 5;
      enemyHps[next.index] = Math.max(0, enemyHps[next.index] - amount);
      emit(bleed.source, "team", amount, "bleed", `Bleed · ${bleed.stacks} stacks`, { enemyIndex: next.index });
      bleed.next += 1; continue;
    }
    if (next.type === "enemy") {
      const enemy = enemies[next.index];
      const skill = enemy.skill;
      if (skill && at >= enemyReady[next.index] && enemyMp[next.index] >= skill.mana) {
        const recipients = skill.kind === "heal-self" ? [next.index].filter((index) => enemyHps[index] < enemies[index].hp)
          : skill.kind === "heal-all" ? enemies.flatMap((member, index) => member.fishpeople && enemyHps[index] > 0 && enemyHps[index] < member.hp ? [index] : []) : [];
        if ((skill.kind !== "heal-self" && skill.kind !== "heal-all") || recipients.length) {
          enemyMp[next.index] -= skill.mana; enemyReady[next.index] = at + skill.cooldown;
          enemyNext[next.index] = at + actionDuration(enemy.speed);
          const source = living()[0];
          if (skill.kind === "guard" || skill.kind === "shield") {
            if (skill.kind === "guard") guardUntil[next.index] = at + (skill.duration ?? 2);
            else shieldUntil[next.index] = at + (skill.duration ?? 5);
            emit(source, "enemy", 0, "buff", skill.name, { enemyIndex: next.index });
          } else if (skill.kind === "heal-all" || skill.kind === "heal-self") {
            for (const recipient of recipients) {
              const before = enemyHps[recipient]; enemyHps[recipient] = Math.min(enemies[recipient].hp, before + 50);
              emit(source, "enemy", 0, "heal", skill.name, { enemyIndex: recipient, healing: enemyHps[recipient] - before });
            }
          } else if (skill.kind === "summon") {
            const knight = enemyCatalog["fishpeople-knight"].stats, index = enemies.length;
            enemies.push(knight); enemyHps.push(knight.hp); enemyMp.push(knight.mp);
            enemyNext.push(at + actionDuration(knight.speed)); stunUntil.push(0); enemyReady.push(0); guardUntil.push(0); shieldUntil.push(0);
            summoned.push({ type: "fishpeople-knight", index, at });
            emit(source, "enemy", 0, "skill", skill.name, { enemyIndex: index });
          } else {
            const target = skill.farthest ? living().at(-1)! : source, unit = units[target];
            if (unit.fighter.weapon === "sword-and-shield" && roll() < 0.3) {
              emit(target, "enemy", 0, "block", `Block ${skill.name}`, { enemyIndex: next.index });
              if (unit.fighter.skill2Unlocked && roll() < COUNTER_CHANCE) basic(target, "counter", next.index);
            } else {
              const amount = Math.max(1, (skill.damage ?? 0) - (skill.magic ? stats(unit).magicDef : stats(unit).def));
              unit.hp = Math.max(0, unit.hp - amount); if (unit.hp <= 0) unit.casting = null;
              emit(target, "enemy", amount, "skill", skill.name, { enemyIndex: next.index });
            }
          }
          continue;
        }
      }
      const areaSkill = enemy.burnAll ?? enemy.slashAll;
      const areaLabel = enemy.burnAll ? "Burn All" : "Slash All";
      if (areaSkill && enemyMp[next.index] >= areaSkill.mana) {
        enemyMp[next.index] -= areaSkill.mana;
        enemyNext[next.index] = at + actionDuration(enemy.speed);
        for (const target of living()) {
          const unit = units[target];
          if (unit.fighter.weapon === "sword-and-shield" && roll() < 0.3) {
            emit(target, "enemy", 0, "block", `Block ${areaLabel}`, { enemyIndex: next.index });
            if (unit.fighter.skill2Unlocked && roll() < COUNTER_CHANCE) basic(target, "counter", next.index);
          } else {
            const amount = Math.max(1, areaSkill.damage - (enemy.burnAll ? stats(unit).magicDef : stats(unit).def));
            unit.hp = Math.max(0, unit.hp - amount);
            if (unit.hp <= 0) unit.casting = null;
            emit(target, "enemy", amount, "skill", areaLabel, { enemyIndex: next.index });
          }
        }
        continue;
      }
      const beam = enemy.bubbleBeam && enemyMp[next.index] >= enemy.bubbleBeam.mana ? enemy.bubbleBeam : undefined;
      if (beam) enemyMp[next.index] -= beam.mana;
      enemyNext[next.index] = at + (enemy.bubbleBeam && enemyMp[next.index] >= enemy.bubbleBeam.mana ? enemy.bubbleBeam.cooldown : actionDuration(enemy.speed));
      const target = living()[0], unit = units[target];
      if (unit.fighter.weapon === "sword-and-shield" && roll() < 0.3) {
        emit(target, "enemy", 0, "block", "Block", { enemyIndex: next.index });
        if (unit.fighter.skill2Unlocked && roll() < COUNTER_CHANCE) basic(target, "counter", next.index);
      } else {
        const current = stats(unit), amount = beam ? Math.max(1, beam.damage - current.magicDef) : Math.max(1, enemy.atk - current.def, enemy.magic - current.magicDef);
        unit.hp = Math.max(0, unit.hp - amount);
        if (unit.hp <= 0) unit.casting = null;
        emit(target, "enemy", amount, beam ? "skill" : "attack", beam ? "Bubble Beam" : "Enemy attack", { enemyIndex: next.index });
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
  return { won: targetEnemy() < 0, steps, enemyHps, summoned, teamHp: units.map((unit) => unit.hp), teamMp: units.map((unit) => unit.mp) };
}
