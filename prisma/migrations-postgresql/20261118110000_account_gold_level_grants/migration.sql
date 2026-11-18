CREATE TABLE "account_grants" (
  "request_key" VARCHAR(36) PRIMARY KEY,
  "admin_id" VARCHAR(30) NOT NULL,
  "kind" VARCHAR(10) NOT NULL CHECK ("kind" IN ('gold', 'levels')),
  "amount" INTEGER NOT NULL CHECK ("amount" >= 1),
  "target_user_id" VARCHAR(30),
  "donation_tier" INTEGER CHECK ("donation_tier" BETWEEN 0 AND 3),
  "recipients_hash" VARCHAR(64),
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "account_grant_entries" (
  "id" VARCHAR(30) PRIMARY KEY,
  "request_key" VARCHAR(36) NOT NULL REFERENCES "account_grants"("request_key") ON DELETE RESTRICT ON UPDATE CASCADE,
  "user_id" VARCHAR(30) NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "gold_before" INTEGER NOT NULL, "gold_after" INTEGER NOT NULL,
  "experience_before" INTEGER NOT NULL, "experience_after" INTEGER NOT NULL,
  "wish_before" INTEGER NOT NULL, "wish_after" INTEGER NOT NULL,
  "level_before" INTEGER NOT NULL, "level_after" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "account_grant_entries_request_key_user_id_key" ON "account_grant_entries"("request_key", "user_id");
CREATE INDEX "account_grant_entries_user_id_idx" ON "account_grant_entries"("user_id");
