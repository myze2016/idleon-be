import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { googlePlayer } from "../src/services/google-auth.service.js";
import { hashPassword } from "../src/utils/password.js";

function profile(sub: string, email: string, nonce = "nonce") {
  return { sub, email, email_verified: true, name: "Google Hero", nonce } as unknown as TokenPayload;
}

test("Google identities require a verified email and nonce and never take over password accounts", async () => {
  await assert.rejects(googlePlayer(undefined, "nonce"), /verified/);
  await assert.rejects(googlePlayer({ ...profile("bad", "bad@example.com"), email_verified: false }, "nonce"), /verified/);
  await assert.rejects(googlePlayer(profile("bad", "bad@example.com", "wrong"), "nonce"), /verified/);
  await prisma.user.create({ data: { username: "google_password", name: "Password User", email: "password@example.com", passwordHash: await hashPassword("Player123!") } });
  await assert.rejects(googlePlayer(profile("password-sub", "password@example.com"), "nonce"), /already has an account/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: "password@example.com" } })).googleSubject, null);
});

test("Google creates one player atomically and preserves progress on repeat sign-in and email changes", async () => {
  const results = await Promise.all([1, 2].map(() => googlePlayer(profile("google-repeat", "repeat@example.com"), "nonce")));
  assert.equal(results[0].id, results[1].id);
  assert.equal(results[0].role, "player"); assert.equal(results[0].donationTier, 0);
  assert.equal("passwordHash" in results[0], false);
  await prisma.user.update({ where: { id: results[0].id }, data: { gold: 1234 } });
  const again = await googlePlayer(profile("google-repeat", "changed@example.com"), "nonce");
  assert.equal(again.id, results[0].id);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: again.id } })).gold, 1234);
});

test("OAuth uses PKCE and nonce, rotates sessions, rejects state replay and handles provider errors", async (t) => {
  const oldId = process.env.GOOGLE_CLIENT_ID, oldSecret = process.env.GOOGLE_CLIENT_SECRET, oldRedirect = process.env.GOOGLE_REDIRECT_URI;
  t.after(() => { for (const [key, value] of [["GOOGLE_CLIENT_ID", oldId], ["GOOGLE_CLIENT_SECRET", oldSecret], ["GOOGLE_REDIRECT_URI", oldRedirect]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } });
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  const unavailable = await request(app).get("/api/auth/google").expect(302);
  assert.equal(unavailable.headers.location, `${env.corsOrigin}/login?googleError=unavailable`);
  process.env.GOOGLE_CLIENT_ID = "test-client"; process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REDIRECT_URI = `${env.corsOrigin}/api/auth/google/callback`;
  const agent = request.agent(app);
  const started = await agent.get("/api/auth/google").expect(302);
  const url = new URL(started.headers.location), state = url.searchParams.get("state")!, nonce = url.searchParams.get("nonce")!;
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), process.env.GOOGLE_REDIRECT_URI);
  assert.ok(state && nonce && url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  let exchanges = 0;
  t.mock.method(OAuth2Client.prototype, "getToken", async (options: { code: string; codeVerifier: string }) => {
    exchanges++; assert.equal(options.code, "test-code"); assert.ok(options.codeVerifier.length >= 43);
    return { tokens: { id_token: "verified-by-mocked-google" } };
  });
  t.mock.method(OAuth2Client.prototype, "verifyIdToken", async (options: { audience: string }) => {
    assert.equal(options.audience, "test-client");
    return { getPayload: () => profile("google-oauth", "oauth@example.com", nonce) };
  });
  await request(app).get(`/api/auth/google/callback?state=${state}&code=test-code`).expect(302).expect("Location", `${env.corsOrigin}/login?googleError=failed`);
  const result = await agent.get(`/api/auth/google/callback?state=${state}&code=test-code`).expect(302).expect("Location", `${env.corsOrigin}/dashboard`);
  assert.notEqual(String(started.headers["set-cookie"]), String(result.headers["set-cookie"]));
  const me = await agent.get("/api/auth/me").expect(200);
  assert.equal(me.body.data.user.role, "player");
  await agent.get(`/api/auth/google/callback?state=${state}&code=test-code`).expect(302).expect("Location", `${env.corsOrigin}/login?googleError=failed`);
  assert.equal(exchanges, 1);
  const cancelled = request.agent(app);
  await cancelled.get("/api/auth/google").expect(302);
  await cancelled.get("/api/auth/google/callback?error=access_denied").expect(302).expect("Location", `${env.corsOrigin}/login?googleError=failed`);
  const wrong = request.agent(app);
  await wrong.get("/api/auth/google").expect(302);
  await wrong.get(`/api/auth/google/callback?state=${"0".repeat(64)}&code=test-code`).expect(302).expect("Location", `${env.corsOrigin}/login?googleError=failed`);
  assert.equal(exchanges, 1);
});
