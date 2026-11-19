import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "../lib/prisma.js";
import { isAllowedOrigin } from "../config/origin.js";
import { PRESENCE_TTL } from "../repositories/gathering.repository.js";
import { HttpError } from "../utils/http-error.js";
import { realtimeBus, type RealtimeEvent } from "./realtime-bus.js";
import { realtimeSession, verifyRealtimeTicket } from "./realtime-ticket.js";

type Subscription = { id: string; channel: "gathering" | "pvp" | "pvp-chat" | "pvp-lobby"; roomId?: number; token?: string; code?: string };
type Client = { userId?: string; sessionId?: string; authenticating: boolean; alive: boolean; subscriptions: Map<string, Subscription>; versions: Map<string, number>; window: number; count: number; moved: number; moving: boolean };
export function attachRealtimeServer(server: Server, options: { broker?: boolean; heartbeatMs?: number } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  const clients = new Map<WebSocket, Client>();
  const send = (socket: WebSocket, packet: object) => {
    if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); return; }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
  };
  const validGathering = async (userId: string, sub: Subscription) => !!await prisma.gatheringMember.findFirst({ where: { userId, roomId: sub.roomId, token: sub.token, lastSeen: { gte: new Date(Date.now() - PRESENCE_TTL) } }, select: { userId: true } });
  async function subscribe(userId: string, value: Record<string, unknown>): Promise<Subscription> {
    if (typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) throw new HttpError(400, "Invalid subscription");
    const id = value.id;
    if (value.channel === "gathering") {
      if (!Number.isSafeInteger(value.roomId) || Number(value.roomId) < 1 || Number(value.roomId) > 2147483647 || typeof value.token !== "string" || !/^[a-f0-9-]{36}$/i.test(value.token)) throw new HttpError(400, "Invalid gathering room");
      const sub: Subscription = { id, channel: "gathering", roomId: Number(value.roomId), token: value.token };
      if (!await validGathering(userId, sub)) throw new HttpError(409, "Join the gathering room again");
      return sub;
    }
    if (value.channel === "pvp-lobby") return { id, channel: "pvp-lobby" };
    if ((value.channel === "pvp" || value.channel === "pvp-chat") && typeof value.code === "string" && /^[A-F0-9]{10}$/.test(value.code)) {
      const room = await prisma.pvpRoom.findFirst({ where: { code: value.code, OR: [{ hostId: userId }, { guestId: userId }] }, select: { id: true } });
      if (!room) throw new HttpError(403, "You are not in this PvP room");
      return { id, channel: value.channel, code: value.code };
    }
    throw new HttpError(400, "Invalid subscription");
  }
  const receiveEvent = (event: RealtimeEvent) => {
    for (const [socket, client] of clients) for (const [id, sub] of client.subscriptions) {
      if (event.kind === "lease") {
        if (client.userId === event.userId && sub.channel === "gathering" && ((event.token && event.token !== sub.token) || (event.invalidatedToken && event.invalidatedToken === sub.token))) {
          client.subscriptions.delete(id); send(socket, { type: "error", id, message: "Join the gathering room again" });
        }
        continue;
      }
      const matching = (sub.channel === "gathering" && (event.kind === "move" || event.kind === "gathering") && sub.roomId === event.roomId)
        || (sub.channel === "pvp" && event.kind === "pvp" && sub.code === event.code)
        || (sub.channel === "pvp-chat" && event.kind === "pvp-chat" && sub.code === event.code)
        || (sub.channel === "pvp-lobby" && event.kind === "pvp-lobby");
      if (matching) send(socket, { type: "event", id, event });
    }
  };
  const health = (active: boolean) => { if (!active) for (const socket of clients.keys()) socket.close(1013, "Reconnect to realtime"); };
  realtimeBus.on("event", receiveEvent); realtimeBus.on("health", health);
  if (options.broker !== false) void realtimeBus.start();
  const upgrade: Parameters<Server["on"]>[1] = () => {};
  void upgrade; // Upgrade handling stays separate from Express's cookie-authenticated HTTP routes.
  const upgradeHandler = (request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/realtime") { socket.destroy(); return; }
    if (!isAllowedOrigin(request.headers.origin) || clients.size >= 1024) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit("connection", connection, request));
  };
  server.on("upgrade", upgradeHandler);
  sockets.on("connection", socket => {
    const client: Client = { authenticating: false, alive: true, subscriptions: new Map(), versions: new Map(), window: Date.now(), count: 0, moved: 0, moving: false };
    clients.set(socket, client);
    const timeout = setTimeout(() => { if (!client.userId) socket.close(4001, "Authentication required"); }, 5000); timeout.unref();
    socket.on("pong", () => { client.alive = true; });
    socket.on("error", () => {});
    socket.on("close", () => { clearTimeout(timeout); clients.delete(socket); });
    socket.on("message", async raw => {
      if (Date.now() - client.window >= 1000) { client.window = Date.now(); client.count = 0; }
      if (++client.count > 30) { socket.close(1008, "Too many messages"); return; }
      let value: Record<string, unknown>;
      try { value = JSON.parse(raw.toString()); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); } catch { socket.close(1007, "Invalid message"); return; }
      try {
        if (!client.userId) {
          if (value.type !== "auth" || client.authenticating) return;
          client.authenticating = true;
          const identity = await verifyRealtimeTicket(value.ticket);
          if ([...clients.values()].filter(other => other.userId === identity.userId).length >= 4) throw new HttpError(429, "Too many realtime connections");
          if (socket.readyState !== WebSocket.OPEN) return;
          client.userId = identity.userId; client.sessionId = identity.sessionId;
          clearTimeout(timeout); send(socket, { type: "ready" }); return;
        }
        if (value.type === "subscribe") {
          if (client.subscriptions.size >= 8 || client.versions.size >= 32) throw new HttpError(429, "Too many subscriptions");
          const id = typeof value.id === "string" ? value.id : "";
          const version = (client.versions.get(id) ?? 0) + 1; client.versions.set(id, version);
          const sub = await subscribe(client.userId, value);
          if (client.versions.get(id) === version && socket.readyState === WebSocket.OPEN) { client.subscriptions.set(id, sub); send(socket, { type: "subscribed", id }); }
        } else if (value.type === "unsubscribe" && typeof value.id === "string") {
          client.versions.set(value.id, (client.versions.get(value.id) ?? 0) + 1); client.subscriptions.delete(value.id);
        } else if (value.type === "move") {
          const sub = client.subscriptions.get(String(value.id));
          if (!sub || sub.channel !== "gathering") throw new HttpError(403, "Join the gathering room first");
          if (typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < .05 || value.x > .95 || typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < .48 || value.y > .9) throw new HttpError(400, "Invalid floor position");
          if (client.moving || Date.now() - client.moved < 100) return;
          client.moving = true; client.moved = Date.now();
          try {
            const updated = await prisma.gatheringMember.updateMany({ where: { userId: client.userId, roomId: sub.roomId, token: sub.token, lastSeen: { gte: new Date(Date.now() - PRESENCE_TTL) } }, data: { x: value.x, y: value.y, lastSeen: new Date() } });
            if (!updated.count) throw new HttpError(409, "Join the gathering room again");
            realtimeBus.publish({ kind: "move", roomId: sub.roomId!, userId: client.userId, x: value.x, y: value.y, at: new Date().toISOString() });
          } finally { client.moving = false; }
        }
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 503;
        if (typeof value.id === "string") client.subscriptions.delete(value.id);
        send(socket, { type: "error", id: value.id, message: error instanceof HttpError ? error.message : "Realtime temporarily unavailable" });
        if (!client.userId || status === 401 || status === 503) socket.close(status === 503 ? 1013 : 4001, "Reconnect to realtime");
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, client] of clients) {
      if (!client.alive) { socket.terminate(); continue; }
      client.alive = false; socket.ping();
      if (client.userId) void realtimeSession(client.userId, client.sessionId!).then(async () => {
        for (const [id, sub] of client.subscriptions) if (sub.channel === "gathering" && !await validGathering(client.userId!, sub)) {
          client.subscriptions.delete(id); send(socket, { type: "error", id, message: "Join the gathering room again" });
        }
      }).catch(() => socket.close(4001, "Please sign in again"));
    }
  }, options.heartbeatMs ?? 30000); heartbeat.unref();
  return async () => {
    clearInterval(heartbeat); server.off("upgrade", upgradeHandler);
    realtimeBus.off("event", receiveEvent); realtimeBus.off("health", health);
    for (const socket of clients.keys()) socket.terminate();
    sockets.close();
    if (options.broker !== false) await realtimeBus.stop();
  };
}
