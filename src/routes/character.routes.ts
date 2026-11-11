import { Router } from "express";
import { env } from "../config/env.js";
import { getCharacter, postCharacter, removeCharacter, wishCharacter, unlockCharacterSkill } from "../controllers/character.controller.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { HttpError } from "../utils/http-error.js";

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
characterRouter.post("/:id/skill-2/unlock", unlockCharacterSkill);
characterRouter.delete("/", removeCharacter);
