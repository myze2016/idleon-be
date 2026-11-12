import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";
import { validateCharacter } from "../src/services/character.service.js";
import { createCharacter, findCharacter } from "../src/repositories/character.repository.js";

try {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production");
  const user = await prisma.user.upsert({
    where: { username: "admin" }, update: {},
    create: { id: "test-admin", username: "admin", name: "Admin", role: "admin", passwordHash: await hashPassword("Admin123!") },
  });
  await prisma.user.upsert({
    where: { username: "player2" }, update: {},
    create: { id: "player-two", username: "player2", name: "Player 2", passwordHash: await hashPassword("Player123!") },
  });
  // Import the previous file-backed character without overwriting database data.
  let legacy: Record<string, unknown> = {};
  try { legacy = JSON.parse(await readFile("data/characters.json", "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (legacy["test-admin"] && !await findCharacter(user.id)) {
    await createCharacter(user.id, validateCharacter(legacy["test-admin"]));
    console.log("Imported the existing admin character.");
  }
  console.log("Development accounts are ready: admin / Admin123! and player2 / Player123!");
} finally {
  await prisma.$disconnect();
}
