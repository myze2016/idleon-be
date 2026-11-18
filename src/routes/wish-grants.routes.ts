import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";

// Mounted only after the admin router's fresh role, origin and rate-limit checks.
export const wishGrantsRouter = Router();
const recipientsHash = (ids: string[]) => createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
function tierNumber(value: unknown) { if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3) throw new HttpError(400, "Choose a donation tier from 0 to 3"); return value; }
wishGrantsRouter.get("/tiers/:tier/preview", async (req, res) => {
  const tier = tierNumber(Number(req.params.tier));
  const users = await prisma.user.findMany({ where: { donationTier: tier }, select: { id: true, username: true }, orderBy: { id: "asc" }, take: 10001 });
  if (users.length > 10000) throw new HttpError(400, "Tier grants support up to 10,000 accounts at a time");
  res.json({ data: { tier, count: users.length, recipientsHash: recipientsHash(users.map(user => user.id)), sample: users.slice(0, 10).map(user => user.username) } });
});
wishGrantsRouter.post("/tiers", async (req, res) => {
  const tier = tierNumber(req.body?.tier), amount = req.body?.amount, hash = req.body?.recipientsHash, key = req.get("Idempotency-Key");
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000 || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash) || Object.keys(req.body).some(key => !["tier", "amount", "recipientsHash"].includes(key))) throw new HttpError(400, "Enter a whole amount between 1 and 1,000,000 and preview recipients first");
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new HttpError(400, "A valid grant request key is required");
  const adminId = req.session.user!.id;
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    const previous = await tx.wishCurrencyBatch.findUnique({ where: { requestKey: key } });
    if (previous) {
      if (previous.adminId !== adminId || previous.donationTier !== tier || previous.amount !== amount || previous.recipientsHash !== hash) throw new HttpError(409, "This grant request key was already used");
      return { tier, amount, recipientCount: previous.recipientCount, total: amount * previous.recipientCount, alreadyApplied: true };
    }
    if (await tx.wishCurrencyGrant.findUnique({ where: { requestKey: key } })) throw new HttpError(409, "This grant request key was already used");
    if (await tx.accountGrant.findUnique({ where: { requestKey: key } })) throw new HttpError(409, "This grant request key was already used");
    const users = await tx.$queryRaw<{ id: string; wish_currency: number }[]>`SELECT id, wish_currency FROM users WHERE donation_tier = ${tier} ORDER BY id FOR UPDATE`;
    if (!users.length) throw new HttpError(400, "No accounts belong to this tier");
    if (users.length > 10000) throw new HttpError(400, "Tier grants support up to 10,000 accounts at a time");
    if (recipientsHash(users.map(user => user.id)) !== hash) throw new HttpError(409, "Tier membership changed. Preview recipients again before sending.");
    if (users.some(user => user.wish_currency > 2147483647 - amount)) throw new HttpError(409, "An account would exceed its balance limit. No wishes were sent.");
    await tx.wishCurrencyBatch.create({ data: { requestKey: key, adminId, donationTier: tier, amount, recipientsHash: hash, recipientIds: users.map(user => user.id), recipientCount: users.length } });
    await tx.wishCurrencyGrant.createMany({ data: users.map(user => ({ requestKey: randomUUID(), batchId: key, userId: user.id, adminId, amount, balanceBefore: user.wish_currency, balanceAfter: user.wish_currency + amount })) });
    await tx.user.updateMany({ where: { id: { in: users.map(user => user.id) } }, data: { wishCurrency: { increment: amount } } });
    return { tier, amount, recipientCount: users.length, total: amount * users.length, alreadyApplied: false };
  }, { timeout: 30000 });
  res.json({ data: result });
});
