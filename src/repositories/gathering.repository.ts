import { playerIdentity, playerNameSelect } from "../models/player-name.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { createGatheringDuel, pvpPhase } from "./pvp.repository.js";

export const GATHERING_CAPACITY = 12;
export const PRESENCE_TTL = 60_000;
const cutoff = () => new Date(Date.now() - PRESENCE_TTL);
const isolationLevel = Prisma.TransactionIsolationLevel.ReadCommitted;

async function prune() {
  await prisma.gatheringMember.deleteMany({ where: { lastSeen: { lt: cutoff() } } });
  await prisma.gatheringRoom.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) }, members: { none: {} } } });
}
export async function gatheringRooms() {
  await prune();
  const rooms = await prisma.gatheringRoom.findMany({ orderBy: { id: "asc" }, take: 50, include: { _count: { select: { members: { where: { lastSeen: { gte: cutoff() } } } } } } });
  return { capacity: GATHERING_CAPACITY, rooms: rooms.map(room => ({ id: room.id, capacity: room.capacity, players: room._count.members })) };
}
export async function joinGathering(userId: string, roomId?: number, create = false, firstAvailable = false) {
  return prisma.$transaction(async tx => {
    // Joins are serialized so simultaneous arrivals cannot overfill a room.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(821493702)::text`;
    const character = await tx.character.findFirst({ where: { userId, isStarter: true }, select: { id: true } });
    if (!character) throw new HttpError(409, "Create your starter character first");
    await tx.gatheringMember.deleteMany({ where: { lastSeen: { lt: cutoff() } } });
    const current = await tx.gatheringMember.findUnique({ where: { userId } });
    let room = roomId ? await tx.gatheringRoom.findUnique({ where: { id: roomId } }) : null;
    if (roomId && !room) throw new HttpError(404, "Gathering room not found");
    if (!room && !create && current && !firstAvailable) room = await tx.gatheringRoom.findUnique({ where: { id: current.roomId } });
    if (!room && !create) {
      const rooms = await tx.gatheringRoom.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { members: true } } }, take: 50 });
      room = rooms.find(candidate => candidate._count.members < candidate.capacity || candidate.id === current?.roomId) ?? null;
    }
    if (!room) room = await tx.gatheringRoom.create({ data: {} });
    await tx.$queryRaw`SELECT id FROM gathering_rooms WHERE id = ${room.id} FOR UPDATE`;
    const count = await tx.gatheringMember.count({ where: { roomId: room.id } });
    if (current?.roomId !== room.id && count >= room.capacity) throw new HttpError(409, "This gathering room is full. Choose another room.");
    if (current?.roomId !== room.id) await tx.gatheringChallenge.updateMany({ where: { OR: [{ fromId: userId }, { toId: userId }], status: "pending" }, data: { status: "canceled" } });
    const token = randomUUID();
    const position = current?.roomId === room.id ? { x: current.x, y: current.y } : { x: .15 + (count % 6) * .13, y: .65 + Math.floor(count / 6) * .14 };
    await tx.gatheringMember.upsert({ where: { userId }, create: { userId, roomId: room.id, token, ...position }, update: { roomId: room.id, token, ...position, lastSeen: new Date() } });
    return { roomId: room.id, token, ...position };
  }, { isolationLevel });
}
async function member(tx: Prisma.TransactionClient, userId: string, roomId: number, token: string) {
  await tx.$queryRaw`SELECT id FROM gathering_rooms WHERE id = ${roomId} FOR UPDATE`;
  const present = await tx.gatheringMember.findUnique({ where: { userId } });
  if (!present || present.roomId !== roomId || present.token !== token || present.lastSeen < cutoff()) throw new HttpError(409, "Your gathering session ended or was opened in another tab. Join again.");
  return present;
}
export async function gatheringPresence(userId: string, roomId: number, token: string, x: number, y: number) {
  // Fence the lease in a single atomic write. Movement must not queue behind
  // every other player on the shared room lock used for joins and invitations.
  const updated = await prisma.gatheringMember.updateMany({
    where: { userId, roomId, token, lastSeen: { gte: cutoff() } },
    data: { x, y, lastSeen: new Date() },
  });
  if (!updated.count) throw new HttpError(409, "Your gathering session ended or was opened in another tab. Join again.");
  const [room, players, messages, challenges] = await Promise.all([
    prisma.gatheringRoom.findUniqueOrThrow({ where: { id: roomId } }),
    prisma.gatheringMember.findMany({ where: { roomId, lastSeen: { gte: cutoff() } }, include: { user: { select: playerNameSelect } } }),
    prisma.gatheringMessage.findMany({ where: { roomId, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { user: { select: playerNameSelect } } }),
    prisma.gatheringChallenge.findMany({ where: { roomId, OR: [{ fromId: userId }, { toId: userId }], expiresAt: { gt: new Date() }, status: { in: ["pending", "accepted"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const codes = challenges.flatMap(challenge => challenge.status === "accepted" && challenge.pvpCode ? [challenge.pvpCode] : []);
  const duels = codes.length ? await prisma.pvpRoom.findMany({ where: { code: { in: codes }, OR: [{ hostId: userId }, { guestId: userId }] } }) : [];
  return { roomId, capacity: room.capacity, serverNow: new Date().toISOString(),
    players: players.map(player => ({ id: player.userId, username: playerIdentity(player.user).username, name: player.user.characters[0]?.name ?? playerIdentity(player.user).name, weapon: player.user.characters[0]?.weapon.replaceAll("_", "-") ?? "sword-and-shield", x: player.x, y: player.y })),
    messages: messages.reverse().map(message => ({ id: message.id, userId: message.userId, username: playerIdentity(message.user).username, body: message.body, createdAt: message.createdAt.toISOString() })),
    challenges: challenges.filter(challenge => challenge.status === "accepted" || players.some(player => player.userId === (challenge.fromId === userId ? challenge.toId : challenge.fromId))).map(challenge => ({ id: challenge.id, fromId: challenge.fromId, toId: challenge.toId, status: challenge.status, expiresAt: challenge.expiresAt.toISOString() })),
    pvpCode: duels.find(duel => ["waiting", "countdown", "battle"].includes(pvpPhase(duel)))?.code ?? null,
  };
}
export async function leaveGathering(userId: string, roomId: number, token: string) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM gathering_rooms WHERE id = ${roomId} FOR UPDATE`;
    // An old tab must never remove a newer tab's presence.
    const removed = await tx.gatheringMember.deleteMany({ where: { userId, roomId, token } });
    if (removed.count) await tx.gatheringChallenge.updateMany({ where: { roomId, OR: [{ fromId: userId }, { toId: userId }], status: "pending" }, data: { status: "canceled" } });
  }, { isolationLevel });
  return { left: true };
}
export async function gatheringChat(userId: string, roomId: number, token: string, body: string) {
  return prisma.$transaction(async tx => {
    await member(tx, userId, roomId, token);
    const recent = await tx.gatheringMessage.findFirst({ where: { userId, createdAt: { gt: new Date(Date.now() - 1500) } } });
    if (recent) throw new HttpError(429, "Please wait a moment before sending another message");
    const message = await tx.gatheringMessage.create({ data: { userId, roomId, body } });
    // Keep bounded history even in a long-lived, busy room.
    const excess = await tx.gatheringMessage.findMany({ where: { roomId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 100, select: { id: true } });
    if (excess.length) await tx.gatheringMessage.deleteMany({ where: { id: { in: excess.map(row => row.id) } } });
    return { id: message.id };
  }, { isolationLevel });
}
export async function challengeGathering(userId: string, roomId: number, token: string, targetId: string) {
  return prisma.$transaction(async tx => {
    await member(tx, userId, roomId, token);
    if (targetId === userId) throw new HttpError(400, "Choose another player to challenge");
    const target = await tx.gatheringMember.findUnique({ where: { userId: targetId } });
    if (!target || target.roomId !== roomId || target.lastSeen < cutoff()) throw new HttpError(409, "That player is no longer in this room");
    const pending = await tx.gatheringChallenge.findFirst({ where: { status: "pending", expiresAt: { gt: new Date() }, OR: [{ fromId: { in: [userId, targetId] } }, { toId: { in: [userId, targetId] } }] } });
    if (pending) throw new HttpError(409, "One player already has a pending invitation");
    const challenge = await tx.gatheringChallenge.create({ data: { roomId, fromId: userId, toId: targetId, expiresAt: new Date(Date.now() + 60_000) } });
    return { id: challenge.id };
  }, { isolationLevel });
}
export async function answerGathering(userId: string, roomId: number, token: string, id: string, accept: boolean) {
  return prisma.$transaction(async tx => {
    await member(tx, userId, roomId, token);
    const challenge = await tx.gatheringChallenge.findUnique({ where: { id } });
    if (!challenge || challenge.roomId !== roomId || challenge.toId !== userId) throw new HttpError(403, "This invitation is not addressed to you");
    if (challenge.status === "accepted") return { code: challenge.pvpCode };
    if (challenge.status !== "pending" || challenge.expiresAt <= new Date()) throw new HttpError(409, "This invitation has expired or ended");
    if (!accept) {
      await tx.gatheringChallenge.update({ where: { id }, data: { status: "declined" } });
      return { code: null };
    }
    const sender = await tx.gatheringMember.findUnique({ where: { userId: challenge.fromId } });
    if (!sender || sender.roomId !== roomId || sender.lastSeen < cutoff()) throw new HttpError(409, "The other player has left the room");
    const duel = await createGatheringDuel(tx, challenge.fromId, userId);
    await tx.gatheringChallenge.update({ where: { id }, data: { status: "accepted", pvpCode: duel.code, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    return { code: duel.code };
  }, { isolationLevel });
}
