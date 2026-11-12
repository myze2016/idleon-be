import assert from "node:assert/strict";
import { test } from "node:test";
import { enemies, type EnemyStats } from "../src/models/enemy.js";
import { simulateGroupBattle, type Fighter } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

const tank = (id = "tank", overrides = {}): Fighter => ({ id, stats: { ...baseStats.spear, hp: 10000, atk: 20, def: 100, magicDef: 0, ...overrides } });
const never = () => 0.99;

test("Guard Mode adds 10 physical defense for exactly two seconds and spends its only 50 MP", () => {
  const battle = simulateGroupBattle([tank()], [enemies["fishpeople-guard"].stats], never);
  const hits = battle.steps.filter((step) => step.actor === "team" && step.kind === "attack");
  assert.equal(hits.find((step) => step.at === 1)!.damage, 15);
  assert.equal(hits.find((step) => step.at === 2)!.damage, 5);
  assert.equal(hits.find((step) => step.at === 3)!.damage, 15);
  assert.equal(battle.steps.filter((step) => step.label === "Guard Mode").length, 1);
});

test("Guardian heals 5 per direct hit for five seconds, never exceeding HP or reviving after lethal damage", () => {
  const battle = simulateGroupBattle([tank()], [enemies["fishpeople-guardian"].stats], never);
  const heals = battle.steps.filter((step) => step.label === "Restorative Shield" && step.kind === "heal");
  assert.deepEqual(heals.map((step) => step.at), [2, 3, 4, 5]);
  assert.ok(heals.every((step) => step.healing === 5 && step.enemyHp <= 700));
  const lethal = simulateGroupBattle([tank("killer", { atk: 1000, speed: -50 })], [{ ...enemies["fishpeople-guardian"].stats, speed: 100 }], never);
  assert.equal(lethal.enemyHps[0], 0);
  assert.equal(lethal.steps.some((step) => step.kind === "heal"), false);
});

test("Archer and Rifler shots use fixed physical damage, mana, and cooldowns", () => {
  for (const [type, label, times, damage] of [
    ["fishpeople-archer", "Sniper Shot", [1], 45],
    ["fishpeople-rifler", "Rifle Shot", [1, 5], 35],
  ] as const) {
    const battle = simulateGroupBattle([tank("target", { atk: 1, def: 5 })], [enemies[type].stats], never);
    const shots = battle.steps.filter((step) => step.label === label);
    assert.deepEqual(shots.map((step) => step.at), times);
    assert.ok(shots.every((step) => step.damage === damage));
  }
});

test("Water Snipe targets the last living ally using special defense and five-second cooldowns", () => {
  const battle = simulateGroupBattle([tank("front", { atk: 1 }), tank("back", { atk: 1, magicDef: 7 })], [enemies["fishpeople-researcher"].stats], never);
  const shots = battle.steps.filter((step) => step.label === "Water Snipe");
  assert.deepEqual(shots.map((step) => step.at), [1, 6, 11, 16]);
  assert.ok(shots.every((step) => step.characterId === "back" && step.damage === 43));
});

test("Cleric heals injured fishpeople allies only, with 50 MP and two-second cooldown", () => {
  const woundedFish: EnemyStats = { ...enemies["fishpeople-rider"].stats, hp: 1000 };
  const battle = simulateGroupBattle([tank("attacker", { atk: 60 })], [woundedFish, enemies["fishpeople-cleric"].stats], never);
  const heals = battle.steps.filter((step) => step.label === "Fishpeople Heal");
  assert.deepEqual(heals.map((step) => step.at), [1, 3]);
  assert.ok(heals.every((step) => step.healing === 50 && step.enemyIndex === 0));
  const noFish = simulateGroupBattle([tank("attacker", { atk: 5 })], [{ ...enemies.baracudon.stats, hp: 1000 }, enemies["fishpeople-cleric"].stats], never);
  assert.equal(noFish.steps.some((step) => step.label === "Fishpeople Heal" && step.enemyIndex === 0), false);
});

test("Baron self heals 50 HP for 10 mana at five-second intervals and Knight blocks at 30 percent", () => {
  const battle = simulateGroupBattle([tank("attacker", { atk: 20 })], [enemies["fishpeople-baron"].stats], never);
  const heals = battle.steps.filter((step) => step.label === "Baron Heal");
  assert.equal(heals.length, 5);
  assert.deepEqual(heals.map((step) => step.at), [1, 6, 11, 16, 21]);
  assert.ok(heals.every((step) => step.healing! <= 50));
  const blocked = simulateGroupBattle([tank()], [enemies["fishpeople-knight"].stats], () => 0.29);
  assert.ok(blocked.steps.some((step) => step.label === "Knight Block"));
});

test("Lord spends 25 MP per summoned Knight, respects ten-second cooldown, and summons fight", () => {
  const battle = simulateGroupBattle([tank("attacker", { atk: 20 })], [enemies["fishpeople-lord"].stats], never);
  assert.deepEqual(battle.summoned.map((summon) => summon.at), [1, 11]);
  assert.equal(battle.enemyHps.length, 3);
  assert.ok(battle.steps.some((step) => step.actor === "enemy" && step.enemyIndex === 1 && step.damage > 0));
  assert.equal(battle.won, true);
});
