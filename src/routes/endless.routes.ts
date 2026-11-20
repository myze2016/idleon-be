import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { endlessHome, startEndless, prepareEndlessWave, resolveEndlessWave, setEndlessSkill2, retireEndless, endlessLeaderboard, endlessSettings, saveEndlessSettings } from "../repositories/endless.repository.js";
import { defaultEnemies, enemies, enemyLocations } from "../models/enemy.js";

export const endlessRouter = Router();
endlessRouter.use(requireAuth);
endlessRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && !isAllowedOrigin(req.get("origin"))) throw new HttpError(403, "Request origin is not allowed");
  next();
});
endlessRouter.use(rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: req => req.session.user!.id, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many Endless requests. Please wait a moment." } } }));
endlessRouter.get("/", async (req, res) => { res.json({ data: await endlessHome(req.session.user!.id) }); });
endlessRouter.get("/leaderboard", async (req, res) => {
  const season = req.query.season === undefined ? undefined : Number(req.query.season);
  if (season !== undefined && (!Number.isSafeInteger(season) || season < 1)) throw new HttpError(400, "Choose a valid season");
  res.json({ data: await endlessLeaderboard(req.session.user!.id, season) });
});
endlessRouter.post("/start", async (req, res) => {
  const { teamIds, requestKey } = req.body ?? {};
  if (!Array.isArray(teamIds) || !teamIds.length || teamIds.length > 6 || teamIds.some(id => typeof id !== "string" || !id || id.length > 30) || new Set(teamIds).size !== teamIds.length || typeof requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) throw new HttpError(400, "Choose 1–6 different owned characters and a valid run request key");
  res.json({ data: await startEndless(req.session.user!.id, teamIds, requestKey) });
});
endlessRouter.param("id", (_req, _res, next, id: string) => { if (!/^[a-z0-9]{20,30}$/.test(id)) throw new HttpError(400, "Choose a valid Endless run"); next(); });
endlessRouter.post("/:id/wave", async (req, res) => { res.json({ data: await prepareEndlessWave(req.session.user!.id, String(req.params.id)) }); });
endlessRouter.post("/:id/skill-2", async (req, res) => {
  const { wave, fighterId, enabled } = req.body ?? {};
  if (!Number.isSafeInteger(wave) || wave < 1 || typeof fighterId !== "string" || !fighterId || fighterId.length > 100 || typeof enabled !== "boolean") throw new HttpError(400, "Provide a checkpoint, a fighter, and a Skill 2 setting");
  res.json({ data: await setEndlessSkill2(req.session.user!.id, String(req.params.id), wave, fighterId, enabled) });
});
endlessRouter.post("/:id/resolve", async (req, res) => {
  if (!Number.isSafeInteger(req.body?.wave) || req.body.wave < 1 || req.body.wave > 2147483647) throw new HttpError(400, "Choose a valid wave");
  res.json({ data: await resolveEndlessWave(req.session.user!.id, String(req.params.id), req.body.wave) });
});
endlessRouter.post("/:id/retire", async (req, res) => { res.json({ data: await retireEndless(req.session.user!.id, String(req.params.id)) }); });

// Mounted separately behind the admin router's fresh role and origin checks.
export const endlessAdminRouter = Router();
endlessAdminRouter.get("/", async (_req, res) => {
  res.json({ data: { ...await endlessSettings(), enemies: Object.entries(enemies).map(([id, enemy]) => ({ id, name: enemy.name, stats: enemy.stats, locations: enemyLocations(id as keyof typeof defaultEnemies) })) } });
});
endlessAdminRouter.put("/", async (req, res) => {
  if (!Number.isInteger(req.body?.version) || req.body.version < 1 || req.body.version >= 2147483647) throw new HttpError(400, "Provide the current Endless settings version");
  res.json({ data: await saveEndlessSettings(req.body.version, req.body.config) });
});
