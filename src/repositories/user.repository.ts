import { prisma } from "../lib/prisma.js";

export function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, username: true, name: true, role: true } });
}
