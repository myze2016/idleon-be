import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";

test("health endpoint returns API status and security headers", async () => {
  const response = await request(app).get("/api/health").expect(200);
  assert.equal(response.body.data.status, "ok");
  assert.equal(typeof response.body.data.uptime, "number");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("unknown endpoints return a JSON 404", async () => {
  const response = await request(app).get("/missing").expect(404);
  assert.deepEqual(response.body, { error: { message: "Route not found" } });
});

test("invalid JSON returns a safe 400 response", async () => {
  const response = await request(app).post("/api/health")
    .set("Content-Type", "application/json").send('{"invalid":').expect(400);
  assert.deepEqual(response.body, { error: { message: "Invalid JSON body" } });
});
