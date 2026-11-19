import { prisma } from "../lib/prisma.js";
import { playerIdentity, playerNameSelect } from "../models/player-name.js";

export function createPlayer(username: string, passwordHash: string) {
  return prisma.user.create({
    data: { username, name: username, passwordHash, role: "player" },
    select: { id: true, username: true, name: true, role: true, donationTier: true },
  });
}

export function findUserByUsername(username: string) {
  return prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } } });
}

export async function findUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, ...playerNameSelect, role: true, donationTier: true } });
  return user ? { id: user.id, ...playerIdentity(user), role: user.role, donationTier: user.donationTier } : null;
}
