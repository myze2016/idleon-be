import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";

test("Forest chief uses its own defeat cycle and rewards 10 gold without boss wishes", async () => {
  await prisma.user.create({ data: { id: "chief-user", username: "chief-user", name: "Chief hunter", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "chief-user", password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Guardian", weapon: "sword-and-shield" }).expect(201);
  const teamIds = [created.body.data.characters[0].id];
  await prisma.character.update({ where: { id: teamIds[0] }, data: { skill2Unlocked: true } });
  for (const weapon of ["wand", "staff", "axe", "spear", "great_sword"] as const) {
    const character = await prisma.character.create({ data: { userId: "chief-user", name: weapon, weapon, skill2Unlocked: true } }); teamIds.push(character.id);
  }
  const spawn = () => agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "forest", teamIds });
  const first = await spawn().expect(201);
  assert.ok(first.body.data.forestProgress.target >= 38 && first.body.data.forestProgress.target <= 45);
  await prisma.user.update({ where: { id: "chief-user" }, data: { forestDefeats: 38, forestBossAt: 39, meadowDefeats: 13, meadowBossAt: 29 } });
  const regular = await spawn().expect(201);
  assert.equal(regular.body.data.boss, false);
  await agent.post(`/api/encounters/${regular.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
  const spawns = await Promise.all([spawn(), spawn()]);
  assert.equal(spawns.filter((response) => response.body.data.boss).length, 1);
  const chief = spawns.find((response) => response.body.data.boss)!.body.data;
  assert.equal(chief.type, "coco-klan-chief"); assert.equal(chief.name, "Coco Klan Chief");
  assert.deepEqual(chief.stats, { hp: 500, mp: 0, atk: 40, def: 10, magic: 0, magicDef: 0, speed: 0, range: "range" });
  assert.equal(chief.gold, 10); assert.equal(chief.wishCurrency, 0);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: "chief-user" } });
  const rewards = await Promise.all([1, 2].map(() => agent.post(`/api/encounters/${chief.id}/resolve`).set("Origin", env.corsOrigin)));
  for (const reward of rewards) {
    assert.equal(reward.status, 200); assert.equal(reward.body.data.won, true);
    assert.equal(reward.body.data.goldEarned, 10); assert.equal(reward.body.data.wishEarned, 0);
    assert.equal(reward.body.data.forestProgress.defeated, 0);
  }
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: "chief-user" } });
  assert.equal(saved.gold, before.gold + 10); assert.equal(saved.wishCurrency, before.wishCurrency);
  assert.equal(saved.forestDefeats, 0); assert.ok(saved.forestBossAt! >= 38 && saved.forestBossAt! <= 45);
  assert.equal(saved.meadowDefeats, 13); assert.equal(saved.meadowBossAt, 29);
  await agent.delete("/api/character").set("Origin", env.corsOrigin).expect(204);
  const reset = await prisma.user.findUniqueOrThrow({ where: { id: "chief-user" } });
  assert.equal(reset.forestDefeats, 0); assert.equal(reset.forestBossAt, null);
});
