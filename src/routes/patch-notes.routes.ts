import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";

export const patchNotesRouter = Router();
patchNotesRouter.get("/", requireAuth, async (req, res) => {
  const before = req.query.before === undefined ? undefined : Number(req.query.before);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new HttpError(400, "Invalid patch cursor");
  const rows = await prisma.balanceRevision.findMany({ where: { patchVersion: { not: null, ...(before === undefined ? {} : { lt: before }) } }, orderBy: { patchVersion: "desc" }, take: 11,
    select: { patchVersion: true, patchChanges: true, createdAt: true } });
  const patches = rows.slice(0, 10).map(row => ({ version: row.patchVersion, changes: row.patchChanges, publishedAt: row.createdAt }));
  res.setHeader("Cache-Control", "no-store");
  res.json({ data: { patches, nextCursor: rows.length > 10 ? patches.at(-1)!.version : null } });
});
