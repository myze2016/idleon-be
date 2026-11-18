import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { registrationProof } from "./registration-helper.js";
import { createVerifiedPlayer, registrationEmail, sendRegistrationCode } from "../src/services/registration-code.service.js";
import { verifyPassword } from "../src/utils/password.js";

test("registration requires email and code and does not create an unverified user", async () => {
  await request(app).post("/api/auth/register").set("Origin", env.corsOrigin).send({ username: "unverified", password: "Player123!", confirmPassword: "Player123!" }).expect(400);
  assert.equal(await prisma.user.count({ where: { username: "unverified" } }), 0);
  assert.equal(registrationEmail(" USER@Example.com "), "user@example.com");
  for (const input of [null, {}, "bad", "x@y", "x y@example.com"]) assert.throws(() => registrationEmail(input));
});

test("wrong attempts persist, five attempts lock a code, and expiry and replay are rejected", async () => {
  const { email, code } = await registrationProof("code_limits");
  for (let i = 1; i <= 5; i++) {
    await assert.rejects(createVerifiedPlayer("code_limits", "Player123!", email, "000000"), /Incorrect/);
    assert.equal((await prisma.registrationCode.findUniqueOrThrow({ where: { email } })).attempts, i);
  }
  await assert.rejects(createVerifiedPlayer("code_limits", "Player123!", email, code), /expired/);
  await registrationProof("code_limits");
  await prisma.registrationCode.update({ where: { email }, data: { expiresAt: new Date(0) } });
  await assert.rejects(createVerifiedPlayer("code_limits", "Player123!", email, code), /expired/);
  await registrationProof("code_limits");
  const results = await Promise.allSettled([1, 2].map(() => createVerifiedPlayer("code_limits", "Player123!", email, code)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await assert.rejects(createVerifiedPlayer("replay", "Player123!", email, code), /expired/);
});

test("Resend sends a hashed code, throttles resends, and preserves codes on provider failure", async (t) => {
  const oldKey = process.env.RESEND_API_KEY, oldFrom = process.env.RESEND_FROM_EMAIL;
  t.after(() => { if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey; if (oldFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = oldFrom; });
  delete process.env.RESEND_API_KEY;
  await assert.rejects(sendRegistrationCode("sender@example.com"), /not configured/);
  process.env.RESEND_API_KEY = "test-key"; process.env.RESEND_FROM_EMAIL = "IdleOn <test@example.com>";
  let sentCode = "", calls = 0, fail = false;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, "https://api.resend.com/emails");
    const body = JSON.parse(options.body as string);
    assert.deepEqual(body.to, ["sender@example.com"]);
    sentCode = body.text.match(/\b\d{6}\b/)[0];
    return new Response("{}", { status: fail ? 500 : 200 });
  });
  await sendRegistrationCode("sender@example.com");
  const stored = await prisma.registrationCode.findUniqueOrThrow({ where: { email: "sender@example.com" } });
  assert.notEqual(stored.codeHash, sentCode); assert.ok(await verifyPassword(sentCode, stored.codeHash));
  await assert.rejects(sendRegistrationCode("sender@example.com"), /60 seconds/); assert.equal(calls, 1);
  await prisma.registrationCode.update({ where: { email: stored.email }, data: { sentAt: new Date(0) } });
  fail = true;
  await assert.rejects(sendRegistrationCode(stored.email), /Could not send/);
  assert.equal((await prisma.registrationCode.findUniqueOrThrow({ where: { email: stored.email } })).codeHash, stored.codeHash);
  fail = false;
  const response = await request(app).post("/api/auth/register/code").set("Origin", env.corsOrigin).send({ email: stored.email }).expect(200);
  assert.equal(response.body.data.code, undefined);
  assert.notEqual((await prisma.registrationCode.findUniqueOrThrow({ where: { email: stored.email } })).codeHash, stored.codeHash);
  await assert.rejects(createVerifiedPlayer("sender", "Player123!", stored.email, "000000"), /Incorrect/);
});
