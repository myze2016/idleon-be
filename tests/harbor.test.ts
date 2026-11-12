import assert from "node:assert/strict";
import { test } from "node:test";
import { enemies, encounterPool, harborPeriod } from "../src/models/enemy.js";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

test("Harbor uses Manila midnight/noon boundaries independent of the host timezone", () => {
  for (const [time, expected] of [
    ["2026-11-11T15:59:59Z", "night"], ["2026-11-11T16:00:00Z", "day"],
    ["2026-11-12T03:59:59Z", "day"], ["2026-11-12T04:00:00Z", "night"],
  ] as const) assert.equal(harborPeriod(new Date(time)), expected);
  assert.deepEqual(encounterPool("harbor", new Date("2026-11-12T00:00:00Z")), ["crab-day", "hermit", "starfish"]);
  assert.deepEqual(encounterPool("harbor", new Date("2026-11-12T08:00:00Z")), ["crab-night", "fishpeople-spearman", "fishpeople-hunter", "fishpeople-magos"]);
});

test("Bubble Beam spends finite mana, uses magic defense, and respects its one-second cooldown", () => {
  const tank = { id: "tank", stats: { ...baseStats.spear, hp: 10000, atk: 1, def: 100, magicDef: 5 } };
  for (const [type, casts, damage] of [["starfish", 2, 15], ["fishpeople-magos", 3, 10], ["fishpeople-guide", 1, 10]] as const) {
    const battle = simulateGroupBattle([tank], [enemies[type].stats], () => 0.99);
    const beams = battle.steps.filter((step) => step.actor === "enemy" && step.label === "Bubble Beam");
    assert.equal(beams.length, casts);
    assert.ok(beams.every((step, index) => step.damage === damage && step.at === index + 1));
    assert.ok(battle.steps.some((step) => step.actor === "enemy" && step.kind === "attack" && step.at > casts));
  }
});

test("Hermit blocks attacks below its 30 percent threshold", () => {
  const fighter = { id: "fighter", stats: { ...baseStats.spear, hp: 500, atk: 150 } };
  const blocked = simulateGroupBattle([fighter], [enemies.hermit.stats], () => 0.299);
  assert.ok(blocked.steps.some((step) => step.label === "Hermit Block" && step.damage === 0));
  const unblocked = simulateGroupBattle([fighter], [enemies.hermit.stats], () => 0.3);
  assert.ok(unblocked.won);
  assert.ok(!unblocked.steps.some((step) => step.label === "Hermit Block"));
});
