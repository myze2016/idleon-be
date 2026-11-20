import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { realtimeBus } from "../services/realtime-bus.js";
import { prisma } from "../lib/prisma.js";
import { gatheringRooms, joinGathering, gatheringPresence, leaveGathering, gatheringChat, challengeGathering, answerGathering } from "../repositories/gathering.repository.js";

export const gatheringRouter = Router();
gatheringRouter.use(requireAuth);
gatheringRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && !isAllowedOrigin(req.get("origin"))) throw new HttpError(403, "Request origin is not allowed");
  const roomId = Number(req.path.match(/^\/(\d+)\//)?.[1]);
  if (req.method === "POST" && roomId && !req.path.endsWith("/presence")) {
    const leaving = req.path.endsWith("/leave"), token = req.body?.token;
    res.once("finish", () => {
      if (res.statusCode >= 400) return;
      realtimeBus.publish({ kind: "gathering", roomId });
      if (leaving) realtimeBus.publish({ kind: "lease", userId: req.session.user!.id, roomId, invalidatedToken: token });
    });
  }
  next();
});
const limit = (count: number) => rateLimit({ windowMs: 60_000, limit: count, keyGenerator: req => req.session.user!.id, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many gathering requests. Please wait a moment." } } });
gatheringRouter.get("/", async (_req, res) => { res.json({ data: await gatheringRooms() }); });
gatheringRouter.post("/join", limit(12), async (req, res) => {
  const { roomId, create, firstAvailable } = req.body ?? {};
  if (roomId !== undefined && (!Number.isSafeInteger(roomId) || roomId < 1 || roomId > 2147483647) || create !== undefined && typeof create !== "boolean" || create && roomId) throw new HttpError(400, "Choose an available gathering room");
  if (firstAvailable !== undefined && typeof firstAvailable !== "boolean" || firstAvailable && (roomId !== undefined || create)) throw new HttpError(400, "Choose automatic entry or a specific room");
  const userId = req.session.user!.id;
  const previous = await prisma.gatheringMember.findUnique({ where: { userId }, select: { roomId: true } });
  const data = await joinGathering(userId, roomId, create ?? false, firstAvailable ?? false);
  realtimeBus.publish({ kind: "lease", userId, roomId: data.roomId, token: data.token });
  realtimeBus.publish({ kind: "gathering", roomId: data.roomId });
  if (previous && previous.roomId !== data.roomId) realtimeBus.publish({ kind: "gathering", roomId: previous.roomId });
  res.json({ data });
});
gatheringRouter.param("roomId", (req, _res, next, value: string) => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) throw new HttpError(400, "Invalid gathering room");
  next();
});
gatheringRouter.use("/:roomId", (req, _res, next) => {
  if (typeof req.body?.token !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.token)) throw new HttpError(400, "Join a gathering room first");
  next();
});
gatheringRouter.post("/:roomId/presence", limit(180), async (req, res) => {
  const { token, x, y } = req.body;
  if (typeof x !== "number" || !Number.isFinite(x) || x < .05 || x > .95 || typeof y !== "number" || !Number.isFinite(y) || y < .48 || y > .9) throw new HttpError(400, "Choose a position on the gathering floor");
  const roomId = Number(req.params.roomId), userId = req.session.user!.id;
  const data = await gatheringPresence(userId, roomId, token, x, y);
  realtimeBus.publish({ kind: "move", roomId, userId, x, y, at: new Date().toISOString() });
  res.json({ data });
});
gatheringRouter.post("/:roomId/leave", async (req, res) => { res.json({ data: await leaveGathering(req.session.user!.id, Number(req.params.roomId), req.body.token) }); });
gatheringRouter.post("/:roomId/chat", limit(30), async (req, res) => {
  const body = req.body.body;
  if (typeof body !== "string" || !body.trim() || body.length > 200 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)) throw new HttpError(400, "Enter a message of 1–200 characters");
  res.status(201).json({ data: await gatheringChat(req.session.user!.id, Number(req.params.roomId), req.body.token, body.trim()) });
});
gatheringRouter.post("/:roomId/challenge", limit(6), async (req, res) => {
  if (typeof req.body.targetId !== "string" || !req.body.targetId || req.body.targetId.length > 30) throw new HttpError(400, "Choose a player in this room");
  res.status(201).json({ data: await challengeGathering(req.session.user!.id, Number(req.params.roomId), req.body.token, req.body.targetId) });
});
gatheringRouter.post("/:roomId/challenge/:id/answer", limit(12), async (req, res) => {
  if (typeof req.body.accept !== "boolean" || String(req.params.id).length > 30) throw new HttpError(400, "Accept or decline this invitation");
  res.json({ data: await answerGathering(req.session.user!.id, Number(req.params.roomId), req.body.token, String(req.params.id), req.body.accept) });
});
