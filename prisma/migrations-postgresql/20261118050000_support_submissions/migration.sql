CREATE TABLE "support_settings" (
  "id" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY CHECK ("id" = 1),
  "qr_image" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "support_submissions" (
  "id" VARCHAR(30) NOT NULL PRIMARY KEY,
  "user_id" VARCHAR(30) NOT NULL,
  "tier" INTEGER NOT NULL CHECK ("tier" BETWEEN 1 AND 3),
  "amount" INTEGER NOT NULL,
  "phone" VARCHAR(16) NOT NULL,
  "reference" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "reviewed_by_id" VARCHAR(30),
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_submissions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "support_submissions_reference_key" ON "support_submissions"("reference");
CREATE INDEX "support_submissions_status_created_at_idx" ON "support_submissions"("status", "created_at");
CREATE INDEX "support_submissions_user_id_created_at_idx" ON "support_submissions"("user_id", "created_at");
