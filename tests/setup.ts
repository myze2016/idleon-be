import { after } from "node:test";
import { prisma } from "../src/lib/prisma.js";

if (process.env.NODE_ENV !== "test" || !/^\/idleon_test_[a-f0-9]{16}$/.test(new URL(process.env.DATABASE_URL!).pathname)) {
  throw new Error("Run tests with npm test so they use a disposable database");
}
after(() => prisma.$disconnect());
