import assert from "node:assert/strict";
import { test } from "node:test";
import { yellowSpectatorAppears } from "../src/models/spectator.js";
import { enemies } from "../src/models/enemy.js";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";

test("Yellow spectator appears for exactly one of ten equally likely outcomes", () => {
  assert.equal(Array.from({ length: 10 }, (_, outcome) => yellowSpectatorAppears(() => outcome)).filter(Boolean).length, 1);
});

test("Demon Prince burns all living allies twice, uses magic defense, then basic attacks", () => {
  const team = [0, 5, 30].map((magicDef, i) => ({ id: `ally-${i}`, stats: { ...baseStats.spear, hp: 10000, atk: 1, def: 99, magicDef } }));
  team.push({ id: "fallen", stats: { ...baseStats.spear, hp: 0, atk: 1, def: 0, magicDef: 0 } });
  const battle = simulateGroupBattle(team, [enemies["demon-prince"].stats], () => 0.99);
  const burns = battle.steps.filter((step) => step.label === "Burn All");
  assert.equal(burns.length, 6);
  for (let i = 0; i < 3; i++) {
    const hits = burns.filter((step) => step.characterId === `ally-${i}`);
    assert.deepEqual(hits.map((step) => step.at), [1, 2]);
    assert.ok(hits.every((step) => step.damage === Math.max(1, 20 - team[i].stats.magicDef)));
  }
  assert.ok(battle.steps.some((step) => step.actor === "enemy" && step.kind === "attack" && step.at === 3));
});
