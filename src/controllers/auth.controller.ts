import type { RequestHandler } from "express";
import { authenticate, registerPlayer } from "../services/auth.service.js";
import { HttpError } from "../utils/http-error.js";
import { sessionCookie, sessionCookieName } from "../middlewares/session.js";
import { findUserById } from "../repositories/user.repository.js";
import type { User } from "../models/user.js";
import type { Request, Response, NextFunction } from "express";

function startSession(req: Request, res: Response, next: NextFunction, user: User, status = 200) {
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.status(status).json({ data: { user } });
    });
  });
}

export const register: RequestHandler = async (req, res, next) => {
  const { username, password, confirmPassword } = req.body ?? {};
  if (typeof username !== "string" || !/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
    throw new HttpError(400, "Username must be 3–30 letters, numbers, or underscores");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 256 || !password.trim()) {
    throw new HttpError(400, "Password must be 8–256 characters");
  }
  if (confirmPassword !== password) throw new HttpError(400, "Passwords do not match");
  const user = await registerPlayer(username.trim(), password);
  startSession(req, res, next, user, 201);
};

export const login: RequestHandler = async (req, res, next) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" ||
      !username.trim() || !password || username.length > 100 || password.length > 256) {
    return next(new HttpError(400, "Enter a valid username and password"));
  }
  const user = await authenticate(username.trim(), password);
  if (!user) return next(new HttpError(401, "Incorrect username or password"));
  startSession(req, res, next, user);
};

export const currentUser: RequestHandler = async (req, res) => {
  const user = await findUserById(req.session.user!.id);
  if (!user) throw new HttpError(401, "Please sign in to continue");
  res.json({ data: { user } });
};

export const logout: RequestHandler = (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie(sessionCookieName, sessionCookie);
    res.status(204).end();
  });
};
