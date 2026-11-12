import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { verifyPassword } from "../src/utils/password.js";

test("registration creates a player session, stores a hash, and grants starter wishes once", async () => {
  const agent = request.agent(app);
  const password = "NewPlayer123!";
  const response = await agent.post("/api/auth/register").set("Origin", env.corsOrigin)
    .send({ username: " New_Player ", password, confirmPassword: password, role: "admin", gold: 999999, wishCurrency: 999 }).expect(201);
  const user = response.body.data.user;
  assert.equal(user.username, "new_player");
  assert.equal(user.role, "player");
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.password, undefined);
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
  assert.equal((await agent.get("/api/auth/me").expect(200)).body.data.user.id, user.id);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.notEqual(stored.passwordHash, password);
  assert.equal(await verifyPassword(password, stored.passwordHash), true);
  assert.equal(stored.gold, 0); assert.equal(stored.wishCurrency, 0); assert.equal(stored.starterCreated, false);
  assert.equal((await agent.get("/api/character").expect(200)).body.data.character, null);
  await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "New Hero", weapon: "bow" }).expect(201);
  await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Another Hero", weapon: "axe" }).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).wishCurrency, 100);
  await agent.post("/api/auth/logout").set("Origin", env.corsOrigin).expect(204);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "NEW_PLAYER", password }).expect(200);
  assert.equal((await agent.get("/api/auth/me").expect(200)).body.data.user.role, "player");
});

test("registration validates input, rejects duplicate usernames atomically, and limits attempts", async () => {
  const valid = { username: "duel_player", password: "Player123!", confirmPassword: "Player123!" };
  for (const origin of [undefined, "https://other.example"]) {
    const req = request(app).post("/api/auth/register");
    if (origin) req.set("Origin", origin);
    await req.send(valid).expect(403);
  }
  const invalid = request.agent(app);
  for (const input of [{}, { ...valid, username: {} }, { ...valid, username: "ab" }, { ...valid, username: "bad name" },
    { ...valid, password: "short", confirmPassword: "short" }, { ...valid, confirmPassword: "different" }, { ...valid, password: "a".repeat(257) }]) {
    await invalid.post("/api/auth/register").set("Origin", env.corsOrigin).send(input).expect(400);
  }
  await invalid.get("/api/auth/me").expect(401);
  const results = await Promise.all([valid, { ...valid, username: "DUEL_PLAYER" }].map((input) =>
    request(app).post("/api/auth/register").set("Origin", env.corsOrigin).send(input)));
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await prisma.user.count({ where: { username: valid.username } }), 1);
  await request(app).post("/api/auth/register").set("Origin", env.corsOrigin).send(valid).expect(429);
});
