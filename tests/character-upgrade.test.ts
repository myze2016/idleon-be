import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { baseStats } from "../src/models/character-stats.js";
import type { Weapon } from "../src/generated/prisma/client.js";

test("repeatable upgrades charge 1k, apply all ten specified bonuses, stack with artifacts, and persist", async () => {
  const userId = "upgrade-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Upgrader", passwordHash: await hashPassword("Test123!"), starterCreated: true, gold: 200000 } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const definitions = [
    ["sword-and-shield", "hp", 10], ["dual-knife", "speed", 5],
    ["rifle", "atk", 5], ["great-sword", "atk", 5], ["book", "mp", 10], ["staff", "magic", 5],
    ["axe", "atk", 5], ["spear", "atk", 5], ["dual-gun", "speed", 5], ["bow", "speed", 5],
  ] as const;
  for (const [weapon, stat, amount] of definitions) {
    const character = await prisma.character.create({ data: { userId, name: weapon, weapon: weapon.replaceAll("-", "_") as Weapon } });
    const endpoint = `/api/character/${character.id}/upgrade`;
    for (let level = 1; level <= 2; level++) {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const response = await agent.post(endpoint).set("Origin", env.corsOrigin).send({ cost: 0, stat: "hp", amount: 999 }).expect(200);
      const saved = response.body.data.characters.find((member: { id: string }) => member.id === character.id);
      assert.equal(response.body.data.gold, before.gold - 1000);
      assert.equal(saved.upgradeLevel, level);
      assert.deepEqual(saved.stats, { ...baseStats[weapon], [stat]: baseStats[weapon][stat] + amount * level });
    }
    if (weapon === "rifle") {
      await prisma.artifact.create({ data: { userId, characterId: character.id, stat: "atk" } });
      const spawn = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [character.id], newExpedition: true }).expect(201);
      await prisma.encounter.update({ where: { id: spawn.body.data.id }, data: { enemyType: "plant" } });
      await prisma.user.update({ where: { id: userId }, data: { expeditionVitals: { [character.id]: { hp: 100, mp: 0 } } } });
      const battle = await agent.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
      assert.equal(battle.body.data.steps.find((step: { kind: string; actor: string }) => step.kind === "attack" && step.actor === "team").damage, 25);
    }
    if (weapon === "book") {
      const spawn = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [character.id], newExpedition: true }).expect(201);
      const battle = await agent.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
      assert.deepEqual(battle.body.data.initialTeamMp, [120]);
    }
    if (weapon === "sword-and-shield") {
      const spawn = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [character.id], newExpedition: true }).expect(201);
      const battle = await agent.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
      assert.deepEqual(battle.body.data.initialTeamHp, [120]);
    }
  }
  await agent.post("/api/auth/logout").set("Origin", env.corsOrigin).expect(204);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const restored = await agent.get("/api/character").expect(200);
  assert.ok(restored.body.data.characters.every((member: { upgradeLevel: number }) => member.upgradeLevel === 2));
  const bow = restored.body.data.characters.find((member: { weapon: string }) => member.weapon === "bow");
  assert.equal(bow.timing.attackInterval, 1 / 1.2);
  assert.equal(bow.timing.spellCastTime, 1 / 1.2);
  const assassin = restored.body.data.characters.find((member: { weapon: string }) => member.weapon === "dual-knife");
  assert.equal(assassin.timing.attackInterval, 1 / 1.2);
  assert.equal(assassin.timing.spellCastTime, 1 / 1.2);
});

test("upgrades validate ownership and class, and concurrent requests cannot overspend", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [{ id: "upgrade-poor", username: "upgrade-poor", name: "Poor", passwordHash, gold: 1000 }, { id: "upgrade-other", username: "upgrade-other", name: "Other", passwordHash }] });
  const userId = "upgrade-poor", agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const own = await prisma.character.create({ data: { userId, name: "Axe", weapon: "axe" } });
  const other = await prisma.character.create({ data: { userId: "upgrade-other", name: "Other", weapon: "axe" } });
  const unsupported = await prisma.character.create({ data: { userId, name: "Wand", weapon: "wand" } });
  const upgrade = (id: string) => agent.post(`/api/character/${id}/upgrade`).set("Origin", env.corsOrigin);
  await request(app).post(`/api/character/${own.id}/upgrade`).set("Origin", env.corsOrigin).expect(401);
  await agent.post(`/api/character/${own.id}/upgrade`).expect(403);
  await upgrade(other.id).expect(404);
  await upgrade(unsupported.id).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).gold, 1000);
  const results = await Promise.all([upgrade(own.id), upgrade(own.id)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await prisma.character.findUniqueOrThrow({ where: { id: own.id } })).upgradeLevel, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).gold, 0);
});
