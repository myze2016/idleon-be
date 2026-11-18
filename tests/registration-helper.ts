import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";

export async function registrationProof(name: string) {
  const email = `${name}@example.com`, code = "123456";
  await prisma.registrationCode.upsert({ where: { email }, create: { email, codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + 600000), sentAt: new Date() }, update: { codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + 600000), attempts: 0 } });
  return { email, code };
}
