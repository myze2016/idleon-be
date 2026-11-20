import assert from "node:assert/strict";
import { test } from "node:test";
import { baseStats } from "../src/models/character-stats.js";
import { simulateExpeditionBattle } from "../src/services/expedition-battle.service.js";

const roll = () => 0.99;

test("Expedition playback preserves shared cast timing and enemy health by encounter", () => {
  const result = simulateExpeditionBattle([
    { id: "mage", weapon: "ice-staff", stats: { ...baseStats["ice-staff"], hp: 1000, mp: 100, magic: 100 } },
  ], [{ id: "first", type: "slime" }, { id: "second", type: "boar" }], roll);

  const cast = result.steps.find(step => step.kind === "cast");
  assert.ok(cast?.teamCasting?.[0]);
  assert.equal(cast.characterId, "mage");
  assert.equal(cast.teamCasting[0].startedAt, cast.at);
  assert.ok(cast.teamCasting[0].endsAt > cast.at);
  assert.equal(result.won, true);
  assert.deepEqual(result.enemyHps, [0, 0]);
  assert.deepEqual(result.steps.at(-1)?.teamMp, result.teamMp);
});

test("Expedition includes summoned enemies in playback and final health", () => {
  const result = simulateExpeditionBattle([
    { id: "tank", stats: { ...baseStats.spear, hp: 10000, atk: 20, def: 100 } },
  ], [{ id: "lord", type: "fishpeople-lord" }], roll);

  assert.equal(result.summoned[0]?.type, "fishpeople-knight");
  assert.equal(result.summoned[0]?.index, 1);
  assert.equal(result.steps.find(step => step.enemyHps?.length === 2)?.at, result.summoned[0]?.at);
  assert.equal(result.enemyHps.length, 1 + result.summoned.length);
});
