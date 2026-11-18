import { readFile } from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

// Only imports into an empty destination, in one transaction. Never overwrites users.
try {
  const snapshot = JSON.parse(await readFile("data/database-transfer.json", "utf8"));
  if (snapshot.version !== 1 || !snapshot.records) throw new Error("Unsupported database snapshot");
  const records = snapshot.records as Record<string, Record<string, unknown>[]>;
  const jsonFields = new Set(["tourneySpectator", "deepSeaProgress", "expeditionVitals", "teamSlots", "hostCharacterIds", "guestCharacterIds", "result", "messages", "teamIds", "patchChanges"]);
  for (const rows of Object.values(records)) for (const row of rows) for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("At") && typeof value === "string") row[key] = new Date(value);
    else if (jsonFields.has(key) && value === null) row[key] = Prisma.DbNull;
  }
  await prisma.$transaction(async (tx) => {
    const counts = await Promise.all([tx.user.count(), tx.character.count(), tx.artifact.count(), tx.questItem.count(), tx.encounter.count(), tx.pvpRoom.count(), tx.session.count(), tx.wishPayment.count(), tx.donationTierChange.count(), tx.supportSettings.count(), tx.supportSubmission.count(), tx.wishCurrencyGrant.count()]);
    if (counts.some(Boolean)) throw new Error("Destination database is not empty; refusing to overwrite existing data");
    if (await tx.gameBalance.count() || await tx.balanceRevision.count()) throw new Error("Destination balance data is not empty");
    if (await tx.accountGrant.count() || await tx.accountGrantEntry.count()) throw new Error("Destination account grant data is not empty");
    await tx.user.createMany({ data: records.user as unknown as Prisma.UserCreateManyInput[] });
    await tx.character.createMany({ data: records.character as unknown as Prisma.CharacterCreateManyInput[] });
    await tx.artifact.createMany({ data: records.artifact as unknown as Prisma.ArtifactCreateManyInput[] });
    await tx.questItem.createMany({ data: records.questItem as unknown as Prisma.QuestItemCreateManyInput[] });
    await tx.encounter.createMany({ data: records.encounter as unknown as Prisma.EncounterCreateManyInput[] });
    await tx.pvpRoom.createMany({ data: records.pvpRoom as unknown as Prisma.PvpRoomCreateManyInput[] });
    await tx.session.createMany({ data: records.session as unknown as Prisma.SessionCreateManyInput[] });
    await tx.wishPayment.createMany({ data: records.wishPayment as unknown as Prisma.WishPaymentCreateManyInput[] });
    await tx.donationTierChange.createMany({ data: (records.donationTierChange ?? []) as unknown as Prisma.DonationTierChangeCreateManyInput[] });
    await tx.supportSettings.createMany({ data: (records.supportSettings ?? []) as unknown as Prisma.SupportSettingsCreateManyInput[] });
    await tx.supportSubmission.createMany({ data: (records.supportSubmission ?? []) as unknown as Prisma.SupportSubmissionCreateManyInput[] });
    if (await tx.wishCurrencyBatch.count()) throw new Error("Destination wish batches are not empty");
    await tx.wishCurrencyBatch.createMany({ data: (records.wishCurrencyBatch ?? []) as unknown as Prisma.WishCurrencyBatchCreateManyInput[] });
    await tx.wishCurrencyGrant.createMany({ data: (records.wishCurrencyGrant ?? []) as unknown as Prisma.WishCurrencyGrantCreateManyInput[] });
    await tx.accountGrant.createMany({ data: (records.accountGrant ?? []) as unknown as Prisma.AccountGrantCreateManyInput[] });
    await tx.accountGrantEntry.createMany({ data: (records.accountGrantEntry ?? []) as unknown as Prisma.AccountGrantEntryCreateManyInput[] });
    await tx.gameBalance.createMany({ data: (records.gameBalance ?? []) as unknown as Prisma.GameBalanceCreateManyInput[] });
    await tx.balanceRevision.createMany({ data: (records.balanceRevision ?? []) as unknown as Prisma.BalanceRevisionCreateManyInput[] });
    await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('balance_revisions', 'id'), COALESCE((SELECT MAX(id) FROM balance_revisions), 1), EXISTS(SELECT 1 FROM balance_revisions))`;
  }, { timeout: 60000 });
  console.log("Imported database snapshot without overwriting any existing records.");
  console.log(Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, rows.length])));
} finally { await prisma.$disconnect(); }
