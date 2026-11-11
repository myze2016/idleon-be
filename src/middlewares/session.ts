import { randomBytes } from "node:crypto";
import session from "express-session";
import { env } from "../config/env.js";

export const sessionCookieName = "idleon.sid";
export const sessionCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.nodeEnv === "production",
  path: "/",
};

export const sessionMiddleware = session({
  name: sessionCookieName,
  secret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { ...sessionCookie, maxAge: 8 * 60 * 60 * 1000 },
});
