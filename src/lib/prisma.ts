import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

export function databaseOptions(connectionString: string) {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: 5,
  };
}

export const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseOptions(env.databaseUrl)) });
