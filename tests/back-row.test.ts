import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateGroupBattle, type Fighter } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

const enemy = { hp: 500, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
test("back-row melee charges mana without attacking or casting melee skills", () => {
  const fighter: Fighter = { id: "axe", weapon: "axe", stats: baseStats.axe, backRow: true, mp: 0, skill2Unlocked: true };
  const front: Fighter = { id: "front", weapon: "sword-and-shield", stats: { ...baseStats["sword-and-shield"], hp: 10000 } };
  const result = simulateGroupBattle([front, fighter], [enemy], () => 0.99);
  assert.equal(result.steps.find((step) => step.kind === "mana")?.teamMp?.[1], 2);
  assert.ok(!result.steps.some((step) => step.characterId === "axe" && step.actor === "team" && (step.damage > 0 || step.kind === "cast")));
  assert.ok(result.teamMp[1] <= baseStats.axe.mp);
});

test("back-row melee attacks and uses melee skills when front slots are empty or defeated", () => {
  const back: Fighter = { id: "back", weapon: "axe", stats: baseStats.axe, backRow: true };
  for (const front of [[], [{ id: "front", weapon: "sword-and-shield" as const, stats: baseStats["sword-and-shield"], hp: 0 }]]) {
    const result = simulateGroupBattle([...front, back], [enemy], () => 0.99);
    assert.ok(result.steps.some((step) => step.actor === "team" && step.characterId === "back" && step.label === "Heavy Blow" && step.damage > 0));
    assert.ok(result.steps.some((step) => step.actor === "team" && step.characterId === "back" && step.kind === "attack" && step.damage > 0));
  }
});

test("back-row melee starts fighting only after the last living front dies", () => {
  const front: Fighter = { id: "front", weapon: "sword-and-shield", stats: baseStats["sword-and-shield"], hp: 1 };
  const back: Fighter = { id: "back", weapon: "axe", stats: baseStats.axe, backRow: true };
  const result = simulateGroupBattle([front, back], [enemy], () => 0.99);
  const death = result.steps.findIndex((step) => step.teamHp[0] === 0);
  const attack = result.steps.findIndex((step) => step.actor === "team" && step.characterId === "back" && step.damage > 0);
  assert.ok(death >= 0 && attack > death);
  assert.ok(!result.steps.slice(0, death).some((step) => step.actor === "team" && step.characterId === "back" && step.kind === "cast"));
});

test("back-row casters retain ranged skills while front-row melee still attacks", () => {
  const fighters: Fighter[] = [
    { id: "axe", weapon: "axe", stats: baseStats.axe },
    { id: "staff", weapon: "staff", stats: baseStats.staff, backRow: true },
  ];
  const result = simulateGroupBattle(fighters, [enemy], () => 0.99);
  assert.ok(result.steps.some((step) => step.characterId === "staff" && step.label === "Fireball" && step.damage > 0));
  assert.ok(result.steps.some((step) => step.characterId === "axe" && step.damage > 0));
  assert.ok(!result.steps.some((step) => step.characterId === "staff" && step.actor === "team" && step.kind === "attack"));
});
