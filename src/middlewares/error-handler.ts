import type { ErrorRequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = error instanceof HttpError ? error.status
    : error instanceof SyntaxError && "status" in error && error.status === 400 ? 400
    : typeof error === "object" && error !== null && "status" in error && error.status === 413 ? 413
    : 500;
  if (status >= 500) console.error(error);

  const message = error instanceof HttpError ? error.message
    : status === 400 ? "Invalid JSON body"
    : status === 413 ? "Request body too large"
    : "Internal server error";
  res.status(status).json({ error: { message } });
};
