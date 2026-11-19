import { Router, type RequestHandler } from "express";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { accountProgress, levelUpReward, experienceForLevel } from "../models/account-progress.js";
import { HttpError } from "../utils/http-error.js";

export const accountGrantsRouter = Router();
const hashIds = (ids: string[]) => createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
const MAX = 2147483647;
export const MAX_GRANT_LEVEL = accountProgress(MAX).level;
export function levelGrant(experience: number, amount: number) {
  const before = accountProgress(experience), level = before.level + amount;
  if (!Number.isInteger(amount) || amount < 1 || level > accountProgress(MAX).level) throw new HttpError(409, `Level grants cannot exceed account level ${accountProgress(MAX).level}`);
  const threshold = experienceForLevel(level);
  const required = accountProgress(threshold).expToNextLevel;
  const after = threshold + Math.min(before.exp, required - 1);
  if (after > MAX) throw new HttpError(409, "Experience would exceed the account limit");
  return { experience: after, level, wishEarned: levelUpReward(experience, after).wishEarned };
}
accountGrantsRouter.use("/:kind", (req, _res, next) => {
  if (req.params.kind !== "gold" && req.params.kind !== "levels") throw new HttpError(404, "Unknown grant module");
  next();
});
accountGrantsRouter.get("/:kind/tiers/:tier/preview", async (req, res) => {
  const tier = Number(req.params.tier);
  if (!Number.isInteger(tier) || tier < 0 || tier > 3) throw new HttpError(400, "Choose a donation tier from 0 to 3");
  const users = await prisma.user.findMany({ where: { donationTier: tier }, orderBy: { id: "asc" }, select: { id: true, username: true }, take: 10001 });
  if (users.length > 10000) throw new HttpError(400, "A tier grant supports up to 10,000 accounts");
  res.json({ data: { maxLevel: accountProgress(MAX).level, tier, count: users.length, recipientsHash: hashIds(users.map(user => user.id)), sample: users.slice(0, 10).map(user => user.username) } });
});
const grant: RequestHandler = async (req, res) => {
  const kind = String(req.params.kind), amount = req.body?.amount, key = req.get("Idempotency-Key");
  const userId = req.params.id ? String(req.params.id) : null, tier = userId ? null : req.body?.tier, hash = userId ? null : req.body?.recipientsHash;
  if (!Number.isInteger(amount) || amount < 1 || amount > (kind === "gold" ? 1000000 : accountProgress(MAX).level - 1)) throw new HttpError(400, `Enter a whole amount from 1 to ${kind === "gold" ? "1,000,000" : accountProgress(MAX).level - 1}`);
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new HttpError(400, "A valid grant request key is required");
  if (Object.keys(req.body ?? {}).some(field => !(userId ? ["amount"] : ["amount", "tier", "recipientsHash"]).includes(field))) throw new HttpError(400, "Invalid grant fields");
  if (!userId && (!Number.isInteger(tier) || tier < 0 || tier > 3 || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) throw new HttpError(400, "Choose a tier and preview recipients first");
  const adminId = req.session.user!.id;
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    const existing = await tx.accountGrant.findUnique({ where: { requestKey: key } });
    if (existing) {
      if (existing.adminId !== adminId || existing.kind !== kind || existing.amount !== amount || existing.targetUserId !== userId || existing.donationTier !== tier || existing.recipientsHash !== hash) throw new HttpError(409, "This request key was already used");
      return { ...(existing.result as Prisma.JsonObject), alreadyApplied: true };
    }
    if (await tx.wishCurrencyGrant.findUnique({ where: { requestKey: key } }) || await tx.wishCurrencyBatch.findUnique({ where: { requestKey: key } })) throw new HttpError(409, "This request key was already used");
    type Recipient = { id: string; username: string; gold: number; experience: number; wish_currency: number };
    const users = userId
      ? await tx.$queryRaw<Recipient[]>`SELECT id, username, gold, experience, wish_currency FROM users WHERE id = ${userId} FOR UPDATE`
      : await tx.$queryRaw<Recipient[]>`SELECT id, username, gold, experience, wish_currency FROM users WHERE donation_tier = ${tier} ORDER BY id FOR UPDATE`;
    if (!users.length) throw new HttpError(userId ? 404 : 400, userId ? "Account not found" : "No accounts belong to this tier");
    if (users.length > 10000) throw new HttpError(400, "A tier grant supports up to 10,000 accounts");
    if (!userId && hashIds(users.map(user => user.id)) !== hash) throw new HttpError(409, "Tier membership changed. Preview again before sending.");
    const entries = users.map(user => {
      const progress = accountProgress(user.experience), next = kind === "levels" ? levelGrant(user.experience, amount) : null;
      const goldAfter = user.gold + (kind === "gold" ? amount : 0), wishAfter = user.wish_currency + (next?.wishEarned ?? 0);
      if (goldAfter > MAX || wishAfter > MAX) throw new HttpError(409, "A recipient would exceed its balance limit. Nothing was sent.");
      return { requestKey: key, userId: user.id, goldBefore: user.gold, goldAfter, experienceBefore: user.experience, experienceAfter: next?.experience ?? user.experience, wishBefore: user.wish_currency, wishAfter, levelBefore: progress.level, levelAfter: next?.level ?? progress.level };
    });
    const summary = { kind, amount, recipientCount: users.length, total: amount * users.length, wishEarned: entries.reduce((sum, entry) => sum + entry.wishAfter - entry.wishBefore, 0),
      ...(userId ? { user: { id: userId, username: users[0].username, gold: entries[0].goldAfter, level: entries[0].levelAfter } } : {}) };
    await tx.accountGrant.create({ data: { requestKey: key, adminId, kind, amount, targetUserId: userId, donationTier: tier, recipientsHash: hash, result: summary } });
    await tx.accountGrantEntry.createMany({ data: entries });
    if (kind === "gold") await tx.user.updateMany({ where: { id: { in: users.map(user => user.id) } }, data: { gold: { increment: amount } } });
    else {
      const values = entries.map(entry => Prisma.sql`(${entry.userId}::varchar, ${entry.experienceAfter}::integer, ${entry.wishAfter}::integer)`);
      await tx.$executeRaw`UPDATE users AS u SET experience = v.experience, wish_currency = v.wishes, updated_at = NOW() FROM (VALUES ${Prisma.join(values)}) AS v(id, experience, wishes) WHERE u.id = v.id`;
    }
    return { ...summary, alreadyApplied: false };
  }, { timeout: 30000 });
  res.json({ data: result });
};
accountGrantsRouter.post("/:kind/accounts/:id", grant);
accountGrantsRouter.post("/:kind/tiers", grant);
