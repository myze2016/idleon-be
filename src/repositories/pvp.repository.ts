import { playerIdentity, playerNameSelect } from "../models/player-name.js";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma, type PvpRoom } from "../generated/prisma/client.js";
import { effectiveStats } from "../models/artifact.js";
import type { WeaponType } from "../models/character.js";
import type { DuelFighter, DuelResult } from "../services/pvp-battle.service.js";
import { hasActiveSkill2, latestSkill2Change, liveSkill2Controls, replayPvpBattle, startLivePvpBattle, type LivePvpResult } from "../services/live-combat.js";
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
/** A gathering invitation has already been accepted by both accounts. */
export async function createGatheringDuel(tx: Prisma.TransactionClient, hostId: string, guestId: string) {
  for (const id of [hostId, guestId].sort()) await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  if (await activeRoom(tx, hostId) || await activeRoom(tx, guestId)) throw new HttpError(409, "One player is already in a PvP room. Finish or leave it first.");
  return tx.pvpRoom.create({ data: { hostId, guestId, code: randomBytes(5).toString("hex").toUpperCase(), expiresAt: new Date(Date.now() + 30 * 60_000) } });
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
    prisma.pvpRoom.findMany({ where: { status: "waiting", guestId: null, expiresAt: { gt: now } }, include: { host: { select: playerNameSelect } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.pvpRoom.findFirst({ where: { OR: [{ hostId: userId }, { guestId: userId }], status: { in: ["waiting", "started"] }, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
  ]);
  return { rooms: rooms.map((room) => ({ code: room.code, hostName: playerIdentity(room.host).name, hostUsername: playerIdentity(room.host).username, isMine: room.hostId === userId })), activeCode: mine?.code ?? null };
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
      const result = startLivePvpBattle(fighters);
      await tx.pvpRoom.update({ where: { id: room.id }, data: { status: "started", startsAt: new Date(Date.now() + 5000), result: result as unknown as Prisma.InputJsonValue } });
    }
    return { code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function setPvpSkill2(userId: string, code: string, fighterId: string, enabled: boolean) {
  return prisma.$transaction(async tx => {
    const room = await lockRoom(tx, code, userId);
    const now = Date.now();
    if (!room.startsAt || !["countdown", "battle"].includes(pvpPhase(room, now))) throw new HttpError(409, "Skill 2 can only be changed during an active match");
    const result = room.result as unknown as LivePvpResult;
    const live = result.live;
    if (!live) throw new HttpError(409, "Skill 2 controls are available in new matches");
    const fighter = live.fighters.find(fighter => fighter.id === fighterId && fighter.userId === userId);
    if (!fighter || !hasActiveSkill2(fighter, live.balance)) throw new HttpError(400, "Choose one of your fighters with an unlocked active Skill 2");
    const previous = latestSkill2Change(live.changes, fighterId);
    if ((previous?.enabled ?? true) === enabled) return { code };
    if (live.changes.length >= 120) throw new HttpError(409, "This match has reached its Skill 2 change limit");
    const at = Math.max(0, (now - room.startsAt.getTime()) / 1000 + 0.25, live.changes.at(-1)?.at ?? 0);
    if (at >= result.duration) throw new HttpError(409, "The match is ending");
    const next = replayPvpBattle({ ...live, changes: [...live.changes, { fighterId, enabled, at }] });
    await tx.pvpRoom.update({ where: { id: room.id }, data: { result: next as unknown as Prisma.InputJsonValue } });
    return { code };
  });
}

export async function pvpState(userId: string, code: string, knownBattle?: string) {
  const room = await prisma.pvpRoom.findUnique({ where: { code }, include: { host: { select: { id: true, ...playerNameSelect } }, guest: { select: { id: true, ...playerNameSelect } } } });
  if (!room) throw new HttpError(404, "PvP room not found");
  if (room.hostId !== userId && room.guestId !== userId) throw new HttpError(403, "You are not in this PvP room");
  const phase = pvpPhase(room), stored = room.result as unknown as LivePvpResult | null;
  const live = stored?.live;
  const result = stored && { fighters: stored.fighters, steps: stored.steps, duration: stored.duration, winnerId: stored.winnerId };
  const startsAt = room.startsAt?.toISOString() ?? null;
  const battleVersion = live?.changes.length ? `${startsAt}:${live.changes.length}` : startsAt;
  const resultUnchanged = !!stored && !!knownBattle && knownBattle === battleVersion && ["battle", "complete"].includes(phase);
  const skill2 = live && liveSkill2Controls(userId, live);
  return { code, phase, serverNow: new Date().toISOString(), startsAt: room.startsAt?.toISOString() ?? null,
    players: [room.host, room.guest].map((user, side) => user ? { id: user.id, ...playerIdentity(user), ready: side === 0 ? room.hostReady : room.guestReady,
      selected: selection(room, side === 0).length > 0, selectedCount: selection(room, side === 0).length,
      characterIds: user.id === userId ? selection(room, side === 0) : [],
      characterId: user.id === userId ? (side === 0 ? room.hostCharacterId : room.guestCharacterId) : null,
      fighters: room.startsAt && !resultUnchanged ? result?.fighters.filter((fighter) => fighter.userId === user.id) ?? [] : [],
      fighter: room.startsAt && !resultUnchanged ? result?.fighters.find((fighter) => fighter.userId === user.id) ?? null : null } : null),
    battleVersion, skill2, resultUnchanged, result: stored && !resultUnchanged && (phase === "battle" || phase === "complete") ? result : null };
}
export async function leavePvp(userId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, code, userId);
    await tx.pvpRoom.update({ where: { id: room.id }, data: { status: pvpPhase(room) === "complete" ? "closed" : "canceled" } });
    return { code };
  });
}

export async function returnToPvp(userId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, code, userId);
    // A second player's return (or a retry) must not clear a newly readied team.
    if (room.status === "waiting") return { code };
    if (room.status !== "started" || pvpPhase(room) !== "complete") throw new HttpError(409, "Finish this match before returning to the PvP room");
    await tx.pvpRoom.update({ where: { id: room.id }, data: {
      status: "waiting", hostReady: false, guestReady: false, startsAt: null,
      result: Prisma.DbNull, expiresAt: new Date(Date.now() + 30 * 60_000),
    } });
    return { code };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

interface ChatMessage { id: string; userId: string; name: string; body: string; createdAt: string }
export async function pvpChat(userId: string, code: string) {
  const room = await prisma.pvpRoom.findUnique({ where: { code }, select: { hostId: true, guestId: true, messages: true } });
  if (!room) throw new HttpError(404, "PvP room not found");
  if (room.hostId !== userId && room.guestId !== userId) throw new HttpError(403, "You are not in this PvP room");
  return { messages: (room.messages as unknown as ChatMessage[] | null) ?? [] };
}

export async function sendPvpChat(userId: string, code: string, body: string) {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, code, userId);
    if (!["waiting", "started"].includes(room.status)) throw new HttpError(409, "This PvP room has ended");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: playerNameSelect });
    const message: ChatMessage = { id: randomBytes(12).toString("hex"), userId, name: playerIdentity(user).name, body, createdAt: new Date().toISOString() };
    const messages = [...((room.messages as unknown as ChatMessage[] | null) ?? []), message].slice(-100);
    await tx.pvpRoom.update({ where: { id: room.id }, data: { messages: messages as unknown as Prisma.InputJsonValue } });
    return { messages };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
