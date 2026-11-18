import { prisma } from "../src/lib/prisma.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";

try {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12 || password.length > 256 || !password.trim()) {
    throw new Error("Set SEED_ADMIN_PASSWORD in the backend .env to a unique password of 12–256 characters");
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const admin = await tx.user.findUnique({ where: { username: "admin" }, select: { id: true, role: true } });
    if (!admin || admin.role !== "admin") throw new Error("The admin account was not found; no password was changed");
    const updated = await tx.user.update({ where: { id: admin.id }, data: { passwordHash }, select: { passwordHash: true } });
    if (!await verifyPassword(password, updated.passwordHash)) throw new Error("Password verification failed");
    await tx.$executeRaw`DELETE FROM sessions WHERE data::jsonb -> 'user' ->> 'id' = ${admin.id}`;
  });
  console.log("Admin password changed and existing admin sessions revoked. Use SEED_ADMIN_PASSWORD from the backend .env to sign in.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not change the admin password");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
