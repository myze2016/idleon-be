import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultEndless, validateEndless, endlessEnemyStats, endlessDistanceStats, endlessSpawnInterval } from "../src/models/endless.js";
import { defaultEnemies } from "../src/models/enemy.js";
import { COMBAT_ENCOUNTER_DISTANCE, simulateDuel } from "../src/services/pvp-battle.service.js";

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

test("Endless scales by distance and keeps spawn intervals between 5 and 25 seconds", () => {
  const base = defaultEnemies.slime.stats;
  assert.deepEqual(endlessDistanceStats(base, 0, 2), base);
  for (const distance of [-1, 100, 200, 499.99]) assert.deepEqual(endlessDistanceStats(base, distance, 2), base);
  assert.equal(endlessDistanceStats(base, 500, 2).hp, base.hp * 2);
  assert.equal(endlessDistanceStats(base, 999.99, 2).hp, base.hp * 2);
  assert.equal(endlessDistanceStats(base, 1000, 2).hp, base.hp * 4);
  assert.equal(endlessSpawnInterval(() => 0), 5);
  assert.equal(endlessSpawnInterval(() => 0.5), 15);
  assert.equal(endlessSpawnInterval(() => 1), 25);
});

test("Endless can travel for an entire checkpoint between enemy spawns", () => {
  const stats = { hp: 100, mp: 100, atk: 10, def: 10, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
  const result = simulateDuel([{ id: "hero", name: "Hero", userId: "player", stats, startX: 400 }], () => 0.5, 12);
  assert.equal(result.duration, 12);
  assert.equal(result.winnerId, "player");
  assert.ok(result.continuation![0].startX! > 400);
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
  ], () => .99, 14);
  const travelling = result.steps.findLast(step => step.at < 4)!;
  assert.ok(travelling.x[0] > 400);
  assert.ok(Math.abs(travelling.x[0] - travelling.x[1] - 64) < 1e-6);
  const spawn = result.steps.find(step => step.kind === "spawn")!;
  assert.equal(spawn.x[2] - Math.max(spawn.x[0], spawn.x[1]), COMBAT_ENCOUNTER_DISTANCE);
  assert.ok(result.steps.some(step => step.at > 4 && step.kind === "attack"));
});

test("Endless lets every melee slot close into range and restores two mana per second", () => {
  const stats = { hp: 10000, mp: 100, atk: 10, def: 100, magic: 0, magicDef: 100, speed: 0, range: "melee" as const };
  const team = Array.from({ length: 4 }, (_, index) => ({ id: `hero-${index}`, userId: "player", name: "Knight", stats, weapon: "sword-and-shield" as const, startX: 400 - index * 64, mp: 0 }));
  const enemy = { id: "enemy", userId: "enemy", name: "Slime", stats, enemyType: "slime" as const, enemy: stats, startX: 460 };
  const result = simulateDuel([...team, enemy], () => .99, 4);
  assert.ok(result.steps.some(step => step.actor === 0 && step.kind === "attack"));
  assert.ok(result.steps.some(step => step.actor === 3 && step.kind === "attack"));
  const mana = result.steps.find(step => step.kind === "mana")!;
  assert.equal(mana.mp[0], 2); assert.equal(mana.mp[3], 2);
  const exposed = simulateDuel([...team.map((member, index) => ({ ...member, hp: index < 3 ? 0 : stats.hp })), enemy], () => .99, 4);
  assert.ok(exposed.steps.some(step => step.actor === 3 && step.kind === "attack"));
});

test("Endless keeps enemies ahead and carries combat positions across checkpoints", () => {
  const stats = { hp: 10000, mp: 100, atk: 10, def: 100, magic: 0, magicDef: 100, speed: 0, range: "melee" as const };
  const party = Array.from({ length: 6 }, (_, index) => ({ id: `party-${index}`, userId: "player", name: "Knight", stats, weapon: "sword-and-shield" as const, startX: [400, 500, 100, 450, 320, 240][index], mp: 0 }));
  const enemy = { id: "behind", userId: "enemy", name: "Slime", stats, enemyType: "slime" as const, enemy: stats, startX: 50 };
  const first = simulateDuel([...party, enemy, { ...enemy, id: "later", spawnAt: 6, spawnOffset: 72 }], () => .99, 12);
  assert.equal(first.steps.filter(step => step.kind === "spawn" && step.actor === 7).length, 1);
  assert.ok(first.steps.filter(step => step.at < 6).every(step => step.actor !== 7 && !step.targets.includes(7)));
  const second = simulateDuel(first.continuation!, () => .99, 12);
  assert.deepEqual(second.fighters.map(member => member.startX), first.continuation!.map(member => member.startX));
  const lastCamera = first.steps.at(-1)!.cameraWorld![0];
  const nextFrame = second.steps[0];
  assert.equal(nextFrame.cameraWorld![0] - nextFrame.cameraTravel![0], lastCamera);
  for (const result of [first, second]) for (const step of result.steps) {
    const front = Math.max(...step.x.slice(0, 6));
    for (let index = 6; index < result.fighters.length; index++) {
      if ((result.fighters[index].spawnAt ?? 0) <= step.at && step.hp[index] > 0) assert.ok(step.x[index] >= front, "enemy crossed behind the party");
    }
  }
  for (let slot = 0; slot < 3; slot++) assert.ok(first.steps.some(step => step.actor === slot && step.kind === "attack"), "front-row member did not fight");
});

test("Endless restores formation before the next group arrives", () => {
  const stats = { hp: 100, mp: 10, atk: 10, def: 10, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
  const team = [
    { id: "lead", name: "Lead", userId: "player", stats, startX: 400 },
    { id: "archer", name: "Archer", userId: "player", stats: { ...stats, range: "range" as const }, startX: 336 },
  ];
  const first = simulateDuel(team, () => .99, 1);
  const dispersed = first.continuation!.map((fighter, index) => ({ ...fighter, startX: index === 0 ? 500 : 100 }));
  const regrouped = simulateDuel(dispersed, () => .99, 7);
  assert.deepEqual(regrouped.fighters.map(fighter => fighter.startX), [500, 100]);
  const firstMove = regrouped.steps.find(step => step.kind === "move")!;
  assert.ok(firstMove.x[0] > 500 && firstMove.x[1] > 100);
  assert.ok(firstMove.x[0] - firstMove.x[1] < 400);
  const final = regrouped.continuation!;
  assert.equal(final[0].startX! - final[1].startX!, 64);
  assert.ok(final[1].startX! > 100);
});

test("Endless resumes marching after a kill and marches into range of the next spawn", () => {
  const stats = { hp: 1000, mp: 0, atk: 100, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" as const };
  const team = [
    { id: "lead", name: "Lead", userId: "player", stats, startX: 400 },
    { id: "archer", name: "Archer", userId: "player", stats: { ...stats, atk: 1, range: "range" as const }, startX: 336 },
  ];
  const enemyStats = { ...stats, hp: 100, atk: 1 };
  const enemy = { id: "first", userId: "enemy", name: "Slime", stats: enemyStats, enemy: enemyStats, startX: 1540 };
  const result = simulateDuel([...team, enemy, { ...enemy, id: "second", spawnAt: 16 }], () => .99, 20);
  const firstShot = result.steps.find(step => step.actor === 1 && step.targets.includes(2))!;
  const kill = result.steps.find(step => step.actor === 0 && step.targets.includes(2) && step.hp[2] === 0)!;
  const resumed = result.steps.find(step => step.at > kill.at && step.kind === "move")!;
  const secondSpawn = result.steps.find(step => step.kind === "spawn" && step.actor === 3)!;
  const approach = result.steps.find(step => step.at > secondSpawn.at && step.kind === "move")!;
  assert.equal(kill.x[1], firstShot.x[1]);
  assert.ok(kill.x[0] > firstShot.x[0]);
  assert.ok(resumed.x[0] > kill.x[0] && resumed.x[1] > kill.x[1]);
  assert.ok(resumed.x[0] - resumed.x[1] < kill.x[0] - kill.x[1]);
  assert.ok(approach.x[0] > secondSpawn.x[0] && approach.x[1] > secondSpawn.x[1]);
});

test("Endless runs the remaining spawn clock at three quarters speed only while the battlefield is empty", () => {
  const stats = { ...defaultEnemies.slime.stats, atk: 100, hp: 1000 };
  const hero = { id: "hero", name: "Hero", userId: "player", stats, startX: 400 };
  const slime = { id: "slime", name: "Slime", userId: "enemy", enemyType: "slime" as const, stats: defaultEnemies.slime.stats, enemy: defaultEnemies.slime.stats, startX: 460 };
  const arrivals = [{ ...slime, id: "first", spawnAt: 10 }, { ...slime, id: "second", spawnAt: 10, spawnOffset: 72 }];
  const options = { endlessSpawns: { scheduleEnd: 20, distance: 420, statMultiplier: 2 } };
  const empty = simulateDuel([hero, ...arrivals], () => .99, 12, options);
  const spawnTimes = empty.steps.filter(step => step.kind === "spawn").map(step => step.at);
  assert.equal(spawnTimes.length, 2);
  assert.equal(spawnTimes[0], spawnTimes[1]);
  assert.ok(Math.abs(spawnTimes[0] - 7.5) < 1e-8);
  assert.equal(empty.fighters[1].stats.hp, 40, "enemy scales at actual spawn distance");
  const mixed = simulateDuel([hero, slime, ...arrivals], () => .99, 12, options);
  const kill = mixed.steps.find(step => step.actor === 0 && step.targets.includes(1) && step.hp[1] === 0)!;
  const next = mixed.steps.find(step => step.kind === "spawn")!;
  assert.ok(Math.abs(next.at - (kill.at + (10 - kill.at) * 0.75)) < 1e-8);
  const checkpoint = simulateDuel([hero, ...arrivals], () => .99, 4, options);
  assert.ok(Math.abs(checkpoint.nextSpawnIn! - (10 - 4 / 0.75)) < 1e-8);
});
