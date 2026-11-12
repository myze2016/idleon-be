import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { deepSeaFloors, type DeepSeaLocation } from "../src/models/deepsea.js";
import { enemies, enemyPools } from "../src/models/enemy.js";

test("DeepSea Moot gates entry on the map, unlocks each floor permanently, and keeps boss rewards unique", async () => {
  const userId = "deepsea-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Diver", passwordHash: await hashPassword("Test123!") } });
  const hero = await prisma.character.create({ data: { userId, name: "Diver", weapon: "axe", upgradeLevel: 1000 } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const spawn = (location: string, fresh = true) => agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location, teamIds: [hero.id], newExpedition: fresh, wave: true });
  for (const floor of Object.keys(deepSeaFloors)) await spawn(floor).expect(403);
  await prisma.questItem.create({ data: { userId, itemId: "deepsea-moth-map" } });
  await spawn("deepsea-2f").expect(403); await spawn("deepsea-palace").expect(403);
  let expectedGold = 0;
  for (const location of Object.keys(deepSeaFloors) as DeepSeaLocation[]) {
    const regular = (await spawn(location).expect(201)).body.data;
    assert.ok(regular.deepSeaProgress.target >= 30 && regular.deepSeaProgress.target <= 40);
    const wave = [regular, ...regular.additionalEnemies];
    assert.ok(wave.length >= 1 && wave.length <= 2);
    assert.ok(wave.every((enemy) => (enemyPools[location] as string[]).includes(enemy.type)));
    await prisma.user.update({ where: { id: userId }, data: { deepSeaProgress: { [location]: { defeated: 30, target: 30 } } } });
    const boss = (await spawn(location, false).expect(201)).body.data;
    assert.equal(boss.type, deepSeaFloors[location].boss); assert.equal(boss.boss, true); assert.equal(boss.additionalEnemies.length, 0);
    const resolve = () => agent.post(`/api/encounters/${boss.id}/resolve`).set("Origin", env.corsOrigin);
    const results = await Promise.all([resolve(), resolve()]);
    for (const result of results) {
      assert.equal(result.status, 200); assert.equal(result.body.data.won, true);
      const rewards = result.body.data.enemies.reduce((sum: number, enemy: { type: keyof typeof enemies }) => sum + enemies[enemy.type].gold, 0);
      assert.equal(result.body.data.goldEarned, rewards);
      assert.equal(result.body.data.expEarned, result.body.data.enemies.length);
      assert.equal(result.body.data.deepSeaProgress.defeated, 0);
    }
    expectedGold += results[0].body.data.goldEarned;
    const state = (await agent.get("/api/character").expect(200)).body.data;
    assert.equal(state.deepSeaFloor, Math.min(3, deepSeaFloors[location].floor + 1));
    assert.equal(state.gold, expectedGold);
  }
  await agent.post("/api/encounters/return").set("Origin", env.corsOrigin).expect(204);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).deepSeaProgress, null);
  await agent.delete("/api/character").set("Origin", env.corsOrigin).expect(204);
  const saved = (await agent.get("/api/character").expect(200)).body.data;
  assert.equal(saved.deepSeaFloor, 3); assert.equal(saved.deepSeaMothUnlocked, true);
});

test("Lord summoned Knights persist as battle enemies and cannot award rewards twice", async () => {
  const userId = "deepsea-summons";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Knight hunter", passwordHash: await hashPassword("Test123!") } });
  const hero = await prisma.character.create({ data: { userId, name: "Rifle", weapon: "rifle", upgradeLevel: 2 } });
  await prisma.artifact.create({ data: { userId, characterId: hero.id, stat: "hp", enhancementLevel: 10000 } });
  const encounter = await prisma.encounter.create({ data: { userId, enemyType: "fishpeople-lord", location: "deepsea-palace", teamIds: [hero.id] } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const result = (await agent.post(`/api/encounters/${encounter.id}/resolve`).set("Origin", env.corsOrigin).expect(200)).body.data;
  assert.equal(result.won, true); assert.equal(result.enemies.length, 3);
  assert.equal(result.goldEarned, 1500); assert.equal(result.expEarned, 3);
  assert.equal(result.enemies.filter((enemy: { summoned: boolean }) => enemy.summoned).length, 2);
  assert.equal(await prisma.encounter.count({ where: { userId, enemyType: "fishpeople-knight" } }), 2);
  for (const enemy of result.enemies) await agent.post(`/api/encounters/${enemy.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(saved.gold, 1500); assert.equal(saved.experience, 3);
});
