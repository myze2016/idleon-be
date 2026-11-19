import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { artifactCatalog } from "../models/artifact.js";
import { characterState } from "./character.repository.js";
import { artifactPrice, artifactEnhanceCost } from "../models/economy.js";
import { HttpError } from "../utils/http-error.js";

export async function buyArtifact(userId: string, stat: string) {
  if (!artifactCatalog.some((item) => item.stat === stat)) throw new HttpError(400, "Choose an artifact from the shop");
  const price = artifactPrice(stat);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const paid = await tx.user.updateMany({ where: { id: userId, starterCreated: true, gold: { gte: price } }, data: { gold: { decrement: price } } });
    if (!paid.count) throw new HttpError(409, `You need ${price.toLocaleString()} gold to buy an artifact`);
    await tx.artifact.create({ data: { userId, stat } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}

export async function equipArtifact(userId: string, characterId: string, artifactId: string | null) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const character = await tx.character.findFirst({ where: { id: characterId, userId } });
    if (!character) throw new HttpError(404, "Character not found");
    if (artifactId !== null) {
      const artifact = await tx.artifact.findFirst({ where: { id: artifactId, userId } });
      if (!artifact) throw new HttpError(404, "Artifact not found");
      if (artifact.characterId && artifact.characterId !== characterId) throw new HttpError(409, "Unequip this artifact from its character first");
    }
    await tx.artifact.updateMany({ where: { userId, characterId }, data: { characterId: null } });
    if (artifactId) await tx.artifact.update({ where: { id: artifactId }, data: { characterId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}

export async function enhanceArtifact(userId: string, artifactId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const artifact = await tx.artifact.findFirst({ where: { id: artifactId, userId } });
    if (!artifact) throw new HttpError(404, "Artifact not found");
    const cost = artifactEnhanceCost(artifact.enhancementLevel);
    const paid = await tx.user.updateMany({ where: { id: userId, gold: { gte: cost } }, data: { gold: { decrement: cost } } });
    if (!paid.count) throw new HttpError(409, `You need ${cost.toLocaleString()} gold to enhance an artifact`);
    await tx.artifact.update({ where: { id: artifactId }, data: { enhancementLevel: { increment: 1 } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return characterState(userId);
}
