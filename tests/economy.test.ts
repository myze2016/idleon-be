import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultEconomy, normalizeEconomy, validateEconomy, artifactPrice, artifactEnhanceCost, characterUpgradeCost, skillUnlockCost } from "../src/models/economy.js";
import { defaultBalance, normalizeBalance, validateBalance } from "../src/services/balance.service.js";
import { withBalance } from "../src/models/balance-context.js";
import { accountProgress, experienceForLevel } from "../src/models/account-progress.js";
import { generatePatchNotes } from "../src/services/patch-notes.service.js";
import { artifactBonus, effectiveStats } from "../src/models/artifact.js";

test("direct economy defaults and legacy multiplier conversion preserve previous progression", () => {
  assert.equal(artifactPrice("hp"), 500); assert.equal(artifactEnhanceCost(200), 1000);
  assert.equal(characterUpgradeCost(200), 1000); assert.equal(skillUnlockCost(), 1000);
  assert.equal(artifactBonus(20), 45);
  const legacy = defaultBalance(); delete legacy.economy;
  assert.deepEqual(normalizeBalance(legacy).economy, defaultEconomy);
  assert.deepEqual(validateBalance(legacy).economy, defaultEconomy);
  const converted = normalizeEconomy({ shopPrices: defaultEconomy.shopPrices, expGrowth: 1.5, artifactEnhanceMultiplier: 1.5, characterUpgradeMultiplier: 1.2, skillUnlockCost: 777 });
  assert.deepEqual(converted.levelExp.slice(0, 3), [10, 15, 23]);
  assert.equal(converted.artifactEnhancements[1].cost, 1500);
  assert.equal(converted.characterUpgrades["sword-and-shield"][1].cost, 1200);
  assert.equal(converted.characterUpgrades["sword-and-shield"][1].gain, 10);
  assert.equal(converted.skillUnlockCost, 777);
  assert.doesNotThrow(() => validateEconomy(converted));
});
test("direct row validation rejects zero EXP, fractions, missing weapons and malformed steps", () => {
  const edits = [
    (s: typeof defaultEconomy) => { s.levelExp = []; },
    (s: typeof defaultEconomy) => { s.levelExp[0] = 0; },
    (s: typeof defaultEconomy) => { s.levelExp[0] = Infinity; },
    (s: typeof defaultEconomy) => { s.artifactEnhancements[0].gain = -1; },
    (s: typeof defaultEconomy) => { s.artifactEnhancements[0].cost = 1.5; },
    (s: typeof defaultEconomy) => { s.characterUpgrades["sword-and-shield"] = []; },
    (s: typeof defaultEconomy) => { delete s.characterUpgrades.bow; },
    (s: typeof defaultEconomy) => { s.skillUnlockCost = -1; },
    (s: typeof defaultEconomy) => { s.shopPrices.hp = 1.5; },
  ];
  for (const edit of edits) { const settings = structuredClone(defaultEconomy); edit(settings); assert.throws(() => validateEconomy(settings)); }
  const free = structuredClone(defaultEconomy); free.artifactEnhancements[0] = { cost: 0, gain: 0 }; free.skillUnlockCost = 0;
  assert.deepEqual(validateEconomy(free), free);
});
test("direct rows drive EXP, per-plus costs and cumulative bonuses, including repeated final rows", () => {
  const before = defaultBalance(), after = defaultBalance();
  after.economy = structuredClone(defaultEconomy);
  after.economy.levelExp = [10, 15, 23];
  after.economy.artifactEnhancements = [{ cost: 100, gain: 3 }, { cost: 250, gain: 7 }];
  after.economy.characterUpgrades["sword-and-shield"] = [{ cost: 900, gain: 12 }, { cost: 1200, gain: 25 }];
  after.economy.characterUpgrades.axe = [{ cost: 300, gain: 4 }];
  withBalance(after, () => {
    assert.equal(artifactEnhanceCost(0), 100); assert.equal(artifactEnhanceCost(1), 250);
    assert.equal(artifactEnhanceCost(1000), 250);
    assert.equal(artifactBonus(0), 5); assert.equal(artifactBonus(1), 8); assert.equal(artifactBonus(2), 15); assert.equal(artifactBonus(3), 22);
    assert.equal(characterUpgradeCost(0, "sword-and-shield"), 900);
    assert.equal(characterUpgradeCost(0, "axe"), 300);
    assert.equal(effectiveStats("sword-and-shield", null, 2).hp, 137);
    assert.equal(effectiveStats("sword-and-shield", { stat: "hp", enhancementLevel: 2 }, 2).hp, 152);
    assert.equal(effectiveStats("sword-and-shield", null, 3).hp, 162);
    assert.deepEqual(accountProgress(48), { level: 4, totalExp: 48, exp: 0, expToNextLevel: 23 });
    for (let level = 1; level < 40; level++) assert.equal(accountProgress(experienceForLevel(level)).level, level);
  });
  const notes = generatePatchNotes(before, after);
  assert.ok(notes.some(note => note.includes("stat gain") && note.includes("12")));
  assert.equal(artifactBonus(2), 9); // Request-local settings do not change defaults.
});
test("one-EXP levels and large plus levels are calculated without per-level loops", () => {
  const config = defaultBalance(); config.economy = structuredClone(defaultEconomy); config.economy.levelExp = [1];
  config.economy.artifactEnhancements = [{ cost: 0, gain: 2 }];
  withBalance(config, () => {
    assert.equal(accountProgress(2147483647).level, 2147483648);
    assert.equal(experienceForLevel(2147483648), 2147483647);
    assert.equal(artifactBonus(2147483647), 4294967299);
  });
});

test("one saved multiplier controls character costs across types and upgrade levels", () => {
  const { characterUpgradeCostMultiplier, ...oldSettings } = structuredClone(defaultEconomy);
  assert.equal(characterUpgradeCostMultiplier, 1);
  oldSettings.characterUpgrades.axe = [{ cost: 101, gain: 4 }];
  const settings = normalizeEconomy(oldSettings);
  assert.equal(settings.characterUpgradeCostMultiplier, 1);
  const before = { ...defaultBalance(), economy: settings };
  const after = { ...before, economy: validateEconomy({ ...settings, characterUpgradeCostMultiplier: 1.5 }) };
  withBalance(after, () => {
    assert.equal(characterUpgradeCost(100, "axe"), 152);
    assert.equal(characterUpgradeCost(0, "sword-and-shield"), 1500);
    assert.equal(artifactEnhanceCost(0), 1000);
  });
  assert.deepEqual(generatePatchNotes(before, after), ["Character upgrade gold cost multiplier: 1× to 1.5×"]);
  assert.throws(() => validateEconomy({ ...settings, characterUpgradeCostMultiplier: -1 }));
  assert.throws(() => validateEconomy({ ...settings, characterUpgradeCostMultiplier: 1_000_001 }));
});
