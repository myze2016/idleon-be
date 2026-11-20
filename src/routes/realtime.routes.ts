import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { realtimeTicket } from "../services/realtime-ticket.js";

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);
realtimeRouter.post("/ticket", rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.session.user!.id, standardHeaders: "draft-8", legacyHeaders: false }), (req, res) => {
  if (!isAllowedOrigin(req.get("origin"))) throw new HttpError(403, "Request origin is not allowed");
  const browserHost = new URL(req.get("origin")!).hostname;
  const configured = process.env.REALTIME_PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}/realtime` : `${env.nodeEnv === "production" ? "wss" : "ws"}://${env.nodeEnv === "production" ? req.get("host") : `${browserHost}:${env.port}`}/realtime`);
  const url = new URL(configured);
  if (url.pathname === "/") url.pathname = "/realtime";
  if (!["ws:", "wss:"].includes(url.protocol) || (env.nodeEnv === "production" && url.protocol !== "wss:") || url.pathname !== "/realtime" || url.username || url.password || url.search || url.hash) throw new HttpError(503, "Configure REALTIME_PUBLIC_URL with the public backend WebSocket URL");
  res.setHeader("Cache-Control", "no-store");
  res.json({ data: { ticket: realtimeTicket(req.session.user!.id, req.sessionID), url: url.toString() } });
});
