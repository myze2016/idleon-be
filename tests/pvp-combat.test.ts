import assert from "node:assert/strict";
import { test } from "node:test";
import { COMBAT_ENCOUNTER_DISTANCE, simulateDuel, PVP_MELEE_RANGE, PVP_RANGED_RANGE, type DuelFighter } from "../src/services/pvp-battle.service.js";
import { baseStats } from "../src/models/character-stats.js";
import type { WeaponType } from "../src/models/character.js";
import { defaultEnemies } from "../src/models/enemy.js";
const fighter = (userId: string, weapon: WeaponType, unlocked = false, overrides = {}): DuelFighter => ({ userId, id: userId, name: userId, weapon, skill2Unlocked: unlocked, stats: { ...baseStats[weapon], ...overrides } });

test("area skills cannot hit an offscreen target when another enemy is in range", () => {
  const player = { ...fighter("team", "ice-staff", true, { hp: 1000, mp: 100 }), startX: 60 };
  const near = { ...fighter("opponent", "sword-and-shield", false, { hp: 5000, mp: 0 }), id: "near", startX: 650 };
  const far = { ...near, id: "far", startX: 3000 };
  for (const [checkpoint, expedition] of [[undefined, false], [undefined, true], [12, false]] as const) {
    const battle = simulateDuel([player, near, far], () => 0.99, checkpoint, { expedition });
    const firstFreeze = battle.steps.find(step => step.label === "Freeze All")!;
    assert.ok(firstFreeze);
    assert.ok(Math.abs(firstFreeze.x[0] - firstFreeze.x[2]) > PVP_RANGED_RANGE);
    for (const step of battle.steps.filter(step => step.label === "Freeze All")) {
      assert.ok(step.targets.every(target => Math.abs(step.x[step.actor] - step.x[target]) <= PVP_RANGED_RANGE + 1e-5));
    }
  }

  const stats = defaultEnemies["demon-prince"].stats;
  const boss: DuelFighter = { id: "boss", userId: "opponent", name: "Demon Prince", enemy: stats, stats, startX: 650 };
  const result = simulateDuel([player, { ...player, id: "rear", startX: -2000 }, boss], () => 0.99);
  const burns = result.steps.filter(step => step.label === "Burn All");
  assert.ok(burns.length);
  assert.ok(Math.abs(burns[0].x[2] - burns[0].x[1]) > PVP_RANGED_RANGE);
  assert.ok(burns.every(step => step.targets.every(target => Math.abs(step.x[2] - step.x[target]) <= PVP_RANGED_RANGE + 1e-5)));
});

test("PvP uses both characters' stats, starts full, and records a valid shared result", () => {
  const result = simulateDuel([fighter("a", "axe", false, { atk: 100 }), fighter("b", "bow")], () => 0.99);
  assert.equal(result.winnerId, "a");
  assert.ok(result.duration > 0 && result.duration <= 180);
  assert.ok(result.steps.some((step) => step.side === 0 && step.label === "Heavy Blow"));
  assert.ok(result.steps.some((step) => step.side === 1 && step.kind === "attack"));
  assert.ok(result.steps.every((step, index) => index === 0 || step.at >= result.steps[index - 1].at));
  assert.ok(result.steps.every((step) => step.hp.every((value) => value >= 0) && step.mp.every((value) => value >= 0)));
});

test("PvP ties do not always favor the room host and defensive stalemates end as a draw", () => {
  const sides: [DuelFighter, DuelFighter] = [fighter("host", "bow", false, { hp: 1 }), fighter("guest", "bow", false, { hp: 1 })];
  assert.equal(simulateDuel(sides, () => 0).winnerId, "host");
  assert.equal(simulateDuel(sides, () => 0.99).winnerId, "guest");
  const draw = simulateDuel([fighter("a", "sword-and-shield", false, { hp: 10000 }), fighter("b", "sword-and-shield", false, { hp: 10000 })], () => 0);
  assert.equal(draw.winnerId, null); assert.equal(draw.duration, 180);
});

test("Both duelists can cast, regenerate mana, apply statuses, and use unlocked skills", () => {
  const frost = simulateDuel([fighter("ice", "ice-staff", true, { hp: 1000 }), fighter("rifle", "rifle", true, { hp: 1000 })], () => 0.99);
  assert.ok(frost.steps.some((step) => step.label === "Freeze All"));
  assert.ok(frost.steps.some((step) => step.label === "Freeze All" && ((step.statuses?.[1] ?? 0) & 4) !== 0));
  const freezeAll = frost.steps.find(step => step.label === "Freeze All")!;
  assert.deepEqual(freezeAll.statusEnds?.[1], { freeze: freezeAll.at + 2 });
  assert.ok(frost.steps.some((step) => step.label === "Long Shot"));
  assert.ok(frost.steps.some((step) => step.kind === "mana"));
  const bleed = simulateDuel([fighter("axe", "dual-axe", true, { hp: 1000 }), fighter("bow", "bow", true, { hp: 1000 })], () => 0.99);
  assert.ok(bleed.steps.some((step) => step.kind === "bleed"));
  assert.ok(bleed.steps.some((step) => step.kind === "poison"));
  assert.ok(bleed.steps.some((step) => step.kind === "attack" && step.actor === 1 && ((step.statuses?.[0] ?? 0) & 1) !== 0));
  assert.ok(bleed.steps.some((step) => step.kind === "attack" && step.actor === 0 && ((step.statuses?.[1] ?? 0) & 2) !== 0));
  assert.ok(bleed.steps.some((step) => step.label === "Axe Frenzy"));
  assert.ok(bleed.steps.some((step) => step.label.startsWith("Shackle")));
  const shackle = bleed.steps.find(step => step.label.startsWith("Shackle"))!;
  assert.equal(shackle.statusEnds?.[0]?.stun, shackle.at + 1);
  const frenzy = bleed.steps.find(step => step.label === "Axe Frenzy")!;
  assert.equal(frenzy.statusEnds?.[0]?.burst, frenzy.at + 3);
  const poison = bleed.steps.find(step => step.kind === "attack" && step.actor === 1 && step.statusEnds?.[0]?.poison)!;
  assert.equal(poison.statusEnds?.[0]?.poison, poison.at + 5);
  assert.ok(bleed.steps.some(step => step.statusEnds?.[1]?.bleed === null));
  const shield = simulateDuel([fighter("shield", "sword-and-shield", true), fighter("axe", "axe")], () => 0);
  assert.ok(shield.steps.some((step) => step.kind === "block"));
  assert.ok(shield.steps.some((step) => step.kind === "counter"));
});

test("Uneven teams use every fighter, retarget defeated opponents, and stop only when a whole team falls", () => {
  const team = Array.from({ length: 6 }, (_, index) => ({ ...fighter("a", "rifle", false, { hp: 150, atk: 15 }), id: `a${index}` }));
  const result = simulateDuel([...team, fighter("b", "bow", false, { hp: 1500 })], () => 0.99);
  assert.equal(result.winnerId, "a");
  for (let index = 0; index < 6; index++) assert.ok(result.steps.some((step) => step.actor === index && step.kind === "skill"));
  assert.ok(result.steps.every((step) => step.hp.length === 7 && step.mp.length === 7));
  const weak = Array.from({ length: 6 }, (_, index) => ({ ...fighter("b", "bow", false, { hp: 1, atk: 1, mp: 0 }), id: `b${index}` }));
  const lone = simulateDuel([fighter("a", "rifle", false, { hp: 500, atk: 100 }), ...weak], () => 0);
  assert.equal(lone.winnerId, "a");
  for (let index = 1; index <= 6; index++) assert.ok(lone.steps.some((step) => step.targets.includes(index) && step.damage > 0));
  const final = lone.steps.at(-1)!;
  assert.equal(final.hp[0] > 0, true); assert.deepEqual(final.hp.slice(1), [0, 0, 0, 0, 0, 0]);
  for (let index = 0; index < lone.steps.length; index++) {
    const step = lone.steps[index];
    if (step.kind !== "mana" && step.kind !== "poison" && step.kind !== "bleed" && index) assert.ok(lone.steps[index - 1].hp[step.actor] > 0);
  }
});

test("6v6 area skills target the opposing team while support heals teammates without reviving", () => {
  const make = (owner: string, weapons: WeaponType[]) => weapons.map((weapon, index) => ({ ...fighter(owner, weapon, true, { hp: 500 }), id: `${owner}${index}` }));
  const result = simulateDuel([...make("a", ["staff", "wand", "glaive", "book", "ice-staff", "sword-and-shield"]), ...make("b", ["staff", "wand", "glaive", "book", "ice-staff", "sword-and-shield"])], () => 0.99);
  assert.ok(result.steps.every((step) => step.hp.length === 12 && step.mp.length === 12));
  const aoe = result.steps.filter((step) => step.actor === 0 && step.label === "Inferno");
  const firstInferno = aoe[0];
  assert.ok(firstInferno);
  const beforeInferno = result.steps[result.steps.indexOf(firstInferno) - 1];
  const inReach = [6, 7, 8, 9, 10, 11].filter(index => beforeInferno.hp[index] > 0 && Math.abs(firstInferno.x[index] - firstInferno.x[0]) <= PVP_RANGED_RANGE + 1e-5);
  assert.deepEqual(aoe.filter(step => step.at === firstInferno.at).flatMap(step => step.targets).sort((a, b) => a - b), inReach);
  assert.ok(result.steps.some((step) => step.kind === "heal" && step.healing > 0 && !step.targets.includes(step.actor)));
  assert.ok(result.steps.some((step) => step.kind === "buff" && step.targets.some((target) => target !== step.actor)));
  assert.ok(result.steps.some((step) => step.label === "Bouncing Glaive"));
  for (const step of result.steps) for (const target of step.targets) {
    if (step.kind === "heal" || step.kind === "buff") assert.equal(result.fighters[target].userId, result.fighters[step.actor].userId);
    if (step.damage > 0) assert.notEqual(result.fighters[target].userId, result.fighters[step.actor].userId);
  }
  const deaths = new Set<number>();
  for (const step of result.steps) step.hp.forEach((hp, index) => { if (deaths.has(index)) assert.equal(hp, 0); if (!hp) deaths.add(index); });
  assert.throws(() => simulateDuel(make("a", ["bow"])), /two teams/);
  assert.throws(() => simulateDuel([...make("a", Array(7).fill("bow")), ...make("b", ["bow"])]), /two teams/);
});

test("Opposite-end deployment gives ranged attacks a real opening before melee can reach", () => {
  const result = simulateDuel([fighter("melee", "sword-and-shield", false, { hp: 2000, mp: 0 }), fighter("ranged", "bow", false, { hp: 2000, mp: 0 })], () => 0.99);
  assert.equal(result.fighters[1].startX! - result.fighters[0].startX!, COMBAT_ENCOUNTER_DISTANCE);
  const ranged = result.steps.find((step) => step.actor === 1 && step.kind === "attack")!;
  const melee = result.steps.find((step) => step.actor === 0 && step.kind === "attack")!;
  assert.ok(ranged.at < melee.at);
  assert.ok(Math.abs(ranged.x[0] - ranged.x[1]) > PVP_MELEE_RANGE);
  assert.ok(Math.abs(ranged.x[0] - ranged.x[1]) > 600);
  assert.ok(Math.abs(ranged.x[0] - ranged.x[1]) <= PVP_RANGED_RANGE + 1e-5);
  for (const step of result.steps.filter((entry) => entry.kind === "attack")) for (const target of step.targets) {
    assert.ok(Math.abs(step.x[step.actor] - step.x[target]) <= (step.actor === 0 ? PVP_MELEE_RANGE : PVP_RANGED_RANGE) + 1e-5);
  }
  const moves = result.steps.filter((step) => step.kind === "move");
  assert.ok(moves.length > 0);
  assert.ok(moves.every((step) => step.x.every((x) => x >= 0 && x <= 1200)));
  const arrival = result.steps.find((step) => Math.abs(step.x[0] - step.x[1]) <= PVP_RANGED_RANGE + 1e-5)!;
  assert.ok(result.steps.filter((step) => step.at > arrival.at && step.at < melee.at).every((step) => Math.abs(step.x[1] - arrival.x[1]) < 1e-4));
});

test("Deployment mirrors full formations, ranged spells respect reach, and stunned units cannot walk", () => {
  const make = (owner: string) => Array.from({ length: 6 }, (_, index) => ({ ...fighter(owner, "sword-and-shield", false, { hp: 1000, mp: 0 }), id: `${owner}${index}` }));
  const formation = simulateDuel([...make("a"), ...make("b")], () => 0.99);
  assert.deepEqual(formation.fighters.slice(0, 6).map((unit) => unit.startX), [30, -34, -98, -162, -226, -290]);
  assert.deepEqual(formation.fighters.slice(6).map((unit) => unit.startX), [1170, 1234, 1298, 1362, 1426, 1490]);
  assert.deepEqual(formation.fighters.map(unit => unit.backRow), [false, false, false, true, true, true, false, false, false, true, true, true]);
  const openingMove = formation.steps.find(step => step.kind === "move")!;
  assert.ok(openingMove.x[5] > formation.fighters[5].startX!);
  assert.ok(openingMove.x[11] < formation.fighters[11].startX!);
  const result = simulateDuel([fighter("ice", "ice-staff", false, { hp: 1000 }), fighter("melee", "sword-and-shield", false, { hp: 1000 })], () => 0.99);
  const freeze = result.steps.find((step) => step.label === "Freeze")!;
  assert.ok(Math.abs(freeze.x[0] - freeze.x[1]) > PVP_MELEE_RANGE);
  assert.ok(Math.abs(freeze.x[0] - freeze.x[1]) <= PVP_RANGED_RANGE + 1e-5);
  for (const step of result.steps.filter((step) => step.at > freeze.at && step.at < freeze.at + 2 - 1e-6)) assert.equal(step.x[1], freeze.x[1]);
});
