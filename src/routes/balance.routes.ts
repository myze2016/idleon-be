import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { defaultBalance, validateBalance, normalizeBalance } from "../services/balance.service.js";
import { withBalance, type BalanceConfig } from "../models/balance-context.js";
import { generatePatchNotes } from "../services/patch-notes.service.js";
import { defaultSkills } from "../models/skills.js";
import { enemies } from "../models/enemy.js";
import { effectiveStats } from "../models/artifact.js";
import type { WeaponType } from "../models/character.js";
import { simulateSkillBattle } from "../services/skill-battle.service.js";
import { HttpError } from "../utils/http-error.js";
import { simulateDuel, type DuelFighter } from "../services/pvp-battle.service.js";
import type { EnemyType } from "../models/enemy.js";

// Mounted behind the admin router's authentication, fresh role check and origin check.
export const balanceRouter = Router();
balanceRouter.get("/", async (_req, res) => {
  const saved = await prisma.gameBalance.findUnique({ where: { id: 1 } });
  const history = await prisma.balanceRevision.findMany({ orderBy: { id: "desc" }, take: 10, select: { id: true, adminId: true, note: true, createdAt: true } });
  res.json({ data: { version: saved?.version ?? 0, config: saved ? normalizeBalance(saved.config as unknown as BalanceConfig) : defaultBalance(), defaults: defaultBalance(), history,
    weapons: Object.entries(defaultSkills).map(([weapon, skills]) => ({ weapon, skills: skills.map(s => s.id) })),
    monsters: Object.entries(enemies).map(([id, enemy]) => ({ id, name: enemy.name, stats: enemy.stats })) } });
});
balanceRouter.get("/history/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Invalid revision");
  const revision = await prisma.balanceRevision.findUnique({ where: { id } });
  if (!revision) throw new HttpError(404, "Revision not found");
  res.json({ data: { config: normalizeBalance(revision.config as unknown as BalanceConfig) } });
});
balanceRouter.put("/", async (req, res) => {
  const { version, note = "" } = req.body ?? {};
  if (!Number.isInteger(version) || version < 0 || typeof note !== "string" || note.trim().length > 300) throw new HttpError(400, "Provide the current version and an optional change note (up to 300 characters)");
  const config = validateBalance(req.body.config);
  const result = await prisma.$transaction(async tx => {
    // Serialize first publication as well as subsequent edits across server instances.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(821493701)::text`;
    const current = await tx.gameBalance.findUnique({ where: { id: 1 } });
    if ((current?.version ?? 0) !== version) throw new HttpError(409, "Balance changed in another session. Reload before publishing.");
    const patchChanges = generatePatchNotes(current ? current.config as unknown as BalanceConfig : defaultBalance(), config);
    if (!patchChanges.length) throw new HttpError(400, "There are no balance changes to publish");
    if (!current) await tx.balanceRevision.create({ data: { adminId: req.session.user!.id, note: "Original defaults", config: defaultBalance() as unknown as Prisma.InputJsonValue } });
    await tx.balanceRevision.create({ data: { adminId: req.session.user!.id, note: note.trim() || `Balance update ${version + 1}`, config: config as unknown as Prisma.InputJsonValue, patchVersion: version + 1, patchChanges } });
    return tx.gameBalance.upsert({ where: { id: 1 }, create: { id: 1, version: 1, config: config as unknown as Prisma.InputJsonValue }, update: { version: { increment: 1 }, config: config as unknown as Prisma.InputJsonValue } });
  });
  res.json({ data: { version: result.version, config: result.config } });
});
balanceRouter.post("/test", (req, res) => {
  const config = validateBalance(req.body?.config);
  const { team, monster, seed } = req.body ?? {};
  if (!Array.isArray(team) || !team.length || team.length > 6 || typeof monster !== "string" || !Object.hasOwn(enemies, monster) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new HttpError(400, "Choose 1–6 characters, a monster and a seed from 0 to 4294967295");
  const slots = new Set<number>();
  for (const member of team) {
    if (!member || !Object.hasOwn(defaultSkills, member.weapon) || !Number.isInteger(member.slot) || member.slot < 0 || member.slot > 5 || slots.has(member.slot) || typeof member.skill2Unlocked !== "boolean" || !Number.isInteger(member.upgradeLevel) || member.upgradeLevel < 0 || member.upgradeLevel > 100) throw new HttpError(400, "Invalid team member or duplicate slot");
    slots.add(member.slot);
  }
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const result = withBalance(config, () => {
    const fighters = [...team].sort((a, b) => a.slot - b.slot).map(member => ({ id: `test-${member.slot + 1}`, weapon: member.weapon as WeaponType, stats: effectiveStats(member.weapon, null, member.upgradeLevel), skill2Unlocked: member.skill2Unlocked, backRow: member.slot >= 3 }));
    return { ...simulateSkillBattle(fighters, enemies[monster as keyof typeof enemies].stats, random), fighters };
  });
  res.json({ data: { ...result, duration: result.steps.at(-1)?.at ?? 0, seed } });
});

balanceRouter.post("/arena-test", (req, res) => {
  const config = validateBalance(req.body?.config);
  const { team1, team2, seed } = req.body ?? {};
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new HttpError(400, "Enter a seed between 0 and 4294967295");
  interface Member { kind: "character" | "enemy"; id: string; slot: number; upgradeLevel: number; skill2Unlocked: boolean }
  function validateTeam(team: unknown): asserts team is Member[] {
    if (!Array.isArray(team) || team.length < 1 || team.length > 6) throw new HttpError(400, "Each team needs 1–6 fighters");
    const slots = new Set<number>();
    for (const member of team) {
      if (!member || !Number.isInteger(member.slot) || member.slot < 0 || member.slot > 5 || slots.has(member.slot) || typeof member.id !== "string") throw new HttpError(400, "Invalid fighter or duplicate slot");
      if (member.kind === "character") {
        if (!Object.hasOwn(defaultSkills, member.id) || !Number.isInteger(member.upgradeLevel) || member.upgradeLevel < 0 || member.upgradeLevel > 100 || typeof member.skill2Unlocked !== "boolean") throw new HttpError(400, "Invalid character selection");
      } else if (member.kind !== "enemy" || !Object.hasOwn(enemies, member.id)) throw new HttpError(400, "Invalid enemy selection");
      slots.add(member.slot);
    }
  }
  validateTeam(team1); validateTeam(team2);
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const result = withBalance(config, () => {
    const fighters: DuelFighter[] = [team1, team2].flatMap((team, side) => [...team].sort((a, b) => a.slot - b.slot).map(member => {
      const common = { id: `team-${side + 1}-slot-${member.slot + 1}`, userId: `team-${side + 1}` };
      if (member.kind === "enemy") { const enemy = enemies[member.id as EnemyType]; return { ...common, name: enemy.name, enemyType: member.id as EnemyType, enemy: enemy.stats, stats: enemy.stats }; }
      return { ...common, name: member.id.replaceAll("-", " "), weapon: member.id as WeaponType, stats: effectiveStats(member.id as WeaponType, null, member.upgradeLevel), skill2Unlocked: member.skill2Unlocked };
    }));
    return simulateDuel(fighters, random);
  });
  res.json({ data: { ...result, seed } });
});
