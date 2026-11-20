import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { attachRealtimeServer } from "../src/services/realtime-server.js";
import { RealtimeBus } from "../src/services/realtime-bus.js";
import { verifyRealtimeTicket } from "../src/services/realtime-ticket.js";

type Packet = { type: string; id?: string; event?: { kind: string; userId?: string; x?: number; y?: number } };
function connection(url: string, ticket: string) {
  const socket = new WebSocket(url, { origin: env.corsOrigin });
  const packets: Packet[] = [], waiting = new Set<() => void>();
  socket.on("error", () => {});
  socket.on("message", raw => { packets.push(JSON.parse(raw.toString())); for (const check of [...waiting]) check(); });
  const closed = new Promise<number>(resolve => socket.once("close", code => resolve(code)));
  const wait = (predicate: (packet: Packet) => boolean) => new Promise<Packet>((resolve, reject) => {
    const timeout = setTimeout(() => { waiting.delete(check); reject(new Error("Realtime event timed out")); }, 4000);
    const check = () => { const index = packets.findIndex(predicate); if (index < 0) return; clearTimeout(timeout); waiting.delete(check); resolve(packets.splice(index, 1)[0]); };
    waiting.add(check); check();
  });
  socket.once("open", () => socket.send(JSON.stringify({ type: "auth", ticket })));
  return { socket, packets, wait, closed, send: (value: object) => socket.send(JSON.stringify(value)) };
}

test("realtime tickets authenticate sockets; movement, chat and PvP are scoped and revoked leases cannot move", async () => {
  const ids = ["realtime-a", "realtime-b", "realtime-c"];
  const passwordHash = await hashPassword("Realtime123!");
  await prisma.user.createMany({ data: ids.map(id => ({ id, username: id, name: id, passwordHash, starterCreated: true })) });
  await prisma.character.createMany({ data: ids.map(id => ({ userId: id, name: id, weapon: "sword_and_shield", isStarter: true })) });
  const agents = ids.map(() => request.agent(app));
  const server = createServer(app), stop = attachRealtimeServer(server, { broker: false, heartbeatMs: 250 });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No server address");
  const url = `ws://127.0.0.1:${address.port}/realtime`;
  const opened: ReturnType<typeof connection>[] = [];
  const post = (index: number, path: string, body = {}) => agents[index].post(`/api/${path}`).set("Origin", env.corsOrigin).send(body);
  try {
    await request(app).post("/api/realtime/ticket").set("Origin", env.corsOrigin).expect(401);
    for (const [index, agent] of agents.entries()) await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: ids[index], password: "Realtime123!" }).expect(200);
    await agents[0].post("/api/realtime/ticket").set("Origin", "https://evil.invalid").expect(403);
    await new Promise<void>((resolve, reject) => {
      const blocked = new WebSocket(url, { origin: "https://evil.invalid" });
      const timeout = setTimeout(() => { blocked.terminate(); reject(new Error("Origin check timed out")); }, 4000);
      blocked.on("error", () => {});
      blocked.once("open", () => { clearTimeout(timeout); blocked.terminate(); reject(new Error("Untrusted origin was accepted")); });
      blocked.once("unexpected-response", (_request, response) => {
        clearTimeout(timeout); response.resume(); blocked.terminate();
        if (response.statusCode === 403) resolve(); else reject(new Error("Untrusted origin was not rejected"));
      });
    });
    const memberships = [];
    memberships.push((await post(0, "gathering/join", { create: true }).expect(200)).body.data);
    memberships.push((await post(1, "gathering/join", { roomId: memberships[0].roomId }).expect(200)).body.data);
    memberships.push((await post(2, "gathering/join", { create: true }).expect(200)).body.data);
    let firstTicket = "";
    for (let index = 0; index < 3; index++) {
      const credentials = (await post(index, "realtime/ticket").expect(200)).body.data;
      assert.equal(new URL(credentials.url).pathname, "/realtime");
      if (!index) firstTicket = credentials.ticket;
      const peer = connection(url, credentials.ticket); opened.push(peer);
      await peer.wait(packet => packet.type === "ready");
      peer.send({ type: "subscribe", id: "g", channel: "gathering", ...memberships[index] });
      await peer.wait(packet => packet.type === "subscribed" && packet.id === "g");
    }
    const [a, b, c] = opened;
    a.send({ type: "move", id: "g", x: .65, y: .75 });
    const movement = await b.wait(packet => packet.type === "event" && packet.event?.kind === "move");
    assert.equal(movement.event!.userId, ids[0]); assert.equal(movement.event!.x, .65);
    assert.equal((await prisma.gatheringMember.findUniqueOrThrow({ where: { userId: ids[0] } })).x, .65);
    assert.ok(!c.packets.some(packet => packet.event?.kind === "move"));
    await post(0, `gathering/${memberships[0].roomId}/chat`, { token: memberships[0].token, body: "Instant room hello" }).expect(201);
    await b.wait(packet => packet.event?.kind === "gathering");
    const code = (await post(0, "pvp").expect(201)).body.data.code;
    await post(1, `pvp/${code}/join`).expect(200);
    for (const peer of [a, b]) for (const channel of ["pvp", "pvp-chat"]) {
      peer.send({ type: "subscribe", id: channel, channel, code });
      await peer.wait(packet => packet.type === "subscribed" && packet.id === channel);
    }
    c.send({ type: "subscribe", id: "private", channel: "pvp", code });
    await c.wait(packet => packet.type === "error" && packet.id === "private");
    const fighter = await prisma.character.findFirstOrThrow({ where: { userId: ids[0] } });
    await post(0, `pvp/${code}/select`, { characterIds: [fighter.id] }).expect(200);
    await b.wait(packet => packet.event?.kind === "pvp");
    await post(0, `pvp/${code}/chat`, { body: "Instant duel hello" }).expect(201);
    await b.wait(packet => packet.event?.kind === "pvp-chat");
    assert.ok(!c.packets.some(packet => packet.event?.kind === "pvp" || packet.event?.kind === "pvp-chat"));
    await post(0, "gathering/join", { roomId: memberships[0].roomId }).expect(200);
    await a.wait(packet => packet.type === "error" && packet.id === "g");
    a.send({ type: "move", id: "g", x: .9, y: .9 });
    await a.wait(packet => packet.type === "error" && packet.id === "g");
    assert.equal((await prisma.gatheringMember.findUniqueOrThrow({ where: { userId: ids[0] } })).x, .65);
    const tampered = connection(url, firstTicket.slice(0, -8) + "tampered"); opened.push(tampered);
    assert.equal(await tampered.closed, 4001);
    assert.ok(!tampered.packets.some(packet => packet.type === "ready"));
    await post(0, "auth/logout").expect(204);
    await assert.rejects(verifyRealtimeTicket(firstTicket), /sign in again/);
    assert.equal(await a.closed, 4001);
  } finally {
    for (const peer of opened) peer.socket.terminate();
    await stop(); await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
});

test("PostgreSQL relays realtime events between independent backend instances", async () => {
  const first = new RealtimeBus(), second = new RealtimeBus();
  try {
    await Promise.all([first.start(), second.start()]);
    assert.ok(first.active && second.active);
    const delivered = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Cross-instance event timed out")), 4000);
      second.once("event", event => { clearTimeout(timeout); assert.deepEqual(event, { kind: "gathering", roomId: 4321 }); resolve(); });
    });
    first.publish({ kind: "gathering", roomId: 4321 }); await delivered;
  } finally { await Promise.all([first.stop(), second.stop()]); }
});
