import "dotenv/config";

const port = Number(process.env.PORT ?? 8020);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const nodeEnv = process.env.NODE_ENV ?? "development";
if (!["development", "test", "production"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test, or production");
}

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3020";
const origin = new URL(corsOrigin);
if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== corsOrigin) {
  throw new Error("CORS_ORIGIN must be an HTTP(S) origin without a trailing slash");
}

const corsAdditionalOrigins = (process.env.CORS_ADDITIONAL_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
for (const value of corsAdditionalOrigins) {
  const additionalOrigin = new URL(value);
  if (!["http:", "https:"].includes(additionalOrigin.protocol) || additionalOrigin.origin !== value) {
    throw new Error("CORS_ADDITIONAL_ORIGINS must contain HTTP(S) origins without trailing slashes");
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const database = new URL(databaseUrl);
if (!["postgresql:", "postgres:"].includes(database.protocol) || database.pathname.length < 2) {
  throw new Error("DATABASE_URL must be a PostgreSQL URL with a database name");
}
if (nodeEnv === "production" && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production");
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? (nodeEnv === "production" ? 1 : 0));
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
  throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 5");
}

export const env = { port, nodeEnv, corsOrigin, corsAdditionalOrigins, databaseUrl, trustProxyHops };
