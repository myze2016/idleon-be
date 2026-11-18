import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFound } from "./middlewares/not-found.js";
import { apiRouter } from "./routes/index.js";
import { sessionMiddleware } from "./middlewares/session.js";
import { isAllowedOrigin } from "./config/origin.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(sessionMiddleware);
app.use("/api", apiRouter);
app.use(notFound);
app.use(errorHandler);
