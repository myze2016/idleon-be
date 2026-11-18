import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

export function databaseOptions(connectionString: string) {
  return {
    connectionString,
    max: 5,
  };
}

export const prisma = new PrismaClient({ adapter: new PrismaPg(databaseOptions(env.databaseUrl)) });
