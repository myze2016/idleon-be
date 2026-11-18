import "./setup.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";

test("tier grants use exact previewed membership, atomic per-account audits and idempotent retries", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "tier-wish-admin", username: "tier_wish_admin", name: "Tier Admin", role: "admin", passwordHash },
    { id: "tier-wish-a", username: "tier_wish_a", name: "Recipient A", donationTier: 2, wishCurrency: 5, passwordHash },
    { id: "tier-wish-b", username: "tier_wish_b", name: "Recipient B", donationTier: 2, wishCurrency: 10, passwordHash },
    { id: "tier-wish-other", username: "tier_wish_other", name: "Other Tier", donationTier: 1, wishCurrency: 50, passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app);
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "tier_wish_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "tier_wish_a", password: "Test123!" }).expect(200);
  const path = "/api/admin/wish-currency/tiers";
  await request(app).get(path + "/2/preview").expect(401);
  await player.get(path + "/2/preview").expect(403);
  await player.post(path).set("Origin", env.corsOrigin).send({}).expect(403);
  await admin.get(path + "/4/preview").expect(400);
  const preview = (await admin.get(path + "/2/preview").expect(200)).body.data;
  assert.equal(preview.count, 2); assert.deepEqual(preview.sample.sort(), ["tier_wish_a", "tier_wish_b"]);
  assert.ok(/^[a-f0-9]{64}$/.test(preview.recipientsHash));
  const key = randomUUID(), body = { tier: 2, amount: 25, recipientsHash: preview.recipientsHash };
  await admin.post(path).send(body).expect(403);
  await admin.post(path).set("Origin", env.corsOrigin).send(body).expect(400);
  for (const amount of [0, -1, 1.5, "25", 1000001]) await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ ...body, amount }).expect(400);
  const responses = await Promise.all([1, 2, 3].map(() => admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", key).send(body)));
  responses.forEach(response => { assert.equal(response.status, 200); assert.equal(response.body.data.recipientCount, 2); assert.equal(response.body.data.total, 50); });
  assert.equal(responses.filter(response => !response.body.data.alreadyApplied).length, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "tier-wish-a" } })).wishCurrency, 30);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "tier-wish-b" } })).wishCurrency, 35);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "tier-wish-other" } })).wishCurrency, 50);
  const audits = await prisma.wishCurrencyGrant.findMany({ where: { batchId: key }, orderBy: { userId: "asc" } });
  assert.equal(audits.length, 2); assert.deepEqual(audits.map(a => [a.balanceBefore, a.balanceAfter]), [[5, 30], [10, 35]]);
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", key).send({ ...body, amount: 26 }).expect(409);
  await admin.post("/api/admin/users/tier-wish-a/wish-currency").set("Origin", env.corsOrigin).set("Idempotency-Key", key).send({ amount: 1 }).expect(409);
  await prisma.user.update({ where: { id: "tier-wish-b" }, data: { donationTier: 1 } });
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send(body).expect(409);
  const retry = await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", key).send(body).expect(200);
  assert.equal(retry.body.data.recipientCount, 2);
  await prisma.user.update({ where: { id: "tier-wish-b" }, data: { donationTier: 2, wishCurrency: 2147483647 } });
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send(body).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "tier-wish-a" } })).wishCurrency, 30);
  assert.equal(await prisma.wishCurrencyBatch.count({ where: { adminId: "tier-wish-admin" } }), 1);
  await prisma.user.update({ where: { id: "tier-wish-b" }, data: { wishCurrency: 35 } });
  const lookup = (await admin.get("/api/admin/donation-tiers?search=tier-wish-a").expect(200)).body.data;
  assert.equal(lookup.users.length, 1); assert.equal(lookup.users[0].id, "tier-wish-a");
  await prisma.user.update({ where: { id: "tier-wish-admin" }, data: { role: "player" } });
  await admin.post(path).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send(body).expect(403);
});
