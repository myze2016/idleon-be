import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { enemies } from "../src/models/enemy.js";
import { enemyWiki } from "../src/models/enemy-wiki.js";
import { characterWiki } from "../src/models/character-wiki.js";

test("Wiki contains every enemy with current stats, rewards, locations, and skill damage", () => {
  const wiki = enemyWiki();
  assert.equal(wiki.length, Object.keys(enemies).length);
  assert.equal(new Set(wiki.map((enemy) => enemy.id)).size, wiki.length);
  for (const enemy of wiki) {
    const source = enemies[enemy.id];
    assert.equal(enemy.gold, source.gold); assert.equal(enemy.experience, 1);
    for (const stat of ["hp", "mp", "atk", "def", "magic", "magicDef", "speed", "range"] as const) assert.equal(enemy.stats[stat], source.stats[stat]);
    assert.ok(enemy.locations.length > 0, enemy.id);
  }
  const find = (id: string) => wiki.find((enemy) => enemy.id === id)!;
  assert.equal(find("hermit").skills[0].description, "30% chance to block direct attacks.");
  assert.equal(find("fishpeople-researcher").skills[0].damage, 50);
  assert.equal(find("fishpeople-researcher").skills[0].damageType, "Magic");
  assert.equal(find("fishpeople-researcher").skills[0].cooldown, 5);
  assert.equal(find("fishpeople-guardian").skills[0].duration, 5);
  assert.match(find("fishpeople-guardian").skills[0].description, /5 HP/);
  assert.equal(find("zugwang").skills[0].damageType, "Physical");
  assert.equal(find("demon-prince").skills[0].damageType, "Magic");
  assert.equal(find("starfish").skills[0].damage, 20);
  assert.deepEqual(find("crab-night").locations, ["Harbor · Night"]);
});

test("Enemy wiki endpoint is available to signed-in players and returns the live catalog", async () => {
  await request(app).get("/api/wiki/enemies").expect(401);
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "admin", password: "Admin123!" }).expect(200);
  const response = await agent.get("/api/wiki/enemies").expect(200);
  assert.deepEqual(response.body.data, enemyWiki());
  assert.equal(response.headers["cache-control"], "no-store");
});

test("Character wiki covers normal and special characters with damage formulas, passives, and upgrades", () => {
  const wiki = characterWiki();
  assert.equal(wiki.length, 14);
  assert.equal(new Set(wiki.map((entry) => entry.id)).size, 14);
  assert.equal(wiki.filter((entry) => entry.special).length, 3);
  const find = (id: string) => wiki.find((entry) => entry.id === id)!;
  assert.deepEqual(wiki.filter((entry) => entry.special).map((entry) => entry.name), ["Kent", "Juan", "Jeffrey"]);
  assert.equal(find("sword-and-shield").upgrade?.amount, 10);
  assert.equal(find("sword-and-shield").upgrade?.stat, "hp");
  assert.equal(find("dual-knife").upgrade?.stat, "speed");
  assert.equal(find("wand").upgrade, null);
  assert.equal(find("bow").stats.range, "range");
  assert.equal(find("glaive").stats.range, "range");
  assert.equal(find("ice-staff").stats.mp, 150);
  assert.deepEqual(find("ice-staff").skills[1].damage, { base: 20, stat: "magic" });
  assert.match(find("dual-axe").skills[0].description, /5 damage per second/);
  for (const entry of wiki) {
    assert.deepEqual(entry.skills.map((skill) => skill.slot), [1, 2]);
    assert.deepEqual(entry.skills.map((skill) => skill.unlockCost), [0, 1000]);
    assert.ok(entry.skills.every((skill) => skill.name && skill.description));
    assert.ok(entry.timing.attackInterval > 0);
    if (entry.upgrade) assert.equal(entry.upgrade.cost, 1000);
    for (const skill of entry.skills) if (skill.damage) assert.match(skill.description, /current (ATK|Magic)/);
  }
});

test("Character wiki endpoint requires login and returns the public base catalog without owned data", async () => {
  await request(app).get("/api/wiki/characters").expect(401);
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: "admin", password: "Admin123!" }).expect(200);
  const response = await agent.get("/api/wiki/characters").expect(200);
  assert.deepEqual(response.body.data, characterWiki());
  assert.equal(response.headers["cache-control"], "no-store");
});
