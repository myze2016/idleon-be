import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { defaultBalance, validateBalance } from "../src/services/balance.service.js";
import { withBalance } from "../src/models/balance-context.js";
import { baseStats } from "../src/models/character-stats.js";
import { characterSkills } from "../src/models/skills.js";
import { effectiveStats } from "../src/models/artifact.js";
import { simulateSkillBattle } from "../src/services/skill-battle.service.js";
import { simulateDuel } from "../src/services/pvp-battle.service.js";
import { generatePatchNotes } from "../src/services/patch-notes.service.js";

test("patch notes include only changed values and identify shared skills", () => {
  const before = defaultBalance(), after = defaultBalance();
  assert.deepEqual(generatePatchNotes(before, after), []);
  after.skills.fireball.damage!.base = 42; after.skills.fireball.cooldown = 3;
  after.skills["double-attack"].chance = .5; after.stats.staff.hp = 75;
  const lines = generatePatchNotes(before, after);
  assert.equal(lines.length, 4);
  assert.ok(lines.includes("Staff — HP: 50 → 75"));
  assert.ok(lines.includes("Staff — Fireball: Base damage 20 → 42"));
  assert.ok(lines.includes("Staff — Fireball: Cooldown 5s → 3s"));
  assert.ok(lines.includes("Dual Gun / Dual Knife — Dual Shot: Chance 30% → 50%"));
});

test("balance validation rejects invalid numbers and mechanics edits", () => {
  assert.deepEqual(validateBalance(defaultBalance()), defaultBalance());
  const invalid = [
    (c: ReturnType<typeof defaultBalance>) => { c.stats.staff.hp = 0; },
    (c: ReturnType<typeof defaultBalance>) => { c.stats.staff.speed = 1001; },
    (c: ReturnType<typeof defaultBalance>) => { c.stats.staff.atk = NaN; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills.fireball.cooldown = 0; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills.fireball.baseCastTime = -1; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills.block.chance = 1.1; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills.fireball.damage!.stat = "atk"; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills.fireball.passive = true; },
    (c: ReturnType<typeof defaultBalance>) => { delete c.skills.heal; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills.block.mpCost = 2; },
    (c: ReturnType<typeof defaultBalance>) => { c.skills["bouncing-glaive"].bounces = 11; },
  ];
  for (const edit of invalid) { const config = defaultBalance(); edit(config); assert.throws(() => validateBalance(config)); }
});

test("request balance snapshots are isolated across concurrent async work", async () => {
  const one = defaultBalance(), two = defaultBalance(); one.stats.staff.magic = 777; two.stats.staff.magic = 333;
  const values = await Promise.all([one, two].map(config => withBalance(config, async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return effectiveStats("staff").magic;
  })));
  assert.deepEqual(values, [777, 333]); assert.equal(baseStats.staff.magic, 15);
});

test("draft skill damage, costs and effects drive PvE and PvP without altering defaults", () => {
  const config = defaultBalance(); config.skills.fireball.damage!.base = 123; config.skills.fireball.mpCost = 17;
  const enemy = { ...baseStats.axe, hp: 2000, atk: 1 };
  const pve = withBalance(config, () => simulateSkillBattle([{ id: "staff", weapon: "staff", stats: effectiveStats("staff") }], enemy, () => .99));
  const fireball = pve.steps.find(s => s.kind === "skill" && s.label === "Fireball")!;
  assert.equal(fireball.damage, 138);
  const cast = pve.steps.find(s => s.kind === "cast" && s.label?.includes("Fireball"))!;
  assert.ok(cast); assert.ok(cast.teamMp![0] <= 133);
  const pvp = withBalance(config, () => simulateDuel([
    { id: "a", name: "a", userId: "a", weapon: "staff", stats: effectiveStats("staff") },
    { id: "b", name: "b", userId: "b", weapon: "axe", stats: enemy },
  ], () => .99));
  assert.equal(pvp.steps.find(s => s.label === "Fireball" && s.kind === "skill")!.damage, 138);
  assert.equal(characterSkills("staff", false)[0].damage!.base, 20);
  assert.match(withBalance(config, () => characterSkills("staff", false)[0].description), /123/);
  config.skills.poison.power = 19;
  const poison = withBalance(config, () => simulateSkillBattle([{ id: "bow", weapon: "bow", stats: effectiveStats("bow") }], enemy, () => .99));
  assert.equal(poison.steps.find(s => s.kind === "poison")!.damage, 19);
  config.skills.heal.power = 41;
  const healing2 = withBalance(config, () => simulateSkillBattle([{ id: "wand", weapon: "wand", stats: { ...effectiveStats("wand"), hp: 1000 }, hp: 400 }], { ...enemy, atk: 0 }, () => .99));
  assert.equal(healing2.steps.find(s => s.kind === "heal")!.healing, 41);
});

test("admin publishing, revision rollback, draft fights and authorization", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "balance-admin", username: "balance_admin", name: "Balance Admin", role: "admin", passwordHash },
    { id: "balance-player", username: "balance_player", name: "Balance Player", passwordHash },
  ] });
  const admin = request.agent(app), player = request.agent(app);
  await admin.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "balance_admin", password: "Test123!" }).expect(200);
  await player.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "balance_player", password: "Test123!" }).expect(200);
  const path = "/api/admin/balance";
  await request(app).get("/api/patch-notes").expect(401);
  assert.deepEqual((await player.get("/api/patch-notes").expect(200)).body.data.patches, []);
  await request(app).get(path).expect(401);
  await player.get(path).expect(403);
  await player.put(path).set("Origin", env.corsOrigin).send({}).expect(403);
  await player.post(path + "/test").set("Origin", env.corsOrigin).send({}).expect(403);
  const catalog = (await admin.get(path).expect(200)).body.data;
  const config = defaultBalance(); config.stats.staff.magic = 555; config.skills.fireball.damage!.base = 70;
  const payload = { config, seed: 42, monster: "slime", team: [{ slot: 0, weapon: "staff", skill2Unlocked: true, upgradeLevel: 0 }] };
  const before = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const encounterCount = await prisma.encounter.count(), characterCount = await prisma.character.count();
  const fight = (await admin.post(path + "/test").set("Origin", env.corsOrigin).send(payload).expect(200)).body.data;
  const repeated = (await admin.post(path + "/test").set("Origin", env.corsOrigin).send(payload).expect(200)).body.data;
  assert.deepEqual(fight, repeated); assert.equal(fight.fighters[0].stats.magic, 555);
  assert.deepEqual(await prisma.user.findMany({ orderBy: { id: "asc" } }), before);
  assert.equal(await prisma.encounter.count(), encounterCount); assert.equal(await prisma.character.count(), characterCount);
  assert.equal(await prisma.gameBalance.count(), 0);
  assert.deepEqual((await player.get("/api/patch-notes").expect(200)).body.data.patches, []);
  await admin.post(path + "/test").set("Origin", env.corsOrigin).send({ ...payload, monster: "__proto__" }).expect(400);
  await admin.post(path + "/test").set("Origin", env.corsOrigin).send({ ...payload, team: [...payload.team, ...payload.team] }).expect(400);
  await admin.put(path).send({ version: 0, note: "invalid origin", config }).expect(403);
  await admin.put(path).set("Origin", env.corsOrigin).send({ version: catalog.version, note: "Improve mage", config }).expect(200);
  try {
    const patchPage = (await player.get("/api/patch-notes").expect(200)).body.data;
    assert.equal(patchPage.patches.length, 1); assert.equal(patchPage.patches[0].version, 1);
    assert.deepEqual(patchPage.patches[0].changes, ["Staff — Magic: 15 → 555", "Staff — Fireball: Base damage 20 → 70"]);
    assert.deepEqual(Object.keys(patchPage.patches[0]).sort(), ["changes", "publishedAt", "version"]);
    assert.ok(!JSON.stringify(patchPage).includes("Improve mage"));
    assert.equal(patchPage.nextCursor, null);
    await player.get("/api/patch-notes?before=bad").expect(400);
    const wiki = (await player.get("/api/wiki/characters").expect(200)).body.data;
    assert.equal(wiki.find((c: { id: string }) => c.id === "staff").stats.magic, 555);
    assert.match(wiki.find((c: { id: string }) => c.id === "staff").skills[0].description, /70/);
    assert.equal(baseStats.staff.magic, 15);
    await admin.put(path).set("Origin", env.corsOrigin).send({ version: 0, note: "stale edit", config }).expect(409);
    const current = (await admin.get(path).expect(200)).body.data;
    assert.equal(current.version, 1); assert.equal(current.history.length, 2);
    const original = (await admin.get(path + "/history/" + current.history.at(-1).id).expect(200)).body.data.config;
    assert.deepEqual(original, defaultBalance());
    const racing = await Promise.all([1, 2].map(() => admin.put(path).set("Origin", env.corsOrigin).send({ version: 1, note: "Restore defaults", config: original })));
    assert.deepEqual(racing.map(r => r.status).sort(), [200, 409]);
    const restored = (await player.get("/api/wiki/characters").expect(200)).body.data;
    assert.equal(restored.find((c: { id: string }) => c.id === "staff").stats.magic, 15);
    const patches = (await player.get("/api/patch-notes").expect(200)).body.data.patches;
    assert.deepEqual(patches.map((patch: { version: number }) => patch.version), [2, 1]);
    assert.ok(patches[0].changes.includes("Staff — Fireball: Base damage 70 → 20"));
    assert.equal((await player.get("/api/patch-notes?before=2").expect(200)).body.data.patches.length, 1);
    await admin.put(path).set("Origin", env.corsOrigin).send({ version: 2, config: original }).expect(400);
    assert.equal((await player.get("/api/patch-notes").expect(200)).body.data.patches.length, 2);
    await prisma.user.update({ where: { id: "balance-admin" }, data: { role: "player" } });
    await admin.get(path).expect(403);
  } finally { await prisma.gameBalance.deleteMany(); await prisma.balanceRevision.deleteMany(); }
});
