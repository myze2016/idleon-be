ALTER TABLE "users" ADD COLUMN "email" VARCHAR(254);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE TABLE "registration_codes" (
  "email" VARCHAR(254) NOT NULL,
  "code_hash" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "registration_codes_pkey" PRIMARY KEY ("email")
);
