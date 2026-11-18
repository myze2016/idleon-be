# Wish QR payments

Players buy **100 wish currency for PHP 10.00** (1000 centavos), using a dynamic PayMongo QR Ph code compatible with GCash. Existing dependencies suffice: Node fetch/crypto, Prisma, and express-rate-limit; no third-party PayMongo SDK or QR package is required.

## Setup

1. Run `npm run db:generate` and `npm run db:deploy` in `idleon-be`.
2. Add `PAYMONGO_SECRET_KEY=sk_test_...` to the backend `.env`. Enable QR Ph in your PayMongo merchant account. Never put the secret in a `NEXT_PUBLIC_` variable.
3. Expose the backend via HTTPS (for local testing, use an HTTPS tunnel to port 8020). Register `https://YOUR-API-HOST/api/payments/paymongo/webhook` in PayMongo Developers → Webhooks, subscribed to `payment.paid`. Copy that endpoint's signing secret into backend `PAYMONGO_WEBHOOK_SECRET`.
4. Restart the backend. Open Wish → Buy 100 Wish. Test mode is visibly labeled; no real GCash transfer is required in test mode. Use PayMongo's supported test payment workflow.
5. After a successful end-to-end test, use a live secret key and a webhook registered in live mode with its own signing secret. Real payments require an activated merchant account and QR Ph capability. The player pays PHP 10; merchant fees are deducted from your proceeds.

API keys and webhook secrets are intentionally not populated by this change. Without them, purchases are disabled. No real charge is created until the player generates a QR and pays it.

## Security and recovery

- Authenticated, origin-checked and rate-limited creation; account-owned status endpoints. A UUID request key makes retries reuse an order. Active unexpired orders are recovered when reopening the panel.
- Amount, currency and wish credit are server constants. Client-supplied purchase fields are rejected.
- Webhooks authenticate original raw bytes using HMAC-SHA256, constant-time comparison, test/live mode and a five-minute timestamp window.
- Payment state is independently fetched from PayMongo. Intent ID, order metadata, amount, currency, mode, paid status and QR Ph source are checked before crediting.
- Currency increment and the order's credited marker are committed in one database transaction with an account lock. Unique payment/event IDs and the conditional credited marker prevent double credit under retries/concurrent delivery.
- Signed notifications are acknowledged only after processing; failures return non-2xx so PayMongo can retry. Authenticated status checks also reconcile missed notifications directly with PayMongo, including late payments on expired codes.
- Orders remain as an audit trail; do not delete paid orders. A game's existing character reset still resets game balances, so resetting characters after a purchase also clears remaining wish currency.
- A timeout before an intent is attached can leave a creating order until its 15-minute expiry. An attached QR can be recovered by checking status. Do not start a second payment just because a request timed out.

## Validation

`npm test` uses an isolated disposable database. Payment tests mock PayMongo (no outbound charges) and cover ownership, authentication, CSRF/origin checks, fixed price, request reuse, invalid/stale/mode-mismatched signatures, mismatched payment details, and concurrent duplicate webhooks awarding exactly 100 currency.

Official references: [QR Ph API](https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api), [webhook signatures and setup](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management).
