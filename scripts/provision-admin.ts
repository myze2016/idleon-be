import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";

try {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12 || password.length > 256 || !password.trim()) {
    throw new Error("Set SEED_ADMIN_PASSWORD to a unique password of 12–256 characters");
  }
  const existing = await prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } });
  if (existing) throw new Error("An admin username already exists. No changes made. Use admin:password to rotate its password.");
  await prisma.user.create({ data: { username: "admin", name: "Admin", role: "admin", passwordHash: await hashPassword(password) } });
  console.log("Admin account created without test grants. Use the configured password to sign in.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not provision admin");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
