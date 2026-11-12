import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { enemies, encounterPool, harborPeriod, enemyRewards, type EnemyType, type Location } from "../models/enemy.js";
import { effectiveStats, artifactDrops } from "../models/artifact.js";
import type { WeaponType } from "../models/character.js";
import { simulateGroupBattle } from "../services/battle.service.js";
import { HttpError } from "../utils/http-error.js";
import { accountProgress, levelUpReward } from "../models/account-progress.js";
import { questDrops } from "../models/quest-item.js";
import { isDeepSea, deepSeaFloors, type DeepSeaProgress } from "../models/deepsea.js";
import { yellowSpectatorAppears, type TourneySpectator } from "../models/spectator.js";

export async function endExpedition(userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.encounter.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: {
      meadowDefeats: 0, forestDefeats: 0, meadowBossAt: null, forestBossAt: null, harborDefeats: 0, harborBossAt: null, tourneyDefeats: 0, tourneyBossAt: null, tourneySpectator: Prisma.DbNull, deepSeaProgress: Prisma.DbNull,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function spawnEncounter(userId: string, ids: string[], location: Location, newExpedition = false, wave = false, spectatorRoll?: () => number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const owned = await tx.character.findMany({ where: { userId, id: { in: ids } }, include: { artifact: true } });
    if (owned.length !== ids.length) throw new HttpError(400, "Choose characters you own");
    const deep = isDeepSea(location);
    if (deep) {
      const map = await tx.questItem.findUnique({ where: { userId_itemId: { userId, itemId: "deepsea-moth-map" } } });
      if (!map || user.deepSeaFloor < deepSeaFloors[location].floor) throw new HttpError(403, "This DeepSea Moot floor is locked");
    }
    const deepProgress = (user.deepSeaProgress ?? {}) as DeepSeaProgress;
    let spectator = user.tourneySpectator as unknown as TourneySpectator | null;
    if (newExpedition || location !== "tourney" || (spectator && JSON.stringify(spectator.teamIds) !== JSON.stringify(ids))) {
      spectator = newExpedition && location === "tourney" && !user.garnalandUnlocked ? { available: yellowSpectatorAppears(spectatorRoll), teamIds: ids } : null;
      await tx.user.update({ where: { id: userId }, data: { tourneySpectator: spectator ? { ...spectator } : Prisma.DbNull } });
    }
    if (newExpedition) {
      const vitals = Object.fromEntries(owned.map((character) => {
        const stats = effectiveStats(character.weapon.replaceAll("_", "-") as WeaponType, character.artifact, character.upgradeLevel);
        return [character.id, { hp: stats.hp, mp: stats.mp }];
      }));
      await tx.user.update({ where: { id: userId }, data: { expeditionVitals: vitals } });
    }
    const pending = await tx.encounter.findMany({ where: { userId, result: { equals: Prisma.DbNull } } });
    const obsolete = pending.filter((encounter) => newExpedition || encounter.location !== location || JSON.stringify(encounter.teamIds) !== JSON.stringify(ids));
    if (obsolete.length) await tx.encounter.deleteMany({ where: { id: { in: obsolete.map((encounter) => encounter.id) } } });
    const active = pending.filter((encounter) => !obsolete.includes(encounter));
    if (active.length >= 32) throw new HttpError(409, "Defeat the monsters already on screen first");
    let target = deep ? deepProgress[location]?.target ?? null : location === "tourney" ? user.tourneyBossAt : location === "harbor" ? user.harborBossAt : location === "meadow" ? user.meadowBossAt : user.forestBossAt;
    const defeats = deep ? deepProgress[location]?.defeated ?? 0 : location === "tourney" ? user.tourneyDefeats : location === "harbor" ? user.harborDefeats : location === "meadow" ? user.meadowDefeats : user.forestDefeats;
    if (target === null) {
      target = deep ? randomInt(30, 41) : location === "tourney" ? randomInt(50, 71) : randomInt(38, 46);
      await tx.user.update({ where: { id: userId }, data: deep ? { deepSeaProgress: { ...deepProgress, [location]: { defeated: defeats, target } } } : location === "tourney" ? { tourneyBossAt: target } : location === "harbor" ? { harborBossAt: target } : location === "meadow" ? { meadowBossAt: target } : { forestBossAt: target } });
    }
    const now = new Date();
    const pool: EnemyType[] = encounterPool(location, now);
    const bossType = deep ? deepSeaFloors[location].boss : location === "tourney" ? "zugwang" : location === "harbor" ? "fishpeople-guide" : location === "meadow" ? "mutant-boar" : "coco-klan-chief";
    const bossDue = defeats >= target && !active.some((encounter) => enemyRewards(encounter.enemyType as EnemyType).boss);
    const count = bossDue ? 1 : Math.min(32 - active.length, (deep || location === "tourney") ? randomInt(1, 3) : location === "harbor" ? randomInt(1, 4) : wave && location === "forest" ? randomInt(1, 3) : 1);
    const spawned = [];
    for (let index = 0; index < count; index++) {
      const enemyType = bossDue ? bossType : pool[randomInt(pool.length)];
      const encounter = await tx.encounter.create({ data: { userId, teamIds: ids, enemyType, location } });
      spawned.push({ id: encounter.id, location, ...enemyRewards(enemyType) });
    }
    return { ...spawned[0], tourneyProgress: { defeated: user.tourneyDefeats, target: location === "tourney" ? target : user.tourneyBossAt }, period: location === "harbor" ? harborPeriod(now) : undefined, harborProgress: { defeated: user.harborDefeats, target: location === "harbor" ? target : user.harborBossAt }, additionalEnemies: spawned.slice(1),
      deepSeaProgress: deep ? { defeated: defeats, target } : undefined,
      yellowSpectator: location === "tourney" && !user.garnalandUnlocked && !!spectator?.available,
      spectatorGroup: spectator?.group ?? 0,
      meadowProgress: { defeated: user.meadowDefeats, target: location === "meadow" ? target : user.meadowBossAt },
      forestProgress: { defeated: user.forestDefeats, target: location === "forest" ? target : user.forestBossAt } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function resolveEncounters(userId: string, ids: string[], lootRoll?: () => number, artifactRoll?: () => number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const records = await tx.encounter.findMany({ where: { id: { in: ids }, userId } });
    if (records.length !== ids.length) throw new HttpError(404, "Encounter not found");
    const encounters = ids.map((id) => records.find((record) => record.id === id)!);
    if (encounters.some((encounter) => encounter.result)) {
      const battleId = encounters[0].battleId ?? encounters[0].id;
      if (encounters.some((encounter) => !encounter.result || (encounter.battleId ?? encounter.id) !== battleId)) throw new HttpError(409, "Encounter already resolved");
      const leader = await tx.encounter.findFirst({ where: { id: battleId, userId } });
      return { expEarned: 0, wishEarned: 0, ...(leader?.result as Record<string, Prisma.JsonValue>), gold: user.gold, wishCurrency: user.wishCurrency,
        garnalandUnlocked: user.garnalandUnlocked, deepSeaFloor: user.deepSeaFloor,
        progression: accountProgress(user.experience), tourneyProgress: { defeated: user.tourneyDefeats, target: user.tourneyBossAt }, harborProgress: { defeated: user.harborDefeats, target: user.harborBossAt }, meadowProgress: { defeated: user.meadowDefeats, target: user.meadowBossAt }, forestProgress: { defeated: user.forestDefeats, target: user.forestBossAt } };
    }
    const teamIds = encounters[0].teamIds as string[];
    if (encounters.some((encounter) => encounter.location !== encounters[0].location || JSON.stringify(encounter.teamIds) !== JSON.stringify(teamIds))) throw new HttpError(400, "Battle monsters from the same location and team");
    const owned = await tx.character.findMany({ where: { userId, id: { in: teamIds } }, include: { artifact: true } });
    if (owned.length !== teamIds.length) throw new HttpError(409, "Your team changed. Return to the room.");
    const vitals = (user.expeditionVitals ?? {}) as Record<string, { hp: number; mp: number }>;
    const fighters = teamIds.map((id) => {
      const character = owned.find((member) => member.id === id)!;
      const weapon = character.weapon.replaceAll("_", "-") as WeaponType;
      const stats = effectiveStats(weapon, character.artifact, character.upgradeLevel);
      return { id, weapon, skill2Unlocked: character.skill2Unlocked, stats, hp: Math.min(stats.hp, vitals[id]?.hp ?? stats.hp), mp: Math.min(stats.mp, vitals[id]?.mp ?? stats.mp) };
    });
    if (fighters.every((fighter) => fighter.hp <= 0)) throw new HttpError(409, "Your team is defeated. Return to the room.");
    const types = encounters.map((encounter) => encounter.enemyType as EnemyType);
    const battle = simulateGroupBattle(fighters, types.map((type) => enemies[type].stats));
    const originalCount = encounters.length;
    for (const summon of battle.summoned) {
      const record = await tx.encounter.create({ data: { userId, teamIds, location: encounters[0].location, enemyType: summon.type, battleId: ids[0], result: { battleId: ids[0] } } });
      encounters.push(record); types.push(summon.type);
    }
    const deepLocation = encounters[0].location;
    const deepProgress = (user.deepSeaProgress ?? {}) as DeepSeaProgress;
    let deepSeaFloor = user.deepSeaFloor;
    if (isDeepSea(deepLocation)) {
      const boss = deepSeaFloors[deepLocation].boss;
      const bossWon = types.some((type, index) => type === boss && battle.enemyHps[index] <= 0);
      const kills = types.filter((type, index) => !enemyRewards(type).boss && battle.enemyHps[index] <= 0).length;
      const previous = deepProgress[deepLocation];
      deepProgress[deepLocation] = { defeated: bossWon ? 0 : (previous?.defeated ?? 0) + kills, target: bossWon ? randomInt(30, 41) : previous?.target ?? randomInt(30, 41) };
      if (bossWon) deepSeaFloor = Math.max(deepSeaFloor, Math.min(3, deepSeaFloors[deepLocation].floor + 1));
    }
    const defeated = types.filter((_, i) => battle.enemyHps[i] <= 0);
    const artifactsEarned = [];
    for (const drop of artifactDrops(defeated, artifactRoll)) {
      const artifact = await tx.artifact.create({ data: { userId, stat: drop.stat } });
      artifactsEarned.push({ id: artifact.id, stat: artifact.stat, characterId: artifact.characterId, enhancementLevel: artifact.enhancementLevel, name: drop.name });
    }
    const garnalandUnlocked = user.garnalandUnlocked || defeated.includes("demon-prince");
    const goldEarned = defeated.reduce((total, type) => total + enemies[type].gold, 0);
    const expEarned = defeated.length;
    const ownedQuestItems = await tx.questItem.findMany({ where: { userId }, select: { itemId: true } });
    const questItemsEarned = questDrops(defeated, ownedQuestItems.map((item) => item.itemId), lootRoll);
    for (const item of questItemsEarned) await tx.questItem.create({ data: { userId, itemId: item.id } });
    const { wishEarned, levelsGained } = levelUpReward(user.experience, user.experience + expEarned);
    const bossWon = defeated.includes("mutant-boar");
    const meadowKills = encounters.filter((encounter, i) => encounter.location === "meadow" && encounter.enemyType !== "mutant-boar" && battle.enemyHps[i] <= 0).length;
    const meadowDefeats = bossWon ? 0 : user.meadowDefeats + meadowKills;
    const meadowBossAt = bossWon ? randomInt(38, 46) : user.meadowBossAt;
    const chiefWon = defeated.includes("coco-klan-chief");
    const forestKills = encounters.filter((encounter, i) => encounter.location === "forest" && encounter.enemyType !== "coco-klan-chief" && battle.enemyHps[i] <= 0).length;
    const forestDefeats = chiefWon ? 0 : user.forestDefeats + forestKills;
    const forestBossAt = chiefWon ? randomInt(38, 46) : user.forestBossAt;
    const guideWon = defeated.includes("fishpeople-guide");
    const harborKills = encounters.filter((encounter, i) => encounter.location === "harbor" && encounter.enemyType !== "fishpeople-guide" && battle.enemyHps[i] <= 0).length;
    const harborDefeats = guideWon ? 0 : user.harborDefeats + harborKills;
    const harborBossAt = guideWon ? randomInt(38, 46) : user.harborBossAt;
    const zugwangWon = defeated.includes("zugwang");
    const tourneyKills = encounters.filter((encounter, i) => encounter.location === "tourney" && !enemyRewards(encounter.enemyType as EnemyType).boss && battle.enemyHps[i] <= 0).length;
    const tourneyDefeats = zugwangWon ? 0 : user.tourneyDefeats + tourneyKills;
    const tourneyBossAt = zugwangWon ? randomInt(50, 71) : user.tourneyBossAt;
    const result = { ...battle, initialTeamHp: fighters.map((fighter) => fighter.hp), initialTeamMp: fighters.map((fighter) => fighter.mp), goldEarned, wishEarned, levelsGained, expEarned, encounterIds: encounters.map((encounter) => encounter.id),
      deepSeaFloor, deepSeaJustUnlocked: deepSeaFloor > user.deepSeaFloor, ...(isDeepSea(deepLocation) ? { deepSeaProgress: deepProgress[deepLocation] } : {}),
      garnalandUnlocked, garnalandJustUnlocked: !user.garnalandUnlocked && garnalandUnlocked,
      artifactsEarned, questItemsEarned, enemies: encounters.map((encounter, index) => ({ id: encounter.id, summoned: index >= originalCount, ...enemyRewards(encounter.enemyType as EnemyType) })) };
    const battleId = encounters[0].id;
    const claimed = await tx.encounter.updateMany({ where: { id: { in: ids }, userId, result: { equals: Prisma.DbNull } }, data: { battleId, result: { battleId } } });
    if (claimed.count !== ids.length) throw new HttpError(409, "Encounter already resolved");
    await tx.encounter.update({ where: { id: battleId }, data: { result: result as unknown as Prisma.InputJsonValue } });
    fighters.forEach((fighter, index) => { vitals[fighter.id] = { hp: battle.teamHp[index], mp: battle.teamMp[index] }; });
    const updated = await tx.user.update({ where: { id: userId }, data: {
      gold: { increment: goldEarned }, wishCurrency: { increment: wishEarned }, experience: { increment: expEarned }, tourneyDefeats, tourneyBossAt, harborDefeats, harborBossAt, meadowDefeats, meadowBossAt, forestDefeats, forestBossAt,
      expeditionVitals: vitals, deepSeaProgress: deepProgress as Prisma.InputJsonValue, deepSeaFloor,
      garnalandUnlocked, ...(garnalandUnlocked ? { tourneySpectator: Prisma.DbNull } : {}),
    } });
    return { ...result, gold: updated.gold, wishCurrency: updated.wishCurrency, progression: accountProgress(updated.experience), tourneyProgress: { defeated: tourneyDefeats, target: tourneyBossAt }, harborProgress: { defeated: harborDefeats, target: harborBossAt }, meadowProgress: { defeated: meadowDefeats, target: meadowBossAt }, forestProgress: { defeated: forestDefeats, target: forestBossAt } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function resolveEncounter(userId: string, id: string) { return resolveEncounters(userId, [id]); }
