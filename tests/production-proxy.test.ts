import "./setup.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("production login sets secure cookies behind the configured HTTPS proxy", () => {
  const script = `
    import assert from 'node:assert/strict';
    import request from 'supertest';
    import { app } from './src/app.ts';
    import { prisma } from './src/lib/prisma.ts';
    try {
      assert.equal(app.get('trust proxy'), 1);
      const response = await request(app).post('/api/auth/login')
        .set('Origin', 'https://frontend.example').set('X-Forwarded-Proto', 'https')
        .send({username:'admin',password:'Admin123!'}).expect(200);
      const cookies = String(response.headers['set-cookie']);
      assert.match(cookies, /HttpOnly/); assert.match(cookies, /Secure/); assert.match(cookies, /SameSite=Lax/);
      const insecure = await request(app).post('/api/auth/login').set('Origin', 'https://frontend.example')
        .send({username:'admin',password:'Admin123!'}).expect(200);
      assert.equal(insecure.headers['set-cookie'], undefined);
      await request(app).post('/api/auth/login').set('Origin','https://other.example')
        .set('X-Forwarded-Proto','https').send({username:'admin',password:'Admin123!'}).expect(403);
    } finally { await prisma.$disconnect(); }
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", CORS_ORIGIN: "https://frontend.example", SESSION_SECRET: "production-proxy-test-only-secret", TRUST_PROXY_HOPS: "1" }, encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
