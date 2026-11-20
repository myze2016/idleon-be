import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultEndless, validateEndless, endlessEnemyStats, endlessDistanceStats, endlessSpawnInterval } from "../src/models/endless.js";
import { defaultEnemies } from "../src/models/enemy.js";
import { simulateDuel } from "../src/services/pvp-battle.service.js";

test("Endless validates the spawn pool and multiplier and preserves enemy mechanics while scaling", () => {
  for (const input of [null, { ...defaultEndless, enemyPool: [] }, { ...defaultEndless, enemyPool: ["unknown"] }, { ...defaultEndless, enemyPool: ["slime", "slime"] }, { ...defaultEndless, statMultiplier: 1 }, { ...defaultEndless, statMultiplier: NaN }, { ...defaultEndless, statMultiplier: 4 }]) assert.throws(() => validateEndless(input));
  assert.deepEqual(validateEndless(defaultEndless).enemyPool, ["boar", "plant", "slime"]);
  const base = defaultEnemies["fishpeople-researcher"].stats;
  assert.deepEqual(endlessEnemyStats(base, 1, 1.2), base);
  const scaled = endlessEnemyStats(base, 3, 2);
  assert.equal(scaled.hp, base.hp * 4); assert.equal(scaled.mp, base.mp * 4);
  assert.equal(scaled.skill!.damage, base.skill.damage * 4);
  assert.equal(scaled.skill!.cooldown, base.skill.cooldown);
  assert.equal(scaled.speed, 0); assert.equal(scaled.range, base.range);
  assert.equal(endlessEnemyStats(defaultEnemies.boar.stats, 1000000, 3).hp, 1000000);
  assert.equal(endlessEnemyStats(defaultEnemies.warrior.stats, 2, 1.1).hp, 55);
  assert.equal(base.hp, 550);
});

test("Endless scales by distance and keeps spawn intervals between 2 and 3 seconds", () => {
  const base = defaultEnemies.slime.stats;
  assert.deepEqual(endlessDistanceStats(base, 0, 2), base);
  for (const distance of [-1, 100, 200, 499.99]) assert.deepEqual(endlessDistanceStats(base, distance, 2), base);
  assert.equal(endlessDistanceStats(base, 500, 2).hp, base.hp * 2);
  assert.equal(endlessDistanceStats(base, 999.99, 2).hp, base.hp * 2);
  assert.equal(endlessDistanceStats(base, 1000, 2).hp, base.hp * 4);
  assert.equal(endlessSpawnInterval(() => 0), 2);
  assert.equal(endlessSpawnInterval(() => 0.5), 2.5);
  assert.equal(endlessSpawnInterval(() => 1), 3);
});

test("continuous combat spawns enemies while others are alive and preserves combat across checkpoints", () => {
  const stats = { hp: 10000, mp: 100, atk: 1, def: 100, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
  const result = simulateDuel([
    { id: "hero", userId: "player", name: "Hero", stats, weapon: "sword-and-shield", startX: 400, hp: 1234, mp: 7 },
    ...[0, 2, 4, 6, 8, 10].map((spawnAt, index) => ({ id: `enemy-${index}`, userId: "enemy", name: "Slime", stats: { ...defaultEnemies.slime.stats, hp: 10000 }, enemyType: "slime" as const, enemy: defaultEnemies.slime.stats, startX: 600, spawnAt })),
  ], () => .99, 12);
  assert.equal(result.duration, 12);
  assert.equal(result.fighters.length, 7);
  assert.ok(result.steps.some(step => step.kind === "spawn" && step.at === 2 && step.hp[1] > 0));
  assert.ok(result.steps.filter(step => step.at < 2).every(step => step.actor !== 2 && !step.targets.includes(2)));
  const continuation = result.continuation!;
  assert.ok(continuation.length > 2);
  const next = simulateDuel(continuation, () => .99, 12);
  assert.equal(next.fighters[0].hp, result.steps.at(-1)!.hp[0]);
  assert.equal(next.fighters[0].startX, result.steps.at(-1)!.x[0]);
  assert.deepEqual(next.fighters[0].combat, continuation[0].combat);
  assert.equal(next.duration, 12);
});
test("shared battle simulation respects carried HP/MP and never revives fallen team members", () => {
  const stats = { hp: 100, mp: 100, atk: 20, def: 10, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
  const result = simulateDuel([
    { id: "fallen", userId: "player", name: "Fallen", stats, weapon: "sword-and-shield", hp: 0, mp: 0 },
    { id: "alive", userId: "player", name: "Alive", stats, weapon: "sword-and-shield", hp: 43, mp: 7 },
    { id: "slime", userId: "enemy", name: "Slime", stats: defaultEnemies.slime.stats, enemyType: "slime", enemy: defaultEnemies.slime.stats },
  ], () => .99);
  assert.equal(result.steps[0].hp[0], 0);
  assert.equal(result.steps[0].hp[1], 43);
  assert.equal(result.steps[0].mp[1], 7);
  assert.ok(result.steps.every(step => step.hp[0] === 0));
  assert.equal(result.winnerId, "player");
});

test("Endless travels between enemies and later spawns stay ahead of the travelling team", () => {
  const stats = { hp: 10000, mp: 0, atk: 1, def: 100, magic: 0, magicDef: 100, speed: 0, range: "melee" as const };
  const result = simulateDuel([
    { id: "front", userId: "player", name: "Front", stats, weapon: "sword-and-shield", startX: 400 },
    { id: "back", userId: "player", name: "Back", stats, weapon: "sword-and-shield", startX: 336 },
    { id: "incoming", userId: "enemy", name: "Slime", stats, enemyType: "slime", enemy: stats, startX: 450, spawnAt: 4 },
  ], () => .99, 12);
  const travelling = result.steps.findLast(step => step.at < 4)!;
  assert.ok(travelling.x[0] > 400);
  assert.ok(Math.abs(travelling.x[0] - travelling.x[1] - 64) < 1e-6);
  const spawn = result.steps.find(step => step.kind === "spawn")!;
  assert.equal(spawn.x[2] - Math.max(spawn.x[0], spawn.x[1]), 800);
  assert.ok(result.steps.some(step => step.at > 4 && step.kind === "attack"));
});

test("Endless uses adventure back-row melee protection and mana regeneration", () => {
  const stats = { hp: 10000, mp: 100, atk: 10, def: 100, magic: 0, magicDef: 100, speed: 0, range: "melee" as const };
  const team = Array.from({ length: 4 }, (_, index) => ({ id: `hero-${index}`, userId: "player", name: "Knight", stats, weapon: "sword-and-shield" as const, startX: 400 - index * 64, mp: 0 }));
  const enemy = { id: "enemy", userId: "enemy", name: "Slime", stats, enemyType: "slime" as const, enemy: stats, startX: 460 };
  const result = simulateDuel([...team, enemy], () => .99, 4);
  assert.ok(result.steps.some(step => step.actor === 0 && step.kind === "attack"));
  assert.ok(!result.steps.some(step => step.actor === 3 && ["attack", "cast", "skill"].includes(step.kind)));
  const mana = result.steps.find(step => step.kind === "mana")!;
  assert.equal(mana.mp[0], 5); assert.equal(mana.mp[3], 10);
  const exposed = simulateDuel([...team.map((member, index) => ({ ...member, hp: index < 3 ? 0 : stats.hp })), enemy], () => .99, 4);
  assert.ok(exposed.steps.some(step => step.actor === 3 && step.kind === "attack"));
});
