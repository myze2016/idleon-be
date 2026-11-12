import assert from "node:assert/strict";
import { test } from "node:test";
import { questDrops } from "../src/models/quest-item.js";

test("Guide map has one successful outcome out of two and never rerolls owned items", () => {
  assert.equal(questDrops(["fishpeople-guide"], [], () => 0).length, 1);
  assert.deepEqual(questDrops(["fishpeople-guide"], [], () => 1), []);
  const unexpectedRoll = () => { throw Error("Ineligible drops must not roll"); };
  assert.deepEqual(questDrops(["fishpeople-guide"], ["deepsea-moth-map"], unexpectedRoll), []);
  assert.deepEqual(questDrops(["assassin", "crab-day"], [], unexpectedRoll), []);
  assert.deepEqual(questDrops([], [], unexpectedRoll), []);
});

test("Zugwang evidence uses a separate 50 percent roll and drops only once", () => {
  assert.equal(questDrops(["zugwang"], [], () => 0)[0]?.id, "zugwangs-evidence");
  assert.deepEqual(questDrops(["zugwang"], [], () => 1), []);
  assert.deepEqual(questDrops(["zugwang"], ["zugwangs-evidence"], () => { throw Error("Owned evidence must not roll"); }), []);
  assert.equal(questDrops(["zugwang"], ["deepsea-moth-map"], () => 0)[0]?.id, "zugwangs-evidence");
});
