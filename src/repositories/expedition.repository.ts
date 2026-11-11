import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { enemies, enemyPools, enemyRewards, type EnemyType, type Location } from "../models/enemy.js";
import { baseStats } from "../models/character-stats.js";
import type { WeaponType } from "../models/character.js";
import { simulateGroupBattle } from "../services/battle.service.js";
import { HttpError } from "../utils/http-error.js";
import { accountProgress, levelUpReward } from "../models/account-progress.js";

export async function spawnEncounter(userId: string, ids: string[], location: Location, newExpedition = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const owned = await tx.character.findMany({ where: { userId, id: { in: ids } } });
    if (owned.length !== ids.length) throw new HttpError(400, "Choose characters you own");
    if (newExpedition) {
      const vitals = Object.fromEntries(owned.map((character) => {
        const stats = baseStats[character.weapon.replaceAll("_", "-") as WeaponType];
        return [character.id, { hp: stats.hp, mp: stats.mp }];
      }));
      await tx.user.update({ where: { id: userId }, data: { expeditionVitals: vitals } });
    }
    const pending = await tx.encounter.findMany({ where: { userId, result: { equals: Prisma.DbNull } } });
    const obsolete = pending.filter((encounter) => newExpedition || encounter.location !== location || JSON.stringify(encounter.teamIds) !== JSON.stringify(ids));
    if (obsolete.length) await tx.encounter.deleteMany({ where: { id: { in: obsolete.map((encounter) => encounter.id) } } });
    const active = pending.filter((encounter) => !obsolete.includes(encounter));
    if (active.length >= 32) throw new HttpError(409, "Defeat the monsters already on screen first");
    let target = location === "meadow" ? user.meadowBossAt : user.forestBossAt;
    const defeats = location === "meadow" ? user.meadowDefeats : user.forestDefeats;
    if (target === null) {
      target = randomInt(25, 31);
      await tx.user.update({ where: { id: userId }, data: location === "meadow" ? { meadowBossAt: target } : { forestBossAt: target } });
    }
    const pool: EnemyType[] = enemyPools[location];
    const bossType = location === "meadow" ? "mutant-boar" : "coco-klan-chief";
    const bossDue = defeats >= target && !active.some((encounter) => encounter.enemyType === bossType);
    const enemyType = bossDue ? bossType : pool[randomInt(pool.length)];
    const encounter = await tx.encounter.create({ data: { userId, teamIds: ids, enemyType, location } });
    return { id: encounter.id, location, ...enemyRewards(enemyType),
      meadowProgress: { defeated: user.meadowDefeats, target: location === "meadow" ? target : user.meadowBossAt },
      forestProgress: { defeated: user.forestDefeats, target: location === "forest" ? target : user.forestBossAt } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function resolveEncounters(userId: string, ids: string[]) {
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
        progression: accountProgress(user.experience), meadowProgress: { defeated: user.meadowDefeats, target: user.meadowBossAt }, forestProgress: { defeated: user.forestDefeats, target: user.forestBossAt } };
    }
    const teamIds = encounters[0].teamIds as string[];
    if (encounters.some((encounter) => encounter.location !== encounters[0].location || JSON.stringify(encounter.teamIds) !== JSON.stringify(teamIds))) throw new HttpError(400, "Battle monsters from the same location and team");
    const owned = await tx.character.findMany({ where: { userId, id: { in: teamIds } } });
    if (owned.length !== teamIds.length) throw new HttpError(409, "Your team changed. Return to the room.");
    const vitals = (user.expeditionVitals ?? {}) as Record<string, { hp: number; mp: number }>;
    const fighters = teamIds.map((id) => {
      const character = owned.find((member) => member.id === id)!;
      const weapon = character.weapon.replaceAll("_", "-") as WeaponType;
      const stats = baseStats[weapon];
      return { id, weapon, skill2Unlocked: character.skill2Unlocked, stats, hp: vitals[id]?.hp ?? stats.hp, mp: vitals[id]?.mp ?? stats.mp };
    });
    if (fighters.every((fighter) => fighter.hp <= 0)) throw new HttpError(409, "Your team is defeated. Return to the room.");
    const types = encounters.map((encounter) => encounter.enemyType as EnemyType);
    const battle = simulateGroupBattle(fighters, types.map((type) => enemies[type].stats));
    const defeated = types.filter((_, i) => battle.enemyHps[i] <= 0);
    const goldEarned = defeated.reduce((total, type) => total + enemies[type].gold, 0);
    const expEarned = defeated.length;
    const { wishEarned, levelsGained } = levelUpReward(user.experience, user.experience + expEarned);
    const bossWon = defeated.includes("mutant-boar");
    const meadowKills = encounters.filter((encounter, i) => encounter.location === "meadow" && encounter.enemyType !== "mutant-boar" && battle.enemyHps[i] <= 0).length;
    const meadowDefeats = bossWon ? 0 : user.meadowDefeats + meadowKills;
    const meadowBossAt = bossWon ? randomInt(25, 31) : user.meadowBossAt;
    const chiefWon = defeated.includes("coco-klan-chief");
    const forestKills = encounters.filter((encounter, i) => encounter.location === "forest" && encounter.enemyType !== "coco-klan-chief" && battle.enemyHps[i] <= 0).length;
    const forestDefeats = chiefWon ? 0 : user.forestDefeats + forestKills;
    const forestBossAt = chiefWon ? randomInt(25, 31) : user.forestBossAt;
    const result = { ...battle, initialTeamHp: fighters.map((fighter) => fighter.hp), initialTeamMp: fighters.map((fighter) => fighter.mp), goldEarned, wishEarned, levelsGained, expEarned, encounterIds: ids,
      enemies: encounters.map((encounter) => ({ id: encounter.id, ...enemyRewards(encounter.enemyType as EnemyType) })) };
    const battleId = encounters[0].id;
    const claimed = await tx.encounter.updateMany({ where: { id: { in: ids }, userId, result: { equals: Prisma.DbNull } }, data: { battleId, result: { battleId } } });
    if (claimed.count !== ids.length) throw new HttpError(409, "Encounter already resolved");
    await tx.encounter.update({ where: { id: battleId }, data: { result: result as unknown as Prisma.InputJsonValue } });
    fighters.forEach((fighter, index) => { vitals[fighter.id] = { hp: battle.teamHp[index], mp: battle.teamMp[index] }; });
    const updated = await tx.user.update({ where: { id: userId }, data: {
      gold: { increment: goldEarned }, wishCurrency: { increment: wishEarned }, experience: { increment: expEarned }, meadowDefeats, meadowBossAt, forestDefeats, forestBossAt,
      expeditionVitals: vitals,
    } });
    return { ...result, gold: updated.gold, wishCurrency: updated.wishCurrency, progression: accountProgress(updated.experience), meadowProgress: { defeated: meadowDefeats, target: meadowBossAt }, forestProgress: { defeated: forestDefeats, target: forestBossAt } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function resolveEncounter(userId: string, id: string) { return resolveEncounters(userId, [id]); }
