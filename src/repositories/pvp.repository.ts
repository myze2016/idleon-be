import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma, type PvpRoom } from "../generated/prisma/client.js";
import { effectiveStats } from "../models/artifact.js";
import type { WeaponType } from "../models/character.js";
import { simulateDuel, type DuelFighter, type DuelResult } from "../services/pvp-battle.service.js";
import { HttpError } from "../utils/http-error.js";

export function pvpPhase(room: Pick<PvpRoom, "status" | "startsAt" | "result" | "expiresAt">, now = Date.now()) {
  if (room.status === "canceled") return "canceled";
  if (room.status === "closed") return room.result && room.startsAt && now >= room.startsAt.getTime() + (room.result as unknown as DuelResult).duration * 1000 ? "complete" : "closed";
  if (room.expiresAt.getTime() <= now) return "expired";
  if (!room.startsAt) return "waiting";
  if (now < room.startsAt.getTime()) return "countdown";
  const result = room.result as unknown as DuelResult;
  return now >= room.startsAt.getTime() + result.duration * 1000 ? "complete" : "battle";
}
async function activeRoom(tx: Prisma.TransactionClient, userId: string) {
  const rooms = await tx.pvpRoom.findMany({ where: { OR: [{ hostId: userId }, { guestId: userId }], status: { in: ["waiting", "started"] }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  return rooms.find((room) => ["waiting", "countdown", "battle"].includes(pvpPhase(room)));
}
async function lockRoom(tx: Prisma.TransactionClient, code: string, userId?: string) {
  await tx.$queryRaw`SELECT id FROM pvp_rooms WHERE code = ${code} FOR UPDATE`;
  const room = await tx.pvpRoom.findUnique({ where: { code } });
  if (!room || room.expiresAt <= new Date()) throw new HttpError(404, "PvP room not found or expired");
  if (userId && room.hostId !== userId && room.guestId !== userId) throw new HttpError(403, "You are not in this PvP room");
  return room;
}
async function snapshot(tx: Prisma.TransactionClient, userId: string, characterId: string): Promise<DuelFighter> {
  const character = await tx.character.findFirst({ where: { id: characterId, userId }, include: { artifact: true } });
  if (!character) throw new HttpError(400, "Choose a character you own");
  const weapon = character.weapon.replaceAll("_", "-") as WeaponType;
  return { id: character.id, userId, name: character.name, weapon, skill2Unlocked: character.skill2Unlocked, stats: effectiveStats(weapon, character.artifact, character.upgradeLevel) };
}
function selection(room: PvpRoom, host: boolean): string[] {
  const ids = host ? room.hostCharacterIds : room.guestCharacterIds;
  const legacy = host ? room.hostCharacterId : room.guestCharacterId;
  return Array.isArray(ids) ? ids as string[] : legacy ? [legacy] : [];
}
async function snapshotTeam(tx: Prisma.TransactionClient, userId: string, ids: string[]) {
  if (!ids.length || ids.length > 6 || new Set(ids).size !== ids.length) throw new HttpError(400, "Choose one to six different owned characters");
  return Promise.all(ids.map((id) => snapshot(tx, userId, id)));
}
export async function listPvp(userId: string) {
  const now = new Date();
  const [rooms, mine] = await Promise.all([
    prisma.pvpRoom.findMany({ where: { status: "waiting", guestId: null, expiresAt: { gt: now } }, include: { host: { select: { name: true, username: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.pvpRoom.findFirst({ where: { OR: [{ hostId: userId }, { guestId: userId }], status: { in: ["waiting", "started"] }, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
  ]);
  return { rooms: rooms.map((room) => ({ code: room.code, hostName: room.host.name, hostUsername: room.host.username, isMine: room.hostId === userId })), activeCode: mine?.code ?? null };
}
export async function createPvp(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (await activeRoom(tx, userId)) throw new HttpError(409, "Finish or leave your current PvP room first");
    const room = await tx.pvpRoom.create({ data: { hostId: userId, code: randomBytes(5).toString("hex").toUpperCase(), expiresAt: new Date(Date.now() + 30 * 60_000) } });
    return { code: room.code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function joinPvp(userId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const room = await lockRoom(tx, code);
    if (room.hostId === userId) throw new HttpError(409, "You cannot fight your own account");
    if (room.guestId === userId) return { code };
    if (await activeRoom(tx, userId)) throw new HttpError(409, "Finish or leave your current PvP room first");
    if (room.status !== "waiting" || room.guestId) throw new HttpError(409, "This room is already full or started");
    await tx.pvpRoom.update({ where: { id: room.id }, data: { guestId: userId } });
    return { code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function selectPvp(userId: string, code: string, characterIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, code, userId), host = room.hostId === userId;
    if (room.status !== "waiting" || (host ? room.hostReady : room.guestReady)) throw new HttpError(409, "Unready before changing characters");
    if (characterIds.length) await snapshotTeam(tx, userId, characterIds);
    await tx.pvpRoom.update({ where: { id: room.id }, data: host ? { hostCharacterIds: characterIds, hostCharacterId: characterIds[0] ?? null } : { guestCharacterIds: characterIds, guestCharacterId: characterIds[0] ?? null } });
    return { code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function readyPvp(userId: string, code: string, ready: boolean) {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, code, userId), host = room.hostId === userId;
    if (room.status !== "waiting") throw new HttpError(409, "This match has already started or ended");
    const selected = selection(room, host);
    if (ready) await snapshotTeam(tx, userId, selected);
    const updated = await tx.pvpRoom.update({ where: { id: room.id }, data: host ? { hostReady: ready } : { guestReady: ready } });
    if (updated.hostReady && updated.guestReady && updated.guestId && updated.hostCharacterId && updated.guestCharacterId) {
      const fighters = [...await snapshotTeam(tx, updated.hostId, selection(updated, true)), ...await snapshotTeam(tx, updated.guestId, selection(updated, false))];
      const result = simulateDuel(fighters);
      await tx.pvpRoom.update({ where: { id: room.id }, data: { status: "started", startsAt: new Date(Date.now() + 5000), result: result as unknown as Prisma.InputJsonValue } });
    }
    return { code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function pvpState(userId: string, code: string) {
  const room = await prisma.pvpRoom.findUnique({ where: { code }, include: { host: { select: { id: true, name: true, username: true } }, guest: { select: { id: true, name: true, username: true } } } });
  if (!room) throw new HttpError(404, "PvP room not found");
  if (room.hostId !== userId && room.guestId !== userId) throw new HttpError(403, "You are not in this PvP room");
  const phase = pvpPhase(room), result = room.result as unknown as DuelResult | null;
  return { code, phase, serverNow: new Date().toISOString(), startsAt: room.startsAt?.toISOString() ?? null,
    players: [room.host, room.guest].map((user, side) => user ? { ...user, ready: side === 0 ? room.hostReady : room.guestReady,
      selected: selection(room, side === 0).length > 0, selectedCount: selection(room, side === 0).length,
      characterIds: user.id === userId ? selection(room, side === 0) : [],
      characterId: user.id === userId ? (side === 0 ? room.hostCharacterId : room.guestCharacterId) : null,
      fighters: room.startsAt ? result?.fighters.filter((fighter) => fighter.userId === user.id) ?? [] : [],
      fighter: room.startsAt ? result?.fighters.find((fighter) => fighter.userId === user.id) ?? null : null } : null),
    result: phase === "battle" || phase === "complete" ? result : null };
}
export async function leavePvp(userId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, code, userId);
    await tx.pvpRoom.update({ where: { id: room.id }, data: { status: pvpPhase(room) === "complete" ? "closed" : "canceled" } });
    return { code };
  });
}
