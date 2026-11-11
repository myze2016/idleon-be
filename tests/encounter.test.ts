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
  assert.ok(battle.teamMp[0] < 150);
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
  assert.equal(first.body.data.gold, 10);
  for (const enemyType of ["boar", "slime", "plant"] as const) {
    const encounter = await prisma.encounter.create({ data: { userId: "meadow-user", enemyType, teamIds } });
    const resolved = await agent.post(`/api/encounters/${encounter.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
    assert.equal(resolved.body.data.won, true);
    assert.equal(resolved.body.data.goldEarned, 10);
    assert.equal(resolved.body.data.steps.at(-1).enemyHp, 0);
  }
  const saved = await agent.get("/api/character").expect(200);
  assert.equal(saved.body.data.gold, 40);
  assert.deepEqual(saved.body.data.progression, { level: 1, totalExp: 4, exp: 4, expToNextLevel: 10 });
});

test("forest battles validate ownership and award exactly 10 gold once, including concurrent resolution", async () => {
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
  assert.equal(enemy.gold, 10);
  const repeated = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send(body).expect(201);
  assert.notEqual(repeated.body.data.id, enemy.id);
  const endpoint = `/api/encounters/${enemy.id}/resolve`;
  await prisma.user.update({ where: { id: "forest-user" }, data: { experience: 9 } });
  await other.post(endpoint).set("Origin", env.corsOrigin).expect(404);
  await agent.post(endpoint).set("Origin", "https://other.example").expect(403);
  const resolved = await Promise.all([1, 2].map(() => agent.post(endpoint).set("Origin", env.corsOrigin).send({ gold: 99999, experience: 99999, level: 999, won: true })));
  for (const response of resolved) {
    assert.equal(response.status, 200); assert.equal(response.body.data.won, true);
    assert.equal(response.body.data.goldEarned, 10); assert.equal(response.body.data.gold, 10);
    assert.equal(response.body.data.expEarned, 1);
    assert.deepEqual(response.body.data.progression, { level: 2, totalExp: 10, exp: 0, expToNextLevel: 20 });
    assert.equal(response.body.data.levelsGained, 1);
    assert.equal(response.body.data.wishEarned, 20);
    assert.equal(response.body.data.steps.at(-1).enemyHp, 0);
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).gold, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-other" } })).gold, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-other" } })).experience, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).experience, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "forest-user" } })).wishCurrency, created.body.data.wishCurrency + 20);
  const saved = await agent.get("/api/character").expect(200);
  assert.equal(saved.body.data.gold, 10);
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
