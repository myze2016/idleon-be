CREATE TABLE "wish_currency_batches" (
  "request_key" VARCHAR(36) PRIMARY KEY,
  "admin_id" VARCHAR(30) NOT NULL,
  "donation_tier" INTEGER NOT NULL CHECK ("donation_tier" BETWEEN 0 AND 3),
  "amount" INTEGER NOT NULL CHECK ("amount" BETWEEN 1 AND 1000000),
  "recipients_hash" VARCHAR(64) NOT NULL,
  "recipient_ids" JSONB NOT NULL,
  "recipient_count" INTEGER NOT NULL CHECK ("recipient_count" BETWEEN 1 AND 10000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "wish_currency_grants" ADD COLUMN "batch_id" VARCHAR(36);
ALTER TABLE "wish_currency_grants" ADD CONSTRAINT "wish_currency_grants_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "wish_currency_batches"("request_key") ON DELETE RESTRICT ON UPDATE CASCADE;
