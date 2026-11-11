import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session.user) return next(new HttpError(401, "Please sign in to continue"));
  next();
};
