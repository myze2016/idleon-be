CREATE TABLE "game_balance" (
  "id" INTEGER PRIMARY KEY DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 0,
  "config" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_balance_singleton" CHECK ("id" = 1 AND "version" >= 0)
);
CREATE TABLE "balance_revisions" (
  "id" SERIAL PRIMARY KEY,
  "adminId" VARCHAR(30) NOT NULL,
  "note" VARCHAR(300) NOT NULL,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
