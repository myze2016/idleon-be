import assert from "node:assert/strict";
import { test } from "node:test";
import { enemies } from "../src/models/enemy.js";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

test("Zugwang slashes every living ally twice for 40 mana each, then uses basic attacks", () => {
  const team = [0, 5, 30].map((def, i) => ({ id: `ally-${i}`, stats: { ...baseStats.spear, hp: 10000, atk: 1, def } }));
  const battle = simulateGroupBattle(team, [enemies.zugwang.stats], () => 0.99);
  const slashes = battle.steps.filter((step) => step.label === "Slash All");
  assert.equal(slashes.length, 6);
  for (let i = 0; i < 3; i++) {
    const hits = slashes.filter((step) => step.characterId === `ally-${i}`);
    assert.deepEqual(hits.map((step) => step.at), [1, 2]);
    assert.ok(hits.every((step) => step.damage === Math.max(1, 20 - team[i].stats.def)));
  }
  assert.ok(battle.steps.some((step) => step.actor === "enemy" && step.kind === "attack" && step.at === 3));
});

test("Slash All skips fallen allies and shield blocks apply separately to each recipient", () => {
  const battle = simulateGroupBattle([
    { id: "dead", hp: 0, stats: baseStats.spear },
    { id: "shield", weapon: "sword-and-shield", stats: { ...baseStats["sword-and-shield"], hp: 10000 } },
    { id: "spear", stats: { ...baseStats.spear, hp: 10000 } },
  ], [enemies.zugwang.stats], () => 0);
  assert.equal(battle.steps.filter((step) => step.label === "Block Slash All").length, 2);
  const hits = battle.steps.filter((step) => step.label === "Slash All");
  assert.equal(hits.length, 2);
  assert.ok(hits.every((step) => step.characterId === "spear" && step.damage === 20));
});
