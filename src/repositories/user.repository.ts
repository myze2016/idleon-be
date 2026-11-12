import { prisma } from "../lib/prisma.js";

export function createPlayer(username: string, passwordHash: string) {
  return prisma.user.create({
    data: { username, name: username, passwordHash, role: "player" },
    select: { id: true, username: true, name: true, role: true },
  });
}

export function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, username: true, name: true, role: true } });
}
