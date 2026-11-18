import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";

test("admins grant account wishes by player/character lookup with atomic audit and duplicate protection", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "grant-admin", username: "grant_admin", name: "Grant Admin", role: "admin", passwordHash },
    { id: "grant-player", username: "grant_player", name: "Grant Player", passwordHash },
    { id: "grant-other", username: "grant_other", name: "Grant Other", passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app);
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "grant_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "grant_player", password: "Test123!" }).expect(200);
  await player.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Gift Hero", weapon: "bow" }).expect(201);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: "grant-player" } });
  const path = "/api/admin/users/grant-player/wish-currency", key = randomUUID();
  await request(app).post(path).send({ amount: 35 }).expect(401);
  await player.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", key).send({ amount: 35 }).expect(403);
  await admin.post(path).set("Idempotency-Key", key).send({ amount: 35 }).expect(403);
  await admin.post(path).set("Origin", "https://other.example").set("Idempotency-Key", key).send({ amount: 35 }).expect(403);
  const found = await admin.get("/api/admin/donation-tiers?search=GIFT%20HERO").expect(200);
  assert.equal(found.body.data.users.length, 1); assert.equal(found.body.data.users[0].id, "grant-player");
  assert.equal(found.body.data.users[0].wishCurrency, 100);
  assert.equal(found.body.data.users[0].characters[0].name, "Gift Hero");
  assert.equal(found.body.data.users[0].passwordHash, undefined);
  for (const amount of [0, -1, 1.5, "100", null, 1000001]) await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount }).expect(400);
  await admin.post(path).set("Origin", env.corsOrigin).send({ amount: 35 }).expect(400);
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 35, role: "admin" }).expect(400);
  const results = await Promise.all([1, 2, 3].map(() => admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", key).send({ amount: 35 })));
  results.forEach((result) => { assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.data.user.wishCurrency, 135); });
  assert.equal((await player.get("/api/character").expect(200)).body.data.wishCurrency, 135);
  const audit = await prisma.wishCurrencyGrant.findMany({ where: { userId: "grant-player" } });
  assert.equal(audit.length, 1); assert.equal(audit[0].adminId, "grant-admin");
  assert.equal(audit[0].amount, 35); assert.equal(audit[0].balanceBefore, 100); assert.equal(audit[0].balanceAfter, 135);
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", key).send({ amount: 36 }).expect(409);
  await admin.post("/api/admin/users/grant-other/wish-currency").set("Origin", env.corsOrigin).set("Idempotency-Key", key).send({ amount: 35 }).expect(409);
  await admin.post("/api/admin/users/missing/wish-currency").set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 35 }).expect(404);
  await admin.patch("/api/admin/users/grant-player/donation-tier").set("Origin", env.corsOrigin).send({ tier: 2 }).expect(200);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: "grant-player" } });
  assert.equal(after.wishCurrency, 135); assert.equal(after.donationTier, 2);
  for (const field of ["gold", "experience", "passwordHash", "role"] as const) assert.equal(after[field], before[field]);
  await prisma.user.update({ where: { id: "grant-player" }, data: { wishCurrency: 2147483647 } });
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 1 }).expect(409);
  assert.equal(await prisma.wishCurrencyGrant.count({ where: { userId: "grant-player" } }), 1);
  await prisma.user.update({ where: { id: "grant-admin" }, data: { role: "player" } });
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 1 }).expect(403);
});
