import { playerIdentity, playerNameSelect } from "../models/player-name.js";
import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma, type EndlessRun } from "../generated/prisma/client.js";
import { defaultEndless, endlessDistanceStats, endlessSpawnInterval, ENDLESS_CHECKPOINT_SECONDS, ENDLESS_METERS_PER_SECOND, validateEndless, type EndlessConfig } from "../models/endless.js";
import { currentBalance, withBalance, type BalanceConfig } from "../models/balance-context.js";
import { defaultBalance, normalizeBalance } from "../services/balance.service.js";
import { effectiveStats } from "../models/artifact.js";
import { enemies, defaultEnemies, type EnemyType } from "../models/enemy.js";
import type { WeaponType } from "../models/character.js";
import { simulateDuel, type DuelFighter, type DuelResult } from "../services/pvp-battle.service.js";
import { HttpError } from "../utils/http-error.js";

type Pending = { enemyType: EnemyType; result: DuelResult; nextSpawnIn?: number };
const isolationLevel = Prisma.TransactionIsolationLevel.ReadCommitted;
const json = (value: unknown) => value as Prisma.InputJsonValue;
export async function endlessSettings() {
  const saved = await prisma.endlessSettings.findUnique({ where: { id: 1 } });
  return { version: saved?.version ?? 1, config: saved ? saved.config as unknown as EndlessConfig : structuredClone(defaultEndless) };
}
export async function saveEndlessSettings(version: number, input: unknown) {
  const config = validateEndless(input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(821493703)::text`;
    const saved = await tx.endlessSettings.findUnique({ where: { id: 1 } });
    if ((saved?.version ?? 1) !== version) throw new HttpError(409, "Endless settings changed. Reload before publishing.");
    const before = validateEndless(saved ? saved.config as unknown as EndlessConfig : defaultEndless);
    if (JSON.stringify(before) === JSON.stringify(config)) throw new HttpError(400, "There are no changes to publish");
    const record = await tx.endlessSettings.upsert({ where: { id: 1 }, create: { id: 1, version: version + 1, config: json(config) }, update: { version: { increment: 1 }, config: json(config) } });
    return { version: record.version, config };
  });
}
function state(run: EndlessRun | null) {
  if (!run) return null;
  return { id: run.id, season: run.season, status: run.status, wave: run.wave, bestWave: run.bestWave,
    distance: run.bestWave, team: (run.team as unknown as DuelFighter[]).filter(member => member.userId === run.userId), settings: run.settings as unknown as EndlessConfig,
    pending: run.pending as unknown as Pending | null, readyAt: run.readyAt?.toISOString() ?? null,
    serverNow: new Date().toISOString(), createdAt: run.createdAt.toISOString() };
}
async function expire(userId: string) {
  await prisma.endlessRun.updateMany({ where: { userId, status: "active", updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } }, data: { status: "expired", pending: Prisma.DbNull, readyAt: null } });
}
export async function endlessHome(userId: string) {
  await expire(userId);
  const [settings, run] = await Promise.all([endlessSettings(), prisma.endlessRun.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } })]);
  return { ...settings, run: state(run), enemies: settings.config.enemyPool.map(id => ({ id, name: defaultEnemies[id].name })) };
}
export async function startEndless(userId: string, ids: string[], requestKey: string) {
  await expire(userId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const duplicate = await tx.endlessRun.findUnique({ where: { requestKey } });
    if (duplicate) { if (duplicate.userId !== userId) throw new HttpError(409, "This run request has already been used"); return state(duplicate); }
    const active = await tx.endlessRun.findFirst({ where: { userId, status: "active" } });
    if (active) return state(active);
    const settings = await endlessSettings();
    if (!settings.config.enabled) throw new HttpError(409, "Endless mode is currently closed to new runs");
    const owned = await tx.character.findMany({ where: { userId, id: { in: ids } }, include: { artifact: true } });
    if (owned.length !== ids.length) throw new HttpError(400, "Choose one to six characters you own");
    const balance = normalizeBalance(currentBalance() ?? defaultBalance());
    const team = withBalance(balance, () => ids.map((id, slot) => {
      const character = owned.find(entry => entry.id === id)!;
      const weapon = character.weapon.replaceAll("_", "-") as WeaponType;
      const stats = effectiveStats(weapon, character.artifact, character.upgradeLevel);
      return { id, userId, name: character.name, weapon, stats, backRow: slot >= 3, skill2Unlocked: character.skill2Unlocked, hp: stats.hp, mp: stats.mp };
    }));
    const run = await tx.endlessRun.create({ data: { userId, requestKey, season: settings.version, team: json(team), settings: json(settings.config), balance: json(balance) } });
    return state(run);
  }, { isolationLevel });
}
async function ownedRun(tx: Prisma.TransactionClient, userId: string, id: string) {
  // Lock the account first in every mutation, serializing runs and best-score updates.
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const run = await tx.endlessRun.findFirst({ where: { id, userId } });
  if (!run) throw new HttpError(404, "Endless run not found");
  return run;
}
export async function prepareEndlessWave(userId: string, id: string) {
  await expire(userId);
  return prisma.$transaction(async tx => {
    const run = await ownedRun(tx, userId, id);
    if (run.status !== "active" || run.pending) return state(run);
    const settings = run.settings as unknown as EndlessConfig, balance = run.balance as unknown as BalanceConfig;
    const team = run.team as unknown as DuelFighter[];
    const front = Math.max(400, ...team.filter(member => member.userId === userId && (member.hp ?? member.stats.hp) > 0).map(member => member.startX ?? 400));
    const incoming: DuelFighter[] = [];
    const capacity = Math.max(0, 40 - team.filter(member => member.userId !== userId).length);
    let spawnAt = (settings as EndlessConfig & { spawnDelay?: number }).spawnDelay ?? 0;
    for (; spawnAt < ENDLESS_CHECKPOINT_SECONDS - 1e-8; spawnAt += endlessSpawnInterval(() => randomInt(1_000_001) / 1_000_000)) {
      if (incoming.length >= capacity) continue;
      const at = spawnAt;
      const type = settings.enemyPool[randomInt(settings.enemyPool.length)];
      const enemy = withBalance(balance, () => enemies[type]);
      const stats = endlessDistanceStats(balance.enemies[type], run.bestWave + at * ENDLESS_METERS_PER_SECOND, settings.statMultiplier);
      incoming.push({ id: `endless-${run.wave}-${incoming.length}`, userId: `enemy:${userId}`, name: enemy.name, enemyType: type, enemy: stats, stats, startX: front + 800, spawnAt: at });
    }
    const result = withBalance(balance, () => {
      return simulateDuel([...team, ...incoming], undefined, ENDLESS_CHECKPOINT_SECONDS);
    });
    const updated = await tx.endlessRun.update({ where: { id }, data: { pending: json({ enemyType: incoming[0]?.enemyType ?? team.find(member => member.enemyType)?.enemyType, result, nextSpawnIn: spawnAt - ENDLESS_CHECKPOINT_SECONDS }), readyAt: new Date(Date.now() + Math.max(1000, Math.ceil(result.duration * 1000))) } });
    return state(updated);
  }, { isolationLevel });
}
export async function resolveEndlessWave(userId: string, id: string, wave: number) {
  await expire(userId);
  const resolved = await prisma.$transaction(async tx => {
    const run = await ownedRun(tx, userId, id);
    if (wave < run.wave || run.status !== "active") return state(run);
    if (wave !== run.wave || !run.pending || !run.readyAt) throw new HttpError(409, "Combat has not started yet");
    if (run.readyAt.getTime() > Date.now()) throw new HttpError(409, "Combat is still in progress");
    const { result, nextSpawnIn } = run.pending as unknown as Pending;
    const last = result.steps.at(-1);
    const team = result.continuation ?? (run.team as unknown as DuelFighter[]).map(member => {
      const index = result.fighters.findIndex(fighter => fighter.id === member.id && fighter.userId === userId);
      return { ...member, hp: last?.hp[index] ?? member.hp ?? member.stats.hp, mp: last?.mp[index] ?? member.mp ?? member.stats.mp };
    });
    const survived = team.some(member => member.userId === userId && (member.hp ?? member.stats.hp) > 0);
    const distance = Math.min(2147483647, run.bestWave + Math.floor(result.duration * ENDLESS_METERS_PER_SECOND));
    if (distance > 0) {
      const previous = await tx.endlessScore.findUnique({ where: { userId_season: { userId, season: run.season } } });
      if (!previous || distance > previous.bestWave) await tx.endlessScore.upsert({ where: { userId_season: { userId, season: run.season } }, create: { userId, season: run.season, bestWave: distance }, update: { bestWave: distance, achievedAt: new Date() } });
    }
    const updated = await tx.endlessRun.update({ where: { id }, data: { status: survived ? "active" : "defeated", wave: run.wave + 1, bestWave: distance, team: json(team), settings: json({ ...(run.settings as unknown as EndlessConfig), spawnDelay: nextSpawnIn ?? 0 }), pending: Prisma.DbNull, readyAt: null } });
    return state(updated);
  }, { isolationLevel });
  // Return the next combat checkpoint in the same HTTP response. The client
  // keeps playing instead of stopping to make another spawn request.
  return resolved?.status === "active" && !resolved.pending ? prepareEndlessWave(userId, id) : resolved;
}
export async function retireEndless(userId: string, id: string) {
  return prisma.$transaction(async tx => {
    const run = await ownedRun(tx, userId, id);
    if (run.status !== "active") return state(run);
    return state(await tx.endlessRun.update({ where: { id }, data: { status: "retired", pending: Prisma.DbNull, readyAt: null } }));
  }, { isolationLevel });
}
export async function endlessLeaderboard(userId: string, season?: number) {
  const settings = await endlessSettings();
  const selected = season ?? settings.version;
  if (selected > settings.version) throw new HttpError(400, "Choose an existing Endless season");
  const [scores, mine] = await Promise.all([
    prisma.endlessScore.findMany({ where: { season: selected }, orderBy: [{ bestWave: "desc" }, { achievedAt: "asc" }, { userId: "asc" }], take: 50, include: { user: { select: playerNameSelect } } }),
    prisma.endlessScore.findUnique({ where: { userId_season: { userId, season: selected } } }),
  ]);
  const ahead = mine ? await prisma.endlessScore.count({ where: { season: selected, OR: [{ bestWave: { gt: mine.bestWave } }, { bestWave: mine.bestWave, achievedAt: { lt: mine.achievedAt } }, { bestWave: mine.bestWave, achievedAt: mine.achievedAt, userId: { lt: userId } }] } }) : 0;
  return { season: selected, currentSeason: settings.version, entries: scores.map((score, index) => ({ rank: index + 1, username: playerIdentity(score.user).username, bestWave: score.bestWave, isMe: score.userId === userId })), mine: mine ? { rank: ahead + 1, bestWave: mine.bestWave } : null };
}
