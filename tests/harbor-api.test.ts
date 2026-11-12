import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { encounterPool } from "../src/models/enemy.js";

test("Harbor waves, isolated boss progress, rewards, replay, and return reset", async () => {
  const userId = "harbor-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Harbor hunter", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const fighter = await prisma.character.create({ data: { userId, name: "Harbor hero", weapon: "axe", upgradeLevel: 1000 } });
  const spawn = () => agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "harbor", teamIds: [fighter.id], wave: true });
  const first = await spawn().expect(201);
  assert.ok(first.body.data.harborProgress.target >= 38 && first.body.data.harborProgress.target <= 45);
  for (let index = 0; index < 8; index++) {
    const wave = (await spawn().expect(201)).body.data;
    const monsters = [wave, ...wave.additionalEnemies];
    assert.ok(monsters.length >= 1 && monsters.length <= 3);
    assert.ok(monsters.every((monster) => encounterPool("harbor").includes(monster.type)));
  }
  await prisma.user.update({ where: { id: userId }, data: { harborDefeats: 38, harborBossAt: 38, forestDefeats: 12, meadowDefeats: 7 } });
  const boss = (await spawn().expect(201)).body.data;
  assert.equal(boss.type, "fishpeople-guide"); assert.equal(boss.boss, true);
  assert.equal(boss.additionalEnemies.length, 0);
  assert.equal((await spawn().expect(201)).body.data.boss, false);
  const resolve = () => agent.post(`/api/encounters/${boss.id}/resolve`).set("Origin", env.corsOrigin);
  const result = (await resolve().expect(200)).body.data;
  assert.equal(result.won, true); assert.equal(result.goldEarned, 200); assert.equal(result.expEarned, 1);
  assert.equal(result.harborProgress.defeated, 0);
  assert.equal(result.forestProgress.defeated, 12); assert.equal(result.meadowProgress.defeated, 7);
  await resolve().expect(200);
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(saved.gold, 200); assert.equal(saved.experience, 1);
  await agent.post("/api/encounters/return").set("Origin", env.corsOrigin).expect(204);
  const reset = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(reset.harborDefeats, 0); assert.equal(reset.harborBossAt, null);
});
