import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { Prisma } from "../generated/prisma/client.js";
import { balanceRouter } from "./balance.routes.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  // Recheck the database instead of trusting an old/spoofed session role.
  const admin = await prisma.user.findUnique({ where: { id: req.session.user!.id }, select: { role: true } });
  if (admin?.role !== "admin") throw new HttpError(403, "Administrator access required");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !isAllowedOrigin(req.get("origin"))) throw new HttpError(403, "Request origin is not allowed");
  next();
});
adminRouter.use(rateLimit({ windowMs: 60000, limit: 30, keyGenerator: (req) => req.session.user!.id,
  standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many admin requests. Try again shortly." } } }));
adminRouter.use("/balance", balanceRouter);
adminRouter.get("/donation-tiers", async (req, res) => {
  if (req.query.search !== undefined && (typeof req.query.search !== "string" || req.query.search.length > 100)) throw new HttpError(400, "Enter a valid username");
  const search = String(req.query.search ?? "").trim();
  const users = await prisma.user.findMany({ where: search ? { OR: [{ username: { contains: search, mode: "insensitive" } }, { characters: { some: { name: { contains: search, mode: "insensitive" } } } }] } : {},
    take: 20, orderBy: { username: "asc" }, select: { id: true, username: true, name: true, donationTier: true, wishCurrency: true, characters: { select: { id: true, name: true }, orderBy: { name: "asc" } } } });
  res.json({ data: { users } });
});
adminRouter.patch("/users/:id/donation-tier", async (req, res) => {
  const tier = req.body?.tier;
  if (!Number.isInteger(tier) || tier < 0 || tier > 3 || Object.keys(req.body ?? {}).some((key) => key !== "tier")) throw new HttpError(400, "Choose a donation tier from 0 to 3");
  const userId = String(req.params.id), adminId = req.session.user!.id;
  const user = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const previous = await tx.user.findUnique({ where: { id: userId } });
    if (!previous) throw new HttpError(404, "Account not found");
    if (previous.donationTier !== tier) {
      await tx.donationTierChange.create({ data: { userId, adminId, fromTier: previous.donationTier, toTier: tier } });
      await tx.user.update({ where: { id: userId }, data: { donationTier: tier } });
    }
    return { id: previous.id, username: previous.username, name: previous.name, donationTier: tier };
  });
  res.json({ data: { user } });
});

adminRouter.post("/users/:id/wish-currency", async (req, res) => {
  const amount = req.body?.amount, requestKey = req.get("Idempotency-Key");
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000 || Object.keys(req.body ?? {}).some((key) => key !== "amount")) throw new HttpError(400, "Enter a whole amount between 1 and 1,000,000");
  if (!requestKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) throw new HttpError(400, "A valid grant request key is required");
  const userId = String(req.params.id), adminId = req.session.user!.id;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new HttpError(404, "Account not found");
      const existing = await tx.wishCurrencyGrant.findUnique({ where: { requestKey } });
      if (existing && (existing.userId !== userId || existing.adminId !== adminId || existing.amount !== amount)) throw new HttpError(409, "This grant request key was already used");
      if (!existing) {
        if (user.wishCurrency > 2147483647 - amount) throw new HttpError(409, "This grant would exceed the account balance limit");
        await tx.wishCurrencyGrant.create({ data: { requestKey, userId, adminId, amount, balanceBefore: user.wishCurrency, balanceAfter: user.wishCurrency + amount } });
        await tx.user.update({ where: { id: userId }, data: { wishCurrency: { increment: amount } } });
      }
      return { id: user.id, username: user.username, wishCurrency: existing ? user.wishCurrency : user.wishCurrency + amount };
    });
    res.json({ data: { user: result } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "This grant request key was already used");
    throw error;
  }
});

adminRouter.put("/support-qr", async (req, res) => {
  const image = req.body?.image;
  if (image !== null) {
    if (typeof image !== "string" || image.length > 720000 || !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(image)) throw new HttpError(400, "Choose a PNG or JPEG QR image under 512 KB");
    const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
    const png = image.startsWith("data:image/png;") && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = image.startsWith("data:image/jpeg;") && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (bytes.length > 512 * 1024 || (!png && !jpeg)) throw new HttpError(400, "Invalid PNG or JPEG image");
  }
  await prisma.supportSettings.upsert({ where: { id: 1 }, create: { id: 1, qrImage: image }, update: { qrImage: image } });
  res.json({ data: { qrImage: image } });
});
adminRouter.get("/support-submissions", async (_req, res) => {
  const submissions = await prisma.supportSubmission.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 50,
    select: { id: true, tier: true, amount: true, phone: true, reference: true, createdAt: true, user: { select: { id: true, username: true } } } });
  res.json({ data: { submissions } });
});
adminRouter.patch("/support-submissions/:id", async (req, res) => {
  const decision = req.body?.decision;
  if (!["approved", "rejected"].includes(decision) || Object.keys(req.body).some((key) => key !== "decision")) throw new HttpError(400, "Choose approve or reject");
  const id = String(req.params.id), adminId = req.session.user!.id;
  const initial = await prisma.supportSubmission.findUnique({ where: { id } });
  if (!initial) throw new HttpError(404, "Support submission not found");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.userId} FOR UPDATE`;
    const submission = await tx.supportSubmission.findUniqueOrThrow({ where: { id } });
    if (submission.status === decision) return;
    if (submission.status !== "pending") throw new HttpError(409, "This submission has already been reviewed");
    if (decision === "approved") {
      const user = await tx.user.findUniqueOrThrow({ where: { id: submission.userId } });
      const tier = Math.max(user.donationTier, submission.tier);
      if (tier !== user.donationTier) {
        await tx.donationTierChange.create({ data: { userId: user.id, adminId, fromTier: user.donationTier, toTier: tier } });
        await tx.user.update({ where: { id: user.id }, data: { donationTier: tier } });
      }
    }
    await tx.supportSubmission.update({ where: { id }, data: { status: decision, reviewedById: adminId, reviewedAt: new Date() } });
  });
  res.json({ data: { status: decision } });
});
