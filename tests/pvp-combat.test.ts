import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateDuel, type DuelFighter } from "../src/services/pvp-battle.service.js";
import { baseStats } from "../src/models/character-stats.js";
import type { WeaponType } from "../src/models/character.js";
const fighter = (userId: string, weapon: WeaponType, unlocked = false, overrides = {}): DuelFighter => ({ userId, id: userId, name: userId, weapon, skill2Unlocked: unlocked, stats: { ...baseStats[weapon], ...overrides } });

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
  assert.ok(frost.steps.some((step) => step.label === "Long Shot"));
  assert.ok(frost.steps.some((step) => step.kind === "mana"));
  const bleed = simulateDuel([fighter("axe", "dual-axe", true, { hp: 1000 }), fighter("bow", "bow", true, { hp: 1000 })], () => 0.99);
  assert.ok(bleed.steps.some((step) => step.kind === "bleed"));
  assert.ok(bleed.steps.some((step) => step.kind === "poison"));
  assert.ok(bleed.steps.some((step) => step.label === "Axe Frenzy"));
  assert.ok(bleed.steps.some((step) => step.label.startsWith("Shackle")));
  const shield = simulateDuel([fighter("shield", "sword-and-shield", true), fighter("axe", "axe")], () => 0);
  assert.ok(shield.steps.some((step) => step.kind === "block"));
  assert.ok(shield.steps.some((step) => step.kind === "counter"));
});

test("Uneven teams use every fighter, retarget defeated opponents, and stop only when a whole team falls", () => {
  const team = Array.from({ length: 6 }, (_, index) => ({ ...fighter("a", "rifle", false, { hp: 150, atk: 15 }), id: `a${index}` }));
  const result = simulateDuel([...team, fighter("b", "bow", false, { hp: 300 })], () => 0.99);
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
  assert.deepEqual(aoe.filter((step) => step.at === aoe[0].at).flatMap((step) => step.targets), [6, 7, 8, 9, 10, 11]);
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
