import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { enemyRewards, type EnemyType } from "../models/enemy.js";
import { yellowSpectatorAppears, type TourneySpectator } from "../models/spectator.js";
import { HttpError } from "../utils/http-error.js";

export async function summonDemonPrince(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const spectator = user.tourneySpectator as unknown as TourneySpectator | null;
    if (user.garnalandUnlocked || !spectator?.available) throw new HttpError(409, "The yellow spectator is not here");
    const evidence = await tx.questItem.findUnique({ where: { userId_itemId: { userId, itemId: "zugwangs-evidence" } } });
    if (!evidence) throw new HttpError(403, "You need Zugwangs Evidence to recognize the yellow spectator");
    const owned = await tx.character.findMany({ where: { userId, id: { in: spectator.teamIds } } });
    if (!owned.length || owned.length !== spectator.teamIds.length) throw new HttpError(409, "Your team changed. Return to the room.");
    const vitals = (user.expeditionVitals ?? {}) as Record<string, { hp: number }>;
    if (owned.every((member) => (vitals[member.id]?.hp ?? 0) <= 0)) throw new HttpError(409, "Your team is defeated. Return to the room.");
    const pending = await tx.encounter.findMany({ where: { userId, result: { equals: Prisma.DbNull } } });
    if (pending.length >= 32 || pending.some((encounter) => enemyRewards(encounter.enemyType as EnemyType).boss)) throw new HttpError(409, "Finish the current monsters before summoning the Demon Prince");
    const encounter = await tx.encounter.create({ data: { userId, teamIds: spectator.teamIds, location: "tourney", enemyType: "demon-prince" } });
    await tx.user.update({ where: { id: userId }, data: { tourneySpectator: { ...spectator, available: false, summoned: true } } });
    return { id: encounter.id, location: "tourney", yellowSpectator: false, ...enemyRewards("demon-prince") };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function refreshSpectators(userId: string, group: number, roll?: () => number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const spectator = user.tourneySpectator as unknown as TourneySpectator | null;
    if (!spectator || user.garnalandUnlocked) return { yellowSpectator: false, spectatorGroup: group };
    const current = spectator.group ?? 0;
    if (group === current) return { yellowSpectator: spectator.available, spectatorGroup: current };
    if (group !== current + 1) throw new HttpError(409, "Wait for the next set of spectators");
    const available = !spectator.summoned && yellowSpectatorAppears(roll);
    await tx.user.update({ where: { id: userId }, data: { tourneySpectator: { ...spectator, group, available } } });
    return { yellowSpectator: available, spectatorGroup: group };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
