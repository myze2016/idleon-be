import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";

test("admin login, session persistence, and logout", async () => {
  const agent = request.agent(app);
  await agent.get("/api/auth/me").expect(401);
  const login = await agent.post("/api/auth/login").set("Origin", env.corsOrigin)
    .send({ username: "admin", password: "Admin123!" }).expect(200);
  assert.equal(login.body.data.user.role, "admin");
  assert.equal(login.body.data.user.password, undefined);
  assert.match(String(login.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(login.headers["set-cookie"]), /SameSite=Lax/);
  const me = await agent.get("/api/auth/me").expect(200);
  assert.equal(me.body.data.user.username, "admin");
  assert.equal(me.headers["cache-control"], "no-store");
  await agent.post("/api/auth/logout").set("Origin", env.corsOrigin).expect(204);
  await agent.get("/api/auth/me").expect(401);
});

test("invalid credentials and malformed fields cannot create a session", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin)
    .send({ username: "admin", password: "wrong" }).expect(401);
  await agent.post("/api/auth/login").set("Origin", env.corsOrigin)
    .send({ username: {}, password: "Admin123!" }).expect(400);
  await agent.get("/api/auth/me").expect(401);
});

test("cross-origin login and logout are rejected", async () => {
  for (const path of ["login", "logout"]) {
    await request(app).post(`/api/auth/${path}`).set("Origin", "https://other.example")
      .send({ username: "admin", password: "Admin123!" }).expect(403);
  }
});

test("repeated failed logins are rate limited", async () => {
  let status = 0;
  for (let i = 0; i < 11; i++) {
    const response = await request(app).post("/api/auth/login").set("Origin", env.corsOrigin)
      .send({ username: "admin", password: "wrong" });
    status = response.status;
  }
  assert.equal(status, 429);
});
