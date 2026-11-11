import type { RequestHandler } from "express";
import { authenticate } from "../services/auth.service.js";
import { HttpError } from "../utils/http-error.js";
import { sessionCookie, sessionCookieName } from "../middlewares/session.js";

export const login: RequestHandler = (req, res, next) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" ||
      !username.trim() || !password || username.length > 100 || password.length > 256) {
    return next(new HttpError(400, "Enter a valid username and password"));
  }
  const user = authenticate(username.trim(), password);
  if (!user) return next(new HttpError(401, "Incorrect username or password"));
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.json({ data: { user } });
    });
  });
};

export const currentUser: RequestHandler = (req, res) => {
  res.json({ data: { user: req.session.user } });
};

export const logout: RequestHandler = (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie(sessionCookieName, sessionCookie);
    res.status(204).end();
  });
};
