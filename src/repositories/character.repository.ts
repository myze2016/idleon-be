import { Prisma, type Weapon } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import type { Character } from "../models/character.js";
import { HttpError } from "../utils/http-error.js";
import { randomInt } from "node:crypto";
import { weaponTypes, specialWeaponTypes } from "../models/character.js";
import { baseStats } from "../models/character-stats.js";
import { accountProgress } from "../models/account-progress.js";
import { actionTiming } from "../models/action-timing.js";
import { characterSkills } from "../models/skills.js";
import { effectiveStats } from "../models/artifact.js";
import { characterUpgrades, UPGRADE_COST } from "../models/character-upgrade.js";
import { questItems } from "../models/quest-item.js";

function toCharacter(record: { name: string; weapon: Weapon }): Character {
  return { name: record.name, weapon: record.weapon.replaceAll("_", "-") as Character["weapon"] };
}

export async function findCharacter(userId: string): Promise<Character | null> {
  const character = await prisma.character.findFirst({ where: { userId, isStarter: true } });
  return character ? toCharacter(character) : null;
}

export async function deleteCharacter(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { starterCreated: false, wishCurrency: 0, gold: 0, experience: 0, meadowDefeats: 0, meadowBossAt: null, forestDefeats: 0, forestBossAt: null, harborDefeats: 0, harborBossAt: null, tourneyDefeats: 0, tourneyBossAt: null, tourneySpectator: Prisma.DbNull, deepSeaProgress: Prisma.DbNull, expeditionVitals: Prisma.DbNull } });
    await tx.user.update({ where: { id: userId }, data: { teamSlots: Prisma.DbNull } });
    await tx.encounter.deleteMany({ where: { userId } });
    await tx.artifact.deleteMany({ where: { userId } });
    await tx.character.deleteMany({ where: { userId } });
  });
}

export async function createCharacter(userId: string, character: Character): Promise<Character> {
  try {
    const record = await prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({ where: { id: userId, starterCreated: false }, data: {
        starterCreated: true, wishCurrency: { increment: 100 },
      } });
      if (!claimed.count) throw new HttpError(409, "You already have a character");
      const starter = await tx.character.create({ data: {
        userId, name: character.name, weapon: character.weapon.replaceAll("-", "_") as Weapon, isStarter: true,
      } });
      await tx.user.update({ where: { id: userId }, data: { teamSlots: [starter.id, null, null, null, null, null] } });
      return starter;
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
    characters: { orderBy: [{ isStarter: "desc" }, { createdAt: "asc" }, { id: "asc" }], include: { artifact: true } },
    artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    questItems: { orderBy: [{ acquiredAt: "asc" }, { itemId: "asc" }] },
  } });
  if (!user) throw new HttpError(401, "Please sign in to continue");
  const starter = user.characters.find((character) => character.isStarter);
  return {
    character: starter ? toCharacter(starter) : null,
    characters: user.characters.map((character) => {
      const owned = toCharacter(character);
      const stats = effectiveStats(owned.weapon, character.artifact, character.upgradeLevel);
      return { ...owned, id: character.id, isStarter: character.isStarter, skill2Unlocked: character.skill2Unlocked, upgradeLevel: character.upgradeLevel, upgrade: characterUpgrades[owned.weapon] ? { ...characterUpgrades[owned.weapon], cost: UPGRADE_COST } : null, artifactId: character.artifact?.id ?? null, baseStats: baseStats[owned.weapon], stats, timing: actionTiming(stats.speed), skills: characterSkills(owned.weapon, character.skill2Unlocked) };
    }),
    wishCurrency: user.wishCurrency,
    garnalandUnlocked: user.garnalandUnlocked,
    deepSeaFloor: user.deepSeaFloor,
    deepSeaMothUnlocked: user.questItems.some((item) => item.itemId === "deepsea-moth-map"),
    questItems: user.questItems.map(({ itemId }) => questItems[itemId as keyof typeof questItems]).filter(Boolean),
    artifacts: user.artifacts.map(({ id, stat, characterId, enhancementLevel }) => ({ id, stat, characterId, enhancementLevel })),
    teamSlots: user.teamSlots ?? [starter?.id ?? null, null, null, null, null, null],
    gold: user.gold,
    progression: accountProgress(user.experience),
  };
}

export const WISH_COST = 100;

export async function upgradeCharacter(userId: string, characterId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const character = await tx.character.findFirst({ where: { userId, id: characterId } });
    if (!character) throw new HttpError(404, "Character not found");
    const weapon = toCharacter(character).weapon;
    if (!characterUpgrades[weapon]) throw new HttpError(409, "Upgrades are not available for this class yet");
    const paid = await tx.user.updateMany({ where: { id: userId, gold: { gte: UPGRADE_COST } }, data: { gold: { decrement: UPGRADE_COST } } });
    if (!paid.count) throw new HttpError(409, "You need 1,000 gold to upgrade this character");
    await tx.character.update({ where: { id: characterId }, data: { upgradeLevel: { increment: 1 } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}

export async function assignTeamSlot(userId: string, slot: number, characterId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const character = await tx.character.findFirst({ where: { id: characterId, userId } });
    if (!character) throw new HttpError(400, "Choose a character you own");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const previous = (user.teamSlots ?? []) as (string | null)[];
    const teamSlots = Array.from({ length: 6 }, (_, index) => index === slot ? characterId : previous[index] === characterId ? null : previous[index] ?? null);
    await tx.user.update({ where: { id: userId }, data: { teamSlots } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}

export async function makeWish(userId: string) {
  const names: Record<typeof weaponTypes[number], string> = {
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
    const spent = await tx.user.updateMany({ where: { id: userId, starterCreated: true, wishCurrency: { gte: WISH_COST } }, data: { wishCurrency: { decrement: WISH_COST } } });
    if (!spent.count) throw new HttpError(409, "You need 100 wish currency to pull");
    return tx.character.create({ data: { userId, name: names[weapon], weapon: weapon.replaceAll("-", "_") as Weapon } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  const reward = toCharacter(record);
  return { ...await characterState(userId), reward: { ...reward, id: record.id, isStarter: false, skill2Unlocked: record.skill2Unlocked, stats: baseStats[reward.weapon], timing: actionTiming(baseStats[reward.weapon].speed), skills: characterSkills(reward.weapon, record.skill2Unlocked) } };
}

export const SKILL_2_COST = 1_000;

export const SPECIAL_WISH_COST = 200;
export async function makeSpecialWish(userId: string) {
  const names = { glaive: "Kent", "ice-staff": "Juan", "dual-axe": "Jeffrey" } as const;
  const record = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const owned = await tx.character.findMany({ where: { userId }, select: { weapon: true } });
    const ownedTypes = new Set(owned.map((member) => member.weapon.replaceAll("_", "-")));
    const available = specialWeaponTypes.filter((weapon) => !ownedTypes.has(weapon));
    if (!available.length) throw new HttpError(409, "You already own all 3 special characters");
    const paid = await tx.user.updateMany({ where: { id: userId, starterCreated: true, wishCurrency: { gte: SPECIAL_WISH_COST } }, data: { wishCurrency: { decrement: SPECIAL_WISH_COST } } });
    if (!paid.count) throw new HttpError(409, "You need 200 wish currency for a Special Wish");
    const weapon = available[randomInt(available.length)];
    return tx.character.create({ data: { userId, name: names[weapon], weapon: weapon.replaceAll("-", "_") as Weapon } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  const state = await characterState(userId);
  return { ...state, reward: state.characters.find((member) => member.id === record.id)! };
}

export async function unlockSkill2(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const character = await tx.character.findFirst({ where: { id, userId } });
    if (!character) throw new HttpError(404, "Character not found");
    if (character.skill2Unlocked) return;
    const paid = await tx.user.updateMany({ where: { id: userId, gold: { gte: SKILL_2_COST } }, data: { gold: { decrement: SKILL_2_COST } } });
    if (!paid.count) throw new HttpError(409, "You need 1,000 gold to unlock Skill 2");
    await tx.character.update({ where: { id }, data: { skill2Unlocked: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}
