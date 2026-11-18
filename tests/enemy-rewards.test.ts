import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { defaultBalance, normalizeBalance, validateBalance } from "../src/services/balance.service.js";
import { generatePatchNotes } from "../src/services/patch-notes.service.js";
import { withBalance } from "../src/models/balance-context.js";
import { enemies, enemyRewards } from "../src/models/enemy.js";

test("enemy rewards validate whole nonnegative amounts, support legacy configs and stay isolated", () => {
  const config = defaultBalance(); config.rewards.boar = { gold: 37, experience: 12 };
  validateBalance(config);
  const reward = withBalance(config, () => enemyRewards("boar"));
  assert.equal(reward.gold, 37); assert.equal(reward.experience, 12);
  assert.equal(enemies.boar.gold, 20); assert.equal(enemies.boar.experience, 1);
  const notes = generatePatchNotes(defaultBalance(), config);
  assert.deepEqual(notes, ["Boar — Gold reward: 20 → 37", "Boar — EXP reward: 1 → 12"]);
  const legacy = defaultBalance(); delete (legacy as Partial<typeof legacy>).rewards;
  assert.deepEqual(normalizeBalance(legacy).rewards.boar, { gold: 20, experience: 1 });
  for (const amount of [-1, 1.5, NaN, 1000001]) {
    const bad = defaultBalance(); bad.rewards.boar.gold = amount; assert.throws(() => validateBalance(bad));
    bad.rewards.boar = { gold: 0, experience: amount }; assert.throws(() => validateBalance(bad));
  }
  config.rewards.boar = { gold: 0, experience: 0 }; validateBalance(config);
});

test("published enemy gold and EXP reach Wiki and real battle payouts without duplicate claims", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "reward-admin", username: "reward_admin", name: "Reward Admin", role: "admin", passwordHash },
    { id: "reward-player", username: "reward_player", name: "Reward Player", passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app);
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "reward_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "reward_player", password: "Test123!" }).expect(200);
  const created = await player.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Archer", weapon: "bow" }).expect(201);
  const id = created.body.data.characters[0].id;
  const config = defaultBalance();
  for (const type of ["boar", "slime", "plant"]) config.rewards[type] = { gold: 37, experience: 12 };
  try {
    await admin.put("/api/admin/balance").set("Origin", env.corsOrigin).send({ version: 0, config }).expect(200);
    const wiki = (await player.get("/api/wiki/enemies").expect(200)).body.data;
    const boar = wiki.find((enemy: { id: string }) => enemy.id === "boar");
    assert.equal(boar.gold, 37); assert.equal(boar.experience, 12);
    const patches = (await player.get("/api/patch-notes").expect(200)).body.data.patches;
    assert.ok(patches[0].changes.includes("Boar — EXP reward: 1 → 12"));
    const before = await prisma.user.findUniqueOrThrow({ where: { id: "reward-player" } });
    const spawn = await player.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [id], newExpedition: true }).expect(201);
    const result = (await player.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(result.won, true); assert.equal(result.goldEarned, 37); assert.equal(result.expEarned, 12); assert.equal(result.wishEarned, 100);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.gold, before.gold + 37); assert.equal(after.experience, before.experience + 12); assert.equal(after.wishCurrency, before.wishCurrency + 100);
    await player.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
    const replay = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(replay.gold, after.gold); assert.equal(replay.experience, after.experience); assert.equal(replay.wishCurrency, after.wishCurrency);
    for (const type of ["boar", "slime", "plant"]) config.rewards[type] = { gold: 0, experience: 0 };
    await admin.put("/api/admin/balance").set("Origin", env.corsOrigin).send({ version: 1, config }).expect(200);
    const nextSpawn = await player.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [id], newExpedition: true }).expect(201);
    const zero = (await player.post(`/api/encounters/${nextSpawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200)).body.data;
    assert.equal(zero.goldEarned, 0); assert.equal(zero.expEarned, 0); assert.equal(zero.wishEarned, 0);
  } finally { await prisma.gameBalance.deleteMany(); await prisma.balanceRevision.deleteMany(); }
});
