import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/utils/password.js";
import { verifyPaymongoSignature, type PaymentResource } from "../src/services/paymongo.service.js";
import { creditVerifiedPayment } from "../src/repositories/payment.repository.js";

test("QR orders enforce fixed price, authenticated ownership, signed webhooks and exactly-once credit", async () => {
  const oldFetch = globalThis.fetch, oldKey = process.env.PAYMONGO_SECRET_KEY, oldSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  process.env.PAYMONGO_SECRET_KEY = "sk_test_mock";
  process.env.PAYMONGO_WEBHOOK_SECRET = "test-webhook-secret";
  let intent: PaymentResource;
  let remoteCreates = 0;
  globalThis.fetch = (async (input, options) => {
    const path = String(input).replace("https://api.paymongo.com/v1/", "");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Basic ${Buffer.from("sk_test_mock:").toString("base64")}`);
    const body = options?.body ? JSON.parse(String(options.body)).data.attributes : undefined;
    if (path === "payment_intents") {
      remoteCreates++;
      assert.equal(body.amount, 1000); assert.equal(body.currency, "PHP"); assert.deepEqual(body.payment_method_allowed, ["qrph"]);
      intent = { id: "pi_mock", attributes: { ...body, status: "awaiting_payment_method", livemode: false, client_key: "not-for-browser" } };
    } else if (path === "payment_methods") {
      assert.equal(body.type, "qrph"); assert.equal(body.expiry_seconds, 900);
      return Response.json({ data: { id: "pm_mock", attributes: {} } });
    } else if (path === "payment_intents/pi_mock/attach") {
      intent!.attributes.status = "awaiting_next_action";
      intent!.attributes.next_action = { code: { image_url: "data:image/png;base64,aGVsbG8=" } };
    } else if (path === "payments/pay_mock") {
      return Response.json({ data: { id: "pay_mock", attributes: { payment_intent_id: "pi_mock" } } });
    } else assert.equal(path, "payment_intents/pi_mock");
    return Response.json({ data: intent! });
  }) as typeof fetch;
  try {
    await prisma.user.create({ data: { id: "payment-owner", username: "payment-owner", name: "Buyer", passwordHash: await hashPassword("Test123!") } });
    await prisma.user.create({ data: { id: "payment-other", username: "payment-other", name: "Other", passwordHash: await hashPassword("Test123!") } });
    const buyer = request.agent(app), other = request.agent(app);
    for (const [agent, username] of [[buyer, "payment-owner"], [other, "payment-other"]] as const) await agent.post("/api/auth/login").set("Origin", env.corsOrigin).send({ username, password: "Test123!" }).expect(200);
    await request(app).post("/api/payments/wish").expect(401);
    await buyer.post("/api/payments/wish").set("Idempotency-Key", randomUUID()).expect(403);
    await buyer.post("/api/payments/wish").set("Origin", "https://evil.example").expect(403);
    await buyer.post("/api/payments/wish").set("Origin", env.corsOrigin).set("Idempotency-Key", randomUUID()).send({ amount: 1, wishes: 99999 }).expect(400);
    const key = randomUUID();
    const concurrent = await Promise.all([key, randomUUID()].map((requestKey) => buyer.post("/api/payments/wish").set("Origin", env.corsOrigin).set("Idempotency-Key", requestKey).expect(201)));
    assert.equal(concurrent[0].body.data.id, concurrent[1].body.data.id);
    const created = concurrent.find((response) => response.body.data.status === "pending")!;
    assert.ok(created);
    const id = created.body.data.id;
    assert.equal(created.body.data.amount, 1000); assert.equal(created.body.data.wishes, 100); assert.equal(created.body.data.testMode, true);
    assert.equal(created.body.data.status, "pending"); assert.ok(created.body.data.qrImage);
    assert.equal(JSON.stringify(created.body).includes("client_key"), false);
    const duplicate = await buyer.post("/api/payments/wish").set("Origin", env.corsOrigin).set("Idempotency-Key", key).expect(201);
    assert.equal(duplicate.body.data.id, id); assert.equal(remoteCreates, 1);
    await other.get(`/api/payments/wish/${id}`).expect(404);
    const pending = await buyer.get(`/api/payments/wish/${id}`).expect(200);
    assert.equal(pending.body.data.status, "pending");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "payment-owner" } })).wishCurrency, 0);
    const raw = JSON.stringify({ data: { id: "evt_mock", attributes: { type: "payment.paid", livemode: false, data: { id: "pay_mock" } } } });
    const t = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "test-webhook-secret").update(`${t}.${raw}`).digest("hex");
    const signed = `t=${t},te=${signature},li=`;
    await request(app).post("/api/payments/paymongo/webhook").set("Content-Type", "application/json").send(raw).expect(400);
    assert.throws(() => verifyPaymongoSignature(Buffer.from(raw + " "), signed));
    assert.throws(() => verifyPaymongoSignature(Buffer.from(raw), signed, Date.now() + 600000));
    assert.throws(() => verifyPaymongoSignature(Buffer.from(raw), `t=${t},te=,li=${signature}`));
    intent!.attributes.status = "succeeded";
    intent!.attributes.payments = [{ id: "pay_mock", attributes: { status: "paid", amount: 1000, currency: "PHP", livemode: false, source: { type: "qrph" } } }];
    const order = await prisma.wishPayment.findUniqueOrThrow({ where: { id } });
    for (const invalid of [
      { ...intent!, attributes: { ...intent!.attributes, amount: 10 } },
      { ...intent!, attributes: { ...intent!.attributes, currency: "USD" } },
      { ...intent!, attributes: { ...intent!.attributes, livemode: true } },
      { ...intent!, attributes: { ...intent!.attributes, metadata: { order_id: "someone-else" } } },
      { ...intent!, attributes: { ...intent!.attributes, payments: [] } },
    ]) await assert.rejects(() => creditVerifiedPayment(order, invalid));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: order.userId } })).wishCurrency, 0);
    // Concurrent delivery, replay and browser reconciliation all race for the same credit.
    const deliveries = await Promise.all([1, 2, 3].map(() => request(app).post("/api/payments/paymongo/webhook").set("Content-Type", "application/json").set("Paymongo-Signature", signed).send(raw)));
    deliveries.forEach((delivery) => assert.equal(delivery.status, 200, JSON.stringify(delivery.body)));
    const paid = await buyer.get(`/api/payments/wish/${id}`).expect(200);
    assert.equal(paid.body.data.status, "paid"); assert.equal(paid.body.data.qrImage, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: order.userId } })).wishCurrency, 100);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "payment-other" } })).wishCurrency, 0);
    const saved = await prisma.wishPayment.findUniqueOrThrow({ where: { id } });
    assert.equal(saved.paymentId, "pay_mock"); assert.ok(saved.creditedAt);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.PAYMONGO_WEBHOOK_SECRET; else process.env.PAYMONGO_WEBHOOK_SECRET = oldSecret;
  }
});
