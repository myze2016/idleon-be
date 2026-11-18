ALTER TABLE "users" ADD COLUMN "donation_tier" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_donation_tier_range" CHECK ("donation_tier" BETWEEN 0 AND 3);
CREATE TABLE "donation_tier_changes" (
  "id" VARCHAR(30) NOT NULL PRIMARY KEY,
  "user_id" VARCHAR(30) NOT NULL,
  "admin_id" VARCHAR(30) NOT NULL,
  "from_tier" INTEGER NOT NULL CHECK ("from_tier" BETWEEN 0 AND 3),
  "to_tier" INTEGER NOT NULL CHECK ("to_tier" BETWEEN 0 AND 3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "donation_tier_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "donation_tier_changes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "donation_tier_changes_user_id_created_at_idx" ON "donation_tier_changes"("user_id", "created_at");
