import assert from "node:assert/strict";
import { test } from "node:test";
import { actionDuration, spellCastTime } from "../src/models/action-timing.js";
import { simulateBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

test("Speed controls repeated attack intervals, including additional attacks between slower attacks", () => {
  const stats = { ...baseStats.bow, hp: 1000, atk: 1, magic: 0, def: 0, speed: 100 };
  const enemy = { ...stats, hp: 40, speed: 0 };
  const battle = simulateBattle([{ id: "fast", stats }], enemy);
  assert.equal(battle.won, true);
  assert.deepEqual(battle.steps.slice(0, 3).map((step) => [step.actor, step.at]), [["team", 0.5], ["team", 1], ["enemy", 1]]);
  const attacks = battle.steps.filter((step) => step.actor === "team");
  for (let i = 1; i < attacks.length; i++) assert.equal(attacks[i].at - attacks[i - 1].at, 0.5);
  assert.equal(attacks.at(-1)?.at, 20);
  assert.ok(battle.steps.every((step, i) => i === 0 || step.at >= battle.steps[i - 1].at));
});

test("zero Speed attacks every second and dead characters stop taking turns", () => {
  const stats = { ...baseStats.bow, hp: 1000, atk: 1, magic: 0, def: 0, speed: 0 };
  const enemy = { ...stats, hp: 3 };
  const equal = simulateBattle([{ id: "normal", stats }], enemy);
  assert.deepEqual(equal.steps.map((step) => [step.actor, step.at]), [["team", 1], ["enemy", 1], ["team", 2], ["enemy", 2], ["team", 3]]);
  const deaths = simulateBattle([{ id: "weak", stats: { ...stats, hp: 1 } }, { id: "survivor", stats }], { ...enemy, hp: 5, speed: 100 });
  assert.equal(deaths.steps[0].actor, "enemy");
  assert.equal(deaths.steps[0].teamHp[0], 0);
  assert.equal(deaths.steps.some((step) => step.actor === "team" && step.characterId === "weak"), false);
});

test("spells default to one second and use the same Speed scaling as attacks", () => {
  assert.equal(spellCastTime(0), 1);
  assert.equal(spellCastTime(100), 0.5);
  assert.ok(Math.abs(spellCastTime(10) - 1 / 1.1) < 1e-10);
  assert.equal(spellCastTime(10), actionDuration(10));
  assert.equal(spellCastTime(100, 2), 1);
  assert.equal(actionDuration(-10), 1);
});
