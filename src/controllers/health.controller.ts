import type { RequestHandler } from "express";
import { getHealth } from "../services/health.service.js";

export const healthCheck: RequestHandler = (_req, res) => {
  res.status(200).json({ data: getHealth() });
};
