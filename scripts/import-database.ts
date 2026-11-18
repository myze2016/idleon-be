import { readFile } from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

// Only imports into an empty destination, in one transaction. Never overwrites users.
try {
  const snapshot = JSON.parse(await readFile("data/database-transfer.json", "utf8"));
  if (snapshot.version !== 1 || !snapshot.records) throw new Error("Unsupported database snapshot");
  const records = snapshot.records as Record<string, Record<string, unknown>[]>;
  const jsonFields = new Set(["tourneySpectator", "deepSeaProgress", "expeditionVitals", "teamSlots", "hostCharacterIds", "guestCharacterIds", "result", "messages", "teamIds"]);
  for (const rows of Object.values(records)) for (const row of rows) for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("At") && typeof value === "string") row[key] = new Date(value);
    else if (jsonFields.has(key) && value === null) row[key] = Prisma.DbNull;
  }
  await prisma.$transaction(async (tx) => {
    const counts = await Promise.all([tx.user.count(), tx.character.count(), tx.artifact.count(), tx.questItem.count(), tx.encounter.count(), tx.pvpRoom.count(), tx.session.count(), tx.wishPayment.count()]);
    if (counts.some(Boolean)) throw new Error("Destination database is not empty; refusing to overwrite existing data");
    await tx.user.createMany({ data: records.user as unknown as Prisma.UserCreateManyInput[] });
    await tx.character.createMany({ data: records.character as unknown as Prisma.CharacterCreateManyInput[] });
    await tx.artifact.createMany({ data: records.artifact as unknown as Prisma.ArtifactCreateManyInput[] });
    await tx.questItem.createMany({ data: records.questItem as unknown as Prisma.QuestItemCreateManyInput[] });
    await tx.encounter.createMany({ data: records.encounter as unknown as Prisma.EncounterCreateManyInput[] });
    await tx.pvpRoom.createMany({ data: records.pvpRoom as unknown as Prisma.PvpRoomCreateManyInput[] });
    await tx.session.createMany({ data: records.session as unknown as Prisma.SessionCreateManyInput[] });
    await tx.wishPayment.createMany({ data: records.wishPayment as unknown as Prisma.WishPaymentCreateManyInput[] });
  }, { timeout: 60000 });
  console.log("Imported database snapshot without overwriting any existing records.");
  console.log(Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, rows.length])));
} finally { await prisma.$disconnect(); }
