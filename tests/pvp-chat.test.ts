import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";

test("PvP chat is private, validates messages, preserves concurrent sends and rematch history, and closes safely", async () => {
  const passwordHash = await hashPassword("Chat123!");
  const agents = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [index, agent] of agents.entries()) {
    const username = `chat_${index}`;
    await prisma.user.create({ data: { id: username, username, name: `Chatter ${index}`, passwordHash } });
    await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username, password: "Chat123!" }).expect(200);
  }
  const [host, guest, outsider] = agents;
  const code = (await host.post("/api/pvp").set("Origin", env.corsOrigin).expect(201)).body.data.code;
  const room = `/api/pvp/${code}`, path = `${room}/chat`;
  await guest.post(`${room}/join`).set("Origin", env.corsOrigin).expect(200);
  await request(app).get(path).expect(401);
  await request(app).post(path).set("Origin", env.corsOrigin).send({ body: "Hello" }).expect(401);
  await outsider.get(path).expect(403);
  await outsider.post(path).set("Origin", env.corsOrigin).send({ body: "Intruder" }).expect(403);
  await host.post(path).set("Origin", "https://other.example").send({ body: "No" }).expect(403);
  assert.deepEqual((await host.get(path).expect(200)).body.data.messages, []);
  for (const body of [null, 4, {}, "", "  ", "x".repeat(301)]) await host.post(path).set("Origin", env.corsOrigin).send({ body }).expect(400);
  const sent = await host.post(path).set("Origin", env.corsOrigin).send({ body: "  Hello 👋 <script>alert(1)</script>  ", userId: "chat_2", name: "Spoofed" }).expect(201);
  const first = sent.body.data.messages[0];
  assert.equal(first.userId, "chat_0"); assert.equal(first.name, "Chatter 0");
  assert.equal(first.body, "Hello 👋 <script>alert(1)</script>");
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));
  assert.deepEqual((await guest.get(path).expect(200)).body.data.messages, [first]);
  await Promise.all([host.post(path).set("Origin", env.corsOrigin).send({ body: "Ready?" }).expect(201), guest.post(path).set("Origin", env.corsOrigin).send({ body: "Ready!" }).expect(201)]);
  const messages = (await guest.get(path).expect(200)).body.data.messages;
  assert.equal(messages.length, 3); assert.equal(new Set(messages.map((message: { id: string }) => message.id)).size, 3);
  assert.deepEqual(new Set(messages.map((message: { body: string }) => message.body)), new Set([first.body, "Ready?", "Ready!"]));
  await prisma.pvpRoom.update({ where: { code }, data: { status: "started", startsAt: new Date(Date.now() - 10000), result: { duration: 1 } } });
  await host.post(`${room}/return`).set("Origin", env.corsOrigin).expect(200);
  assert.deepEqual((await guest.get(path).expect(200)).body.data.messages, messages);
  const secondCode = (await outsider.post("/api/pvp").set("Origin", env.corsOrigin).expect(201)).body.data.code;
  assert.deepEqual((await outsider.get(`/api/pvp/${secondCode}/chat`).expect(200)).body.data.messages, []);
  await host.post(`${room}/leave`).set("Origin", env.corsOrigin).expect(200);
  await guest.post(path).set("Origin", env.corsOrigin).send({ body: "Too late" }).expect(409);
  assert.deepEqual((await guest.get(path).expect(200)).body.data.messages, messages);
  await prisma.pvpRoom.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await guest.post(path).set("Origin", env.corsOrigin).send({ body: "Expired" }).expect(404);
});

test("PvP chat bounds history to 100 messages and limits message bursts per account", async () => {
  const username = "chat_limit", password = "Chat123!";
  await prisma.user.create({ data: { id: username, username, name: "Chat Limit", passwordHash: await hashPassword(password) } });
  const host = request.agent(app);
  await host.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username, password }).expect(200);
  const code = (await host.post("/api/pvp").set("Origin", env.corsOrigin).expect(201)).body.data.code;
  const old = Array.from({ length: 100 }, (_, index) => ({ id: `old${index}`, userId: username, name: "Chat Limit", body: `Message ${index}`, createdAt: new Date().toISOString() }));
  await prisma.pvpRoom.update({ where: { code }, data: { messages: old } });
  for (let index = 0; index < 30; index++) await host.post(`/api/pvp/${code}/chat`).set("Origin", env.corsOrigin).send({ body: `New ${index}` }).expect(201);
  await host.post(`/api/pvp/${code}/chat`).set("Origin", env.corsOrigin).send({ body: "Limited" }).expect(429);
  const messages = (await host.get(`/api/pvp/${code}/chat`).expect(200)).body.data.messages;
  assert.equal(messages.length, 100); assert.equal(messages[0].id, "old30"); assert.equal(messages.at(-1).body, "New 29");
});
