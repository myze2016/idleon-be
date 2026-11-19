import { test } from "node:test";
import assert from "node:assert/strict";
import { playerIdentity } from "../src/models/player-name.js";

test("Google players display their chosen starter name instead of the internal username", () => {
  assert.deepEqual(playerIdentity({ username: "google_internal", name: "Google Profile", googleSubject: "subject", characters: [{ name: "Chosen Adventurer" }] }), {
    username: "Chosen Adventurer", name: "Chosen Adventurer",
  });
});

test("Google players without a starter use their saved name", () => {
  assert.deepEqual(playerIdentity({ username: "google_internal", name: "Saved Adventurer", googleSubject: "subject", characters: [] }), {
    username: "Saved Adventurer", name: "Saved Adventurer",
  });
});

test("Password accounts retain their account username and display name", () => {
  assert.deepEqual(playerIdentity({ username: "account_name", name: "Account Name", googleSubject: null, characters: [{ name: "Starter" }] }), {
    username: "account_name", name: "Account Name",
  });
});
