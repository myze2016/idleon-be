import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { defaultBalance, validateBalance, normalizeBalance } from "../src/services/balance.service.js";
import { withBalance } from "../src/models/balance-context.js";
import { enemies } from "../src/models/enemy.js";
import { simulateDuel, type DuelFighter } from "../src/services/pvp-battle.service.js";
import { effectiveStats } from "../src/models/artifact.js";
import { generatePatchNotes } from "../src/services/patch-notes.service.js";

test("enemy drafts validate native fields, preserve defaults and generate patch notes", () => {
  const config = defaultBalance(); config.enemies.slime.hp = 777; config.enemies.starfish.bubbleBeam!.damage = 45;
  validateBalance(config);
  assert.equal(withBalance(config, () => enemies.slime.stats.hp), 777); assert.equal(enemies.slime.stats.hp, 40);
  assert.ok(generatePatchNotes(defaultBalance(), config).includes("Slime — HP: 40 → 777"));
  assert.ok(generatePatchNotes(defaultBalance(), config).some(line => line.includes("BubbleBeam") && line.includes("20 → 45")));
  const legacy = defaultBalance(); delete (legacy as Partial<typeof legacy>).enemies;
  assert.equal(normalizeBalance(legacy).enemies.slime.hp, 40);
  for (const edit of [
    (c: typeof config) => { c.enemies.slime.hp = 0; },
    (c: typeof config) => { c.enemies.starfish.bubbleBeam!.cooldown = 0; },
    (c: typeof config) => { c.enemies.hermit.blockChance = 2; },
    (c: typeof config) => { c.enemies["fishpeople-guard"].skill!.kind = "summon"; },
  ]) { const bad = defaultBalance(); edit(bad); assert.throws(() => validateBalance(bad)); }
});

test("mixed arena supports native shields, healing, ranged skills, area attacks and summons", () => {
  const config = defaultBalance();
  config.enemies["fishpeople-lord"].hp = 10000; config.enemies["fishpeople-lord"].mp = 25;
  config.enemies["fishpeople-lord"].skill!.cooldown = 10;
  const result = withBalance(config, () => {
    const native = (id: keyof typeof enemies, side: string, suffix = ""): DuelFighter => ({ id: id + side + suffix, name: id, userId: side, enemyType: id, enemy: enemies[id].stats, stats: enemies[id].stats });
    return simulateDuel([
      native("fishpeople-lord", "a"), native("fishpeople-guardian", "a"), native("fishpeople-cleric", "a"),
      native("starfish", "b"), native("demon-prince", "b"),
      { id: "wand", name: "Wand", userId: "b", weapon: "wand", skill2Unlocked: true, stats: { ...effectiveStats("wand"), hp: 10000 } },
    ], () => .99);
  });
  for (const name of ["Summon Knight", "Restorative Shield", "Fishpeople Heal", "Bubble Beam", "Burn All"]) assert.ok(result.steps.some(step => step.label === name), name);
  const summoned = result.fighters.find(f => f.spawnAt !== undefined)!;
  assert.ok(summoned); assert.equal(summoned.enemyType, "fishpeople-knight"); assert.ok(summoned.spawnAt! > 0);
  assert.ok(result.steps.some(step => step.kind === "move"));
  assert.ok(result.steps.every(step => step.hp.every(hp => hp >= 0) && step.mp.every(mp => mp >= 0)));
  assert.ok(result.duration <= 180);
});

test("admin mixed-team lab is deterministic, isolated, validated and publishes enemy changes", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [{ id: "arena-admin", username: "arena_admin", name: "Arena Admin", role: "admin", passwordHash }, { id: "arena-player", username: "arena_player", name: "Arena Player", passwordHash }] });
  const admin = request.agent(app), player = request.agent(app);
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "arena_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "arena_player", password: "Test123!" }).expect(200);
  const config = defaultBalance(); config.enemies.slime.hp = 888;
  const character = { kind: "character", id: "staff", slot: 0, upgradeLevel: 0, skill2Unlocked: true };
  const enemy = { kind: "enemy", id: "slime", slot: 1 };
  const payload = { config, seed: 42, team1: [character, enemy], team2: [{ ...enemy, slot: 0 }, { ...character, slot: 1 }] };
  const path = "/api/admin/balance/arena-test";
  await request(app).post(path).send(payload).expect(401);
  await player.post(path).set("Origin", env.corsOrigin).send(payload).expect(403);
  await admin.post(path).send(payload).expect(403);
  const before = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const encounters = await prisma.encounter.count(), characters = await prisma.character.count();
  const fight = (await admin.post(path).set("Origin", env.corsOrigin).send(payload).expect(200)).body.data;
  const repeat = (await admin.post(path).set("Origin", env.corsOrigin).send(payload).expect(200)).body.data;
  assert.deepEqual(fight, repeat); assert.equal(fight.fighters.length, 4);
  assert.equal(fight.fighters.find((f: { enemyType?: string }) => f.enemyType === "slime").stats.hp, 888);
  assert.ok(fight.steps.some((step: { cameraTravel?: number[] }) => (step.cameraTravel?.[0] ?? 0) > 0));
  const turnOff = { fighterId: "team-1-slot-1", at: 1, enabled: false };
  const toggled = (await admin.post(path).set("Origin", env.corsOrigin).send({ ...payload, changes: [turnOff] }).expect(200)).body.data;
  assert.equal(toggled.skill2.find((control: { id: string }) => control.id === turnOff.fighterId).enabled, false);
  const opening = (step: { at: number }) => step.at < turnOff.at;
  assert.deepEqual(toggled.steps.filter(opening), fight.steps.filter(opening));
  assert.ok(fight.steps.some((step: { actor: number; label: string }) => step.actor === 0 && step.label === "Casting Inferno"));
  assert.ok(!toggled.steps.some((step: { actor: number; label: string }) => step.actor === 0 && step.label === "Casting Inferno"));
  assert.deepEqual(await prisma.user.findMany({ orderBy: { id: "asc" } }), before);
  assert.equal(await prisma.encounter.count(), encounters); assert.equal(await prisma.character.count(), characters);
  assert.equal(await prisma.gameBalance.count(), 0);
  for (const invalid of [{ ...payload, team1: [] }, { ...payload, team2: [enemy, enemy] }, { ...payload, team1: [{ ...enemy, id: "__proto__" }] }]) await admin.post(path).set("Origin", env.corsOrigin).send(invalid).expect(400);
  try {
    await admin.put("/api/admin/balance").set("Origin", env.corsOrigin).send({ version: 0, config }).expect(200);
    const wiki = (await player.get("/api/wiki/enemies").expect(200)).body.data;
    assert.equal(wiki.find((enemy: { id: string }) => enemy.id === "slime").stats.hp, 888);
    const patches = (await player.get("/api/patch-notes").expect(200)).body.data.patches;
    assert.ok(patches[0].changes.includes("Slime — HP: 40 → 888"));
  } finally { await prisma.gameBalance.deleteMany(); await prisma.balanceRevision.deleteMany(); }
});
