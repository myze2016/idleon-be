import { Router } from "express";
import { env } from "../config/env.js";
import { getCharacter, postCharacter, removeCharacter, wishCharacter, unlockCharacterSkill } from "../controllers/character.controller.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { HttpError } from "../utils/http-error.js";
import { assignTeamSlot, upgradeCharacter } from "../repositories/character.repository.js";
import { buyArtifact, equipArtifact } from "../repositories/artifact.repository.js";

export const characterRouter = Router();
characterRouter.use(requireAuth);
characterRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["POST", "DELETE"].includes(req.method) && req.get("origin") !== env.corsOrigin) {
    return next(new HttpError(403, "Request origin is not allowed"));
  }
  next();
});
characterRouter.get("/", getCharacter);
characterRouter.post("/", postCharacter);
characterRouter.post("/wish", wishCharacter);
characterRouter.post("/:id/upgrade", async (req, res) => {
  res.json({ data: await upgradeCharacter(req.session.user!.id, String(req.params.id)) });
});
characterRouter.post("/artifacts/buy", async (req, res) => {
  if (typeof req.body?.stat !== "string") throw new HttpError(400, "Choose an artifact");
  res.status(201).json({ data: await buyArtifact(req.session.user!.id, req.body.stat) });
});
characterRouter.post("/:id/artifact", async (req, res) => {
  const artifactId = req.body?.artifactId;
  if (artifactId !== null && (typeof artifactId !== "string" || !artifactId)) throw new HttpError(400, "Choose an owned artifact or unequip it");
  res.json({ data: await equipArtifact(req.session.user!.id, String(req.params.id), artifactId) });
});
characterRouter.post("/team", async (req, res) => {
  const { slot, characterId } = req.body ?? {};
  if (!Number.isInteger(slot) || slot < 0 || slot >= 6 || typeof characterId !== "string" || !characterId) throw new HttpError(400, "Choose a valid team slot and character");
  res.json({ data: await assignTeamSlot(req.session.user!.id, slot, characterId) });
});
characterRouter.post("/:id/skill-2/unlock", unlockCharacterSkill);
characterRouter.delete("/", removeCharacter);
