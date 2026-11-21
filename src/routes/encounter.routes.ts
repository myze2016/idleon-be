import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { spawnEncounter, resolveEncounter, resolveEncounters, endExpedition, joinExpeditionCombat, toggleExpeditionSkill2 } from "../repositories/expedition.repository.js";
import { isDeepSea } from "../models/deepsea.js";
import { summonDemonPrince, refreshSpectators } from "../repositories/spectator.repository.js";

export const encounterRouter = Router();
encounterRouter.use(requireAuth);
encounterRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!isAllowedOrigin(req.get("origin"))) return next(new HttpError(403, "Request origin is not allowed"));
  next();
});
encounterRouter.post("/", async (req, res) => {
  const { location, teamIds } = req.body ?? {};
  if (location !== "garnaland" && location !== "forest" && location !== "meadow" && location !== "harbor" && location !== "tourney" && !isDeepSea(location)) throw new HttpError(400, "Choose Meadow, Forest, Harbor, Zugwangs Battle Tourney, or Garnaland");
  if (!Array.isArray(teamIds) || !teamIds.length || teamIds.length > 6 || teamIds.some((id) => typeof id !== "string") || new Set(teamIds).size !== teamIds.length) {
    throw new HttpError(400, "Choose 1–6 different characters");
  }
  res.status(201).json({ data: await spawnEncounter(req.session.user!.id, teamIds, location, req.body?.newExpedition === true, req.body?.wave === true) });
});
encounterRouter.post("/return", async (req, res) => {
  await endExpedition(req.session.user!.id);
  res.sendStatus(204);
});
encounterRouter.post("/spectator", async (req, res) => {
  res.status(201).json({ data: await summonDemonPrince(req.session.user!.id) });
});
encounterRouter.post("/spectators/next", async (req, res) => {
  const group = req.body?.group;
  if (!Number.isSafeInteger(group) || group < 1) throw new HttpError(400, "Choose a valid spectator group");
  res.json({ data: await refreshSpectators(req.session.user!.id, group) });
});
encounterRouter.post("/resolve", async (req, res) => {
  const ids = req.body?.encounterIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 32 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new HttpError(400, "Choose 1–32 different encounters");
  res.json({ data: await resolveEncounters(req.session.user!.id, ids) });
});
encounterRouter.post("/prepare", async (req, res) => {
  const { encounterIds: ids, disabledSkill2Ids = [] } = req.body ?? {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 32 || ids.some(id => typeof id !== "string" || !id || id.length > 30) || new Set(ids).size !== ids.length) throw new HttpError(400, "Choose 1 to 32 different encounters");
  if (!Array.isArray(disabledSkill2Ids) || disabledSkill2Ids.length > 6 || disabledSkill2Ids.some(id => typeof id !== "string" || !id || id.length > 30)) throw new HttpError(400, "Choose valid Skill 2 fighters");
  res.json({ data: await resolveEncounters(req.session.user!.id, ids, undefined, undefined, { disabledSkill2Ids }) });
});
encounterRouter.post("/:id/skill-2", async (req, res) => {
  const id = String(req.params.id), { fighterId, enabled } = req.body ?? {};
  if (!id || id.length > 30 || typeof fighterId !== "string" || !fighterId || fighterId.length > 30 || typeof enabled !== "boolean") throw new HttpError(400, "Provide a fighter and a Skill 2 setting");
  res.json({ data: await toggleExpeditionSkill2(req.session.user!.id, id, fighterId, enabled) });
});
encounterRouter.post("/:id/arrivals", async (req, res) => {
  const leaderId = String(req.params.id), ids = req.body?.encounterIds;
  if (!leaderId || leaderId.length > 30 || !Array.isArray(ids) || !ids.length || ids.length > 32
    || ids.some(id => typeof id !== "string" || !id || id.length > 30) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, "Choose enemies from the current expedition");
  }
  res.json({ data: await joinExpeditionCombat(req.session.user!.id, leaderId, ids) });
});
encounterRouter.post("/:id/resolve", async (req, res) => {
  res.json({ data: await resolveEncounter(req.session.user!.id, String(req.params.id)) });
});
