import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { enemies } from "../src/models/enemy.js";
import { baseStats } from "../src/models/character-stats.js";
import { simulateBattle } from "../src/services/battle.service.js";

test("Meadow spawns one monster, Forest spawns 1–2, and a due boss always spawns alone", async () => {
  const userId = "wave-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Explorer", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Guardian", weapon: "sword-and-shield" }).expect(201);
  const teamIds = [created.body.data.characters[0].id];
  for (const location of ["meadow", "forest"]) {
    for (let i = 0; i < 4; i++) {
      const response = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location, teamIds, newExpedition: true, wave: true }).expect(201);
      const group = [response.body.data, ...response.body.data.additionalEnemies];
      if (location === "meadow") assert.equal(group.length, 1);
      else assert.ok(group.length >= 1 && group.length <= 2);
      assert.ok(group.every((enemy) => !enemy.boss && enemy.location === location));
      assert.equal(new Set(group.map((enemy) => enemy.id)).size, group.length);
      assert.equal(await prisma.encounter.count({ where: { userId } }), group.length);
    }
    await prisma.user.update({ where: { id: userId }, data: { meadowDefeats: 45, meadowBossAt: 45, forestDefeats: 45, forestBossAt: 45 } });
    const boss = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location, teamIds, newExpedition: true, wave: true }).expect(201);
    assert.equal(boss.body.data.boss, true);
    assert.deepEqual(boss.body.data.additionalEnemies, []);
    await agent.post("/api/encounters/return").set("Origin", env.corsOrigin).expect(204);
  }
});

test("returning to the room resets both boss cycles and removes old encounters without spending rewards", async () => {
  const userId = "return-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Explorer", passwordHash: await hashPassword("Test123!"), meadowDefeats: 20, meadowBossAt: 25, forestDefeats: 29, forestBossAt: 30, gold: 100, experience: 5, wishCurrency: 7 } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const encounter = await prisma.encounter.create({ data: { userId, enemyType: "boar", teamIds: [] } });
  await request(app).post("/api/encounters/return").set("Origin", env.corsOrigin).expect(401);
  await agent.post("/api/encounters/return").expect(403);
  await agent.post("/api/encounters/return").set("Origin", env.corsOrigin).expect(204);
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(saved.meadowDefeats, 0); assert.equal(saved.forestDefeats, 0);
  assert.equal(saved.meadowBossAt, null); assert.equal(saved.forestBossAt, null);
  assert.equal(saved.gold, 100); assert.equal(saved.experience, 5); assert.equal(saved.wishCurrency, 7);
  await agent.post(`/api/encounters/${encounter.id}/resolve`).set("Origin", env.corsOrigin).expect(404);
  await agent.post("/api/encounters/return").set("Origin", env.corsOrigin).expect(204);
});

test("expedition HP and MP persist between battles, replay safely, and recover on a new expedition", async () => {
  const userId = "vitals-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Explorer", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Mage", weapon: "staff" }).expect(201);
  const id = created.body.data.characters[0].id;
  const spawn = (newExpedition = false) => agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [id], newExpedition });
  const resolve = (encounterId: string) => agent.post(`/api/encounters/${encounterId}/resolve`).set("Origin", env.corsOrigin).send({ hp: 9999, mp: 9999 });
  const first = await spawn(true).expect(201);
  const battle = (await resolve(first.body.data.id).expect(200)).body.data;
  assert.deepEqual(battle.initialTeamHp, [50]);
  assert.deepEqual(battle.initialTeamMp, [150]);
  assert.ok(battle.teamHp[0] < 50);
  assert.ok(battle.teamMp[0] <= 150);
  assert.ok(battle.steps.some((step: { kind?: string; teamMp?: number[] }) => step.kind === "cast" && step.teamMp![0] < 150));
  const saved = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).expeditionVitals;
  await resolve(first.body.data.id).expect(200);
  assert.deepEqual((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).expeditionVitals, saved);
  const next = await spawn().expect(201);
  const second = (await resolve(next.body.data.id).expect(200)).body.data;
  assert.deepEqual(second.initialTeamHp, battle.teamHp);
  assert.deepEqual(second.initialTeamMp, battle.teamMp);
  const fresh = await spawn(true).expect(201);
  const recovered = (await resolve(fresh.body.data.id).expect(200)).body.data;
  assert.deepEqual(recovered.initialTeamHp, [50]);
  assert.deepEqual(recovered.initialTeamMp, [150]);
});

test("Meadow spawns its own enemies, replaces pending Forest encounters, and awards gold for all three types", async () => {
  await prisma.user.create({ data: { id: "meadow-user", username: "meadow-user", name: "Explorer", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "meadow-user", password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Meadow hero", weapon: "sword-and-shield" }).expect(201);
  const teamIds = [created.body.data.characters[0].id];
  const forest = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "forest", teamIds }).expect(201);
  const spawned = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds, enemyType: "warrior", gold: 999 }).expect(201);
  assert.ok(["boar", "slime", "plant"].includes(spawned.body.data.type));
  assert.notEqual(spawned.body.data.id, forest.body.data.id);
  await agent.post(`/api/encounters/${forest.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(404);
  const replay = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds }).expect(201);
  assert.notEqual(replay.body.data.id, spawned.body.data.id);
  const first = await agent.post(`/api/encounters/${spawned.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
  assert.equal(first.body.data.gold, 20);
  for (const enemyType of ["boar", "slime", "plant"] as const) {
    const encounter = await prisma.encounter.create({ data: { userId: "meadow-user", enemyType, teamIds } });
    const resolved = await agent.post(`/api/encounters/${encounter.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
    assert.equal(resolved.body.data.won, true);
    assert.equal(resolved.body.data.goldEarned, 20);
    assert.equal(resolved.body.data.steps.at(-1).enemyHp, 0);
  }
  const saved = await agent.get("/api/character").expect(200);
  assert.equal(saved.body.data.gold, 80);
  assert.deepEqual(saved.body.data.progression, { level: 1, totalExp: 4, exp: 4, expToNextLevel: 10 });
});

test("forest battles validate ownership and award exactly 20 gold once, including concurrent resolution", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "forest-user", username: "forest-user", name: "Explorer", passwordHash },
    { id: "forest-other", username: "forest-other", name: "Other", passwordHash },
  ] });
  const agent = request.agent(app), other = request.agent(app);
  for (const [client, username] of [[agent, "forest-user"], [other, "forest-other"]] as const) {
    await client.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username, password: "Test123!" }).expect(200);
  }
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Guardian", weapon: "sword-and-shield" }).expect(201);
  const teamIds = [created.body.data.characters[0].id];
  const body = { location: "forest", teamIds };
  await request(app).post("/api/encounters").set("Origin", env.corsOrigin).send(body).expect(401);
  await agent.post("/api/encounters").send(body).expect(403);
  await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ ...body, location: "desert" }).expect(400);
  await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ ...body, teamIds: [] }).expect(400);
  await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ ...body, teamIds: [...teamIds, ...teamIds] }).expect(400);
  await other.post("/api/encounters").set("Origin", env.corsOrigin).send(body).expect(400);
  const spawned = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send(body).expect(201);
  const enemy = spawned.body.data;
  assert.ok(enemy.type === "warrior" || enemy.type === "slinger");
  assert.deepEqual(enemy.stats, enemies[enemy.type as keyof typeof enemies].stats);
  assert.equal(enemy.gold, 20);
  const repeated = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send(body).expect(201);
  assert.notEqual(repeated.body.data.id, enemy.id);
  const endpoint = `/api/encounters/${enemy.id}/resolve`;
  await prisma.user.update({ where: { id: "forest-user" }, data: { experience: 9 } });
  await other.post(endpoint).set("Origin", env.corsOrigin).expect(404);
  await agent.post(endpoint).set("Origin", "https://other.example").expect(403);
  const resolved = await Promise.all([1, 2].map(() => agent.post(endpoint).set("Origin", env.corsOrigin).send({ gold: 99999, experience: 99999, level: 999, won: true })));
  for (const response of resolved) {
    assert.equal(response.status, 200); assert.equal(response.body.data.won, true);
    assert.equal(response.body.data.goldEarned, 20); assert.equal(response.body.data.gold, 20);
    assert.equal(response.body.data.expEarned, 1);
    assert.deepEqual(response.body.data.progression, { level: 2, totalExp: 10, exp: 0, expToNextLevel: 20 });
    assert.equal(response.body.data.levelsGained, 1);
    assert.equal(response.body.data.wishEarned, 100);
    assert.equal(response.body.data.steps.at(-1).enemyHp, 0);
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).gold, 20);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-other" } })).gold, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-other" } })).experience, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).experience, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).wishCurrency, created.body.data.wishCurrency + 100);
  const saved = await agent.get("/api/character").expect(200);
  assert.equal(saved.body.data.gold, 20);
  assert.deepEqual(saved.body.data.progression, { level: 2, totalExp: 10, exp: 0, expToNextLevel: 20 });
  await agent.delete("/api/character").set("Origin", env.corsOrigin).expect(204);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).gold, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).experience, 0);
  assert.equal(await prisma.encounter.count({ where: { userId: "forest-user" } }), 0);
  await agent.post(endpoint).set("Origin", env.corsOrigin).expect(404);
});

test("battle calculation uses defense, magic defense, speed, and actual remaining HP", () => {
  const guardian = simulateBattle([{ id: "guardian", stats: baseStats["sword-and-shield"] }], enemies.warrior.stats);
  assert.equal(guardian.won, true);
  assert.equal(guardian.steps[0].damage, 5);
  assert.equal(guardian.steps.find((step) => step.actor === "enemy")?.damage, 1);
  const mage = simulateBattle([{ id: "mage", stats: baseStats.staff }], enemies.warrior.stats);
  assert.equal(mage.steps[0].damage, 15);
  const weak = simulateBattle([{ id: "weak", stats: { ...baseStats.bow, hp: 1, atk: 0, magic: 0, speed: 0 } }], enemies.warrior.stats);
  assert.equal(weak.won, false);
  assert.equal(weak.steps.at(-1)?.teamHp[0], 0);
  assert.ok(weak.steps.at(-1)!.enemyHp > 0);
});
