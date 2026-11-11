import { Router } from "express";
import { healthCheck } from "../controllers/health.controller.js";
import { authRouter } from "./auth.routes.js";
import { characterRouter } from "./character.routes.js";
import { encounterRouter } from "./encounter.routes.js";

export const apiRouter = Router();
apiRouter.get("/health", healthCheck);
apiRouter.use("/auth", authRouter);
apiRouter.use("/character", characterRouter);
apiRouter.use("/encounters", encounterRouter);
