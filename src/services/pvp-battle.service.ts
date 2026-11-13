import { randomInt } from "node:crypto";
import type { Fighter } from "./battle.service.js";
import { skills, savesManaForSkill2, type SkillDefinition } from "../models/skills.js";
import { actionDuration, spellCastTime } from "../models/action-timing.js";

export interface DuelFighter extends Fighter { userId: string; name: string; startX?: number }
export interface DuelStep {
  at: number; side: number; actor: number; targets: number[]; kind: string; label: string;
  damage: number; healing: number; critical: boolean; hp: number[]; mp: number[]; x: number[];
}
export interface DuelResult { fighters: DuelFighter[]; steps: DuelStep[]; duration: number; winnerId: string | null }
type Buff = { kind: "attack" | "speed" | "hero" | "burst"; amount: number; until: number };
export const PVP_MELEE_RANGE = 70;
export const PVP_RANGED_RANGE = 600;
export const PVP_WALK_SPEED = 120;
const MOVE_TICK = 0.1;
const rangedSkills = new Set(["shackle", "fireball", "inferno", "throw-spear", "long-shot", "bouncing-glaive", "freeze", "freeze-all"]);

/** Ordered fighters: host formation followed by guest formation, front slots first. */
export function simulateDuel(fighters: DuelFighter[], roll = () => randomInt(1_000_000) / 1_000_000): DuelResult {
  const owners = [...new Set(fighters.map((fighter) => fighter.userId))];
  if (owners.length !== 2 || owners.some((id) => fighters.filter((fighter) => fighter.userId === id).length > 6)) throw new Error("PvP requires two teams of one to six characters");
  const units = fighters.map((fighter, index) => {
    const team = owners.indexOf(fighter.userId);
    const count = fighters.filter((other) => other.userId === fighter.userId).length;
    const slot = fighters.slice(0, index).filter((other) => other.userId === fighter.userId).length;
    return { fighter, team, x: team === 0 ? 60 + (count - 1 - slot) * 64 : 1140 - (count - 1 - slot) * 64, hp: fighter.stats.hp, mp: fighter.stats.mp,
    next: actionDuration(fighter.stats.speed), ready: [0, 0], stun: 0, buffs: [] as Buff[],
    cast: null as { skill: SkillDefinition; slot: number; ends: number } | null,
    poison: null as { until: number; next: number; source: number } | null,
    bleed: 0, bleedNext: Infinity, bleedSource: 0 };
  });
  const initialPositions = units.map((unit) => unit.x);
  const steps: DuelStep[] = [];
  let at = 0, manaAt = 1, moveAt = MOVE_TICK;
  const first = roll() < 0.5 ? 0 : 1;
  const alive = (team: number) => units.flatMap((unit, index) => unit.team === team && unit.hp > 0 ? [index] : []);
  const enemies = (index: number) => alive(1 - units[index].team).sort((a, b) => Math.abs(units[a].x - units[index].x) - Math.abs(units[b].x - units[index].x) || a - b);
  const allies = (index: number) => alive(units[index].team);
  const basicRange = (index: number) => fighters[index].stats.range === "range" ? PVP_RANGED_RANGE : PVP_MELEE_RANGE;
  const skillRange = (skill: SkillDefinition) => rangedSkills.has(skill.id) ? PVP_RANGED_RANGE : PVP_MELEE_RANGE;
  const inRange = (actor: number, target: number, range: number) => Math.abs(units[actor].x - units[target].x) <= range + 1e-5;
  const stats = (index: number) => {
    const value = { ...units[index].fighter.stats };
    for (const buff of units[index].buffs) {
      if (buff.kind === "attack" || buff.kind === "hero") value.atk += buff.amount;
      if (buff.kind === "hero") value.def += buff.amount;
      if (buff.kind === "speed" || buff.kind === "burst") value.speed += buff.amount;
    }
    return value;
  };
  function emit(actor: number, kind: string, label: string, damage = 0, healing = 0, critical = false, targets: number[] = []) {
    steps.push({ at, side: units[actor].team, actor, targets, kind, label, damage, healing, critical,
      hp: units.map((unit) => unit.hp), mp: units.map((unit) => unit.mp), x: units.map((unit) => unit.x) });
  }
  function buff(index: number, value?: Buff) {
    const unit = units[index], before = stats(index).speed;
    unit.buffs = unit.buffs.filter((entry) => entry.until > at + 1e-8);
    if (value) unit.buffs.push(value);
    const after = stats(index).speed;
    if (before !== after) {
      const ratio = actionDuration(after) / actionDuration(before);
      if (unit.cast) unit.cast.ends = at + Math.max(0, unit.cast.ends - at) * ratio;
      else unit.next = at + Math.max(0, unit.next - at) * ratio;
    }
  }
  function strike(actor: number, target: number, raw: number, magical: boolean, kind: string, label: string, critical = false, counter = false): boolean {
    const victim = units[target];
    if (units[actor].hp <= 0 || victim.hp <= 0) return false;
    if (victim.fighter.weapon === "sword-and-shield" && roll() < 0.3) {
      emit(target, "block", "Block", 0, 0, false, [target]);
      if (!counter && victim.fighter.skill2Unlocked && roll() < 0.3) basic(target, true, actor);
      return false;
    }
    const damage = Math.max(1, raw - (magical ? stats(target).magicDef : stats(target).def)) * (critical ? 2 : 1);
    victim.hp = Math.max(0, victim.hp - damage);
    if (!victim.hp) victim.cast = null;
    emit(actor, kind, label, damage, 0, critical, [target]);
    return true;
  }
  function basic(actor: number, counter = false, counterTarget?: number) {
    const targets = (counterTarget === undefined ? enemies(actor) : [counterTarget]).filter((target) => inRange(actor, target, basicRange(actor))).slice(0, units[actor].fighter.weapon === "glaive" ? 2 : 1);
    for (const target of targets) {
      const current = stats(actor), defender = stats(target);
      const magical = current.magic - defender.magicDef > current.atk - defender.def;
      if (!strike(actor, target, magical ? current.magic : current.atk, magical, counter ? "counter" : "attack", counter ? "Counterattack" : "Attack", false, counter)) continue;
      const victim = units[target];
      if (!victim.hp) continue;
      if (units[actor].fighter.weapon === "bow") {
        if (victim.poison) { victim.poison.until = at + 5; victim.poison.source = actor; }
        else victim.poison = { until: at + 5, next: at + 1, source: actor };
      }
      if (units[actor].fighter.weapon === "dual-axe") {
        if (!victim.bleed) victim.bleedNext = at + 1;
        victim.bleed += 1; victim.bleedSource = actor;
      }
    }
  }
  const buffKind = (id: string): Buff["kind"] | null => id === "attack-buff" ? "attack" : id === "speed-buff" ? "speed" : id === "hero" ? "hero" : ["burst-fire", "axe-frenzy"].includes(id) ? "burst" : null;
  function buffTargets(actor: number, skill: SkillDefinition) {
    const kind = buffKind(skill.id);
    return (kind === "attack" || kind === "speed" ? allies(actor) : [actor]).filter((index) => !units[index].buffs.some((entry) => entry.kind === kind));
  }
  function eligible(actor: number, skill: SkillDefinition) {
    if (skill.id === "heal" || skill.id === "mass-heal") return allies(actor).some((index) => units[index].hp < fighters[index].stats.hp);
    if (buffKind(skill.id)) return buffTargets(actor, skill).length > 0;
    return enemies(actor).some((index) => inRange(actor, index, skillRange(skill)) && (skill.id !== "shackle" || units[index].stun <= at));
  }
  function finish(actor: number) {
    const unit = units[actor], casting = unit.cast!, skill = casting.skill;
    unit.cast = null; unit.ready[casting.slot] = at + skill.cooldown;
    if (skill.id === "heal" || skill.id === "mass-heal") {
      const targets = skill.id === "mass-heal" ? allies(actor) : allies(actor).filter((index) => units[index].hp < fighters[index].stats.hp).sort((a, b) => units[a].hp - units[b].hp).slice(0, 1);
      for (const target of targets) {
        const before = units[target].hp;
        units[target].hp = Math.min(fighters[target].stats.hp, before + (skill.id === "heal" ? 30 : 20));
        emit(actor, "heal", skill.name, 0, units[target].hp - before, false, [target]);
      }
    } else if (buffKind(skill.id)) {
      const kind = buffKind(skill.id)!, candidates = buffTargets(actor, skill);
      if (candidates.length) {
        const target = candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))];
        buff(target, { kind, amount: kind === "attack" ? 5 : kind === "speed" || kind === "hero" ? 20 : 40, until: at + (kind === "burst" ? 3 : 7) });
        emit(actor, "buff", skill.name, 0, 0, false, [target]);
      }
    } else if (skill.id === "shackle") {
      const target = enemies(actor).find((index) => inRange(actor, index, skillRange(skill)) && units[index].stun <= at);
      if (target !== undefined) { units[target].stun = Math.max(units[target].stun, at + 1); emit(actor, "skill", "Shackle · Stun 1s", 0, 0, false, [target]); }
    } else if (skill.damage) {
      const critical = unit.fighter.weapon === "rifle" && !!unit.fighter.skill2Unlocked && roll() < 0.3;
      const hit = (target: number) => {
        if (strike(actor, target, skill.damage!.base + stats(actor)[skill.damage!.stat], skill.damage!.stat === "magic", "skill", skill.name, critical)
          && ["freeze", "freeze-all"].includes(skill.id)) units[target].stun = Math.max(units[target].stun, at + 2);
      };
      if (skill.id === "bouncing-glaive") {
        let target = enemies(actor).find((index) => inRange(actor, index, skillRange(skill)));
        for (let bounce = 0; bounce < 5 && target !== undefined && unit.hp > 0; bounce++) {
          hit(target);
          target = enemies(actor).find((index) => index !== target);
        }
      } else {
        const primary = enemies(actor).find((index) => inRange(actor, index, skillRange(skill)));
        if (primary !== undefined) for (const target of ["inferno", "freeze-all"].includes(skill.id) ? enemies(actor) : [primary]) hit(target);
      }
    }
    unit.next = at + actionDuration(stats(actor).speed);
  }
  for (let event = 0; event < 50000 && alive(0).length && alive(1).length; event++) {
    const events = [{ at: manaAt, type: "mana", index: 0, priority: -4 }, { at: moveAt, type: "move", index: 0, priority: -1 },
      ...units.flatMap((unit, index) => unit.hp <= 0 ? [] : [
        { at: Math.max(unit.cast?.ends ?? unit.next, unit.stun), type: "unit", index, priority: unit.team === first ? 0 : 1 },
        ...(unit.poison && unit.poison.next <= unit.poison.until + 1e-8 ? [{ at: unit.poison.next, type: "poison", index, priority: -3 }] : []),
        ...(unit.bleed ? [{ at: unit.bleedNext, type: "bleed", index, priority: -3 }] : []),
        ...unit.buffs.map((entry) => ({ at: entry.until, type: "expiry", index, priority: -2 })),
      ]),
    ].sort((a, b) => a.at - b.at || a.priority - b.priority);
    const next = events[0];
    if (next.at > 180) { at = 180; break; }
    at = next.at;
    if (next.type === "move") {
      moveAt += MOVE_TICK;
      let moved = false;
      // Apply both teams' travel from the same frame so the host gets no movement head start.
      const destinations = units.map((unit, index) => {
        if (unit.hp <= 0 || unit.cast || unit.stun > at + 1e-8) return unit.x;
        const target = enemies(index)[0];
        if (target === undefined) return unit.x;
        let reach = basicRange(index);
        const definitions = unit.fighter.weapon ? skills[unit.fighter.weapon] : [];
        for (const slot of [0, 1]) {
          const skill = definitions[slot];
          if (skill && !skill.passive && (slot === 0 || unit.fighter.skill2Unlocked) && unit.mp >= skill.mpCost && unit.hp > skill.hpCost && at >= unit.ready[slot] && rangedSkills.has(skill.id)) reach = Math.max(reach, skillRange(skill));
        }
        const distance = units[target].x - unit.x;
        const travel = Math.min(PVP_WALK_SPEED * MOVE_TICK, Math.max(0, Math.abs(distance) - reach) / 2);
        if (travel > 1e-7) moved = true;
        return unit.x + Math.sign(distance) * travel;
      });
      units.forEach((unit, index) => { unit.x = destinations[index]; });
      if (moved) emit(alive(0)[0], "move", "Advancing");
      continue;
    }
    if (next.type === "mana") {
      manaAt += 1;
      units.forEach((unit) => { if (unit.hp > 0) unit.mp = Math.min(unit.fighter.stats.mp, unit.mp + 5); });
      emit(0, "mana", "Mana regeneration"); continue;
    }
    if (next.type === "expiry") { buff(next.index); emit(next.index, "buff", "Buff expired"); continue; }
    const unit = units[next.index];
    if (next.type === "poison" || next.type === "bleed") {
      const damage = next.type === "poison" ? 5 : unit.bleed * 5;
      unit.hp = Math.max(0, unit.hp - damage);
      if (!unit.hp) unit.cast = null;
      emit(next.type === "poison" ? unit.poison!.source : unit.bleedSource, next.type, next.type === "poison" ? "Poison" : `Bleed · ${unit.bleed} stacks`, damage, 0, false, [next.index]);
      if (next.type === "poison") { unit.poison!.next += 1; if (unit.poison!.next > unit.poison!.until + 1e-8) unit.poison = null; }
      else unit.bleedNext += 1;
      continue;
    }
    if (unit.cast) { finish(next.index); continue; }
    const definitions = unit.fighter.weapon ? skills[unit.fighter.weapon] : [];
    const savingMana = savesManaForSkill2(definitions[1], unit.fighter.skill2Unlocked, unit.mp, unit.fighter.stats.mp, unit.hp, unit.ready[1], at);
    let cast = false;
    for (const slot of [1, 0] as const) {
      const skill = definitions[slot];
      if (slot === 0 && skill?.mpCost && savingMana) continue;
      if (!skill || skill.passive || (slot === 1 && !unit.fighter.skill2Unlocked) || at < unit.ready[slot] || unit.mp < skill.mpCost || unit.hp <= skill.hpCost || !eligible(next.index, skill)) continue;
      unit.mp -= skill.mpCost; unit.hp -= skill.hpCost;
      unit.cast = { skill, slot, ends: at + spellCastTime(stats(next.index).speed, skill.baseCastTime) };
      emit(next.index, "cast", `Casting ${skill.name}`); cast = true; break;
    }
    if (!cast) {
      if (!enemies(next.index).some((target) => inRange(next.index, target, basicRange(next.index)))) {
        unit.next = at + MOVE_TICK;
        continue;
      }
      basic(next.index);
      if (["dual-gun", "dual-knife"].includes(unit.fighter.weapon ?? "") && unit.hp > 0 && enemies(next.index).length && roll() < 0.3) basic(next.index);
      unit.next = at + actionDuration(stats(next.index).speed);
    }
  }
  const winner = alive(0).length && !alive(1).length ? 0 : alive(1).length && !alive(0).length ? 1 : -1;
  return { fighters: fighters.map((fighter, index) => ({ ...fighter, startX: initialPositions[index] })), steps, duration: at, winnerId: winner < 0 ? null : owners[winner] };
}
