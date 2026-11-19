import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { joinGathering, gatheringPresence, leaveGathering, GATHERING_CAPACITY, PRESENCE_TTL } from "../src/repositories/gathering.repository.js";

test("gathering capacity is atomic, stale members release slots, and newer tabs own their presence", async () => {
  const passwordHash = await hashPassword("Test123!");
  const ids = Array.from({ length: 13 }, (_, i) => `gather-cap-${i}`);
  await prisma.user.createMany({ data: ids.map(id => ({ id, username: id, name: id, passwordHash, starterCreated: true })) });
  await prisma.character.createMany({ data: ids.map(id => ({ userId: id, name: "Knight", weapon: "sword_and_shield", isStarter: true })) });
  const room = await prisma.gatheringRoom.create({ data: {} });
  try {
    const arrivals = await Promise.allSettled(ids.map(id => joinGathering(id, room.id)));
    assert.equal(arrivals.filter(result => result.status === "fulfilled").length, GATHERING_CAPACITY);
    assert.equal(await prisma.gatheringMember.count({ where: { roomId: room.id } }), 12);
    const rejectedIndex = arrivals.findIndex(result => result.status === "rejected");
    const admittedIndex = arrivals.findIndex(result => result.status === "fulfilled");
    const first = arrivals[admittedIndex]; assert.equal(first.status, "fulfilled");
    if (first.status !== "fulfilled") throw new Error("No admitted member");
    const next = await joinGathering(ids[admittedIndex], room.id);
    assert.notEqual(first.value.token, next.token);
    await leaveGathering(ids[admittedIndex], room.id, first.value.token);
    assert.ok(await prisma.gatheringMember.findUnique({ where: { userId: ids[admittedIndex] } }));
    await assert.rejects(gatheringPresence(ids[admittedIndex], room.id, first.value.token, .5, .7), /session ended/);
    await prisma.gatheringMember.update({ where: { userId: ids[admittedIndex] }, data: { lastSeen: new Date(Date.now() - PRESENCE_TTL - 1000) } });
    await joinGathering(ids[rejectedIndex], room.id);
    assert.equal(await prisma.gatheringMember.count({ where: { roomId: room.id } }), 12);
    assert.equal(await prisma.gatheringMember.findUnique({ where: { userId: ids[admittedIndex] } }), null);
    const overflow = await joinGathering(ids[admittedIndex]);
    assert.notEqual(overflow.roomId, room.id);
    const stillOverflow = await joinGathering(ids[admittedIndex], undefined, false, true);
    assert.equal(stillOverflow.roomId, overflow.roomId);
    const departing = await prisma.gatheringMember.findFirstOrThrow({ where: { roomId: room.id } });
    await leaveGathering(departing.userId, room.id, departing.token);
    const automatic = await joinGathering(ids[admittedIndex], undefined, false, true);
    assert.equal(automatic.roomId, room.id);
    const reenter = await joinGathering(ids[admittedIndex], undefined, false, true);
    assert.equal(reenter.roomId, room.id); // Their own slot remains usable in a full room.
  } finally { await prisma.gatheringRoom.deleteMany(); }
});

test("gathering chat is scoped, movement is validated, and PvP requires the recipient's consent", async () => {
  const passwordHash = await hashPassword("Test123!");
  const ids = ["gather-host", "gather-guest", "gather-other"];
  await prisma.user.createMany({ data: ids.map(id => ({ id, username: id, name: id, passwordHash, starterCreated: true })) });
  await prisma.character.createMany({ data: ids.map(id => ({ userId: id, name: "Knight", weapon: "sword_and_shield", isStarter: true })) });
  const [host, guest, other] = ids.map(() => request.agent(app));
  for (const [index, agent] of [host, guest, other].entries()) await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: ids[index], password: "Test123!" }).expect(200);
  await request(app).get("/api/gathering").expect(401);
  await host.post("/api/gathering/join").send({}).expect(403);
  const h = (await host.post("/api/gathering/join").set("Origin", env.corsOrigin).send({ create: true }).expect(200)).body.data;
  const g = (await guest.post("/api/gathering/join").set("Origin", env.corsOrigin).send({ roomId: h.roomId }).expect(200)).body.data;
  const o = (await other.post("/api/gathering/join").set("Origin", env.corsOrigin).send({ create: true }).expect(200)).body.data;
  const post = (agent: typeof host, membership: typeof h, path: string, body = {}) => agent.post(`/api/gathering/${membership.roomId}/${path}`).set("Origin", env.corsOrigin).send({ token: membership.token, ...body });
  try {
    await post(host, h, "presence", { x: Infinity, y: .7 }).expect(400);
    await post(host, h, "presence", { x: .5, y: .1 }).expect(400);
    await post(other, h, "presence", { x: .5, y: .7 }).expect(409);
    const text = "Hello <b>adventurers</b>!";
    await post(host, h, "chat", { body: "x".repeat(201) }).expect(400);
    await post(host, h, "chat", { body: text }).expect(201);
    await post(host, h, "chat", { body: "too soon" }).expect(429);
    const state = (await post(guest, g, "presence", { x: .6, y: .7 }).expect(200)).body.data;
    assert.equal(state.players.length, 2); assert.equal(state.capacity, 12);
    assert.equal(state.messages[0].body, text);
    assert.equal(state.messages[0].username, ids[0]);
    assert.ok(!JSON.stringify(state).includes("passwordHash"));
    const privateState = (await post(other, o, "presence", { x: .5, y: .7 }).expect(200)).body.data;
    assert.equal(privateState.messages.length, 0);
    await post(host, h, "challenge", { targetId: ids[0] }).expect(400);
    await post(host, h, "challenge", { targetId: ids[2] }).expect(409);
    const challenge = (await post(host, h, "challenge", { targetId: ids[1] }).expect(201)).body.data;
    await post(host, h, `challenge/${challenge.id}/answer`, { accept: true }).expect(403);
    assert.equal(await prisma.pvpRoom.count({ where: { hostId: ids[0] } }), 0);
    const accepted = await Promise.all([1, 2].map(() => post(guest, g, `challenge/${challenge.id}/answer`, { accept: true }).expect(200)));
    const code = accepted[0].body.data.code;
    assert.equal(accepted[1].body.data.code, code);
    assert.equal(await prisma.pvpRoom.count({ where: { hostId: ids[0] } }), 1);
    const duel = await prisma.pvpRoom.findUniqueOrThrow({ where: { code } });
    assert.equal(duel.guestId, ids[1]); assert.equal(duel.status, "waiting");
    assert.equal((await post(host, h, "presence", { x: .5, y: .7 }).expect(200)).body.data.pvpCode, code);
    await other.post(`/api/pvp/${code}/join`).set("Origin", env.corsOrigin).expect(409);
    await guest.post(`/api/pvp/${code}/leave`).set("Origin", env.corsOrigin).expect(200);
    const next = (await post(host, h, "challenge", { targetId: ids[1] }).expect(201)).body.data;
    await post(guest, g, `challenge/${next.id}/answer`, { accept: false }).expect(200);
    await post(guest, g, `challenge/${next.id}/answer`, { accept: true }).expect(409);
    const expiring = (await post(host, h, "challenge", { targetId: ids[1] }).expect(201)).body.data;
    await prisma.gatheringChallenge.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await post(guest, g, `challenge/${expiring.id}/answer`, { accept: true }).expect(409);
    const departing = (await post(host, h, "challenge", { targetId: ids[1] }).expect(201)).body.data;
    await post(host, h, "leave").expect(200);
    await post(guest, g, `challenge/${departing.id}/answer`, { accept: true }).expect(409);
  } finally {
    await prisma.gatheringRoom.deleteMany();
    await prisma.pvpRoom.deleteMany({ where: { hostId: ids[0] } });
  }
});
