import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { withBalance } from "../src/models/balance-context.js";
import { resolveEncounters, toggleExpeditionSkill2 } from "../src/repositories/expedition.repository.js";
import { defaultBalance } from "../src/services/balance.service.js";
import type { BattleStep } from "../src/services/battle.service.js";

test("Expedition updates the remaining timeline and awards only the settled result", async () => {
  const user = await prisma.user.create({ data: { username: "expedition_live_test", name: "Expedition Live Test", passwordHash: "unused" } });
  const fighter = await prisma.character.create({ data: { userId: user.id, name: "Juan", weapon: "ice_staff", skill2Unlocked: true } });
  const encounter = await prisma.encounter.create({ data: { userId: user.id, enemyType: "slime", teamIds: [fighter.id] } });
  await prisma.user.update({ where: { id: user.id }, data: { expeditionVitals: { [fighter.id]: { hp: 1000, mp: 20 } } } });
  const config = defaultBalance();
  config.stats["ice-staff"].hp = 1000;
  config.enemies.slime.hp = 250;

  await withBalance(config, async () => {
    const ids = [encounter.id];
    const prepared = await resolveEncounters(user.id, ids, undefined, undefined, { disabledSkill2Ids: [] });
    assert.ok((prepared as { steps: BattleStep[] }).steps.some(step => step.label === "Casting Freeze All"));
    assert.ok("movement" in prepared && Array.isArray(prepared.movement) && prepared.movement.length > 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).gold, 0);
    await assert.rejects(() => resolveEncounters(user.id, ids), /still in progress/);

    const initial = await prisma.encounter.findUniqueOrThrow({ where: { id: encounter.id }, select: { liveCombat: true } });
    const timeline = initial.liveCombat as { startedAt: number };
    await prisma.encounter.update({ where: { id: encounter.id }, data: { liveCombat: { ...timeline, startedAt: Date.now() } } });
    const toggled = await toggleExpeditionSkill2(user.id, encounter.id, fighter.id, false);
    assert.equal(toggled.skill2[0]?.enabled, false);
    assert.ok(toggled.steps.some(step => step.label === "Casting Freeze"));
    assert.ok(!toggled.steps.some(step => step.label === "Casting Freeze All"));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).gold, 0);

    const pending = await prisma.encounter.findUniqueOrThrow({ where: { id: encounter.id }, select: { liveCombat: true } });
    const live = pending.liveCombat as { startedAt: number };
    await prisma.encounter.update({ where: { id: encounter.id }, data: { liveCombat: { ...live, startedAt: 0 } } });
    await resolveEncounters(user.id, ids);
    const paid = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).gold;
    assert.equal(paid, config.rewards.slime.gold);
    await resolveEncounters(user.id, ids);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).gold, paid);

    await prisma.user.update({ where: { id: user.id }, data: {
      expeditionVitals: { [fighter.id]: { hp: 500, mp: 0, manaRestingAt: Date.now() - 1000 } },
    } });
    const next = await prisma.encounter.create({ data: { userId: user.id, enemyType: "slime", teamIds: [fighter.id] } });
    const nextPlayback = await resolveEncounters(user.id, [next.id], undefined, undefined, { disabledSkill2Ids: [] });
    assert.deepEqual(nextPlayback.initialTeamHp, [500]);
    assert.deepEqual(nextPlayback.initialTeamMp, [2]);
  });
});
