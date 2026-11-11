import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import session, { type SessionData } from "express-session";
import { PrismaSessionStore } from "../src/repositories/session.store.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";

test("session data survives a new store instance, expires, and can be destroyed", async () => {
  const store = new PrismaSessionStore();
  const data: SessionData = { cookie: new session.Cookie({ maxAge: 60_000 }), user: { id: "test-admin", username: "admin", name: "Admin", role: "admin" } };
  await new Promise<void>((resolve, reject) => store.set("durable-session", data, (error) => error ? reject(error) : resolve()));
  const reopened = new PrismaSessionStore();
  const restored = await new Promise<SessionData | null | undefined>((resolve, reject) => reopened.get("durable-session", (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(restored?.user?.id, "test-admin");
  const later = new Date(Date.now() + 120_000);
  data.cookie.expires = later;
  await new Promise<void>((resolve, reject) => reopened.touch("durable-session", data, (error) => error ? reject(error) : resolve()));
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: "durable-session" } })).expiresAt.getTime(), later.getTime());
  await prisma.session.update({ where: { id: "durable-session" }, data: { expiresAt: new Date(0) } });
  const expired = await new Promise((resolve, reject) => reopened.get("durable-session", (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(expired, null);
  assert.equal(await prisma.session.count({ where: { id: "durable-session" } }), 0);
  await new Promise<void>((resolve, reject) => store.set("logout-session", data, (error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => reopened.destroy("logout-session", (error) => error ? reject(error) : resolve()));
  assert.equal(await prisma.session.count({ where: { id: "logout-session" } }), 0);
});

test("passwords are salted and verified without plaintext storage", async () => {
  const first = await hashPassword("Admin123!");
  const second = await hashPassword("Admin123!");
  assert.notEqual(first, second);
  assert.equal(first.includes("Admin123!"), false);
  assert.equal(await verifyPassword("Admin123!", first), true);
  assert.equal(await verifyPassword("wrong", first), false);
  assert.equal(await verifyPassword("Admin123!", "invalid"), false);
});
