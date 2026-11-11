import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { simulateGroupBattle } from "../src/services/battle.service.js";
import { baseStats } from "../src/models/character-stats.js";
import { enemies } from "../src/models/enemy.js";

test("Meadow boss triggers at a saved 38–45-kill target and awards 40 gold without boss wishes", async () => {
  await prisma.user.create({ data: { id: "boss-user", username: "boss-user", name: "Boss hunter", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "boss-user", password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Guardian", weapon: "sword-and-shield" }).expect(201);
  const teamIds = [created.body.data.characters[0].id];
  for (const weapon of ["wand", "staff", "axe", "spear", "great_sword"] as const) {
    const member = await prisma.character.create({ data: { userId: "boss-user", weapon, name: weapon, skill2Unlocked: true } }); teamIds.push(member.id);
  }
  const spawn = (location = "meadow") => agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location, teamIds });
  const first = await spawn().expect(201);
  assert.ok(first.body.data.meadowProgress.target >= 38 && first.body.data.meadowProgress.target <= 45);
  await prisma.user.update({ where: { id: "boss-user" }, data: { meadowDefeats: 40, meadowBossAt: 41 } });
  const regular = await spawn().expect(201);
  assert.equal(regular.body.data.boss, false);
  await agent.post(`/api/encounters/${regular.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "boss-user" } })).meadowDefeats, 41);
  const pair = await Promise.all([spawn(), spawn()]);
  assert.ok(pair.every((response) => response.status === 201));
  assert.equal(pair.filter((response) => response.body.data.boss).length, 1);
  const boss = pair.find((response) => response.body.data.boss)!.body.data;
  assert.equal(boss.type, "mutant-boar");
  assert.deepEqual(boss.stats, { hp: 300, mp: 0, atk: 30, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" });
  assert.equal(boss.gold, 40); assert.equal(boss.wishCurrency, 0);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: "boss-user" } });
  const resolved = await Promise.all([1, 2].map(() => agent.post(`/api/encounters/${boss.id}/resolve`).set("Origin", env.corsOrigin)));
  for (const response of resolved) {
    assert.equal(response.status, 200); assert.equal(response.body.data.won, true);
    assert.equal(response.body.data.goldEarned, 40); assert.equal(response.body.data.wishEarned, 0);
  }
  const after = await prisma.user.findUniqueOrThrow({ where: { id: "boss-user" } });
  assert.equal(after.gold, before.gold + 40); assert.equal(after.wishCurrency, before.wishCurrency);
  assert.equal(after.meadowDefeats, 0); assert.ok(after.meadowBossAt! >= 38 && after.meadowBossAt! <= 45);
  const forest = await spawn("forest").expect(201);
  await agent.post(`/api/encounters/${forest.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "boss-user" } })).meadowDefeats, 0);
});

test("multiple active monsters resolve as one owned battle without duplicate rewards", async () => {
  await prisma.user.create({ data: { id: "group-user", username: "group-user", name: "Group", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "group-user", password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Mage", weapon: "staff" }).expect(201);
  const id = created.body.data.characters[0].id;
  await prisma.character.update({ where: { id }, data: { skill2Unlocked: true } });
  const group = await Promise.all([1, 2].map(() => agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [id] })));
  const encounterIds = group.map((response) => response.body.data.id);
  assert.notEqual(encounterIds[0], encounterIds[1]);
  await request(app).post("/api/encounters/resolve").set("Origin", env.corsOrigin).send({ encounterIds }).expect(401);
  await agent.post("/api/encounters/resolve").set("Origin", env.corsOrigin).send({ encounterIds: [...encounterIds, encounterIds[0]] }).expect(400);
  const result = await agent.post("/api/encounters/resolve").set("Origin", env.corsOrigin).send({ encounterIds }).expect(200);
  const defeated = result.body.data.enemyHps.filter((hp: number) => hp === 0).length;
  assert.equal(result.body.data.enemies.length, 2);
  assert.equal(result.body.data.goldEarned, defeated * 10); assert.equal(result.body.data.expEarned, defeated);
  const inferno = result.body.data.steps.filter((step: { label: string }) => step.label === "Inferno");
  assert.ok(new Set(inferno.map((step: { enemyIndex: number }) => step.enemyIndex)).size === 2);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: "group-user" } });
  await agent.post("/api/encounters/resolve").set("Origin", env.corsOrigin).send({ encounterIds }).expect(200);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: "group-user" } });
  assert.equal(after.gold, before.gold); assert.equal(after.experience, before.experience);
});

test("Inferno damages all enemies and each living enemy has its own attack schedule", () => {
  const battle = simulateGroupBattle([{ id: "staff", weapon: "staff", skill2Unlocked: true, stats: { ...baseStats.staff, hp: 1000 } }], [enemies.boar.stats, enemies.slime.stats], () => 0.99);
  const attacks = battle.steps.filter((step) => step.actor === "enemy" && step.at === 1);
  assert.deepEqual(attacks.map((step) => step.enemyIndex), [0, 1]);
  const inferno = battle.steps.filter((step) => step.label === "Inferno");
  assert.equal(inferno[0].damage, 35); assert.equal(inferno[1].damage, 35);
  assert.equal(inferno[0].at, inferno[1].at);
  assert.deepEqual(inferno.slice(0, 2).map((step) => step.enemyIndex), [0, 1]);
  assert.equal(battle.won, true); assert.deepEqual(battle.enemyHps, [0, 0]);
});
