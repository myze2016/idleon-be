import "./setup.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { levelGrant, MAX_GRANT_LEVEL } from "../src/routes/account-grants.routes.js";
import { accountProgress } from "../src/models/account-progress.js";
import { defaultBalance } from "../src/services/balance.service.js";
import { withBalance } from "../src/models/balance-context.js";

test("level grants preserve level progress, apply normal wish rewards and respect XP capacity", () => {
  assert.equal(MAX_GRANT_LEVEL, 28);
  const grant = levelGrant(15, 2);
  assert.equal(grant.experience, 75); assert.equal(grant.level, 4); assert.equal(grant.wishEarned, 200);
  assert.equal(accountProgress(grant.experience).exp, 5);
  assert.equal(levelGrant(0, 27).level, 28);
  assert.throws(() => levelGrant(2147483647, 1));
  assert.throws(() => levelGrant(0, 28)); assert.throws(() => levelGrant(0, 0));
});

test("direct EXP tables with cheaper later levels still grant exactly the requested levels", () => {
  const config = defaultBalance(); config.economy!.levelExp = [100, 10];
  withBalance(config, () => {
    const grant = levelGrant(90, 1);
    assert.equal(grant.level, 2); assert.equal(grant.wishEarned, 100);
    assert.equal(accountProgress(grant.experience).level, 2);
    assert.equal(accountProgress(grant.experience).exp, 9);
  });
});

test("gold and account-level modules enforce admin access, audited retries and atomic tier grants", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "resource-admin", username: "resource_admin", name: "Resource Admin", role: "admin", passwordHash },
    { id: "resource-a", username: "resource_a", name: "Resource A", donationTier: 3, gold: 10, experience: 3, wishCurrency: 2, passwordHash },
    { id: "resource-b", username: "resource_b", name: "Resource B", donationTier: 3, gold: 20, experience: 15, wishCurrency: 4, passwordHash },
    { id: "resource-other", username: "resource_other", name: "Resource Other", donationTier: 1, gold: 5, passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app), root = "/api/admin/account-grants";
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "resource_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "resource_a", password: "Test123!" }).expect(200);
  const gold = root + "/gold/accounts/resource-a", levels = root + "/levels/accounts/resource-a";
  await request(app).post(gold).send({ amount: 100 }).expect(401);
  await player.post(gold).set("Origin", env.corsOrigin).send({ amount: 100 }).expect(403);
  await player.get(root + "/gold/tiers/3/preview").expect(403);
  await admin.post(gold).send({ amount: 100 }).expect(403);
  await admin.get(root + "/invalid/tiers/3/preview").expect(404);
  await admin.post(gold).set("Origin", env.corsOrigin).send({ amount: 100 }).expect(400);
  const goldKey = randomUUID();
  const grants = await Promise.all([1, 2, 3].map(() => admin.post(gold).set("Origin", env.corsOrigin).set("Idempotency-Key", goldKey).send({ amount: 100 })));
  grants.forEach(result => assert.equal(result.status, 200, JSON.stringify(result.body)));
  assert.equal(grants.filter(result => !result.body.data.alreadyApplied).length, 1);
  const first = await prisma.user.findUniqueOrThrow({ where: { id: "resource-a" } });
  assert.equal(first.gold, 110); assert.equal(first.experience, 3); assert.equal(first.wishCurrency, 2);
  const levelKey = randomUUID();
  const levelResult = await admin.post(levels).set("Origin", env.corsOrigin).set("Idempotency-Key", levelKey).send({ amount: 2 }).expect(200);
  assert.equal(levelResult.body.data.user.level, 3); assert.equal(levelResult.body.data.wishEarned, 200);
  await admin.post(levels).set("Origin", env.corsOrigin).set("Idempotency-Key", levelKey).send({ amount: 2 }).expect(200);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: "resource-a" } });
  assert.equal(after.gold, 110); assert.equal(after.experience, 33); assert.equal(after.wishCurrency, 202);
  await admin.post(levels).set("Origin", env.corsOrigin).set("Idempotency-Key", goldKey).send({ amount: 1 }).expect(409);
  await admin.post("/api/admin/users/resource-a/wish-currency").set("Origin", env.corsOrigin).set("Idempotency-Key", goldKey).send({ amount: 1 }).expect(409);
  for (const amount of [0, 1.5, "1", 28]) await admin.post(levels).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount }).expect(400);
  const preview = (await admin.get(root + "/gold/tiers/3/preview").expect(200)).body.data;
  assert.equal(preview.count, 2);
  await admin.post(root + "/gold/tiers").set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ tier: 3, amount: 50, recipientsHash: preview.recipientsHash }).expect(200);
  const tierKey = randomUUID();
  const bulkLevels = { tier: 3, amount: 2, recipientsHash: preview.recipientsHash };
  await admin.post(root + "/levels/tiers").set("Origin", env.corsOrigin).set("Idempotency-Key", tierKey).send(bulkLevels).expect(200);
  const a = await prisma.user.findUniqueOrThrow({ where: { id: "resource-a" } }), b = await prisma.user.findUniqueOrThrow({ where: { id: "resource-b" } });
  assert.equal(a.gold, 160); assert.equal(a.experience, 153); assert.equal(a.wishCurrency, 402);
  assert.equal(b.gold, 70); assert.equal(b.experience, 75); assert.equal(b.wishCurrency, 204);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "resource-other" } })).gold, 5);
  const entries = await prisma.accountGrantEntry.findMany({ where: { requestKey: tierKey } });
  assert.equal(entries.length, 2); assert.ok(entries.every(entry => entry.levelAfter - entry.levelBefore === 2 && entry.wishAfter - entry.wishBefore === 200));
  await prisma.user.update({ where: { id: b.id }, data: { experience: 2147483647 } });
  await admin.post(root + "/levels/tiers").set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send(bulkLevels).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).experience, a.experience);
  await prisma.user.update({ where: { id: b.id }, data: { experience: 75, donationTier: 1 } });
  await admin.post(root + "/gold/tiers").set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ ...bulkLevels, amount: 50 }).expect(409);
  const lookup = (await admin.get("/api/admin/donation-tiers?search=resource-a").expect(200)).body.data;
  assert.equal(lookup.users[0].gold, 160); assert.equal(lookup.users[0].level, 5);
  await prisma.user.update({ where: { id: "resource-admin" }, data: { role: "player" } });
  await admin.post(gold).set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 1 }).expect(403);
});
