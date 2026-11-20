import assert from "node:assert/strict";
import { test } from "node:test";
import { baseStats } from "../src/models/character-stats.js";
import { defaultBalance } from "../src/services/balance.service.js";
import { hasActiveSkill2, replayCombat, type LiveCombat } from "../src/services/live-combat.js";

for (const mode of ["PvP", "Endless"] as const) {
  test(`${mode} applies Skill 2 changes to future actions only`, () => {
    const live: LiveCombat = { seed: "test", balance: defaultBalance(), changes: [], fighters: [
      { id: "juan", name: "Juan", userId: "a", weapon: "ice-staff", skill2Unlocked: true, mp: 0, startX: 400, stats: { ...baseStats["ice-staff"], hp: 10000, mp: 60 } },
      { id: "knight", name: "Knight", userId: "b", weapon: "sword-and-shield", skill2Unlocked: true, startX: 470, stats: { ...baseStats["sword-and-shield"], hp: 10000 } },
    ] };
    const duration = mode === "Endless" ? 12 : undefined;
    const before = replayCombat(live, duration);
    const after = replayCombat({ ...live, changes: [{ fighterId: "juan", at: 2.5, enabled: false }] }, duration);
    assert.equal(hasActiveSkill2(live.fighters[0], live.balance), true);
    assert.equal(hasActiveSkill2(live.fighters[1], live.balance), false);
    assert.deepEqual(after.steps.filter(step => step.at < 2.5), before.steps.filter(step => step.at < 2.5));
    assert.ok(before.steps.some(step => step.actor === 0 && step.label === "Casting Freeze All"));
    assert.ok(after.steps.some(step => step.actor === 0 && step.label === "Casting Freeze"));
    assert.ok(!after.steps.some(step => step.actor === 0 && step.label === "Casting Freeze All"));
  });
}
