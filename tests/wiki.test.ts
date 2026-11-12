import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { enemies } from "../src/models/enemy.js";
import { enemyWiki } from "../src/models/enemy-wiki.js";

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
