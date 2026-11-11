import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { currentUser, login, logout } from "../controllers/auth.controller.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { HttpError } from "../utils/http-error.js";

export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
authRouter.use((req, _res, next) => {
  if (req.method === "POST" && req.get("origin") !== env.corsOrigin) {
    return next(new HttpError(403, "Request origin is not allowed"));
  }
  next();
});
authRouter.post("/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts. Try again in 15 minutes." } },
}), login);
authRouter.get("/me", requireAuth, currentUser);
authRouter.post("/logout", logout);
