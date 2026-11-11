import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { artifactCatalog } from "../src/models/artifact.js";
import { baseStats } from "../src/models/character-stats.js";

test("artifacts cost 1k, equip one per owned character, persist, and affect stats and actual battles", async () => {
  const userId = "artifact-user";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Collector", passwordHash: await hashPassword("Test123!") } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Knight", weapon: "sword-and-shield" }).expect(201);
  const id = created.body.data.characters[0].id;
  const buy = (stat: string) => agent.post("/api/character/artifacts/buy").set("Origin", env.corsOrigin).send({ stat, price: 0, bonus: 999 });
  const equip = (artifactId: string | null, characterId = id) => agent.post(`/api/character/${characterId}/artifact`).set("Origin", env.corsOrigin).send({ artifactId });
  await request(app).post("/api/character/artifacts/buy").set("Origin", env.corsOrigin).send({ stat: "atk" }).expect(401);
  await agent.post("/api/character/artifacts/buy").send({ stat: "atk" }).expect(403);
  await buy("atk").expect(409);
  await prisma.user.update({ where: { id: userId }, data: { gold: 7000 } });
  await buy("range").expect(400);
  for (const definition of artifactCatalog) {
    const bought = await buy(definition.stat).expect(201);
    const artifact = bought.body.data.artifacts.find((item: { stat: string }) => item.stat === definition.stat);
    const equipped = await equip(artifact.id).expect(200);
    const expected = { ...baseStats["sword-and-shield"], [definition.stat]: baseStats["sword-and-shield"][definition.stat] + 5 };
    assert.deepEqual(equipped.body.data.characters[0].stats, expected);
    assert.equal(equipped.body.data.artifacts.filter((item: { characterId: string }) => item.characterId === id).length, 1);
    if (definition.stat === "speed") assert.equal(equipped.body.data.characters[0].timing.attackInterval, 1 / 1.05);
    if (definition.stat === "hp" || definition.stat === "mp" || definition.stat === "atk") {
      const spawn = await agent.post("/api/encounters").set("Origin", env.corsOrigin).send({ location: "meadow", teamIds: [id], newExpedition: true }).expect(201);
      const battle = await agent.post(`/api/encounters/${spawn.body.data.id}/resolve`).set("Origin", env.corsOrigin).expect(200);
      assert.deepEqual(battle.body.data.initialTeamHp, [expected.hp]);
      assert.deepEqual(battle.body.data.initialTeamMp, [expected.mp]);
      assert.equal(battle.body.data.steps.find((step: { actor: string }) => step.actor === "team").damage, expected.atk);
    }
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).gold < 1000, true);
  const inventory = (await agent.get("/api/character").expect(200)).body.data.artifacts;
  await equip("not-owned").expect(404);
  await equip(inventory[0].id, "not-owned").expect(404);
  const second = await prisma.character.create({ data: { userId, name: "Mage", weapon: "staff" } });
  const equipped = inventory.find((item: { characterId: string }) => item.characterId === id);
  await equip(equipped.id, second.id).expect(409);
  const removed = await equip(null).expect(200);
  assert.deepEqual(removed.body.data.characters[0].stats, baseStats["sword-and-shield"]);
  await equip(equipped.id, second.id).expect(200);
  await agent.post("/api/auth/logout").set("Origin", env.corsOrigin).expect(204);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const saved = await agent.get("/api/character").expect(200);
  assert.equal(saved.body.data.artifacts.length, 7);
  assert.equal(saved.body.data.characters.find((member: { id: string }) => member.id === second.id).artifactId, equipped.id);
  await agent.delete("/api/character").set("Origin", env.corsOrigin).expect(204);
  assert.equal(await prisma.artifact.count({ where: { userId } }), 0);
});

test("concurrent artifact purchases cannot overspend gold", async () => {
  const userId = "artifact-concurrent";
  await prisma.user.create({ data: { id: userId, username: userId, name: "Collector", passwordHash: await hashPassword("Test123!"), starterCreated: true, gold: 1000 } });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: userId, password: "Test123!" }).expect(200);
  const responses = await Promise.all(["hp", "atk"].map((stat) => agent.post("/api/character/artifacts/buy").set("Origin", env.corsOrigin).send({ stat })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).gold, 0);
  assert.equal(await prisma.artifact.count({ where: { userId } }), 1);
});
