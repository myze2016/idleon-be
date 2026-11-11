import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/utils/password.js";

const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
const databaseName = `idleon_test_${randomBytes(8).toString("hex")}`;
const admin = new PrismaClient({ adapter: new PrismaMariaDb({
  host: url.hostname, port: Number(url.port || 3306),
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), connectionLimit: 2,
}) });
url.pathname = `/${databaseName}`;
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Test command exited with ${result.status}`);
}

let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  const { prisma } = await import("../src/lib/prisma.js");
  try {
    await prisma.user.create({ data: { id: "test-admin", username: "admin", name: "Admin", passwordHash: await hashPassword("Admin123!") } });
  } finally { await prisma.$disconnect(); }
  run(["--import", "tsx", "--test", "--test-concurrency=1", ...readdirSync("tests").filter((file) => file.endsWith(".test.ts")).map((file) => `tests/${file}`)]);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (created && /^idleon_test_[a-f0-9]{16}$/.test(databaseName)) await admin.$executeRawUnsafe(`DROP DATABASE \`${databaseName}\``);
  await admin.$disconnect();
}
