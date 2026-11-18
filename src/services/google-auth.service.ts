import { randomBytes } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { hashPassword } from "../utils/password.js";
import { registrationEmail } from "./registration-code.service.js";

export function googleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI || `${env.corsOrigin}/api/auth/google/callback`;
  if (!clientId || !secret) throw new HttpError(503, "Google sign-in is not configured yet");
  return new OAuth2Client(clientId, secret, redirect);
}

export async function googlePlayer(payload: TokenPayload | undefined, nonce: string) {
  if (!payload || !payload.sub || payload.email_verified !== true || (payload as TokenPayload & { nonce?: string }).nonce !== nonce) {
    throw new HttpError(401, "Google identity could not be verified");
  }
  const select = { id: true, username: true, name: true, role: true, donationTier: true } as const;
  const existing = await prisma.user.findUnique({ where: { googleSubject: payload.sub }, select });
  if (existing) return existing;
  const email = registrationEmail(payload.email);
  // Never link an existing password account based solely on a matching email.
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new HttpError(409, "That email already has an account. Sign in with your username and password.");
  }
  try {
    return await prisma.user.create({
      data: { googleSubject: payload.sub, email, username: `google_${randomBytes(10).toString("hex")}`,
        name: payload.name?.slice(0, 100) || "Adventurer", passwordHash: await hashPassword(randomBytes(48).toString("hex")), role: "player" }, select,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.user.findUnique({ where: { googleSubject: payload.sub }, select });
      if (concurrent) return concurrent;
      throw new HttpError(409, "That email already has an account. Sign in with your username and password.");
    }
    throw error;
  }
}
