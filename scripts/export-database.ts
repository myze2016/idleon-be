import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma.js";

// Private local snapshot. Contains password hashes/session records; data/ is gitignored.
try {
  const records = await prisma.$transaction(async (tx) => ({
    user: await tx.user.findMany(), character: await tx.character.findMany(),
    artifact: await tx.artifact.findMany(), questItem: await tx.questItem.findMany(),
    encounter: await tx.encounter.findMany(), pvpRoom: await tx.pvpRoom.findMany(),
    session: await tx.session.findMany(), wishPayment: await tx.wishPayment.findMany(),
  }), { isolationLevel: "RepeatableRead", timeout: 60000 });
  await mkdir("data", { recursive: true });
  await writeFile("data/database-transfer.json", JSON.stringify({ version: 1, exportedAt: new Date(), records }), { flag: "wx" });
  console.log("Private snapshot saved to data/database-transfer.json");
  console.log(Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, rows.length])));
} finally { await prisma.$disconnect(); }
