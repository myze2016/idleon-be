import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { COMBAT_ENCOUNTER_DISTANCE } from "../src/services/pvp-battle.service.js";

test("Endless admin controls, verified distance and continuous spawns, snapshots, idempotency, defeat and seasonal rankings", async () => {
  const passwordHash = await hashPassword("Test123!");
  await prisma.user.createMany({ data: [
    { id: "endless-admin", username: "endless_admin", name: "Endless Admin", passwordHash, role: "admin" },
    ...["endless-one", "endless-two"].map(id => ({ id, username: id, name: id, passwordHash, starterCreated: true })),
  ] });
  const first = await prisma.character.create({ data: { userId: "endless-one", name: "Knight", weapon: "sword_and_shield", isStarter: true, upgradeLevel: 20 } });
  const second = await prisma.character.create({ data: { userId: "endless-two", name: "Knight", weapon: "sword_and_shield", isStarter: true } });
  const [admin, one, two] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [index, agent] of [admin, one, two].entries()) await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username: ["endless_admin", "endless-one", "endless-two"][index], password: "Test123!" }).expect(200);
  const post = (agent: typeof one, path: string, body = {}) => agent.post(`/api/endless/${path}`).set("Origin", env.corsOrigin).send(body);
  const save = (version: number, config: object) => admin.put("/api/admin/endless").set("Origin", env.corsOrigin).send({ version, config });
  const finish = async (id: string) => { await prisma.endlessRun.update({ where: { id }, data: { readyAt: new Date(Date.now() - 100) } }); };
  try {
    await request(app).get("/api/endless").expect(401);
    await one.get("/api/admin/endless").expect(403);
    await admin.put("/api/admin/endless").send({}).expect(403);
    const original = (await admin.get("/api/admin/endless").expect(200)).body.data;
    await save(original.version, { enabled: true, enemyPool: [], statMultiplier: 1.2 }).expect(400);
    const settings = { enabled: true, enemyPool: ["slime"], statMultiplier: 1.2 };
    const published = (await save(original.version, settings).expect(200)).body.data;
    const season = published.version;
    await save(original.version, settings).expect(409);
    await post(one, "start", { teamIds: [second.id], requestKey: randomUUID() }).expect(400);
    const requestKey = randomUUID();
    const run = (await post(one, "start", { teamIds: [first.id], requestKey, hp: 999999, bestWave: 99999 }).expect(200)).body.data;
    assert.equal(run.bestWave, 0); assert.equal(run.team[0].stats.hp, 300);
    assert.equal((await post(one, "start", { teamIds: [first.id], requestKey }).expect(200)).body.data.id, run.id);
    assert.equal((await post(one, "start", { teamIds: [first.id], requestKey: randomUUID() }).expect(200)).body.data.id, run.id);
    await post(two, `${run.id}/wave`).expect(404);
    const wave = (await post(one, `${run.id}/wave`).expect(200)).body.data;
    assert.equal(wave.pending.enemyType, "slime");
    assert.equal(wave.pending.result.duration, 12);
    const enemies = wave.pending.result.fighters.filter((fighter: { enemyType?: string; spawnAt: number }) => fighter.enemyType && fighter.spawnAt <= 12);
    assert.equal(enemies[0].startX - wave.pending.result.fighters[0].startX, COMBAT_ENCOUNTER_DISTANCE);
    const spawnTimes = [...new Set<number>(enemies.map((fighter: { spawnAt: number }) => fighter.spawnAt))];
    assert.equal(spawnTimes[0], 0);
    for (const [index, at] of spawnTimes.entries()) {
      const batch = enemies.filter((fighter: { spawnAt: number }) => fighter.spawnAt === at);
      assert.ok(batch.length >= 1 && batch.length <= 2);
      assert.equal(new Set(batch.map((fighter: { startX: number }) => fighter.startX)).size, batch.length);
      const nextAt = spawnTimes[index + 1] ?? 12 + wave.pending.nextSpawnIn;
      assert.ok(nextAt - at >= 3.75 - 1e-8 && nextAt - at <= 25 + 1e-8);
    }
    assert.deepEqual((await post(one, `${run.id}/wave`).expect(200)).body.data.pending, wave.pending);
    await post(one, `${run.id}/resolve`, { wave: 1, bestWave: 99999 }).expect(409);
    await finish(run.id);
    const resolutions = await Promise.all([1, 2].map(() => post(one, `${run.id}/resolve`, { wave: 1 }).expect(200)));
    assert.equal(resolutions[0].body.data.wave, 2); assert.equal(resolutions[1].body.data.wave, 2);
    const after = resolutions[0].body.data;
    assert.equal(after.distance, 120); assert.equal(after.bestWave, 120);
    assert.ok(after.pending, "resolving a surviving run prepares the next checkpoint without a separate spawn request");
    assert.ok(after.readyAt);
    assert.equal(after.team[0].hp, wave.pending.result.steps.at(-1).hp[0]);
    const laterSettings = { enabled: true, enemyPool: ["fishpeople-lord"], statMultiplier: 2 };
    const newer = (await save(season, laterSettings).expect(200)).body.data;
    await prisma.character.update({ where: { id: first.id }, data: { upgradeLevel: 21 } });
    const next = (await post(one, `${run.id}/wave`).expect(200)).body.data;
    assert.equal(next.season, season);
    assert.deepEqual(next.settings.enemyPool, ["slime"]);
    assert.ok(next.pending.enemyType === "slime" || next.pending.enemyType === null);
    const incoming = next.pending.result.fighters.find((fighter: { id: string; spawnAt: number }) => fighter.id === "endless-2-0" && fighter.spawnAt <= 12);
    if (incoming) {
      assert.ok(incoming.spawnAt >= wave.pending.nextSpawnIn * 0.75 - 1e-8 && incoming.spawnAt <= wave.pending.nextSpawnIn + 1e-8);
      assert.equal(incoming.stats.hp, Math.ceil(40 * 1.2 ** Math.floor((120 + incoming.spawnAt * 10) / 500)));
    } else {
      assert.ok(wave.pending.nextSpawnIn >= 12 - 1e-8);
      assert.ok(next.pending.nextSpawnIn <= wave.pending.nextSpawnIn - 12 + 1e-8);
    }
    assert.equal(next.pending.result.fighters[0].stats.hp, 300);
    assert.equal(next.pending.result.fighters[0].hp, after.team[0].hp);
    await finish(run.id);
    await post(one, `${run.id}/resolve`, { wave: 2 }).expect(200);
    const oldScores = (await one.get(`/api/endless/leaderboard?season=${season}`).expect(200)).body.data;
    assert.equal(oldScores.entries.length, 1); assert.equal(oldScores.mine.bestWave, 240); assert.equal(oldScores.mine.rank, 1);
    await prisma.endlessScore.create({ data: { userId: "endless-two", season, bestWave: 240, achievedAt: new Date(0) } });
    const tied = (await one.get(`/api/endless/leaderboard?season=${season}`).expect(200)).body.data;
    assert.equal(tied.entries[0].username, "endless-two"); assert.equal(tied.mine.rank, 2);
    await prisma.endlessScore.delete({ where: { userId_season: { userId: "endless-two", season } } });
    assert.equal((await one.get("/api/endless/leaderboard").expect(200)).body.data.entries.length, 0);
    await post(one, `${run.id}/retire`).expect(200);
    assert.equal((await post(one, "start", { teamIds: [first.id], requestKey }).expect(200)).body.data.status, "retired");
    const loser = (await post(two, "start", { teamIds: [second.id], requestKey: randomUUID() }).expect(200)).body.data;
    const loss = (await post(two, `${loser.id}/wave`).expect(200)).body.data;
    assert.notEqual(loss.pending.result.winnerId, "endless-two");
    let ended = loss;
    for (let checkpoints = 0; ended.status === "active" && checkpoints < 6; checkpoints++) {
      await finish(loser.id);
      ended = (await post(two, `${loser.id}/resolve`, { wave: ended.wave }).expect(200)).body.data;
    }
    assert.equal(ended.status, "defeated"); assert.ok(ended.distance > 0);
    assert.equal(await prisma.endlessScore.count({ where: { userId: "endless-two" } }), 1);
    await save(newer.version, { ...laterSettings, enabled: false }).expect(200);
    await post(two, "start", { teamIds: [second.id], requestKey: randomUUID() }).expect(409);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: "endless-one" } });
    assert.equal(account.gold, 0); assert.equal(account.experience, 0);
    assert.equal(await prisma.endlessScore.count({ where: { userId: "endless-one", season } }), 1);
  } finally {
    await prisma.endlessRun.deleteMany(); await prisma.endlessScore.deleteMany(); await prisma.endlessSettings.deleteMany();
  }
});
