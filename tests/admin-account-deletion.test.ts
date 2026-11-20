import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";

test("admin can delete a confirmed player account and revoke its sessions", async () => {
  const password = "Restart123!";
  const passwordHash = await hashPassword(password);
  const email = "fresh_restart@example.test";
  await prisma.user.createMany({ data: [
    { id: "restart-admin", username: "restart_admin", name: "Restart Admin", role: "admin", passwordHash },
    { id: "restart-player", username: "restart_player", name: "Restart Player", email, passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app);
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "restart_admin", password }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "restart_player", password }).expect(200);
  await player.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Restart Hero", weapon: "bow" }).expect(201);
  const path = "/api/admin/users/restart-player";
  await player.delete(path).set("Origin", env.corsOrigin).send({ username: "restart_player" }).expect(403);
  await admin.delete(path).send({ username: "restart_player" }).expect(403);
  await admin.delete(path).set("Origin", env.corsOrigin).send({ username: "wrong" }).expect(400);
  await admin.delete("/api/admin/users/restart-admin").set("Origin", env.corsOrigin).send({ username: "restart_admin" }).expect(403);
  await admin.delete(path).set("Origin", env.corsOrigin).send({ username: "restart_player" }).expect(204);
  await player.get("/api/auth/me").expect(401);
  assert.equal(await prisma.character.count({ where: { userId: "restart-player" } }), 0);
  const fresh = await prisma.user.create({ data: { username: "restart_player", email, name: "Fresh Player", passwordHash } });
  assert.equal(fresh.starterCreated, false);
  assert.equal(fresh.gold, 0);
});
