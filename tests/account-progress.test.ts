import assert from "node:assert/strict";
import { test } from "node:test";
import { accountProgress, levelUpReward } from "../src/models/account-progress.js";

test("account levels use exponentially growing requirements with EXP carried over", () => {
  for (const [total, level, progress, required] of [
    [0, 1, 0, 10], [9, 1, 9, 10], [10, 2, 0, 20], [29, 2, 19, 20],
    [30, 3, 0, 40], [69, 3, 39, 40], [70, 4, 0, 80], [150, 5, 0, 160],
  ]) assert.deepEqual(accountProgress(total), { level, totalExp: total, exp: progress, expToNextLevel: required });
});

test("each level gained awards 100 wishes, including several levels in one battle", () => {
  assert.deepEqual(levelUpReward(0, 9), { levelsGained: 0, wishEarned: 0 });
  assert.deepEqual(levelUpReward(9, 10), { levelsGained: 1, wishEarned: 100 });
  assert.deepEqual(levelUpReward(9, 41), { levelsGained: 2, wishEarned: 200 });
  assert.deepEqual(levelUpReward(10, 11), { levelsGained: 0, wishEarned: 0 });
  assert.deepEqual(levelUpReward(70, 70), { levelsGained: 0, wishEarned: 0 });
});
