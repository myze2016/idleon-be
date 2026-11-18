import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";
import { validateCharacter } from "../src/services/character.service.js";
import { createCharacter, findCharacter } from "../src/repositories/character.repository.js";
import { weaponTypes, specialWeaponTypes } from "../src/models/character.js";
import type { Weapon } from "../src/generated/prisma/client.js";

function seedPassword(key: "SEED_ADMIN_PASSWORD" | "SEED_PLAYER_PASSWORD") {
  const password = process.env[key];
  if (!password || password.length < 12 || password.length > 256 || !password.trim()) {
    throw new Error(`Set ${key} in the backend .env to a unique password of 12–256 characters`);
  }
  return password;
}

try {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production");
  const user = await prisma.user.upsert({
    where: { username: "admin" }, update: {},
    create: { id: "test-admin", username: "admin", name: "Admin", role: "admin", passwordHash: await hashPassword(seedPassword("SEED_ADMIN_PASSWORD")) },
  });
  await prisma.user.upsert({
    where: { username: "player2" }, update: {},
    create: { id: "player-two", username: "player2", name: "Player 2", passwordHash: await hashPassword(seedPassword("SEED_PLAYER_PASSWORD")) },
  });
  // Import the previous file-backed character without overwriting database data.
  let legacy: Record<string, unknown> = {};
  try { legacy = JSON.parse(await readFile("data/characters.json", "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (legacy["test-admin"] && !await findCharacter(user.id)) {
    await createCharacter(user.id, validateCharacter(legacy["test-admin"]));
    console.log("Imported the existing admin character.");
  }
  // Provider-independent provisioning; preserves passwords, teams and upgrades.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
    const admin = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (admin.role !== "admin") return;
    await tx.user.update({ where: { id: user.id }, data: {
      gold: Math.max(admin.gold, 100000000), wishCurrency: Math.max(admin.wishCurrency, 1000000),
      garnalandUnlocked: true, deepSeaFloor: Math.max(admin.deepSeaFloor, 3), starterCreated: true,
    } });
    for (const itemId of ["deepsea-moth-map", "zugwangs-evidence"]) await tx.questItem.upsert({
      where: { userId_itemId: { userId: user.id, itemId } }, update: {}, create: { userId: user.id, itemId },
    });
    for (const weapon of [...weaponTypes, ...specialWeaponTypes]) {
      const value = weapon.replaceAll("-", "_") as Weapon;
      if (!await tx.character.findFirst({ where: { userId: user.id, weapon: value } })) await tx.character.create({ data: {
        userId: user.id, weapon: value, skill2Unlocked: true,
        name: ({ glaive: "Kent", "ice-staff": "Juan", "dual-axe": "Jeffrey" } as Record<string, string>)[weapon]
          ?? weapon.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      } });
    }
    if (!await tx.character.findFirst({ where: { userId: user.id, isStarter: true } })) {
      const starter = await tx.character.findFirstOrThrow({ where: { userId: user.id, weapon: "sword_and_shield" } });
      await tx.character.update({ where: { id: starter.id }, data: { isStarter: true } });
    }
    await tx.character.updateMany({ where: { userId: user.id }, data: { skill2Unlocked: true } });
  });
  console.log("Admin test account: all characters and maps, 100 million gold, and 1 million wishes.");
  console.log("Development accounts are ready. Use the passwords configured in the backend .env.");
} finally {
  await prisma.$disconnect();
}
