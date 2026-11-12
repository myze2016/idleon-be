import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateBattle, type Fighter } from "../src/services/battle.service.js";
import { baseStats, type CharacterStats } from "../src/models/character-stats.js";
import type { WeaponType } from "../src/models/character.js";
import { skills } from "../src/models/skills.js";

const enemy: CharacterStats = { hp: 1000, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" };
function member(weapon: WeaponType, unlocked = false, overrides: Partial<CharacterStats> = {}): Fighter {
  return { id: weapon, weapon, skill2Unlocked: unlocked, stats: { ...baseStats[weapon], ...overrides } };
}
const never = () => 0.99, always = () => 0;

test("active damage adds the current relevant stat before defense and criticals, including buffs", () => {
  const rifle = simulateBattle([member("rifle", true, { hp: 1000, atk: 30, magic: 99 })], { ...enemy, def: 7, magicDef: 50 }, always);
  assert.equal(rifle.steps.find((step) => step.label === "Long Shot")?.damage, 126);
  const staff = simulateBattle([member("staff", false, { hp: 1000, atk: 99, magic: 45 })], { ...enemy, def: 70, magicDef: 12 }, never);
  assert.equal(staff.steps.find((step) => step.label === "Fireball")?.damage, 53);
  const hero = simulateBattle([member("great-sword", true, { hp: 1000 })], enemy, never);
  assert.equal(hero.steps.find((step) => step.label === "Slash")?.damage, 60);
  const bow = simulateBattle([member("bow", true, { hp: 1000, atk: 99 })], enemy, never);
  assert.equal(bow.steps.find((step) => step.label?.startsWith("Shackle ·"))?.damage, 0);
  assert.ok(bow.steps.filter((step) => step.kind === "poison").every((step) => step.damage === 5));
  for (const definitions of Object.values(skills)) for (const skill of definitions) {
    if (skill.passive || ["heal", "mass-heal", "attack-buff", "speed-buff", "hero", "burst-fire", "shackle"].includes(skill.id)) assert.equal(skill.damage, undefined);
    if (skill.damage) assert.ok(skill.description.includes(skill.damage.stat === "atk" ? "+ current ATK" : "+ current Magic"));
  }
});

test("shield blocks and unlocked counters use independent proc rolls", () => {
  const locked = simulateBattle([member("sword-and-shield")], { ...enemy, hp: 100 }, always);
  assert.ok(locked.steps.some((step) => step.kind === "block" && step.damage === 0));
  assert.equal(locked.steps.some((step) => step.kind === "counter"), false);
  const unlocked = simulateBattle([member("sword-and-shield", true)], { ...enemy, hp: 100 }, always);
  assert.ok(unlocked.steps.some((step) => step.kind === "counter" && step.damage === 10));
  const missed = simulateBattle([member("sword-and-shield", true)], { ...enemy, hp: 100 }, never);
  assert.equal(missed.steps.some((step) => step.kind === "block"), false);
});

test("poison deals exactly five 5-HP ticks after one application even if its source dies", () => {
  const tank: Fighter = { id: "tank", stats: { ...baseStats["sword-and-shield"], hp: 1000, atk: 0, magic: 0, def: 100 } };
  const battle = simulateBattle([member("bow", false, { hp: 1 }), tank], { ...enemy, hp: 200 }, never);
  const ticks = battle.steps.filter((step) => step.kind === "poison");
  assert.equal(ticks.length, 5);
  assert.ok(ticks.every((step) => step.damage === 5));
  for (let i = 1; i < ticks.length; i++) assert.ok(Math.abs(ticks[i].at - ticks[i - 1].at - 1) < 1e-8);
});

test("Shackle costs 25 MP and prevents enemy attacks for one second", () => {
  const battle = simulateBattle([member("bow", true, { hp: 1000 })], enemy, never);
  const cast = battle.steps.find((step) => step.kind === "cast" && step.label === "Casting Shackle")!;
  assert.equal(cast.teamMp?.[0], 75);
  const stun = battle.steps.find((step) => step.label === "Shackle · Stun 1s")!;
  assert.ok(stun);
  assert.equal(battle.steps.some((step) => step.actor === "enemy" && step.at > stun.at && step.at < stun.at + 1), false);
  assert.equal(simulateBattle([member("bow")], enemy, never).steps.some((step) => step.label?.includes("Shackle")), false);
});

test("Wand heals the wounded ally, caps HP, and Mass Heal is free and targets all living allies", () => {
  const ally: Fighter = { id: "ally", stats: { ...baseStats.bow, hp: 100, speed: 0 } };
  const heal = simulateBattle([ally, member("wand")], { ...enemy, atk: 40 }, never);
  const restored = heal.steps.find((step) => step.kind === "heal")!;
  assert.equal(restored.label, "Heal"); assert.equal(restored.healing, 30);
  assert.deepEqual(restored.targetIds, ["ally"]);
  assert.equal(heal.steps.find((step) => step.label === "Casting Heal")?.teamMp?.[1], 125);
  assert.ok(heal.steps.every((step) => step.teamHp[0] <= 100 && step.teamHp[1] <= 50));
  const mass = simulateBattle([ally, member("wand", true)], { ...enemy, atk: 40 }, never);
  const all = mass.steps.find((step) => step.label === "Mass Heal")!;
  assert.equal(all.healing, 20); assert.deepEqual(all.targetIds, ["ally", "wand"]);
  assert.equal(mass.steps.find((step) => step.label === "Casting Mass Heal")?.teamMp?.[1], 150);
});

test("Staff, Spear, Axe, and Great Sword deal their configured skill damage and costs", () => {
  for (const [weapon, unlocked, label, damage, cost] of [
    ["staff", false, "Fireball", 35, 10], ["staff", true, "Inferno", 35, 30],
    ["spear", false, "Throw Spear", 35, 10], ["spear", true, "Charge", 55, 10],
    ["axe", false, "Heavy Blow", 60, 10], ["axe", true, "Berserker Blow", 80, 10],
    ["great-sword", false, "Slash", 40, 10],
  ] as const) {
    const battle = simulateBattle([member(weapon, unlocked, { hp: 1000 })], enemy, never);
    assert.equal(battle.steps.find((step) => step.label === label)?.damage, damage, label);
    assert.equal(battle.steps.find((step) => step.label === `Casting ${label}`)?.teamMp?.[0], baseStats[weapon].mp - cost, label);
    if (label === "Berserker Blow") assert.equal(battle.steps.find((step) => step.kind === "cast")?.teamHp[0], 970);
  }
  assert.equal(simulateBattle([member("axe", true, { hp: 30 })], enemy, never).steps.some((step) => step.label === "Casting Berserker Blow"), false);
});

test("Book buffs affect another ally's attack and speed and expire", () => {
  const ally: Fighter = { id: "ally", stats: { ...baseStats.bow, hp: 1000, speed: 0 } };
  const attack = simulateBattle([ally, member("book", false, { hp: 1000 })], { ...enemy, hp: 500 }, always);
  const blessing = attack.steps.find((step) => step.label === "Attack Blessing")!;
  assert.deepEqual(blessing.targetIds, ["ally"]);
  assert.ok(attack.steps.some((step) => step.characterId === "ally" && step.kind === "attack" && step.damage === 15));
  assert.ok(attack.steps.some((step) => step.label === "Buff expired" && Math.abs(step.at - blessing.at - 7) < 1e-8));
  const speed = simulateBattle([ally, member("book", true, { hp: 1000 })], enemy, always);
  const haste = speed.steps.find((step) => step.label === "Haste")!;
  const attacks = speed.steps.filter((step) => step.actor === "team" && step.characterId === "ally" && step.kind === "attack" && step.at > haste.at && step.at < haste.at + 7);
  assert.ok(attacks.length > 2);
  assert.ok(Math.abs(attacks[1].at - attacks[0].at - 1 / 1.2) < 1e-8);
});

test("Hero adds 20 defense for 7 seconds and Rifle critical skills deal double damage only when unlocked", () => {
  const hero = simulateBattle([member("great-sword", true, { hp: 1000, mp: 125 })], { ...enemy, atk: 25 }, never);
  const buff = hero.steps.find((step) => step.label === "Hero")!;
  assert.ok(hero.steps.some((step) => step.actor === "enemy" && step.at > buff.at && step.at < buff.at + 7 && step.damage === 5));
  assert.ok(hero.steps.some((step) => step.label === "Buff expired" && Math.abs(step.at - buff.at - 7) < 1e-8));
  const rifle = simulateBattle([member("rifle", true, { hp: 1000 })], enemy, always);
  const crit = rifle.steps.find((step) => step.label === "Long Shot")!;
  assert.equal(crit.damage, 100); assert.equal(crit.critical, true); assert.equal(crit.at, 2);
  const locked = simulateBattle([member("rifle", false, { hp: 1000 })], enemy, always);
  assert.equal(locked.steps.find((step) => step.label === "Long Shot")?.damage, 50);
});

test("both dual-weapon types proc extra basic hits and gain 40 speed for a 3-second Burst Fire", () => {
  for (const weapon of ["dual-gun", "dual-knife"] as const) {
    const dual = simulateBattle([member(weapon, false, { hp: 1000 })], enemy, always);
    assert.ok(dual.steps.some((step) => step.kind === "double"));
    assert.equal(simulateBattle([member(weapon, false, { hp: 1000 })], enemy, never).steps.some((step) => step.kind === "double"), false);
    const burst = simulateBattle([member(weapon, true, { hp: 1000 })], enemy, never);
    const buff = burst.steps.find((step) => step.label === "Burst Fire")!;
    assert.equal(burst.steps.find((step) => step.label === "Casting Burst Fire")?.teamMp?.[0], 70);
    assert.ok(burst.steps.some((step) => step.label === "Buff expired" && Math.abs(step.at - buff.at - 3) < 1e-8));
    const attacks = burst.steps.filter((step) => step.kind === "attack" && step.actor === "team" && step.at > buff.at && step.at < buff.at + 3);
    assert.ok(Math.abs(attacks[1].at - attacks[0].at - 1 / 1.5) < 1e-8);
  }
});

test("active skills obey cooldowns while mana regenerates and snapshots remain valid", () => {
  const battle = simulateBattle([member("staff", false, { hp: 1000, mp: 20 })], enemy, never);
  const casts = battle.steps.filter((step) => step.kind === "cast");
  assert.ok(casts.length > 2);
  assert.ok(casts[1].at - battle.steps.find((step) => step.label === "Fireball")!.at >= 5);
  assert.ok(battle.steps.every((step) => step.teamMp![0] >= 0 && step.teamHp[0] >= 0));
  assert.ok(battle.steps.some((step) => step.kind === "attack" && step.actor === "team"));
  assert.ok(battle.steps.every((step) => step.teamMp![0] <= 20));
  for (let i = 1; i < casts.length; i++) assert.ok(casts[i].at - casts[i - 1].at >= 6);
  assert.ok(battle.steps.every((step, i) => i === 0 || step.at >= battle.steps[i - 1].at));
});
