import { Router, raw, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { prisma } from "../lib/prisma.js";
import { paymentConfig, verifyPaymongoSignature } from "../services/paymongo.service.js";
import { createWishPayment, getWishPayment, paymentView, processPaymentEvent } from "../repositories/payment.repository.js";

// Mounted before JSON parsing/session handling to authenticate the exact original bytes.
export const paymentWebhookBody = raw({ type: "application/json", limit: "256kb" });
export const paymentWebhook: RequestHandler = async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "Expected a JSON payment event");
  verifyPaymongoSignature(req.body, req.get("Paymongo-Signature"));
  const payload = JSON.parse(req.body.toString("utf8"));
  await processPaymentEvent(payload.data ?? {});
  res.json({ received: true });
};

export const paymentRouter = Router();
paymentRouter.use(requireAuth);
paymentRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && !isAllowedOrigin(req.get("origin"))) return next(new HttpError(403, "Request origin is not allowed"));
  next();
});
paymentRouter.use(rateLimit({ windowMs: 60000, limit: 30, keyGenerator: (req) => req.session.user!.id,
  standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many payment requests. Try again shortly." } } }));
paymentRouter.get("/wish/latest", async (req, res) => {
  let configured = false;
  try { paymentConfig(); configured = true; } catch { /* Store stays available without payment credentials. */ }
  if (!configured) { res.json({ data: { available: false, order: null } }); return; }
  const order = await prisma.wishPayment.findFirst({ where: { userId: req.session.user!.id, livemode: paymentConfig().livemode,
    status: { in: ["creating", "pending"] }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  res.json({ data: { available: true, order: order ? paymentView(order) : null } });
});
paymentRouter.post("/wish", rateLimit({ windowMs: 15 * 60000, limit: 5, keyGenerator: (req) => req.session.user!.id,
  standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many QR requests. Please try again later." } } }), async (req, res) => {
  const key = req.get("Idempotency-Key");
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new HttpError(400, "A valid payment request key is required");
  if (req.body && Object.keys(req.body).length) throw new HttpError(400, "This purchase has a fixed price and quantity");
  res.status(201).json({ data: await createWishPayment(req.session.user!.id, key) });
});
paymentRouter.get("/wish/:id", async (req, res) => {
  res.json({ data: await getWishPayment(req.session.user!.id, String(req.params.id)) });
});
