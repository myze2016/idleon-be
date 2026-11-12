import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateGroupBattle, type Fighter } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

const enemy = { hp: 1000, mp: 0, atk: 1, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
const never = () => 0.99;
function special(weapon: "glaive" | "ice-staff" | "dual-axe", unlocked = false): Fighter {
  return { id: weapon, weapon, skill2Unlocked: unlocked, stats: { ...baseStats[weapon], hp: 10000 } };
}

test("Kent basic attacks hit two enemies, including when the first target blocks", () => {
  const battle = simulateGroupBattle([special("glaive")], [enemy, enemy, enemy], never);
  assert.deepEqual(battle.steps.filter((step) => step.at === 1 && step.actor === "team" && step.kind === "attack").map((step) => step.enemyIndex), [0, 1]);
  const blocked = simulateGroupBattle([special("glaive")], [{ ...enemy, blockChance: 1 }, enemy], never);
  assert.ok(blocked.steps.some((step) => step.at === 1 && step.kind === "attack" && step.enemyIndex === 1));
});

test("Bouncing Glaive deals 20 plus ATK, bounces up to four times, and stops without another target", () => {
  const battle = simulateGroupBattle([special("glaive", true)], [{ ...enemy, def: 5 }, { ...enemy, def: 5 }], never);
  const first = battle.steps.filter((step) => step.label === "Bouncing Glaive" && step.at === 2);
  assert.equal(first.length, 5); assert.ok(first.every((step) => step.damage === 25));
  for (let i = 1; i < first.length; i++) assert.notEqual(first[i].enemyIndex, first[i - 1].enemyIndex);
  assert.equal(battle.steps.find((step) => step.label === "Casting Bouncing Glaive")!.teamMp![0], 80);
  const casts = battle.steps.filter((step) => step.label === "Casting Bouncing Glaive");
  for (let i = 1; i < casts.length; i++) assert.ok(casts[i].at - casts[i - 1].at >= 4);
  const solo = simulateGroupBattle([special("glaive", true)], [enemy], never);
  assert.equal(solo.steps.filter((step) => step.label === "Bouncing Glaive" && step.at === 2).length, 1);
});

test("Juan Freeze deals 20 plus Magic and stuns for two seconds; Freeze All hits and stuns all targets", () => {
  for (const unlocked of [false, true]) {
    const battle = simulateGroupBattle([special("ice-staff", unlocked)], [{ ...enemy, magicDef: 5 }, { ...enemy, magicDef: 5 }], never);
    const name = unlocked ? "Freeze All" : "Freeze";
    const hits = battle.steps.filter((step) => step.label === name && step.at === 2);
    assert.equal(hits.length, unlocked ? 2 : 1);
    assert.ok(hits.every((step) => step.damage === 35));
    assert.equal(battle.steps.find((step) => step.label === `Casting ${name}`)!.teamMp![0], unlocked ? 110 : 130);
    for (const hit of hits) assert.ok(!battle.steps.some((step) => step.actor === "enemy" && step.enemyIndex === hit.enemyIndex && step.at >= 2 && step.at < 4));
  }
});

test("Jeffrey bleed stacks for five damage per second each and does not stack on a blocked hit", () => {
  const battle = simulateGroupBattle([special("dual-axe")], [enemy], never);
  const ticks = battle.steps.filter((step) => step.kind === "bleed");
  assert.deepEqual(ticks.slice(0, 3).map((step) => [step.at, step.damage]), [[2, 5], [3, 10], [4, 15]]);
  const blocked = simulateGroupBattle([special("dual-axe")], [{ ...enemy, blockChance: 1 }], never);
  assert.equal(blocked.steps.some((step) => step.kind === "bleed"), false);
});

test("Jeffrey Axe Frenzy costs 50 MP, gives 40 Speed for three seconds, and uses a five-second cooldown", () => {
  const battle = simulateGroupBattle([special("dual-axe", true)], [enemy], never);
  const cast = battle.steps.find((step) => step.label === "Casting Axe Frenzy")!;
  assert.equal(cast.teamMp![0], 0);
  const buff = battle.steps.find((step) => step.label === "Axe Frenzy")!;
  assert.equal(buff.at, 2);
  const firstAttack = battle.steps.find((step) => step.kind === "attack" && step.actor === "team")!;
  assert.ok(Math.abs(firstAttack.at - (2 + 1 / 1.4)) < 1e-8);
  assert.ok(battle.steps.some((step) => step.label === "Buff expired" && step.at === 5));
});
