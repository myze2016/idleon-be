import assert from "node:assert/strict";
import { test } from "node:test";
import { baseStats } from "../src/models/character-stats.js";
import { expeditionFighters, replayExpedition, simulateExpeditionBattle } from "../src/services/expedition-battle.service.js";
import { defaultBalance, normalizeBalance, validateBalance } from "../src/services/balance.service.js";
import { withBalance } from "../src/models/balance-context.js";
import { enemyWiki } from "../src/models/enemy-wiki.js";
import { COMBAT_ENCOUNTER_DISTANCE, COMBAT_VISIBLE_DISTANCE, PVP_MELEE_RANGE, PVP_RANGED_RANGE } from "../src/services/pvp-battle.service.js";
import { LIVE_COMBAT_RULES_VERSION, replayCombat } from "../src/services/live-combat.js";

const roll = () => 0.99;

test("Expedition playback preserves shared cast timing and enemy health by encounter", () => {
  const result = simulateExpeditionBattle([
    { id: "mage", weapon: "ice-staff", stats: { ...baseStats["ice-staff"], hp: 1000, mp: 100, magic: 100 } },
  ], [{ id: "first", type: "slime" }, { id: "second", type: "boar" }], roll);

  const cast = result.steps.find(step => step.kind === "cast");
  assert.ok(cast?.teamCasting?.[0]);
  assert.equal(cast.characterId, "mage");
  assert.equal(cast.teamCasting[0].startedAt, cast.at);
  assert.ok(cast.teamCasting[0].endsAt > cast.at);
  assert.equal(result.won, true);
  assert.deepEqual(result.enemyHps, [0, 0]);
  assert.deepEqual(result.steps.at(-1)?.teamMp, result.teamMp);
});

test("Expedition includes summoned enemies in playback and final health", () => {
  const result = simulateExpeditionBattle([
    { id: "tank", stats: { ...baseStats.spear, hp: 10000, atk: 20, def: 100 } },
  ], [{ id: "lord", type: "fishpeople-lord" }], roll);

  assert.equal(result.summoned[0]?.type, "fishpeople-knight");
  assert.equal(result.summoned[0]?.index, 1);
  assert.equal(result.steps.find(step => step.enemyHps?.length === 2)?.at, result.summoned[0]?.at);
  assert.equal(result.enemyHps.length, 1 + result.summoned.length);
});

test("shared combat uses boss area cooldown defaults and published overrides", () => {
  const saved = defaultBalance();
  delete saved.enemies["demon-prince"].burnAll!.cooldown;
  delete saved.enemies.zugwang.slashAll!.cooldown;
  const config = normalizeBalance(saved);
  const team = [{ id: "tank", stats: { ...baseStats.spear, hp: 10000, atk: 20, def: 100 } }];
  for (const [type, label, key] of [["demon-prince", "Burn All", "burnAll"], ["zugwang", "Slash All", "slashAll"]] as const) {
    const casts = () => simulateExpeditionBattle(team, [{ id: type, type }], roll).steps.filter(step => step.label === label).map(step => step.at);
    assert.deepEqual(withBalance(config, casts), [1, 11]);
    config.enemies[type][key]!.cooldown = 4;
    withBalance(validateBalance(config), () => {
      assert.deepEqual(casts(), [1, 5]);
      assert.equal(enemyWiki().find(enemy => enemy.id === type)?.skills.find(skill => skill.name === label)?.cooldown, 4);
    });
  }
});

test("a live Expedition toggle preserves earlier actions and changes future casts", () => {
  const live = {
    seed: "expedition-toggle", balance: defaultBalance(), changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION,
    fighters: expeditionFighters([
      { id: "mage", weapon: "ice-staff", skill2Unlocked: true, mp: 20, stats: { ...baseStats["ice-staff"], hp: 1000 } },
    ], [{ id: "boss", type: "demon-prince" }]),
  };
  const before = replayExpedition(live);
  const after = replayExpedition({ ...live, changes: [{ fighterId: "mage", at: 1.5, enabled: false }] });
  assert.deepEqual(after.steps.filter(step => step.at < 1.5), before.steps.filter(step => step.at < 1.5));
  assert.ok(before.steps.some(step => step.label === "Casting Freeze All"));
  assert.ok(after.steps.some(step => step.label === "Casting Freeze"));
  assert.ok(!after.steps.some(step => step.label === "Casting Freeze All"));
});

test("live Expedition plays ranged casts before contact and regenerates mana during approach", () => {
  const stats = { ...baseStats.staff, hp: 1000, mp: 100 };
  const fighters = expeditionFighters([{ id: "mage", weapon: "staff", stats, mp: 10 }], [{ id: "boar", type: "boar" }], COMBAT_ENCOUNTER_DISTANCE);
  const result = replayExpedition({ seed: "ranged-approach", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION });
  const cast = result.steps.find(step => step.label === "Casting Fireball");
  assert.ok(cast);
  assert.equal(result.steps.find(step => step.kind === "mana")?.teamMp?.[0], 12);
  const initial = result.movement[0];
  const duringCast = result.movement.filter(frame => frame.at <= cast.at).at(-1)!;
  assert.equal(initial.x[1] - initial.x[0], COMBAT_ENCOUNTER_DISTANCE);
  assert.ok(duringCast.x[1] - duringCast.x[0] <= PVP_RANGED_RANGE + 1e-5);
  assert.ok(duringCast.x[1] - duringCast.x[0] > 600);
});

test("Expedition and Endless melee teams advance toward ranged enemies", () => {
  const stats = { ...baseStats.spear, hp: 1000, atk: 100 };
  const fighters = expeditionFighters([{ id: "melee", stats }], [{ id: "slinger", type: "slinger" }], PVP_RANGED_RANGE);
  const live = { seed: "ranged-enemy", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION };
  const result = replayExpedition(live);
  assert.ok(result.movement.some(frame => frame.x[0] > result.movement[0].x[0]));
  assert.equal(result.won, true);
  const endless = replayCombat(live, 12);
  assert.ok(endless.steps.some(step => step.kind === "attack" && step.actor === 0));
  assert.equal(endless.winnerId, "team");
});

test("combat skills wait until an approaching enemy reaches the visible battlefield", () => {
  const fighters = expeditionFighters([
    { id: "book", weapon: "book", stats: { ...baseStats.book, hp: 1000, mp: 100 } },
  ], [{ id: "boar", type: "boar" }], COMBAT_ENCOUNTER_DISTANCE);
  const result = replayExpedition({ seed: "entry", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION });
  const cast = result.steps.find(step => step.kind === "cast");
  assert.ok(cast);
  const position = result.movement.findLast(frame => frame.at <= cast.at)!;
  assert.ok(position.x[1] - position.x[0] <= COMBAT_VISIBLE_DISTANCE + 1e-5);
  assert.ok(position.x[1] - position.x[0] > PVP_RANGED_RANGE);
});

test("an archer walks during the approach and stops once the target is in range in every mode", () => {
  const fighters = expeditionFighters([
    { id: "archer", weapon: "bow", stats: { ...baseStats.bow, hp: 1000 }, mp: 0 },
  ], [{ id: "boar", type: "boar" }], COMBAT_ENCOUNTER_DISTANCE);
  const live = { seed: "both-walk", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION };
  for (const [mode, duration, expedition] of [["Expedition", undefined, true], ["Endless", 12, false], ["PvP", undefined, false]] as const) {
    const result = replayCombat(live, duration, expedition);
    const firstMove = result.steps.find(step => step.kind === "move")!;
    const firstAttack = result.steps.find(step => step.actor === 0 && step.kind === "attack")!;
    assert.ok(firstMove.x[0] > result.fighters[0].startX!, mode);
    assert.ok(firstMove.x[1] < result.fighters[1].startX!, mode);
    assert.ok(firstMove.x[1] - firstMove.x[0] > COMBAT_VISIBLE_DISTANCE, mode);
    assert.ok(firstAttack.x[1] - firstAttack.x[0] <= PVP_RANGED_RANGE + 1e-5, mode);
  }
  const previous = replayCombat({ ...live, rulesVersion: 5 }, undefined, true);
  assert.equal(previous.steps.find(step => step.kind === "move")?.x[0], previous.fighters[0].startX);
  const current = replayCombat(live, undefined, true);
  const previousFirstMove = previous.steps.find(step => step.kind === "move")!;
  const currentFirstMove = current.steps.find(step => step.kind === "move")!;
  const previousStride = previous.fighters[1].startX! - previousFirstMove.x[1];
  const currentStride = current.fighters[1].startX! - currentFirstMove.x[1];
  assert.ok(Math.abs(currentStride - previousStride * .7) < 1e-6);
});

for (const [weapon, attackLabel] of [["bow", undefined], ["staff", "Fireball"], ["ice-staff", "Freeze"]] as const) {
  test(`${weapon} and melee march together before splitting at ranged contact in every mode`, () => {
    const fighters = expeditionFighters([
      { id: "ranged", weapon, stats: { ...baseStats[weapon], hp: 10000 }, mp: attackLabel ? 100 : 0 },
      { id: "melee", weapon: "axe", stats: { ...baseStats.axe, hp: 10000 }, mp: 0 },
    ], [{ id: "slinger", type: "slinger" }], COMBAT_ENCOUNTER_DISTANCE);
    const stats = { ...fighters[2].stats, hp: 10000 };
    fighters[2] = { ...fighters[2], enemy: stats, stats };
    const live = { seed: "melee-closes", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION };
    for (const [mode, duration, expedition] of [["Expedition", undefined, true], ["Endless", 30, false], ["PvP", undefined, false]] as const) {
      const result = replayCombat(live, duration, expedition);
      const firstMove = result.steps.find(step => step.kind === "move")!;
      const shot = result.steps.find(step => step.actor === 0 && (attackLabel ? step.label === attackLabel : step.kind === "attack") && step.damage > 0);
      const hit = result.steps.find(step => step.actor === 1 && step.damage > 0);
      assert.ok(firstMove.x[0] > result.fighters[0].startX!, mode);
      assert.ok(Math.abs((firstMove.x[0] - firstMove.x[1]) - (result.fighters[0].startX! - result.fighters[1].startX!)) < 1e-5, mode);
      assert.ok(shot && hit && shot.at < hit.at && hit.x[1] > shot.x[1], mode);
      assert.ok(result.steps.filter(step => step.at >= shot.at && step.at <= hit.at)
        .every(step => step.cameraWorld?.[0] === shot.cameraWorld?.[0]), mode);
      assert.ok(Math.abs(hit.x[1] - hit.x[2]) <= PVP_MELEE_RANGE + 1e-5, mode);
    }
  });
}

test("ranged-only PvP teams close the opening gap and then stop to fire", () => {
  const stats = { ...baseStats.bow, hp: 1000 };
  const fighters = ["host", "guest"].map(userId => ({ id: userId, userId, name: "Archer", weapon: "bow" as const, stats }));
  const result = replayCombat({ seed: "ranged-duel", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION });
  const attack = result.steps.find(step => step.kind === "attack");
  assert.ok(attack && Math.abs(attack.x[1] - attack.x[0]) <= PVP_RANGED_RANGE + 1e-5);
  assert.ok(attack.x[0] > result.fighters[0].startX! && attack.x[1] < result.fighters[1].startX!);
  assert.ok(result.steps.every(step => step.at < attack.at || step.x[0] === attack.x[0] && step.x[1] === attack.x[1]));
});

test("a cast plants its caster while melee advances and the camera holds in every mode", () => {
  for (const backRow of [false, true]) {
    const fighters = expeditionFighters([
      { id: "melee", weapon: "axe", stats: { ...baseStats.axe, hp: 10000 }, mp: 0 },
      { id: "spear", weapon: "spear", stats: { ...baseStats.spear, hp: 10000 }, backRow },
    ], [{ id: "slinger", type: "slinger" }], COMBAT_ENCOUNTER_DISTANCE);
    const stats = { ...fighters[2].stats, hp: 10000 };
    fighters[2] = { ...fighters[2], enemy: stats, stats };
    const live = { seed: "throw-on-the-move", balance: defaultBalance(), fighters, changes: [], rulesVersion: LIVE_COMBAT_RULES_VERSION };
    for (const [mode, duration, expedition] of [["Expedition", undefined, true], ["Endless", 12, false], ["PvP", undefined, false]] as const) {
      const result = replayCombat(live, duration, expedition);
      const cast = result.steps.find(step => step.actor === 1 && step.kind === "cast" && step.label === "Casting Throw Spear");
      const hit = result.steps.find(step => step.actor === 1 && step.kind === "skill" && step.label === "Throw Spear");
      assert.ok(cast && hit && hit.at > cast.at, mode);
      assert.ok(result.steps.slice(result.steps.indexOf(cast), result.steps.indexOf(hit) + 1)
        .every(step => step.x[1] === cast.x[1]), mode);
      assert.ok(hit.x[0] > cast.x[0], mode);
      assert.equal(cast.cameraWorld?.[0], hit.cameraWorld?.[0], mode);
      assert.equal(cast.spearCasting, undefined, mode);
      assert.ok(result.steps.some(step => step.at > hit.at && step.x[1] > hit.x[1]), mode);
      if (expedition) {
        const movement = replayExpedition(live).movement.filter(frame => frame.at >= cast.at && frame.at <= hit.at);
        assert.equal(movement[0]?.at, cast.at);
        assert.equal(movement.at(-1)?.at, hit.at);
        assert.ok(movement.every(frame => frame.x[1] === cast.x[1]));
      }
      const previous = replayCombat({ ...live, rulesVersion: 13 }, duration, expedition);
      const oldCast = previous.steps.find(step => step.actor === 1 && step.kind === "cast" && step.label === "Casting Throw Spear");
      const oldHit = previous.steps.find(step => step.actor === 1 && step.kind === "skill" && step.label === "Throw Spear");
      assert.ok(oldCast && oldHit && oldHit.x[0] === oldCast.x[0], mode);
    }
  }
});
