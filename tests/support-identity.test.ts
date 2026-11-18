import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";

test("support identification saves only four digits to the signed-in account and is private to admins", async () => {
  const passwordHash = await hashPassword("IdentityTest123!");
  await prisma.user.createMany({ data: [
    { id: "identity-player", username: "identity_player", name: "Player", passwordHash },
    { id: "identity-other", username: "identity_other", name: "Other", passwordHash },
    { id: "identity-admin", username: "identity_admin", name: "Admin", passwordHash, role: "admin" },
  ] });
  const player = request.agent(app), other = request.agent(app), admin = request.agent(app);
  for (const [agent, username] of [[player, "identity_player"], [other, "identity_other"], [admin, "identity_admin"]] as const) {
    await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username, password: "IdentityTest123!" }).expect(200);
  }
  await request(app).post("/api/support/identity").send({ phoneLast4: "0012" }).expect(401);
  await player.post("/api/support/identity").send({ phoneLast4: "0012" }).expect(403);
  await player.post("/api/support/identity").set("Origin", env.corsOrigin).send({ phoneLast4: "0012" }).expect(200);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: "identity-player" } });
  assert.equal(stored.supportPhoneLast4, "0012"); assert.ok(stored.supportIdentifiedAt);
  assert.equal(stored.donationTier, 0); assert.equal(stored.gold, 0); assert.equal(stored.wishCurrency, 0);
  assert.equal(await prisma.supportSubmission.count({ where: { userId: stored.id } }), 0);
  assert.equal((await player.get("/api/support").expect(200)).body.data.phoneLast4, "0012");
  assert.equal((await other.get("/api/support").expect(200)).body.data.phoneLast4, null);
  await player.get("/api/admin/support-identities").expect(403);
  await request(app).get("/api/admin/support-identities").expect(401);
  const listed = (await admin.get("/api/admin/support-identities").expect(200)).body.data.users;
  assert.equal(listed.find((user: { id: string }) => user.id === stored.id).supportPhoneLast4, "0012");
  await player.post("/api/auth/logout").set("Origin", env.corsOrigin).expect(204);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "identity_player", password: "IdentityTest123!" }).expect(200);
  assert.equal((await player.get("/api/support").expect(200)).body.data.phoneLast4, "0012");
  await player.post("/api/support/identity").set("Origin", env.corsOrigin).send({ phoneLast4: "4567" }).expect(200);
  for (const input of [{}, { phoneLast4: "123" }, { phoneLast4: "12345" }, { phoneLast4: "abcd" }, { phoneLast4: 1234 }, { phoneLast4: "1234", userId: "identity-other" }]) {
    await player.post("/api/support/identity").set("Origin", env.corsOrigin).send(input).expect(400);
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: stored.id } })).supportPhoneLast4, "4567");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "identity-other" } })).supportPhoneLast4, null);
});
