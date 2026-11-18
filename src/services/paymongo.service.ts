import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../utils/http-error.js";

export const WISH_PRICE = 1000; // PHP centavos
export const WISH_CREDIT = 100;

export function paymentConfig() {
  const secret = process.env.PAYMONGO_SECRET_KEY ?? "";
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET ?? "";
  if (!/^sk_(test|live)_\S+$/.test(secret) || !webhookSecret) {
    throw new HttpError(503, "QR payments are not configured yet. Please try again later.");
  }
  return { secret, webhookSecret, livemode: secret.startsWith("sk_live_") };
}

export interface PaymentResource {
  id: string;
  attributes: {
    amount: number; currency: string; status: string; livemode: boolean;
    payment_intent_id?: string; source?: { type?: string };
    metadata?: { order_id?: string };
    client_key?: string;
    next_action?: { code?: { image_url?: string } };
    payments?: PaymentResource[];
  };
}

export async function paymongo(path: string, attributes?: object, idempotencyKey?: string): Promise<PaymentResource> {
  const { secret } = paymentConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.paymongo.com/v1/${path}`, {
      method: attributes ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(attributes ? { body: JSON.stringify({ data: { attributes } }) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(502, "Payment provider is unavailable. Check this order again before starting another payment."); }
  // Never relay provider payloads, credentials, or customer details to logs/the browser.
  if (!response.ok) throw new HttpError(502, "PayMongo could not process this request. Please try again later.");
  const body = await response.json() as { data?: PaymentResource };
  if (!body.data?.id || !body.data.attributes) throw new HttpError(502, "Invalid payment provider response");
  return body.data;
}

export function verifyPaymongoSignature(raw: Buffer, header: string | undefined, now = Date.now()) {
  const { webhookSecret, livemode } = paymentConfig();
  const parts = Object.fromEntries((header ?? "").split(",").map((part) => part.trim().split("=")));
  const timestamp = parts.t;
  const signature = parts[livemode ? "li" : "te"] ?? "";
  if (!/^\d+$/.test(timestamp ?? "") || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new HttpError(400, "Invalid payment signature");
  }
  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.`).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new HttpError(400, "Invalid payment signature");
}
