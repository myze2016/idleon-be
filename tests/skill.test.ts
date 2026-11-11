import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";

test("Skill 2 unlock costs 10,000 gold once, checks ownership, and persists per character", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "skill-user", username: "skill-user", name: "Skill user", passwordHash, gold: 9999, experience: 17 },
    { id: "skill-other", username: "skill-other", name: "Other", passwordHash, gold: 20000 },
  ] });
  const agent = request.agent(app), other = request.agent(app);
  for (const [client, username] of [[agent, "skill-user"], [other, "skill-other"]] as const) {
    await client.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username, password: "Test123!" }).expect(200);
  }
  const created = await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Ranger", weapon: "rifle" }).expect(201);
  const id = created.body.data.characters[0].id;
  assert.equal(created.body.data.characters[0].skill2Unlocked, false);
  const second = await prisma.character.create({ data: { userId: "skill-user", name: "Mage", weapon: "staff" } });
  const path = `/api/character/${id}/skill-2/unlock`;
  await request(app).post(path).set("Origin", env.corsOrigin).expect(401);
  await other.post(path).set("Origin", env.corsOrigin).expect(404);
  await agent.post(path).set("Origin", "https://other.example").expect(403);
  await agent.post(path).expect(403);
  await agent.post(path).set("Origin", env.corsOrigin).send({ cost: 0, gold: 100000, skill2Unlocked: true }).expect(409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "skill-user" } })).gold, 9999);
  assert.equal((await prisma.character.findUniqueOrThrow({ where: { id } })).skill2Unlocked, false);
  await prisma.user.update({ where: { id: "skill-user" }, data: { gold: 10000 } });
  const responses = await Promise.all([1, 2].map(() => agent.post(path).set("Origin", env.corsOrigin)));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const saved = await agent.get("/api/character").expect(200);
  assert.equal(saved.body.data.gold, 0);
  assert.equal(saved.body.data.progression.totalExp, 17);
  assert.equal(saved.body.data.characters.find((character: { id: string }) => character.id === id).skill2Unlocked, true);
  assert.equal(saved.body.data.characters.find((character: { id: string }) => character.id === second.id).skill2Unlocked, false);
  assert.equal(saved.body.data.characters.find((character: { id: string }) => character.id === id).stats.range, "range");
  await agent.post(path).set("Origin", env.corsOrigin).expect(200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "skill-user" } })).gold, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "skill-other" } })).gold, 20000);
});
