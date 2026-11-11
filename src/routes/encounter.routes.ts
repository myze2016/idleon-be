import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { spawnEncounter, resolveEncounter, resolveEncounters } from "../repositories/expedition.repository.js";

export const encounterRouter = Router();
encounterRouter.use(requireAuth);
encounterRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.get("origin") !== env.corsOrigin) return next(new HttpError(403, "Request origin is not allowed"));
  next();
});
encounterRouter.post("/", async (req, res) => {
  const { location, teamIds } = req.body ?? {};
  if (location !== "forest" && location !== "meadow") throw new HttpError(400, "Choose Meadow or Forest");
  if (!Array.isArray(teamIds) || !teamIds.length || teamIds.length > 6 || teamIds.some((id) => typeof id !== "string") || new Set(teamIds).size !== teamIds.length) {
    throw new HttpError(400, "Choose 1–6 different characters");
  }
  res.status(201).json({ data: await spawnEncounter(req.session.user!.id, teamIds, location, req.body?.newExpedition === true) });
});
encounterRouter.post("/resolve", async (req, res) => {
  const ids = req.body?.encounterIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 32 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new HttpError(400, "Choose 1–32 different encounters");
  res.json({ data: await resolveEncounters(req.session.user!.id, ids) });
});
encounterRouter.post("/:id/resolve", async (req, res) => {
  res.json({ data: await resolveEncounter(req.session.user!.id, String(req.params.id)) });
});
