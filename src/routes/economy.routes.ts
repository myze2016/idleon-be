import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { defaultEconomy, validateEconomy, normalizeEconomy } from "../models/economy.js";
import { type BalanceConfig } from "../models/balance-context.js";
import { defaultBalance, normalizeBalance } from "../services/balance.service.js";
import { generatePatchNotes } from "../services/patch-notes.service.js";
import { HttpError } from "../utils/http-error.js";
import { characterUpgrades } from "../models/character-upgrade.js";

// Mounted under the existing authenticated, origin-checked admin router.
export const economyRouter = Router();
economyRouter.get("/", async (_req, res) => {
  const saved = await prisma.gameBalance.findUnique({ where: { id: 1 } });
  const config = saved?.config as unknown as BalanceConfig | undefined;
  res.json({ data: { version: saved?.version ?? 0, settings: normalizeEconomy(config?.economy), defaults: defaultEconomy, upgrades: characterUpgrades } });
});
economyRouter.put("/", async (req, res) => {
  const { version, settings } = req.body ?? {};
  if (!Number.isInteger(version) || version < 0) throw new HttpError(400, "Provide the current economy version");
  const economy = validateEconomy(settings);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(821493701)::text`;
    const saved = await tx.gameBalance.findUnique({ where: { id: 1 } });
    if ((saved?.version ?? 0) !== version) throw new HttpError(409, "Economy or balance changed in another session. Reload before publishing.");
    const before = normalizeBalance(saved ? saved.config as unknown as BalanceConfig : defaultBalance());
    const config = { ...before, economy };
    const patchChanges = generatePatchNotes(before, config);
    if (!patchChanges.length) throw new HttpError(400, "There are no economy changes to publish");
    if (!saved) await tx.balanceRevision.create({ data: { adminId: req.session.user!.id, note: "Original defaults", config: before as unknown as Prisma.InputJsonValue } });
    await tx.balanceRevision.create({ data: { adminId: req.session.user!.id, note: "Economy update", patchVersion: version + 1, patchChanges, config: config as unknown as Prisma.InputJsonValue } });
    return tx.gameBalance.upsert({ where: { id: 1 }, create: { id: 1, version: 1, config: config as unknown as Prisma.InputJsonValue }, update: { version: { increment: 1 }, config: config as unknown as Prisma.InputJsonValue } });
  });
  res.json({ data: { version: result.version, settings: economy, defaults: defaultEconomy, upgrades: characterUpgrades } });
});
