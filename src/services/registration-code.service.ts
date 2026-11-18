import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

export function registrationEmail(input: unknown) {
  if (typeof input !== "string" || input.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())) {
    throw new HttpError(400, "Enter a valid email address");
  }
  return input.trim().toLowerCase();
}

export async function sendRegistrationCode(email: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new HttpError(503, "Email registration is not configured yet. Please try again later.");
  const code = String(randomInt(100000, 1000000));
  const codeHash = await hashPassword(code);
  await prisma.$transaction(async (tx) => {
    // Serialize requests for an email across sessions and backend instances.
    await tx.registrationCode.upsert({ where: { email }, create: { email, codeHash: "", expiresAt: new Date(0), sentAt: new Date(0) }, update: {} });
    await tx.$queryRaw`SELECT email FROM registration_codes WHERE email = ${email} FOR UPDATE`;
    const previous = await tx.registrationCode.findUniqueOrThrow({ where: { email } });
    if (Date.now() - previous.sentAt.getTime() < 60000) throw new HttpError(429, "Wait 60 seconds before requesting another code");
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw new HttpError(409, "That email is already registered");
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject: "Your IdleOn registration code", text: `Your IdleOn registration code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.` }),
      });
      if (!response.ok) throw new Error("Email provider rejected the request");
    } catch {
      throw new HttpError(502, "Could not send your code. Please try again later.");
    }
    await tx.registrationCode.update({ where: { email }, data: { codeHash, attempts: 0, sentAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60000) } });
  }, { timeout: 20000 });
}

export async function createVerifiedPlayer(username: string, password: string, email: string, code: string) {
  const passwordHash = await hashPassword(password);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT email FROM registration_codes WHERE email = ${email} FOR UPDATE`;
      const challenge = await tx.registrationCode.findUnique({ where: { email } });
      if (!challenge || challenge.expiresAt.getTime() <= Date.now() || challenge.attempts >= 5) {
        return { error: "Code expired or unavailable. Request a new code." } as const;
      }
      if (!await verifyPassword(code, challenge.codeHash)) {
        await tx.registrationCode.update({ where: { email }, data: { attempts: { increment: 1 } } });
        return { error: "Incorrect verification code" } as const;
      }
      const user = await tx.user.create({ data: { username: username.toLowerCase(), name: username, email, passwordHash, role: "player" }, select: { id: true, username: true, name: true, role: true, donationTier: true } });
      await tx.registrationCode.delete({ where: { email } });
      return { user } as const;
    });
    if ("error" in result) throw new HttpError(400, result.error!);
    return result.user;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "That username or email is already registered");
    throw error;
  }
}
