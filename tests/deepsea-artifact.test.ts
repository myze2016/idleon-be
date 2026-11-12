import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { artifactDrops, effectiveStats } from "../src/models/artifact.js";
import { baseStats } from "../src/models/character-stats.js";
import { resolveEncounters } from "../src/repositories/expedition.repository.js";
import { characterState } from "../src/repositories/character.repository.js";
import { hashPassword } from "../src/utils/password.js";
import { enemies } from "../src/models/enemy.js";

test("Fish Emperor Lord has a ten-percent artifact drop with both Magic and Defense bonuses", () => {
  assert.equal(enemies["fishpeople-lord"].name, "Fish Emperor Lord");
  assert.equal(Array.from({ length: 10 }, (_, value) => artifactDrops(["fishpeople-lord"], () => value).length).reduce((sum, value) => sum + value, 0), 1);
  assert.deepEqual(artifactDrops(["fishpeople-guardian"], () => { throw Error("Other enemies cannot roll this artifact"); }), []);
  assert.deepEqual(effectiveStats("axe", { stat: "deep-sea", enhancementLevel: 0 }), { ...baseStats.axe, magic: 5, def: 5 });
  assert.deepEqual(effectiveStats("axe", { stat: "deep-sea", enhancementLevel: 2 }), { ...baseStats.axe, magic: 9, def: 9 });
});

test("Deep Sea Artifact drops persist, equip, enhance, and never duplicate on battle replay", async () => {
  const userId = "artifact-drop-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Deepsea hunter", starterCreated: true, gold: 5000, passwordHash: await hashPassword("Test123!") } });
  const hero = await prisma.character.create({ data: { userId, name: "Hunter", weapon: "axe", upgradeLevel: 1000 } });
  const encounter = () => prisma.encounter.create({ data: { userId, enemyType: "fishpeople-lord", location: "deepsea-palace", teamIds: [hero.id] } });
  const first = await encounter();
  const victory = await resolveEncounters(userId, [first.id], undefined, () => 0);
  assert.equal(victory.won, true); assert.equal(victory.artifactsEarned.length, 1);
  const dropped = victory.artifactsEarned[0];
  assert.equal(dropped.name, "Deep Sea Artifact"); assert.equal(dropped.stat, "deep-sea");
  await resolveEncounters(userId, [first.id], undefined, () => { throw Error("Replays must not roll"); });
  assert.equal(await prisma.artifact.count({ where: { userId } }), 1);
  const missed = await encounter();
  assert.deepEqual((await resolveEncounters(userId, [missed.id], undefined, () => 1)).artifactsEarned, []);
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  await agent.post("/api/character/artifacts/buy").set("Origin", env.corsOrigin).send({ stat: "deep-sea" }).expect(400);
  const equipped = (await agent.post(`/api/character/${hero.id}/artifact`).set("Origin", env.corsOrigin).send({ artifactId: dropped.id }).expect(200)).body.data;
  assert.equal(equipped.characters[0].stats.magic, 5); assert.equal(equipped.characters[0].stats.def, 5);
  const enhanced = (await agent.post(`/api/character/artifacts/${dropped.id}/enhance`).set("Origin", env.corsOrigin).expect(200)).body.data;
  assert.equal(enhanced.characters[0].stats.magic, 7); assert.equal(enhanced.characters[0].stats.def, 7);
  assert.equal(enhanced.gold, equipped.gold - 1000);
  assert.equal((await characterState(userId)).artifacts[0].enhancementLevel, 1);
});

test("A surviving Fish Emperor Lord never drops the artifact", async () => {
  const userId = "artifact-drop-loss";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Novice", passwordHash: "unused" } });
  const hero = await prisma.character.create({ data: { userId, name: "Novice", weapon: "axe" } });
  const boss = await prisma.encounter.create({ data: { userId, enemyType: "fishpeople-lord", location: "deepsea-palace", teamIds: [hero.id] } });
  const result = await resolveEncounters(userId, [boss.id], undefined, () => { throw Error("A surviving boss cannot drop loot"); });
  assert.equal(result.won, false); assert.deepEqual(result.artifactsEarned, []);
});
