import "dotenv/config";

const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const nodeEnv = process.env.NODE_ENV ?? "development";
if (!["development", "test", "production"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test, or production");
}

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const origin = new URL(corsOrigin);
if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== corsOrigin) {
  throw new Error("CORS_ORIGIN must be an HTTP(S) origin without a trailing slash");
}

export const env = { port, nodeEnv, corsOrigin };
