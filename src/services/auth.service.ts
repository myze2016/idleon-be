import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import type { User } from "../models/user.js";

const salt = randomBytes(16);
const hash = scryptSync("Admin123!", salt, 64);

// Development account only; replace with a database-backed repository before deployment.
export function authenticate(username: string, password: string): User | null {
  if (env.nodeEnv === "production") return null;
  const matches = timingSafeEqual(hash, scryptSync(password, salt, 64));
  if (username !== "admin" || !matches) return null;
  return { id: "test-admin", username: "admin", name: "Admin", role: "admin" };
}
