import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { artifactCatalog, effectiveStats } from "../src/models/artifact.js";
import { baseStats } from "../src/models/character-stats.js";

test("Enhancement adds two per level to only the artifact main stat for every artifact type", () => {
  for (const { stat } of artifactCatalog) {
    const expected = { ...baseStats.axe, [stat]: baseStats.axe[stat] + 9 };
    assert.deepEqual(effectiveStats("axe", { stat, enhancementLevel: 2 }), expected);
    assert.equal(effectiveStats("axe", { stat })[stat], baseStats.axe[stat] + 5);
  }
});

test("Artifact enhancements cost 1k, persist when unequipped, and affect equipped stats and combat", async () => {
  const userId = "enhance-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Enhancer", passwordHash: await hashPassword("Test123!"), gold: 2500, starterCreated: true } });
  const fighter = await prisma.character.create({ data: { userId, name: "Axeman", weapon: "axe", isStarter: true } });
  const artifact = await prisma.artifact.create({ data: { userId, stat: "atk", characterId: fighter.id } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const enhance = (id = artifact.id) => agent.post(`/api/character/artifacts/${id}/enhance`).set("Origin", env.corsOrigin).send({ cost: 0, enhancementLevel: 99 });
  await request(app).post(`/api/character/artifacts/${artifact.id}/enhance`).set("Origin", env.corsOrigin).expect(401);
  await agent.post(`/api/character/artifacts/${artifact.id}/enhance`).expect(403);
  await enhance("missing").expect(404);
  const once = (await enhance().expect(200)).body.data;
  assert.equal(once.gold, 1500); assert.equal(once.artifacts[0].enhancementLevel, 1);
  assert.equal(once.characters[0].stats.atk, baseStats.axe.atk + 7);
  const twice = (await enhance().expect(200)).body.data;
  assert.equal(twice.gold, 500); assert.equal(twice.characters[0].stats.atk, baseStats.axe.atk + 9);
  await enhance().expect(409);
  const spawn = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [fighter.id], newExpedition: true }).expect(201);
  const battle = (await agent.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200)).body.data;
  const hit = battle.steps.find((step: { actor: string; damage: number }) => step.actor === "team" && step.damage > 0);
  assert.ok(hit.damage >= baseStats.axe.atk + 9);
  await agent.post(`/api/character/${fighter.id}/artifact`).set("Origin", env.corsOrigin).send({ artifactId: null }).expect(200);
  const saved = (await agent.get("/api/character").expect(200)).body.data;
  assert.equal(saved.artifacts[0].enhancementLevel, 2); assert.equal(saved.characters[0].stats.atk, baseStats.axe.atk);
  const again = (await agent.post(`/api/character/${fighter.id}/artifact`).set("Origin", env.corsOrigin).send({ artifactId: artifact.id }).expect(200)).body.data;
  assert.equal(again.characters[0].stats.atk, baseStats.axe.atk + 9);
});

test("Concurrent enhancements cannot overspend, and other accounts cannot enhance an artifact", async () => {
  const userId = "enhance-race";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Enhancer", passwordHash: await hashPassword("Test123!"), gold: 1000 } });
  const artifact = await prisma.artifact.create({ data: { userId, stat: "speed" } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const other = await prisma.artifact.create({ data: { userId: "test-admin", stat: "hp" } });
  await agent.post(`/api/character/artifacts/${other.id}/enhance`).set("Origin", env.corsOrigin).expect(404);
  const responses = await Promise.all([1, 2].map(() => agent.post(`/api/character/artifacts/${artifact.id}/enhance`).set("Origin", env.corsOrigin)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).gold, 0);
  assert.equal((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).enhancementLevel, 1);
  assert.equal((await prisma.artifact.findUniqueOrThrow({ where: { id: other.id } })).enhancementLevel, 0);
});
