import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";

test("economy admin authorization, publication, version conflicts and actual gold charges", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "economy-admin", username: "economy_admin", name: "Economy Admin", role: "admin", passwordHash },
    { id: "economy-player", username: "economy_player", name: "Economy Player", passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app), path = "/api/admin/economy";
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "economy_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "economy_player", password: "Test123!" }).expect(200);
  await request(app).get(path).expect(401);
  await player.get(path).expect(403);
  const catalog = (await admin.get(path).expect(200)).body.data;
  const settings = structuredClone(catalog.settings);
  settings.levelExp = [10, 15, 23];
  settings.artifactEnhancements[0] = { cost: 1000, gain: 3 };
  settings.artifactEnhancements[1] = { cost: 1500, gain: 7 };
  settings.characterUpgrades["sword-and-shield"][0] = { cost: 1000, gain: 12 };
  settings.characterUpgrades["sword-and-shield"][1] = { cost: 1200, gain: 25 };
  settings.skillUnlockCost = 777;
  settings.shopPrices.hp = 321;
  await admin.put(path).send({ version: catalog.version, settings }).expect(403);
  await admin.put(path).set("Origin", env.corsOrigin).send({ version: catalog.version, settings: { ...settings, levelExp: [0] } }).expect(400);
  await admin.put(path).set("Origin", env.corsOrigin).send({ version: catalog.version, settings }).expect(200);
  try {
    assert.deepEqual((await admin.get(path).expect(200)).body.data.settings, settings);
    await admin.put(path).set("Origin", env.corsOrigin).send({ version: catalog.version, settings }).expect(409);
    const balance = (await admin.get("/api/admin/balance").expect(200)).body.data;
    assert.deepEqual(balance.config.economy, settings);
    const created = (await player.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Knight", weapon: "sword-and-shield" }).expect(201)).body.data;
    const characterId = created.characters[0].id;
    await prisma.user.update({ where: { id: "economy-player" }, data: { gold: 10000 } });
    const purchased = (await player.post("/api/character/artifacts/buy").set("Origin", env.corsOrigin).send({ stat: "hp", price: 0 }).expect(201)).body.data;
    assert.equal(purchased.gold, 9679);
    const artifactId = purchased.artifacts[0].id;
    const enhanced = (await player.post(`/api/character/artifacts/${artifactId}/enhance`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(enhanced.gold, 8679); assert.equal(enhanced.artifacts[0].enhanceCost, 1500);
    const enhancedAgain = (await player.post(`/api/character/artifacts/${artifactId}/enhance`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(enhancedAgain.gold, 7179);
    const upgraded = (await player.post(`/api/character/${characterId}/upgrade`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(upgraded.characters[0].stats.hp, 112);
    assert.equal(upgraded.gold, 6179); assert.equal(upgraded.characters[0].upgrade.cost, 1200);
    const upgradedAgain = (await player.post(`/api/character/${characterId}/upgrade`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(upgradedAgain.characters[0].stats.hp, 137);
    assert.equal(upgradedAgain.gold, 4979);
    const equipped = (await player.post(`/api/character/${characterId}/artifact`).set("Origin", env.corsOrigin).send({ artifactId }).expect(200)).body.data;
    assert.equal(equipped.characters[0].stats.hp, 152);
    const unlocked = (await player.post(`/api/character/${characterId}/skill-2/unlock`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(unlocked.gold, 4202); assert.equal(unlocked.characters[0].skill2Unlocked, true);
    assert.equal((await player.post(`/api/character/${characterId}/skill-2/unlock`).set("Origin", env.corsOrigin).expect(200)).body.data.gold, 4202);
    const accounts = (await admin.get("/api/admin/donation-tiers?search=economy_player").expect(200)).body.data;
    assert.ok(accounts.maxLevel > 28);
    const preview = (await admin.get("/api/admin/account-grants/levels/tiers/0/preview").expect(200)).body.data;
    assert.equal(preview.maxLevel, accounts.maxLevel);
    const granted = (await admin.post("/api/admin/account-grants/levels/accounts/economy-player").set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 3 }).expect(200)).body.data;
    assert.equal(granted.user.level, 4);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "economy-player" } })).experience, 48);
    const updated = (await admin.get("/api/admin/balance").expect(200)).body.data;
    updated.config.stats.staff.hp += 1;
    await admin.put("/api/admin/balance").set("Origin", env.corsOrigin).send({ version: updated.version, config: updated.config }).expect(200);
    assert.deepEqual((await admin.get(path).expect(200)).body.data.settings, settings);
    const current = (await admin.get(path).expect(200)).body.data;
    const changed = structuredClone(settings);
    changed.artifactEnhancements[0].gain = 4;
    changed.characterUpgrades["sword-and-shield"][0].gain = 14;
    changed.skillUnlockCost = 12345;
    await admin.put(path).set("Origin", env.corsOrigin).send({ version: current.version, settings: changed }).expect(200);
    const recalculated = (await player.get("/api/character").expect(200)).body.data;
    assert.equal(recalculated.characters[0].stats.hp, 155);
    assert.equal(recalculated.characters[0].skill2Unlocked, true);
    assert.equal(recalculated.gold, 4202);
  } finally {
    await prisma.gameBalance.deleteMany();
    await prisma.balanceRevision.deleteMany();
  }
});
