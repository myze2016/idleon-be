import { Prisma, type WishPayment } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { paymongo, paymentConfig, WISH_CREDIT, WISH_PRICE, type PaymentResource } from "../services/paymongo.service.js";

export function paymentView(order: WishPayment) {
  const expired = order.status !== "paid" && order.expiresAt.getTime() <= Date.now();
  return {
    id: order.id, status: expired ? "expired" : order.status,
    amount: order.amount, currency: order.currency, wishes: order.wishes,
    testMode: !order.livemode, expiresAt: order.expiresAt.toISOString(),
    qrImage: !expired && order.status === "pending" ? order.qrImage : null,
  };
}

export async function createWishPayment(userId: string, requestKey: string) {
  const { livemode } = paymentConfig();
  const previous = await prisma.wishPayment.findUnique({ where: { requestKey } });
  if (previous) {
    if (previous.userId !== userId) throw new HttpError(409, "Payment request already exists");
    return paymentView(previous);
  }
  let order: WishPayment;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const active = await tx.wishPayment.findFirst({ where: { userId, livemode, status: { in: ["creating", "pending"] }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      if (active) return { order: active, created: false };
      return { order: await tx.wishPayment.create({ data: { userId, requestKey, livemode, expiresAt: new Date(Date.now() + 15 * 60 * 1000) } }), created: true };
    });
    if (!result.created) return paymentView(result.order);
    order = result.order;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.wishPayment.findUniqueOrThrow({ where: { requestKey } });
      if (existing.userId !== userId) throw new HttpError(409, "Payment request already exists");
      return paymentView(existing);
    }
    throw error;
  }
  // Persist before each remote step so an interrupted request can still be reconciled.
  const intent = await paymongo("payment_intents", {
    amount: WISH_PRICE, currency: "PHP", payment_method_allowed: ["qrph"],
    description: "100 Wish Currency", metadata: { order_id: order.id },
  }, `${order.id}-intent`);
  await prisma.wishPayment.update({ where: { id: order.id }, data: { intentId: intent.id } });
  const method = await paymongo("payment_methods", { type: "qrph", expiry_seconds: 900 }, `${order.id}-method`);
  const attached = await paymongo(`payment_intents/${encodeURIComponent(intent.id)}/attach`, {
    payment_method: method.id, client_key: intent.attributes.client_key,
  }, `${order.id}-attach`);
  const image = attached.attributes.next_action?.code?.image_url;
  if (attached.id !== intent.id || !image || !/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(image)) {
    throw new HttpError(502, "QR code is unavailable. Check this order again before creating another payment.");
  }
  await prisma.wishPayment.updateMany({ where: { id: order.id, status: "creating" }, data: { qrImage: image, status: "pending" } });
  return paymentView(await prisma.wishPayment.findUniqueOrThrow({ where: { id: order.id } }));
}

export async function creditVerifiedPayment(order: WishPayment, intent: PaymentResource, eventId?: string) {
  const attributes = intent.attributes;
  if (intent.id !== order.intentId || attributes.amount !== WISH_PRICE || attributes.currency !== "PHP"
    || attributes.livemode !== order.livemode || attributes.metadata?.order_id !== order.id
    || order.amount !== WISH_PRICE || order.wishes !== WISH_CREDIT) {
    throw new HttpError(409, "Payment details do not match the order");
  }
  if (attributes.status !== "succeeded") return;
  const paid = attributes.payments?.find((payment) => payment.attributes.status === "paid");
  if (!paid || paid.attributes.amount !== WISH_PRICE || paid.attributes.currency !== "PHP"
    || paid.attributes.livemode !== order.livemode || paid.attributes.source?.type !== "qrph") {
    throw new HttpError(409, "Payment has not been verified");
  }
  await prisma.$transaction(async (tx) => {
    // Lock the account before the order, matching the game's other currency transactions.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${order.userId} FOR UPDATE`;
    const credited = await tx.wishPayment.updateMany({ where: { id: order.id, creditedAt: null }, data: {
      status: "paid", creditedAt: new Date(), paymentId: paid.id, ...(eventId ? { eventId } : {}), qrImage: null,
    } });
    if (credited.count) await tx.user.update({ where: { id: order.userId }, data: { wishCurrency: { increment: WISH_CREDIT } } });
  });
}

export async function reconcilePayment(order: WishPayment, eventId?: string) {
  if (order.creditedAt || !order.intentId) return;
  const intent = await paymongo(`payment_intents/${encodeURIComponent(order.intentId)}`);
  await creditVerifiedPayment(order, intent, eventId);
  const image = intent.attributes.next_action?.code?.image_url;
  if (order.status === "creating" && intent.attributes.status === "awaiting_next_action" && image && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(image)) {
    await prisma.wishPayment.updateMany({ where: { id: order.id, status: "creating" }, data: { status: "pending", qrImage: image } });
  }
}

export async function getWishPayment(userId: string, id: string) {
  const order = await prisma.wishPayment.findFirst({ where: { id, userId } });
  if (!order) throw new HttpError(404, "Payment not found");
  await reconcilePayment(order);
  return paymentView(await prisma.wishPayment.findUniqueOrThrow({ where: { id } }));
}

export async function processPaymentEvent(event: { id?: string; attributes?: { type?: string; livemode?: boolean; data?: PaymentResource } }) {
  if (event.attributes?.livemode !== paymentConfig().livemode) throw new HttpError(400, "Incorrect payment mode");
  if (event.attributes.type !== "payment.paid") return;
  const resource = event.attributes.data;
  if (!event.id || !resource?.id) throw new HttpError(400, "Invalid payment event");
  // Fetch the payment independently; never use webhook/browser amounts as proof of payment.
  const payment = await paymongo(`payments/${encodeURIComponent(resource.id)}`);
  const intentId = payment.attributes.payment_intent_id;
  if (!intentId) return;
  const order = await prisma.wishPayment.findUnique({ where: { intentId } });
  if (order) await reconcilePayment(order, event.id);
}
