import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";

const secret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const signature = (value: string) => createHmac("sha256", secret).update(`realtime:${value}`).digest();
export function realtimeTicket(userId: string, sessionId: string) {
  const value = Buffer.from(JSON.stringify({ userId, sessionId, exp: Date.now() + 45000, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  return `${value}.${signature(value).toString("base64url")}`;
}
export async function realtimeSession(userId: string, sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.expiresAt.getTime() <= Date.now()) throw new HttpError(401, "Please sign in again");
  const data = JSON.parse(session.data);
  if (data.user?.id !== userId) throw new HttpError(401, "Please sign in again");
}
export async function verifyRealtimeTicket(ticket: unknown) {
  if (typeof ticket !== "string" || ticket.length > 2048) throw new HttpError(401, "Invalid realtime ticket");
  const [value, signed, extra] = ticket.split(".");
  const received = Buffer.from(signed ?? "", "base64url"), expected = signature(value ?? "");
  if (!value || extra || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new HttpError(401, "Invalid realtime ticket");
  let identity: { userId: string; sessionId: string; exp: number };
  try { identity = JSON.parse(Buffer.from(value, "base64url").toString()); } catch { throw new HttpError(401, "Invalid realtime ticket"); }
  if (typeof identity.userId !== "string" || typeof identity.sessionId !== "string" || typeof identity.exp !== "number" || identity.exp <= Date.now()) throw new HttpError(401, "Realtime ticket expired");
  await realtimeSession(identity.userId, identity.sessionId);
  return identity;
}
