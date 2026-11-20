import assert from "node:assert/strict";
import { test } from "node:test";
import { baseStats } from "../src/models/character-stats.js";
import { simulateExpeditionBattle } from "../src/services/expedition-battle.service.js";
import { defaultBalance, normalizeBalance, validateBalance } from "../src/services/balance.service.js";
import { withBalance } from "../src/models/balance-context.js";
import { enemyWiki } from "../src/models/enemy-wiki.js";

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

test("shared combat uses boss area cooldown defaults and published overrides", () => {
  const saved = defaultBalance();
  delete saved.enemies["demon-prince"].burnAll!.cooldown;
  delete saved.enemies.zugwang.slashAll!.cooldown;
  const config = normalizeBalance(saved);
  const team = [{ id: "tank", stats: { ...baseStats.spear, hp: 10000, atk: 20, def: 100 } }];
  for (const [type, label, key] of [["demon-prince", "Burn All", "burnAll"], ["zugwang", "Slash All", "slashAll"]] as const) {
    const casts = () => simulateExpeditionBattle(team, [{ id: type, type }], roll).steps.filter(step => step.label === label).map(step => step.at);
    assert.deepEqual(withBalance(config, casts), [1, 11]);
    config.enemies[type][key]!.cooldown = 4;
    withBalance(validateBalance(config), () => {
      assert.deepEqual(casts(), [1, 5]);
      assert.equal(enemyWiki().find(enemy => enemy.id === type)?.skills.find(skill => skill.name === label)?.cooldown, 4);
    });
  }
});
