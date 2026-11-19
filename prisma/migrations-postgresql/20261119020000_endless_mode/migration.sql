CREATE TABLE "endless_settings" (
  "id" INTEGER PRIMARY KEY DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "config" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "endless_runs" (
  "id" VARCHAR(30) PRIMARY KEY,
  "request_key" VARCHAR(36) NOT NULL UNIQUE,
  "user_id" VARCHAR(30) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "season" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "wave" INTEGER NOT NULL DEFAULT 1 CHECK ("wave" >= 1),
  "best_wave" INTEGER NOT NULL DEFAULT 0 CHECK ("best_wave" >= 0),
  "team" JSONB NOT NULL,
  "settings" JSONB NOT NULL,
  "balance" JSONB NOT NULL,
  "pending" JSONB,
  "ready_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "endless_runs_user_id_status_idx" ON "endless_runs"("user_id", "status");
CREATE TABLE "endless_scores" (
  "user_id" VARCHAR(30) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "season" INTEGER NOT NULL,
  "best_wave" INTEGER NOT NULL,
  "achieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "season")
);
CREATE INDEX "endless_scores_season_best_wave_achieved_at_idx" ON "endless_scores"("season", "best_wave", "achieved_at");
CREATE UNIQUE INDEX "endless_runs_one_active_per_user" ON "endless_runs"("user_id") WHERE "status" = 'active';
