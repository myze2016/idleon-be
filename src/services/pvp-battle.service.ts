import { skillValue } from "../models/skills.js";
import { randomInt } from "node:crypto";
import type { BattleStep, CombatStatusEnds, Fighter } from "./battle.service.js";
import { skills, savesManaForSkill2, type SkillDefinition } from "../models/skills.js";
import { actionDuration, MANA_REGEN_PER_SECOND, spellCastTime } from "../models/action-timing.js";
import { DEFAULT_ENEMY_AREA_COOLDOWN, enemies as enemyCatalog, type EnemyStats, type EnemyType } from "../models/enemy.js";
import { EMPTY_BATTLEFIELD_SPAWN_FACTOR, ENDLESS_METERS_PER_SECOND, endlessDistanceStats } from "../models/endless.js";

export interface DuelFighter extends Fighter { userId: string; name: string; startX?: number; enemyType?: EnemyType; enemy?: EnemyStats; spawnAt?: number; spawnOffset?: number; combat?: CombatContinuation; statusEnds?: CombatStatusEnds }
interface CombatContinuation {
  next: number; ready: number[]; stun: number; enemyReady: number; guardUntil: number; shieldUntil: number;
  buffs: Buff[]; cast: { skill: SkillDefinition; slot: number; ends: number; starts?: number } | null;
  poison: { until: number; next: number; sourceId: string } | null; bleed: number; bleedNext: number; bleedSourceId?: string;
  formationEngaged?: boolean;
  cameraWorld?: number;
  freezeUntil?: number;
}
export interface DuelStep {
  at: number; side: number; actor: number; targets: number[]; kind: NonNullable<BattleStep["kind"]> | "move" | "spawn"; label: string;
  damage: number; healing: number; critical: boolean; hp: number[]; mp: number[]; x: number[];
  teamCasting?: BattleStep["teamCasting"];
  castEndsAt?: number;
  statuses?: number[];
  statusEnds?: BattleStep["statusEnds"];
  spearCasting?: number[];
  cameraTravel?: number[];
  cameraWorld?: number[];
}
export interface DuelResult { fighters: DuelFighter[]; steps: DuelStep[]; duration: number; winnerId: string | null; continuation?: DuelFighter[]; nextSpawnIn?: number }
export interface EndlessSpawnSchedule { scheduleEnd: number; distance: number; statMultiplier: number }
type Buff = { kind: "attack" | "speed" | "hero" | "burst"; amount: number; until: number };
export const PVP_MELEE_RANGE = 70;
export const PVP_RANGED_RANGE = 780;
export const COMBAT_VISIBLE_DISTANCE = PVP_RANGED_RANGE;
export const COMBAT_ENCOUNTER_DISTANCE = 1140;
export const PVP_WALK_SPEED = 120;
const ENEMY_WALK_SPEED = 84;
const MOVE_TICK = 0.1;
const rangedSkills = new Set(["shackle", "fireball", "inferno", "throw-spear", "long-shot", "bouncing-glaive", "freeze", "freeze-all"]);

/** Ordered fighters: host formation followed by guest formation, front slots first. */
export function simulateDuel(fighters: DuelFighter[], roll = () => randomInt(1_000_000) / 1_000_000, continuousSeconds?: number,
  { expedition = false, legacyRules = false, sharedEncounterDistance = true, rangedRange = PVP_RANGED_RANGE,
    encounterDistance = COMBAT_ENCOUNTER_DISTANCE, visibleDistance = COMBAT_VISIBLE_DISTANCE, walkToRange = true, individualEngagement = true,
    pacedApproach = true, holdRangedPosition = true, marchingFormation = true, rangedCasterFormation = true,
    mobileSpearThrow = false, pauseFormationDuringCast = false, spearCastCamera = false,
    unifiedMovement = true, screenBoundCombat = true, endlessSpawns, skill2EnabledAt }: {
    expedition?: boolean; legacyRules?: boolean; sharedEncounterDistance?: boolean; rangedRange?: number;
    encounterDistance?: number; visibleDistance?: number; walkToRange?: boolean; individualEngagement?: boolean;
    pacedApproach?: boolean; holdRangedPosition?: boolean; marchingFormation?: boolean; rangedCasterFormation?: boolean;
    mobileSpearThrow?: boolean; pauseFormationDuringCast?: boolean; spearCastCamera?: boolean;
    unifiedMovement?: boolean; screenBoundCombat?: boolean; endlessSpawns?: EndlessSpawnSchedule;
    skill2EnabledAt?: (fighter: DuelFighter, at: number) => boolean | undefined;
  } = {}): DuelResult {
  const adventure = expedition || !!continuousSeconds;
  fighters = fighters.map((fighter, index) => {
    if (adventure && fighter.userId !== fighters[0]?.userId || !adventure && !sharedEncounterDistance) return { ...fighter };
    const slot = fighters.slice(0, index).filter(other => other.userId === fighter.userId).length;
    return { ...fighter, backRow: fighter.backRow ?? slot >= 3 };
  });
  const owners = [...new Set(fighters.map((fighter) => fighter.userId))];
  const validTeamCount = owners.length === 2 || (!!continuousSeconds && owners.length === 1);
  if (!validTeamCount || (!adventure && owners.some((id) => fighters.filter((fighter) => fighter.userId === id).length > 6))) throw new Error("Combat requires two teams. PvP allows up to six fighters per team.");
  const units = fighters.map((fighter, index) => {
    const team = owners.indexOf(fighter.userId);
    const count = fighters.filter((other) => other.userId === fighter.userId).length;
    const slot = fighters.slice(0, index).filter((other) => other.userId === fighter.userId).length;
    const offset = sharedEncounterDistance && !adventure
      ? encounterDistance / 2 + slot * 64
      : 540 - (count - 1 - slot) * 64;
    return { fighter, team, x: fighter.startX ?? 600 + (team === 0 ? -offset : offset), hp: Math.max(0, Math.min(fighter.stats.hp, fighter.hp ?? fighter.stats.hp)), mp: Math.max(0, Math.min(fighter.stats.mp, fighter.mp ?? fighter.stats.mp)),
    spawned: (fighter.spawnAt ?? 0) <= 0,
    next: (fighter.spawnAt ?? 0) + actionDuration(fighter.stats.speed), ready: [0, 0], stun: 0, freezeUntil: 0, enemyReady: 0, guardUntil: 0, shieldUntil: 0, buffs: [] as Buff[],
    cast: null as CombatContinuation["cast"],
    poison: null as { until: number; next: number; source: number } | null,
    bleed: 0, bleedNext: Infinity, bleedSource: 0 };
  });
  if (continuousSeconds) units.forEach(unit => {
    const saved = unit.fighter.combat;
    if (!saved) return;
    Object.assign(unit, saved, {
      ready: [...saved.ready],
      freezeUntil: saved.freezeUntil ?? 0,
      buffs: saved.buffs.map(buff => ({ ...buff })), cast: saved.cast ? { ...saved.cast } : null,
      poison: saved.poison ? { until: saved.poison.until, next: saved.poison.next, source: Math.max(0, fighters.findIndex(fighter => fighter.id === saved.poison!.sourceId)) } : null,
      bleedSource: Math.max(0, fighters.findIndex(fighter => fighter.id === saved.bleedSourceId)),
      bleedNext: saved.bleed ? saved.bleedNext : Infinity,
    });
  });
  const continuingFight = individualEngagement && !!continuousSeconds
    && units.some(unit => (pacedApproach || unit.team === 1) && unit.hp > 0 && unit.fighter.combat);
  if (adventure && !continuingFight) {
    const party = units.filter(unit => unit.team === 0);
    const first = party.findIndex(unit => unit.hp > 0);
    const front = Math.max(0, ...party.filter(unit => unit.hp > 0).map(unit => unit.x));
    party.forEach((unit, slot) => { if (unit.hp > 0) unit.x = front - (slot - first) * 64; });
    for (const unit of units) if (unit.team === 1 && (unit.fighter.spawnAt ?? 0) === 0) unit.x = Math.max(unit.x, front + PVP_MELEE_RANGE);
  }
  const initialPositions = units.map((unit) => unit.x);
  const initialStatusEnds = units.map(unit => activeStatusEnds(unit, 0));
  const steps: DuelStep[] = [];
  const timeLimit = continuousSeconds ?? (expedition ? Infinity : 180);
  let at = 0, manaAt = 1, moveAt = MOVE_TICK, spawnClock = 0;
  const activeSkill2 = (fighter: DuelFighter) => fighter.skill2Unlocked && (skill2EnabledAt?.(fighter, at) ?? fighter.skill2Enabled) !== false;
  const first = roll() < 0.5 ? 0 : 1;
  const alive = (team: number) => units.flatMap((unit, index) => unit.team === team && unit.hp > 0 && unit.spawned ? [index] : []);
  const formationEngaged = [0, 1].map(team => alive(1 - team).length > 0
    && alive(team).some(index => fighters[index].combat?.formationEngaged));
  const cameraTravel = [0, 0];
  const cameraOrigin = [0, 1].map(side => {
    const team = alive(side), facing = side === 0 ? 1 : -1;
    return team.map(index => fighters[index].combat?.cameraWorld).find(value => value !== undefined)
      ?? (team.length ? Math.max(...team.map(index => units[index].x * facing)) : 0);
  });
  const enemies = (index: number) => alive(1 - units[index].team).sort((a, b) => adventure && units[index].team === 1
    ? units[b].x - units[a].x || a - b
    : Math.abs(units[a].x - units[index].x) - Math.abs(units[b].x - units[index].x) || a - b);
  const allies = (index: number) => alive(units[index].team);
  const usesFormation = (index: number) => adventure ? units[index].team === 0 : sharedEncounterDistance;
  const protectedBackRow = (index: number) => usesFormation(index) && fighters[index].backRow && allies(index).some(other => !fighters[other].backRow);
  const basicRange = (index: number) => fighters[index].stats.range === "range" ? rangedRange : PVP_MELEE_RANGE;
  const rangedFormation = (index: number) => {
    const { stats, weapon } = fighters[index];
    return stats.range === "range" || (rangedCasterFormation && (weapon === "staff" || weapon === "ice-staff"));
  };
  const skillRange = (skill: SkillDefinition) => rangedSkills.has(skill.id) ? rangedRange : PVP_MELEE_RANGE;
  const moveDistance = PVP_WALK_SPEED * MOVE_TICK;
  const canMove = (unit: typeof units[number]) => unit.hp > 0 && unit.spawned && unit.stun <= at + 1e-8
    && (!unit.cast || (mobileSpearThrow && unit.cast.skill.id === "throw-spear"));
  function savingSkill2Mana(index: number, skill: SkillDefinition | undefined, enabled: boolean | undefined) {
    const unit = units[index];
    return savesManaForSkill2(skill, enabled, unit.mp, unit.fighter.stats.mp, unit.hp, unit.ready[1], at)
      && !!skill && eligible(index, skill);
  }
  function movementReach(index: number) {
    const unit = units[index], native = unit.fighter.enemy, area = native?.burnAll ?? native?.slashAll;
    let reach = basicRange(index);
    const nativeReady = at + 1e-8 >= unit.enemyReady;
    if (((!unifiedMovement || nativeReady) && ((native?.bubbleBeam && unit.mp >= native.bubbleBeam.mana)
      || (native?.skill?.kind === "shot" && unit.mp >= native.skill.mana)))
      || (area && nativeReady && unit.mp >= area.mana)) reach = Math.max(reach, rangedRange);
    const definitions = unit.fighter.weapon ? skills[unit.fighter.weapon] : [];
    const skill2Enabled = activeSkill2(unit.fighter);
    const savingMana = individualEngagement && savingSkill2Mana(index, definitions[1], skill2Enabled);
    for (const slot of [0, 1]) {
      const skill = definitions[slot];
      if (!skill || skill.passive || !rangedSkills.has(skill.id) || at < unit.ready[slot] || unit.mp < skill.mpCost || unit.hp <= skill.hpCost) continue;
      if (slot === 1 ? !skill2Enabled : savingMana && skill.mpCost > 0) continue;
      if (unifiedMovement || !individualEngagement || eligible(index, skill)) reach = Math.max(reach, skillRange(skill));
    }
    return reach;
  }
  const inRange = (actor: number, target: number, range: number) => {
    // Adventure front-row melee units share contact with the leading enemy;
    // they fight from their formation instead of overtaking their teammates.
    const direction = units[actor].team === 0 ? 1 : -1;
    const formationReach = !individualEngagement && usesFormation(actor) && range === PVP_MELEE_RANGE
      ? Math.max(0, ...allies(actor).map(index => (units[index].x - units[actor].x) * direction)) : 0;
    return Math.abs(units[actor].x - units[target].x) <= range + formationReach + 1e-5;
  };
  const supportTargets = (actor: number) => allies(actor).filter(target => !screenBoundCombat || inRange(actor, target, rangedRange));
  const stats = (index: number) => {
    const value = { ...units[index].fighter.stats };
    if (at < units[index].guardUntil) value.def += 10;
    for (const buff of units[index].buffs) {
      if (buff.kind === "attack" || buff.kind === "hero") value.atk += buff.amount;
      if (buff.kind === "hero") value.def += buff.amount;
      if (buff.kind === "speed" || buff.kind === "burst") value.speed += buff.amount;
    }
    return value;
  };
  function activeStatusEnds(unit: typeof units[number], time: number): CombatStatusEnds | null {
    if (!unit.spawned || unit.hp <= 0) return null;
    const ends: CombatStatusEnds = {};
    if (unit.poison && unit.poison.until > time) ends.poison = unit.poison.until;
    if (unit.bleed > 0) ends.bleed = null;
    if (unit.freezeUntil > time) ends.freeze = unit.freezeUntil;
    if (unit.stun > Math.max(time, unit.freezeUntil)) ends.stun = unit.stun;
    if (unit.guardUntil > time) ends.guard = unit.guardUntil;
    if (unit.shieldUntil > time) ends.shield = unit.shieldUntil;
    for (const buff of unit.buffs) {
      if (buff.until > time) ends[buff.kind] = Math.max(ends[buff.kind] ?? 0, buff.until);
    }
    return Object.keys(ends).length ? ends : null;
  }
  function emit(actor: number, kind: DuelStep["kind"], label: string, damage = 0, healing = 0, critical = false, targets: number[] = []) {
    const spearCasting = spearCastCamera ? units.flatMap((unit, index) => unit.hp > 0 && unit.cast?.skill.id === "throw-spear" ? [index] : []) : [];
    // Bits follow the status atlas order: poison, bleed, stun, guard, buff.
    const statuses = unifiedMovement ? units.map(unit => unit.hp <= 0 ? 0 :
      Number((unit.poison?.until ?? 0) > at) | (Number(unit.bleed > 0) << 1) | (Number(unit.stun > at) << 2)
      | (Number(unit.guardUntil > at || unit.shieldUntil > at) << 3) | (Number(unit.buffs.some(buff => buff.until > at)) << 4)) : [];
    const statusEnds = units.map(unit => activeStatusEnds(unit, at));
    if (unifiedMovement && ["attack", "cast", "skill"].includes(kind)) formationEngaged[units[actor].team] = true;
    steps.push({ at, side: units[actor].team, actor, targets, kind, label, damage, healing, critical,
      hp: units.map((unit) => unit.hp), mp: units.map((unit) => unit.mp), x: units.map((unit) => unit.x),
      ...(spearCasting.length ? { spearCasting } : {}),
      ...(statuses.some(Boolean) ? { statuses } : {}),
      ...(statusEnds.some(Boolean) ? { statusEnds } : {}),
      ...(unifiedMovement ? { cameraTravel: [...cameraTravel], cameraWorld: cameraOrigin.map((origin, side) => origin + cameraTravel[side]),
        ...(kind === "cast" ? { castEndsAt: units[actor].cast?.ends } : {}) } : {}),
      ...(expedition ? { teamCasting: units.filter(unit => unit.team === 0).map(({ cast }) => cast
        ? { name: cast.skill.name, startedAt: cast.starts ?? at, endsAt: cast.ends } : null) } : {}) });
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
  function strike(actor: number, target: number, raw: number, magical: boolean, kind: DuelStep["kind"], label: string,
    critical = false, counter = false, onHit?: () => void) {
    const victim = units[target];
    if (units[actor].hp <= 0 || victim.hp <= 0) return;
    const blockChance = victim.fighter.weapon === "sword-and-shield" ? skillValue("block", "chance") : victim.fighter.enemy?.blockChance ?? 0;
    if (blockChance > 0 && roll() < blockChance) {
      emit(target, "block", "Block", 0, 0, false, [target]);
      if (!counter && victim.fighter.weapon === "sword-and-shield" && victim.fighter.skill2Unlocked && roll() < skillValue("counter", "chance")) basic(target, true, actor);
      return;
    }
    const damage = Math.max(1, raw - (magical ? stats(target).magicDef : stats(target).def)) * (critical ? skillValue("critical", "multiplier") : 1);
    victim.hp = Math.max(0, victim.hp - damage);
    if (!victim.hp) victim.cast = null;
    else onHit?.();
    emit(actor, kind, label, damage, 0, critical, [target]);
    if (victim.hp > 0 && at < victim.shieldUntil) {
      const before = victim.hp; victim.hp = Math.min(victim.fighter.stats.hp, victim.hp + 5);
      emit(target, "heal", "Restorative Shield", 0, victim.hp - before, false, [target]);
    }
  }
  function basic(actor: number, counter = false, counterTarget?: number) {
    if (!individualEngagement && protectedBackRow(actor) && fighters[actor].stats.range !== "range") return;
    const targets = (counterTarget === undefined ? enemies(actor) : [counterTarget]).filter((target) => inRange(actor, target, basicRange(actor))).slice(0, units[actor].fighter.weapon === "glaive" ? 2 : 1);
    for (const target of targets) {
      const current = stats(actor), defender = stats(target);
      const magical = current.magic - defender.magicDef > current.atk - defender.def;
      const victim = units[target];
      strike(actor, target, magical ? current.magic : current.atk, magical, counter ? "counter" : "attack",
        counter ? "Counterattack" : "Attack", false, counter, () => {
          if (units[actor].fighter.weapon === "bow") {
            if (victim.poison) { victim.poison.until = at + skillValue("poison", "duration"); victim.poison.source = actor; }
            else victim.poison = { until: at + skillValue("poison", "duration"), next: at + 1, source: actor };
          }
          if (units[actor].fighter.weapon === "dual-axe") {
            if (!victim.bleed) victim.bleedNext = at + 1;
            victim.bleed += 1; victim.bleedSource = actor;
          }
        });
    }
  }
  const buffKind = (id: string): Buff["kind"] | null => id === "attack-buff" ? "attack" : id === "speed-buff" ? "speed" : id === "hero" ? "hero" : ["burst-fire", "axe-frenzy"].includes(id) ? "burst" : null;
  function buffTargets(actor: number, skill: SkillDefinition) {
    const kind = buffKind(skill.id);
    return (kind === "attack" || kind === "speed" ? supportTargets(actor) : [actor]).filter((index) => !units[index].buffs.some((entry) => entry.kind === kind));
  }
  function eligible(actor: number, skill: SkillDefinition) {
    if (skill.id === "heal" || skill.id === "mass-heal") return supportTargets(actor).some((index) => units[index].hp < fighters[index].stats.hp);
    if (buffKind(skill.id)) return buffTargets(actor, skill).length > 0;
    if (!individualEngagement && protectedBackRow(actor) && !rangedSkills.has(skill.id)) return false;
    return enemies(actor).some((index) => inRange(actor, index, skillRange(skill)) && (skill.id !== "shackle" || units[index].stun <= at));
  }
  function finish(actor: number) {
    const unit = units[actor], casting = unit.cast!, skill = casting.skill;
    unit.cast = null; unit.ready[casting.slot] = at + skill.cooldown;
    if (skill.id === "heal" || skill.id === "mass-heal") {
      const nearbyAllies = supportTargets(actor);
      const targets = skill.id === "mass-heal" ? nearbyAllies : nearbyAllies.filter((index) => units[index].hp < fighters[index].stats.hp).sort((a, b) => units[a].hp - units[b].hp).slice(0, 1);
      for (const target of targets) {
        const before = units[target].hp;
        units[target].hp = Math.min(fighters[target].stats.hp, before + skill.power!);
        emit(actor, "heal", skill.name, 0, units[target].hp - before, false, [target]);
      }
    } else if (buffKind(skill.id)) {
      const kind = buffKind(skill.id)!, candidates = buffTargets(actor, skill);
      if (candidates.length) {
        const target = candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))];
        buff(target, { kind, amount: skill.power!, until: at + skill.duration! });
        emit(actor, "buff", skill.name, 0, 0, false, [target]);
      }
    } else if (skill.id === "shackle") {
      const target = enemies(actor).find((index) => inRange(actor, index, skillRange(skill)) && units[index].stun <= at);
      if (target !== undefined) { units[target].stun = Math.max(units[target].stun, at + skill.duration!); emit(actor, "skill", `Shackle · Stun ${skill.duration}s`, 0, 0, false, [target]); }
    } else if (skill.damage) {
      const critical = unit.fighter.weapon === "rifle" && !!unit.fighter.skill2Unlocked && roll() < skillValue("critical", "chance");
      const hit = (target: number) => {
        strike(actor, target, skill.damage!.base + stats(actor)[skill.damage!.stat], skill.damage!.stat === "magic", "skill", skill.name, critical, false, () => {
          if (["freeze", "freeze-all"].includes(skill.id)) {
            const victim = units[target];
            victim.freezeUntil = Math.max(victim.freezeUntil, at + skill.duration!);
            victim.stun = Math.max(victim.stun, victim.freezeUntil);
          }
        });
      };
      if (skill.id === "bouncing-glaive") {
        let target = enemies(actor).find((index) => inRange(actor, index, skillRange(skill)));
        for (let bounce = 0; bounce <= skill.bounces! && target !== undefined && unit.hp > 0; bounce++) {
          hit(target);
          target = enemies(actor).find((index) => index !== target && (!screenBoundCombat || inRange(actor, index, skillRange(skill))));
        }
      } else {
        const primary = enemies(actor).find((index) => inRange(actor, index, skillRange(skill)));
        if (primary !== undefined) for (const target of ["inferno", "freeze-all"].includes(skill.id) ? enemies(actor) : [primary]) {
          if (!screenBoundCombat || inRange(actor, target, skillRange(skill))) hit(target);
        }
      }
    }
    unit.next = at + actionDuration(stats(actor).speed);
  }
  function enemyAction(actor: number) {
    const unit = units[actor], enemy = unit.fighter.enemy;
    if (!enemy) return false;
    const skill = enemy.skill;
    if (skill && at >= unit.enemyReady && unit.mp >= skill.mana) {
      const targets = skill.kind === "heal-self" ? [actor].filter(i => units[i].hp < fighters[i].stats.hp) : skill.kind === "heal-all" ? supportTargets(actor).filter(i => fighters[i].enemy?.fishpeople && units[i].hp < fighters[i].stats.hp) : [];
      const rangedTargets = enemies(actor).filter(i => inRange(actor, i, rangedRange));
      const canUse = skill.kind === "shot" ? rangedTargets.length > 0 : skill.kind.startsWith("heal") ? targets.length > 0 : skill.kind === "summon" ? allies(actor).length < 6 && fighters.filter(f => f.userId === unit.fighter.userId).length < 24 : true;
      if (canUse) {
        unit.mp -= skill.mana; unit.enemyReady = at + skill.cooldown;
        if (skill.kind === "guard" || skill.kind === "shield") {
          if (skill.kind === "guard") unit.guardUntil = at + (skill.duration ?? 2); else unit.shieldUntil = at + (skill.duration ?? 5);
          emit(actor, "buff", skill.name, 0, 0, false, [actor]);
        } else if (skill.kind.startsWith("heal")) {
          for (const target of targets) { const before = units[target].hp; units[target].hp = Math.min(fighters[target].stats.hp, before + 50); emit(actor, "heal", skill.name, 0, units[target].hp - before, false, [target]); }
        } else if (skill.kind === "summon") {
          const stats = structuredClone(enemyCatalog["fishpeople-knight"].stats), index = fighters.length;
          const fighter: DuelFighter = { id: `summon-${index}`, userId: unit.fighter.userId, name: "Summoned Knight", enemyType: "fishpeople-knight", enemy: stats, stats, spawnAt: at };
          const behind = unit.x + (unit.team === 0 ? -50 : 50);
          const x = unifiedMovement ? behind : Math.max(30, Math.min(1170, behind));
          fighters.push(fighter); initialPositions.push(x);
          units.push({ ...unit, fighter, hp: stats.hp, mp: stats.mp, x, next: at + actionDuration(stats.speed), ready: [0, 0], stun: 0, freezeUntil: 0, enemyReady: 0, guardUntil: 0, shieldUntil: 0, buffs: [], cast: null, poison: null, bleed: 0, bleedNext: Infinity, bleedSource: 0 });
          emit(actor, "skill", skill.name, 0, 0, false, [index]);
        } else {
          const target = skill.farthest ? rangedTargets.at(-1)! : rangedTargets[0];
          strike(actor, target, skill.damage ?? 0, !!skill.magic, "skill", skill.name);
        }
        unit.next = at + actionDuration(stats(actor).speed); return true;
      }
    }
    const area = enemy.burnAll ?? enemy.slashAll, beam = enemy.bubbleBeam;
    if (area && at + 1e-8 >= unit.enemyReady && unit.mp >= area.mana && enemies(actor).some(i => inRange(actor, i, rangedRange))) {
      unit.mp -= area.mana;
      unit.enemyReady = at + (area.cooldown ?? DEFAULT_ENEMY_AREA_COOLDOWN);
      for (const target of enemies(actor)) if (!screenBoundCombat || inRange(actor, target, rangedRange)) {
        strike(actor, target, area.damage, !!enemy.burnAll, "skill", enemy.burnAll ? "Burn All" : "Slash All");
      }
      unit.next = at + actionDuration(stats(actor).speed); return true;
    }
    if (beam && unit.mp >= beam.mana && at >= unit.enemyReady) {
      const target = enemies(actor).find(i => inRange(actor, i, rangedRange));
      if (target !== undefined) { unit.mp -= beam.mana; unit.enemyReady = at + beam.cooldown; strike(actor, target, beam.damage, true, "skill", "Bubble Beam"); unit.next = at + actionDuration(stats(actor).speed); return true; }
    }
    return false;
  }
  for (let event = 0; event < 50000 && alive(0).length && (continuousSeconds || alive(1).length
    || expedition && units.some(unit => unit.team === 1 && unit.hp > 0 && !unit.spawned)); event++) {
    // Keep the rolled interval on a separate clock so only the empty portion runs faster.
    const spawnFactor = endlessSpawns && !alive(1).length ? EMPTY_BATTLEFIELD_SPAWN_FACTOR : 1;
    const events = [{ at: manaAt, type: "mana", index: 0, priority: -4 }, { at: moveAt, type: "move", index: 0, priority: -1 },
      ...units.flatMap((unit, index) => unit.hp <= 0 ? [] : !unit.spawned ? [{
        at: endlessSpawns ? at + (unit.fighter.spawnAt! > spawnClock + 1e-8 ? (unit.fighter.spawnAt! - spawnClock) * spawnFactor : 0) : unit.fighter.spawnAt!,
        type: "spawn", index, priority: -5,
      }] : [
        { at: Math.max(unit.cast?.ends ?? unit.next, unit.stun), type: "unit", index, priority: unit.team === first ? 0 : 1 },
        ...(unit.poison && unit.poison.next <= unit.poison.until + 1e-8 ? [{ at: unit.poison.next, type: "poison", index, priority: -3 }] : []),
        ...(unit.bleed ? [{ at: unit.bleedNext, type: "bleed", index, priority: -3 }] : []),
        ...unit.buffs.map((entry) => ({ at: entry.until, type: "expiry", index, priority: -2 })),
      ]),
    ].sort((a, b) => a.at - b.at || a.priority - b.priority);
    const next = events[0];
    if (endlessSpawns) spawnClock += Math.max(0, Math.min(next.at, timeLimit) - at) / spawnFactor;
    if (next.at > timeLimit) { at = timeLimit; break; }
    at = next.at;
    if (next.type === "spawn") {
      const arriving = units[next.index];
      if (marchingFormation && !alive(arriving.team).length) formationEngaged[1 - arriving.team] = false;
      arriving.spawned = true;
      if (endlessSpawns && arriving.fighter.enemyType) {
        const stats = endlessDistanceStats(enemyCatalog[arriving.fighter.enemyType].stats,
          endlessSpawns.distance + at * ENDLESS_METERS_PER_SECOND, endlessSpawns.statMultiplier);
        Object.assign(arriving.fighter, { enemy: stats, stats, spawnAt: at });
        Object.assign(arriving, { hp: stats.hp, mp: stats.mp, next: at + actionDuration(stats.speed) });
      }
      if (adventure && arriving.team === 1) {
        // Spawn relative to the travelling party, not its position at the
        // beginning of the checkpoint (which can now be behind the party).
        arriving.x = Math.max(...alive(0).map(index => units[index].x))
          + (sharedEncounterDistance ? encounterDistance : 800) + (arriving.fighter.spawnOffset ?? 0);
      }
      emit(next.index, "spawn", "Enemy approaches"); continue;
    }
    if (next.type === "move") {
      moveAt += MOVE_TICK;
      if (unifiedMovement) {
        const teams = [alive(0), alive(1)];
        const inSight = teams[0].some(index => teams[1].some(target => inRange(index, target, visibleDistance)));
        const reaches = units.map((unit, index) => unit.hp > 0 && unit.spawned ? movementReach(index) : 0);
        let moved = false;
        const destinations = units.map((unit, index) => {
          if (!canMove(unit)) return unit.x;
          const lookingForEnemies = screenBoundCombat && adventure && unit.team === 0 && !inSight;
          const target = lookingForEnemies ? undefined : enemies(index)[0];
          const stride = unit.fighter.enemy ? ENEMY_WALK_SPEED * MOVE_TICK : moveDistance;
          if (target !== undefined) {
            const gap = units[target].x - unit.x;
            const remaining = Math.max(0, Math.abs(gap) - reaches[index]);
            return unit.x + Math.sign(gap) * Math.min(stride, remaining);
          }
          if (!adventure || unit.team !== 0) return unit.x;
          const lead = teams[0][0];
          const formationX = units[lead].x - (index - lead) * 64;
          const correction = Math.max(-stride / 2, Math.min(stride / 2, formationX - unit.x));
          return unit.x + stride + correction;
        });
        teams.forEach((team, side) => {
          const opposing = teams[1 - side];
          if (!opposing.length || (screenBoundCombat && !inSight)) formationEngaged[side] = false;
          else if (team.some(index => opposing.some(target => inRange(index, target, reaches[index])))) formationEngaged[side] = true;
          if (formationEngaged[side] || !team.length) return;
          const direction = side === 0 ? 1 : -1;
          const before = Math.max(...team.map(index => units[index].x * direction));
          const after = Math.max(...team.map(index => destinations[index] * direction));
          const camera = cameraOrigin[side] + cameraTravel[side];
          const stride = Math.max(0, after - before);
          const catchUp = Math.min(stride / 2, Math.max(0, after - camera - stride));
          cameraTravel[side] += stride + catchUp;
        });
        units.forEach((unit, index) => {
          moved ||= destinations[index] !== unit.x;
          unit.x = destinations[index];
        });
        if (moved) emit(alive(0)[0], "move", "Advancing");
        continue;
      }
      let moved = false;
      const paused = pauseFormationDuringCast ? [0, 1].map(team => alive(team).some(index => units[index].cast)) : [];
      const party = !individualEngagement && (legacyRules ? expedition : adventure) ? alive(0) : [];
      const front = party.reduce((lead, index) => lead === undefined || units[index].x > units[lead].x ? index : lead, undefined as number | undefined);
      const nearest = front === undefined ? undefined : enemies(front)[0];
      let advance = 0;
      if (front !== undefined && nearest !== undefined && party.every(index => !units[index].cast && units[index].stun <= at + 1e-8)) {
        if (walkToRange) {
          const remaining = party.flatMap(index => {
            const reach = movementReach(index);
            if (reach === PVP_MELEE_RANGE && protectedBackRow(index)) return [];
            return [Math.max(0, Math.abs(units[nearest].x - units[index].x) - reach)];
          });
          advance = Math.min(moveDistance, ...remaining);
        } else if (fighters[nearest].stats.range === "range" && party.some(index => fighters[index].stats.range !== "range" && !protectedBackRow(index))) {
          advance = Math.min(moveDistance, Math.max(0, units[nearest].x - units[front].x - PVP_MELEE_RANGE));
        }
      }
      const travelling = adventure && !alive(1).length && (marchingFormation || !alive(0).some(index => units[index].cast || units[index].stun > at + 1e-8));
      const regroup = pacedApproach && travelling ? alive(0) : [];
      const lead = regroup[0];
      const anchor = (holdRangedPosition ? regroup.find(rangedFormation) : undefined) ?? lead;
      const formationX = (index: number) => units[anchor].x - (index - anchor) * 64;
      const regrouping = anchor !== undefined && regroup.some(index => Math.abs(units[index].x - formationX(index)) > 1e-5);
      const hasMelee = !adventure && holdRangedPosition && units.some((unit, index) =>
        unit.spawned && unit.hp > 0 && !rangedFormation(index) && !protectedBackRow(index));
      const march = marchingFormation && (adventure || hasMelee) ? [0, 1].map(team => {
        if (adventure && team === 1) return undefined;
        if (!alive(1 - team).length) { formationEngaged[team] = false; return undefined; }
        if (formationEngaged[team]) return undefined;
        const ranged = alive(team).filter(index => !fighters[index].enemy && rangedFormation(index));
        if (!ranged.length) return undefined;
        const gap = Math.min(...ranged.map(index => Math.abs(units[enemies(index)[0]].x - units[index].x)));
        const remaining = gap - Math.min(rangedRange, visibleDistance);
        if (remaining <= 1e-5) { formationEngaged[team] = true; return undefined; }
        return (team === 0 ? 1 : -1) * Math.min(moveDistance, remaining);
      }) : [];
      // Ranged-only duels still need a way to close the opening gap.
      const holdsPosition = (index: number) => holdRangedPosition && rangedFormation(index)
        && !fighters[index].enemy && (marchingFormation
          ? (adventure || hasMelee) && formationEngaged[units[index].team]
          : adventure ? units[index].team === 0 : hasMelee);
      // Apply both teams' travel from the same frame so the host gets no movement head start.
      const destinations = units.map((unit, index) => {
        if (paused[unit.team] || !canMove(unit)) return unit.x;
        if (adventure && unit.team === 0) {
          if (advance > 1e-7) { moved = true; return unit.x + advance; }
          if (travelling) {
            const distance = regrouping ? formationX(index) - unit.x : moveDistance;
            // Keep marching while separated members adjust their pace to close formation.
            const travel = marchingFormation && regrouping
              ? moveDistance + Math.max(-moveDistance / 2, Math.min(moveDistance / 2, distance))
              : Math.sign(distance) * Math.min(moveDistance, Math.abs(distance));
            if (travel) moved = true;
            return unit.x + travel;
          }
          if (!individualEngagement) return unit.x;
        }
        const target = enemies(index)[0];
        const marchStep = march[unit.team];
        if (marchStep !== undefined && !unit.fighter.enemy) { moved = true; return unit.x + marchStep; }
        if (target === undefined || holdsPosition(index)) return unit.x;
        if (protectedBackRow(index) && !rangedFormation(index)) return unit.x;
        const distance = units[target].x - unit.x;
        const stepDistance = pacedApproach && (unit.fighter.enemy || (adventure && unit.team === 1)) ? ENEMY_WALK_SPEED * MOVE_TICK : moveDistance;
        const reach = holdRangedPosition && !unit.fighter.enemy && (!adventure || unit.team === 0)
          ? rangedFormation(index) ? rangedRange : PVP_MELEE_RANGE
          : movementReach(index);
        const travel = Math.min(stepDistance, Math.max(0, Math.abs(distance) - reach) / (adventure || individualEngagement ? 1 : 2));
        if (travel > 1e-7) moved = true;
        return unit.x + Math.sign(distance) * travel;
      });
      if (walkToRange && (!adventure || individualEngagement)) {
        // Protected back slots follow the front when their own movement has stopped.
        const frontTravel = [0, 1].map(team => {
          const direction = team === 0 ? 1 : -1;
          return direction * Math.max(0, ...alive(team).filter(index => !fighters[index].backRow)
            .map(index => (destinations[index] - units[index].x) * direction));
        });
        units.forEach((unit, index) => {
          if (paused[unit.team] || !canMove(unit) || destinations[index] !== unit.x || !protectedBackRow(index) || holdsPosition(index)) return;
          const target = enemies(index)[0];
          const reach = mobileSpearThrow && unit.fighter.weapon === "spear" ? basicRange(index) : movementReach(index);
          if (target !== undefined && !inRange(index, target, reach)) destinations[index] += frontTravel[unit.team];
        });
      }
      units.forEach((unit, index) => { unit.x = destinations[index]; });
      if (moved) emit(alive(0)[0], "move", "Advancing");
      continue;
    }
    if (next.type === "mana") {
      manaAt += 1;
      units.forEach(unit => {
        if (unit.hp <= 0 || unit.fighter.enemy || (unifiedMovement && !unit.spawned)) return;
        const restored = legacyRules ? (adventure && unit.team === 0 && unit.fighter.backRow ? 10 : 5) : MANA_REGEN_PER_SECOND;
        unit.mp = Math.min(unit.fighter.stats.mp, unit.mp + restored);
      });
      emit(0, "mana", "Mana regeneration"); continue;
    }
    if (next.type === "expiry") { buff(next.index); emit(next.index, "buff", "Buff expired"); continue; }
    const unit = units[next.index];
    if (next.type === "poison" || next.type === "bleed") {
      const damage = next.type === "poison" ? skillValue("poison", "power") : unit.bleed * skillValue("bleed", "power");
      unit.hp = Math.max(0, unit.hp - damage);
      if (!unit.hp) unit.cast = null;
      emit(next.type === "poison" ? unit.poison!.source : unit.bleedSource, next.type, next.type === "poison" ? "Poison" : `Bleed · ${unit.bleed} stacks`, damage, 0, false, [next.index]);
      if (next.type === "poison") { unit.poison!.next += 1; if (unit.poison!.next > unit.poison!.until + 1e-8) unit.poison = null; }
      else unit.bleedNext += 1;
      continue;
    }
    if (unit.cast) {
      const before = steps.length, isSpearThrow = unit.cast.skill.id === "throw-spear";
      finish(next.index);
      if ((unifiedMovement || pauseFormationDuringCast || spearCastCamera && isSpearThrow) && before === steps.length) emit(next.index, "move", "Cast ended");
      continue;
    }
    if (Number.isFinite(visibleDistance) && !enemies(next.index).some(target => inRange(next.index, target, visibleDistance))) {
      unit.next = moveAt;
      continue;
    }
    if (enemyAction(next.index)) continue;
    const definitions = unit.fighter.weapon ? skills[unit.fighter.weapon] : [];
    const skill2 = definitions[1];
    const skill2Enabled = activeSkill2(unit.fighter);
    const savingMana = savesManaForSkill2(skill2, skill2Enabled, unit.mp, unit.fighter.stats.mp, unit.hp, unit.ready[1], at)
      && !!skill2 && eligible(next.index, skill2);
    let cast = false;
    for (const slot of [1, 0] as const) {
      const skill = definitions[slot];
      if (slot === 0 && skill?.mpCost && savingMana) continue;
      if (!skill || skill.passive || (slot === 1 && !skill2Enabled) || at < unit.ready[slot] || unit.mp < skill.mpCost || unit.hp <= skill.hpCost || !eligible(next.index, skill)) continue;
      unit.mp -= skill.mpCost; unit.hp -= skill.hpCost;
      unit.cast = { skill, slot, ends: at + spellCastTime(stats(next.index).speed, skill.baseCastTime), ...(expedition ? { starts: at } : {}) };
      emit(next.index, "cast", `Casting ${skill.name}`); cast = true; break;
    }
    if (!cast) {
      if (!enemies(next.index).some((target) => inRange(next.index, target, basicRange(next.index)))) {
        // Movement runs first on ties, so retry just after positions update.
        unit.next = moveAt;
        continue;
      }
      basic(next.index);
      if (["dual-gun", "dual-knife"].includes(unit.fighter.weapon ?? "") && unit.hp > 0 && enemies(next.index).length && roll() < skillValue("double-attack", "chance")) basic(next.index);
      unit.next = at + actionDuration(stats(next.index).speed);
    }
  }
  const winner = alive(0).length && !alive(1).length ? 0 : alive(1).length && !alive(0).length ? 1 : -1;
  if (continuousSeconds) emit(0, "move", "Travelling");
  const continuation = continuousSeconds ? units.filter(unit => (unit.team === 0 || unit.hp > 0) && unit.spawned).map(unit => ({
    ...unit.fighter, spawnAt: 0, startX: unit.x, hp: unit.hp, mp: unit.mp,
    combat: { next: Math.max(0, unit.next - at), ready: unit.ready.map(value => Math.max(0, value - at)), stun: Math.max(0, unit.stun - at),
      ...(unit.freezeUntil > at ? { freezeUntil: unit.freezeUntil - at } : {}),
      enemyReady: Math.max(0, unit.enemyReady - at), guardUntil: Math.max(0, unit.guardUntil - at), shieldUntil: Math.max(0, unit.shieldUntil - at),
      buffs: unit.buffs.filter(buff => buff.until > at).map(buff => ({ ...buff, until: buff.until - at })),
      cast: unit.cast ? { ...unit.cast, ends: Math.max(0, unit.cast.ends - at) } : null,
      poison: unit.poison ? { until: unit.poison.until - at, next: unit.poison.next - at, sourceId: fighters[unit.poison.source].id } : null,
      bleed: unit.bleed, bleedNext: unit.bleed ? Math.max(0, unit.bleedNext - at) : 0, bleedSourceId: fighters[unit.bleedSource]?.id,
      ...(marchingFormation && formationEngaged[unit.team] && alive(1 - unit.team).length ? { formationEngaged: true } : {}),
      ...(unifiedMovement ? { cameraWorld: cameraOrigin[unit.team] + cameraTravel[unit.team] } : {}),
    },
  })) : undefined;
  const nextSpawnIn = endlessSpawns && Math.max(0, Math.min(endlessSpawns.scheduleEnd,
    ...units.filter(unit => !unit.spawned).map(unit => unit.fighter.spawnAt!)) - spawnClock);
  return { fighters: fighters.map((fighter, index) => ({ ...fighter, startX: initialPositions[index], statusEnds: initialStatusEnds[index] ?? undefined })), steps, duration: at, winnerId: winner < 0 ? null : owners[winner],
    ...(continuation ? { continuation } : {}), ...(nextSpawnIn === undefined ? {} : { nextSpawnIn }) };
}
