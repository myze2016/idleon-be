CREATE TABLE "wish_currency_grants" (
  "id" VARCHAR(30) NOT NULL PRIMARY KEY,
  "request_key" VARCHAR(36) NOT NULL,
  "user_id" VARCHAR(30) NOT NULL,
  "admin_id" VARCHAR(30) NOT NULL,
  "amount" INTEGER NOT NULL CHECK ("amount" BETWEEN 1 AND 1000000),
  "balance_before" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wish_currency_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wish_currency_grants_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "wish_currency_grants_request_key_key" ON "wish_currency_grants"("request_key");
CREATE INDEX "wish_currency_grants_user_id_created_at_idx" ON "wish_currency_grants"("user_id", "created_at");
