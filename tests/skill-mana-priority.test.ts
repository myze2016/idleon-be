import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { simulateDuel } from "../src/services/pvp-battle.service.js";
import { baseStats } from "../src/models/character-stats.js";
import { savesManaForSkill2, skills } from "../src/models/skills.js";

test("Juan saves mana for ready Freeze All, uses basics while saving, and casts Freeze during its cooldown", () => {
  const battle = simulateGroupBattle([{ id: "juan", weapon: "ice-staff", skill2Unlocked: true, mp: 20, stats: { ...baseStats["ice-staff"], hp: 1000 } }], [{ ...baseStats.axe, hp: 10000, atk: 1, mp: 0 }], () => 0.99);
  const casts = battle.steps.filter((step) => step.kind === "cast");
  assert.equal(casts[0].label, "Casting Freeze All");
  assert.equal(casts[0].at, 2);
  assert.ok(battle.steps.some((step) => step.kind === "attack" && step.actor === "team" && step.at < 2));
  const finished = battle.steps.find((step) => step.label === "Freeze All" && step.kind === "skill")!;
  assert.ok(casts.some((step) => step.label === "Casting Freeze" && step.at > finished.at && step.at < finished.at + 5));
  const second = casts.find((step) => step.label === "Casting Freeze All" && step.at > casts[0].at)!;
  assert.ok(second);
  assert.ok(!casts.some((step) => step.label === "Casting Freeze" && step.at >= finished.at + 5 && step.at < second.at));
});

test("PvP also stops spending on Freeze when Freeze All is ready and needs mana", () => {
  const result = simulateDuel([
    { id: "juan", userId: "a", name: "Juan", weapon: "ice-staff", skill2Unlocked: true, stats: { ...baseStats["ice-staff"], hp: 10000, mp: 40 } },
    { id: "tank", userId: "b", name: "Tank", weapon: "sword-and-shield", stats: { ...baseStats["sword-and-shield"], hp: 10000, mp: 0, atk: 1 } },
  ], () => 0.99);
  const big = result.steps.filter((step) => step.actor === 0 && step.kind === "cast" && step.label === "Casting Freeze All");
  assert.ok(big.length >= 2);
  const completed = result.steps.find((step) => step.actor === 0 && step.kind === "skill" && step.label === "Freeze All")!;
  const next = big.find((step) => step.at > completed.at)!;
  assert.ok(result.steps.some((step) => step.actor === 0 && step.label === "Casting Freeze" && step.at > completed.at && step.at < completed.at + 5));
  assert.ok(!result.steps.some((step) => step.actor === 0 && step.label === "Casting Freeze" && step.at >= completed.at + 5 && step.at < next.at));
});

test("Saving does not block locked/passive Skill 2, cooldowns, or unaffordable max MP and HP costs", () => {
  const freeze = skills["ice-staff"][1];
  assert.equal(savesManaForSkill2(freeze, true, 20, 150, 100, 0, 1), true);
  assert.equal(savesManaForSkill2(freeze, false, 20, 150, 100, 0, 1), false);
  assert.equal(savesManaForSkill2(freeze, true, 20, 150, 100, 5, 1), false);
  assert.equal(savesManaForSkill2(freeze, true, 40, 150, 100, 0, 1), false);
  assert.equal(savesManaForSkill2(freeze, true, 20, 25, 100, 0, 1), false);
  assert.equal(savesManaForSkill2(skills.rifle[1], true, 0, 100, 100, 0, 1), false);
  assert.equal(savesManaForSkill2(skills.axe[1], true, 0, 100, 30, 0, 1), false);
  const battle = simulateGroupBattle([{ id: "juan", weapon: "ice-staff", skill2Unlocked: true, mp: 20, stats: { ...baseStats["ice-staff"], hp: 1000, mp: 25 } }], [{ ...baseStats.axe, hp: 10000, atk: 1, mp: 0 }], () => 0.99);
  assert.equal(battle.steps.find((step) => step.kind === "cast")?.label, "Casting Freeze");
});
