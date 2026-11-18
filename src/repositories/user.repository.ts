import { prisma } from "../lib/prisma.js";

export function createPlayer(username: string, passwordHash: string) {
  return prisma.user.create({
    data: { username, name: username, passwordHash, role: "player" },
    select: { id: true, username: true, name: true, role: true, donationTier: true },
  });
}

export function findUserByUsername(username: string) {
  return prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, username: true, name: true, role: true, donationTier: true } });
}
