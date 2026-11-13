import { Router } from "express";
import { healthCheck } from "../controllers/health.controller.js";
import { authRouter } from "./auth.routes.js";
import { characterRouter } from "./character.routes.js";
import { encounterRouter } from "./encounter.routes.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { enemyWiki } from "../models/enemy-wiki.js";
import { characterWiki } from "../models/character-wiki.js";
import { pvpRouter } from "./pvp.routes.js";

export const apiRouter = Router();
apiRouter.get("/health", healthCheck);
apiRouter.get("/wiki/enemies", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ data: enemyWiki() });
});
apiRouter.get("/wiki/characters", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ data: characterWiki() });
});
apiRouter.use("/auth", authRouter);
apiRouter.use("/character", characterRouter);
apiRouter.use("/encounters", encounterRouter);
apiRouter.use("/pvp", pvpRouter);
