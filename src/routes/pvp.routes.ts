import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth.js";
import { isAllowedOrigin } from "../config/origin.js";
import { HttpError } from "../utils/http-error.js";
import { listPvp, createPvp, joinPvp, selectPvp, readyPvp, pvpState, leavePvp, returnToPvp } from "../repositories/pvp.repository.js";

export const pvpRouter = Router();
pvpRouter.use(requireAuth);
pvpRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && !isAllowedOrigin(req.get("origin"))) return next(new HttpError(403, "Request origin is not allowed"));
  next();
});
pvpRouter.get("/", async (req, res) => { res.json({ data: await listPvp(req.session.user!.id) }); });
pvpRouter.post("/", async (req, res) => { res.status(201).json({ data: await createPvp(req.session.user!.id) }); });
pvpRouter.param("code", (req, _res, next, code: string) => {
  if (!/^[A-F0-9]{10}$/.test(code)) return next(new HttpError(400, "Enter a valid room code"));
  next();
});
pvpRouter.get("/:code", async (req, res) => { res.json({ data: await pvpState(req.session.user!.id, String(req.params.code)) }); });
pvpRouter.post("/:code/join", async (req, res) => { res.json({ data: await joinPvp(req.session.user!.id, String(req.params.code)) }); });
pvpRouter.post("/:code/select", async (req, res) => {
  const ids = req.body?.characterIds ?? (typeof req.body?.characterId === "string" ? [req.body.characterId] : null);
  if (!Array.isArray(ids) || ids.length > 6 || ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new HttpError(400, "Choose up to six different owned characters");
  res.json({ data: await selectPvp(req.session.user!.id, String(req.params.code), ids) });
});
pvpRouter.post("/:code/ready", async (req, res) => {
  if (typeof req.body?.ready !== "boolean") throw new HttpError(400, "Choose ready or unready");
  res.json({ data: await readyPvp(req.session.user!.id, String(req.params.code), req.body.ready) });
});
pvpRouter.post("/:code/leave", async (req, res) => { res.json({ data: await leavePvp(req.session.user!.id, String(req.params.code)) }); });
pvpRouter.post("/:code/return", async (req, res) => { res.json({ data: await returnToPvp(req.session.user!.id, String(req.params.code)) }); });
