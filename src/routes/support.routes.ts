import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { supportAmount } from "../models/support-amount.js";

export const supportRouter = Router();
supportRouter.use(requireAuth);
supportRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && !isAllowedOrigin(req.get("origin"))) throw new HttpError(403, "Request origin is not allowed");
  next();
});
supportRouter.get("/", async (_req, res) => {
  const settings = await prisma.supportSettings.findUnique({ where: { id: 1 } });
  res.json({ data: { qrImage: settings?.qrImage ?? null } });
});
supportRouter.post("/submissions", rateLimit({ windowMs: 15 * 60000, limit: 5, keyGenerator: (req) => req.session.user!.id,
  standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many submissions. Please wait before trying again." } } }), async (req, res) => {
  const { phone, reference } = req.body ?? {};
  const { amount, tier } = supportAmount(req.body?.amount);
  if (typeof phone !== "string" || !/^(09\d{9}|\+?639\d{9})$/.test(phone.trim())
    || typeof reference !== "string" || !/^[a-zA-Z0-9-]{6,64}$/.test(reference.trim()) || Object.keys(req.body).some((key) => !["amount", "phone", "reference"].includes(key))) throw new HttpError(400, "Enter a valid Philippine mobile number and transaction reference");
  const settings = await prisma.supportSettings.findUnique({ where: { id: 1 } });
  if (!settings?.qrImage) throw new HttpError(503, "The donation QR is not available yet");
  const normalizedPhone = phone.trim().startsWith("09") ? `+63${phone.trim().slice(1)}` : phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`;
  try {
    const submission = await prisma.supportSubmission.create({ data: { userId: req.session.user!.id, tier, amount, phone: normalizedPhone, reference: reference.trim().toUpperCase() },
      select: { id: true, tier: true, amount: true, status: true, createdAt: true } });
    res.status(201).json({ data: { submission } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "This transaction reference has already been submitted. Contact the admin if you need help.");
    throw error;
  }
});
