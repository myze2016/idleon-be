import assert from "node:assert/strict";
import { test } from "node:test";
import { initialGarnalandProgress, garnalandSpecial, advanceGarnaland } from "../src/models/garnaland.js";
import { enemies, enemyPools, enemyRewards } from "../src/models/enemy.js";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

test("Garnaland schedules chicken semi-bosses and the king without duplicate active specials", () => {
  let progress = initialGarnalandProgress();
  assert.equal(garnalandSpecial(progress, []), null);
  progress = advanceGarnaland(progress, Array(15).fill("mushroom-fighter"));
  assert.equal(garnalandSpecial(progress, []), "mushroom-chicken");
  assert.equal(garnalandSpecial(progress, ["mushroom-chicken"]), null);
  progress = advanceGarnaland(progress, ["mushroom-chicken"]);
  assert.equal(progress.defeated, 15);
  assert.equal(progress.chickenAt, 30);
  progress = advanceGarnaland(progress, Array(25).fill("fairy"));
  assert.equal(garnalandSpecial(progress, []), "mushroom-king");
  assert.equal(garnalandSpecial(progress, ["mushroom-king"]), null);
  assert.deepEqual(advanceGarnaland(progress, ["mushroom-king"]), initialGarnalandProgress());
});

test("All five Garnaland enemies have basic attacks only and distinct boss rewards", () => {
  assert.deepEqual(enemyPools.garnaland, ["mushroom-fighter", "mushroom-rager", "fairy"]);
  for (const type of [...enemyPools.garnaland, "mushroom-chicken", "mushroom-king"] as const) {
    const enemy = enemies[type];
    assert.equal(enemy.stats.mp, 0);
    for (const ability of ["skill", "bubbleBeam", "burnAll", "slashAll", "blockChance"]) assert.equal(ability in enemy.stats, false);
    const battle = simulateGroupBattle([{ id: "target", stats: { ...baseStats.spear, hp: 100000, atk: 1, def: 0 } }], [enemy.stats], () => 0.99);
    const actions = battle.steps.filter((step) => step.actor === "enemy" && step.kind !== "mana");
    assert.ok(actions.length > 0);
    assert.ok(actions.every((step) => step.kind === "attack"));
    assert.ok(enemy.gold > 0 && enemy.experience > 0);
  }
  assert.equal(enemyRewards("mushroom-chicken").semiBoss, true);
  assert.equal(enemyRewards("mushroom-chicken").boss, false);
  assert.equal(enemyRewards("mushroom-king").boss, true);
});
