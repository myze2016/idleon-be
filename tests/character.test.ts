import "./setup.js";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { test } from "node:test";
import request from "supertest";

test("character creation validates choices, persists per account, and prevents replacement", async () => {
    const { app } = await import("../src/app.js");
    const { env } = await import("../src/config/env.js");
    const { weaponTypes } = await import("../src/models/character.js");
    const { validateCharacter } = await import("../src/services/character.service.js");
    const repository = await import("../src/repositories/character.repository.js");
    const agent = request.agent(app);
    await agent.get("/api/character").expect(401);
    await agent.post("/api/character").set("Origin", env.corsOrigin).send({ name: "Hero", weapon: "bow" }).expect(401);
    const login = await agent.post("/api/auth/login").set("Origin", env.corsOrigin)
      .send({ username: "admin", password: "Admin123!" }).expect(200);
    const empty = await agent.get("/api/character").expect(200);
    assert.equal(empty.body.data.character, null);
    assert.equal(empty.headers["cache-control"], "no-store");
    await agent.post("/api/character").set("Origin", "https://other.example")
      .send({ name: "Hero", weapon: "bow" }).expect(403);
    for (const input of [null, {}, { name: " ", weapon: "bow" }, { name: "A", weapon: "bow" },
      { name: "a".repeat(25), weapon: "bow" }, { name: "<Hero>", weapon: "bow" }, { name: "Hero", weapon: "invalid" }]) {
      await agent.post("/api/character").set("Origin", env.corsOrigin).send(input).expect(400);
    }
    for (const weapon of weaponTypes) assert.equal(validateCharacter({ name: " Hero ", weapon }).weapon, weapon);
    const input = { name: " Hero ", weapon: "sword-and-shield" };
    const results = await Promise.all([1, 2].map(() => agent.post("/api/character").set("Origin", env.corsOrigin).send(input)));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    const expected = { name: "Hero", weapon: "sword-and-shield" };
    const saved = await prisma.character.findFirstOrThrow({ where: { userId: login.body.data.user.id } });
    assert.equal(saved.name, expected.name);
    assert.equal(saved.weapon, "sword_and_shield");
    await prisma.user.create({ data: { id: "another-user", username: "another", name: "Another", passwordHash: "unused" } });
    await repository.createCharacter("another-user", { name: "Mage", weapon: "staff" });
    assert.deepEqual(await repository.findCharacter("another-user"), { name: "Mage", weapon: "staff" });
    assert.equal(await repository.findCharacter("unknown-user"), null);
    await agent.post("/api/auth/logout").set("Origin", env.corsOrigin).expect(204);
    await agent.get("/api/character").expect(401);
    await agent.post("/api/auth/login").set("Origin", env.corsOrigin)
      .send({ username: "admin", password: "Admin123!" }).expect(200);
    const returning = await agent.get("/api/character").expect(200);
    assert.deepEqual(returning.body.data.character, expected);
    await request(app).delete("/api/character").set("Origin", env.corsOrigin).expect(401);
    await agent.delete("/api/character").set("Origin", "https://other.example").expect(403);
    await agent.delete("/api/character").expect(403);
    assert.deepEqual(await repository.findCharacter(login.body.data.user.id), expected);
    await agent.delete("/api/character").set("Origin", env.corsOrigin).expect(204);
    assert.equal(await repository.findCharacter(login.body.data.user.id), null);
    assert.deepEqual(await repository.findCharacter("another-user"), { name: "Mage", weapon: "staff" });
    await agent.get("/api/auth/me").expect(200);
    const reset = await agent.get("/api/character").expect(200);
    assert.equal(reset.body.data.character, null);
    await agent.delete("/api/character").set("Origin", env.corsOrigin).expect(204);
    const recreated = await agent.post("/api/character").set("Origin", env.corsOrigin)
      .send({ name: "New Hero", weapon: "wand" }).expect(201);
    assert.deepEqual(recreated.body.data.character, { name: "New Hero", weapon: "wand" });
});
