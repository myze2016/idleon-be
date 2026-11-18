import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { currentUser, login, logout, register, requestRegistrationCode } from "../controllers/auth.controller.js";
import { isAllowedOrigin } from "../config/origin.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { HttpError } from "../utils/http-error.js";
import { startGoogleLogin, finishGoogleLogin } from "../controllers/google-auth.controller.js";

export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
authRouter.use((req, _res, next) => {
  if (req.method === "POST" && !isAllowedOrigin(req.get("origin"))) {
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
authRouter.post("/register/code", rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: { message: "Too many email requests. Try again in an hour." } },
}), requestRegistrationCode);

authRouter.post("/register", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many registration attempts. Try again in 15 minutes." } },
}), register);

authRouter.get("/me", requireAuth, currentUser);

const googleLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
authRouter.get("/google", googleLimiter, startGoogleLogin);
authRouter.get("/google/callback", googleLimiter, finishGoogleLogin);
authRouter.post("/logout", logout);
