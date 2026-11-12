import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

const opponent = { ...baseStats.axe, hp: 10000, atk: 1, mp: 0 };

test("Mana restores five per second to each living ally, caps at maximum, and stops when battle ends", () => {
  const team = [
    { id: "empty", mp: 0, stats: { ...baseStats.axe, hp: 3, mp: 12, atk: 1 } },
    { id: "nearly-full", mp: 8, stats: { ...baseStats.axe, hp: 3, mp: 10, atk: 1 } },
    { id: "dead", hp: 0, mp: 0, stats: { ...baseStats.axe, mp: 100 } },
    { id: "zero", mp: 0, stats: { ...baseStats.axe, hp: 3, mp: 0, atk: 1 } },
  ];
  const battle = simulateGroupBattle(team, [opponent], () => 0.99);
  const ticks = battle.steps.filter((step) => step.kind === "mana");
  assert.deepEqual(ticks.map((step) => step.at), [1, 2, 3]);
  assert.deepEqual(ticks[0].teamMp, [5, 10, 0, 0]);
  assert.deepEqual(ticks[1].teamMp, [10, 10, 0, 0]);
  assert.deepEqual(ticks[2].teamMp, [12, 10, 0, 0]);
  assert.ok(battle.steps.every((step) => step.teamMp?.[2] === 0 && step.teamMp?.[3] === 0));
  const finalTime = battle.steps.at(-1)!.at;
  assert.ok(ticks.every((step) => step.at <= finalTime));
});

test("Mana regen lets an empty caster resume spells and includes regeneration while casting", () => {
  const battle = simulateGroupBattle([{ id: "mage", weapon: "staff", mp: 0, stats: { ...baseStats.staff, hp: 1000 } }], [opponent], () => 0.99);
  const cast = battle.steps.find((step) => step.kind === "cast")!;
  assert.ok(cast.at >= 2);
  assert.ok(battle.steps.some((step) => step.kind === "mana" && step.teamCasting?.[0] !== null));
  assert.ok(battle.steps.filter((step) => step.kind === "cast").length > 1);
  assert.ok(battle.steps.every((step) => step.teamMp![0] >= 0 && step.teamMp![0] <= baseStats.staff.mp));
});
