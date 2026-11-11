import { Prisma, type Weapon } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import type { Character } from "../models/character.js";
import { HttpError } from "../utils/http-error.js";
import { randomInt } from "node:crypto";
import { weaponTypes } from "../models/character.js";
import { baseStats } from "../models/character-stats.js";
import { accountProgress } from "../models/account-progress.js";
import { actionTiming } from "../models/action-timing.js";
import { characterSkills } from "../models/skills.js";

function toCharacter(record: { name: string; weapon: Weapon }): Character {
  return { name: record.name, weapon: record.weapon.replaceAll("_", "-") as Character["weapon"] };
}

export async function findCharacter(userId: string): Promise<Character | null> {
  const character = await prisma.character.findFirst({ where: { userId, isStarter: true } });
  return character ? toCharacter(character) : null;
}

export async function deleteCharacter(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { starterCreated: false, wishCurrency: 0, gold: 0, experience: 0, meadowDefeats: 0, meadowBossAt: null, forestDefeats: 0, forestBossAt: null, expeditionVitals: Prisma.DbNull } });
    await tx.encounter.deleteMany({ where: { userId } });
    await tx.character.deleteMany({ where: { userId } });
  });
}

export async function createCharacter(userId: string, character: Character): Promise<Character> {
  try {
    const record = await prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({ where: { id: userId, starterCreated: false }, data: {
        starterCreated: true, wishCurrency: { increment: 1 },
      } });
      if (!claimed.count) throw new HttpError(409, "You already have a character");
      return tx.character.create({ data: {
        userId, name: character.name, weapon: character.weapon.replaceAll("-", "_") as Weapon, isStarter: true,
      } });
    });
    return toCharacter(record);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "You already have a character");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new HttpError(401, "Please sign in to continue");
    }
    throw error;
  }
}

export async function characterState(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: {
    characters: { orderBy: [{ isStarter: "desc" }, { createdAt: "asc" }, { id: "asc" }] },
  } });
  if (!user) throw new HttpError(401, "Please sign in to continue");
  const starter = user.characters.find((character) => character.isStarter);
  return {
    character: starter ? toCharacter(starter) : null,
    characters: user.characters.map((character) => {
      const owned = toCharacter(character);
      return { ...owned, id: character.id, isStarter: character.isStarter, skill2Unlocked: character.skill2Unlocked, stats: baseStats[owned.weapon], timing: actionTiming(baseStats[owned.weapon].speed), skills: characterSkills(owned.weapon, character.skill2Unlocked) };
    }),
    wishCurrency: user.wishCurrency,
    gold: user.gold,
    progression: accountProgress(user.experience),
  };
}

export async function makeWish(userId: string) {
  const names: Record<Character["weapon"], string> = {
    "sword-and-shield": "Sword and shield", bow: "Bow", wand: "Wand", staff: "Staff", book: "Book",
    spear: "Spear", axe: "Axe", rifle: "Rifle", "dual-gun": "Dual gun", "great-sword": "Great sword", "dual-knife": "Dual knife",
  };
  const record = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const owned = await tx.character.findMany({ where: { userId }, select: { weapon: true } });
    const ownedTypes = new Set(owned.map((character) => character.weapon.replaceAll("_", "-")));
    const available = weaponTypes.filter((weapon) => !ownedTypes.has(weapon));
    if (!available.length) throw new HttpError(409, "You already own all 11 character types");
    const weapon = available[randomInt(available.length)];
    const spent = await tx.user.updateMany({ where: { id: userId, starterCreated: true, wishCurrency: { gte: 1 } }, data: { wishCurrency: { decrement: 1 } } });
    if (!spent.count) throw new HttpError(409, "Not enough wish currency");
    return tx.character.create({ data: { userId, name: names[weapon], weapon: weapon.replaceAll("-", "_") as Weapon } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  const reward = toCharacter(record);
  return { ...await characterState(userId), reward: { ...reward, id: record.id, isStarter: false, skill2Unlocked: record.skill2Unlocked, stats: baseStats[reward.weapon], timing: actionTiming(baseStats[reward.weapon].speed), skills: characterSkills(reward.weapon, record.skill2Unlocked) } };
}

export const SKILL_2_COST = 10_000;

export async function unlockSkill2(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const character = await tx.character.findFirst({ where: { id, userId } });
    if (!character) throw new HttpError(404, "Character not found");
    if (character.skill2Unlocked) return;
    const paid = await tx.user.updateMany({ where: { id: userId, gold: { gte: SKILL_2_COST } }, data: { gold: { decrement: SKILL_2_COST } } });
    if (!paid.count) throw new HttpError(409, "You need 10,000 gold to unlock Skill 2");
    await tx.character.update({ where: { id }, data: { skill2Unlocked: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}
