import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { withBalance, type BalanceConfig } from "../models/balance-context.js";
export const gameBalance: RequestHandler = async (_req, _res, next) => {
  const saved = await prisma.gameBalance.findUnique({ where: { id: 1 } });
  if (saved) withBalance(saved.config as unknown as BalanceConfig, () => next());
  else next();
};
