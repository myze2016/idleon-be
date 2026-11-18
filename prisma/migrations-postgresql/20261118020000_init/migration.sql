-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'player');

-- CreateEnum
CREATE TYPE "Weapon" AS ENUM ('sword-and-shield', 'bow', 'wand', 'staff', 'book', 'spear', 'axe', 'rifle', 'dual-gun', 'great-sword', 'dual-knife', 'glaive', 'ice-staff', 'dual-axe');

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(30) NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'player',
    "starter_created" BOOLEAN NOT NULL DEFAULT false,
    "wish_currency" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "meadow_defeats" INTEGER NOT NULL DEFAULT 0,
    "meadow_boss_at" INTEGER,
    "tourney_defeats" INTEGER NOT NULL DEFAULT 0,
    "tourney_boss_at" INTEGER,
    "tourney_spectator" JSONB,
    "garnaland_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "deep_sea_floor" INTEGER NOT NULL DEFAULT 1,
    "deep_sea_progress" JSONB,
    "harbor_defeats" INTEGER NOT NULL DEFAULT 0,
    "harbor_boss_at" INTEGER,
    "forest_defeats" INTEGER NOT NULL DEFAULT 0,
    "forest_boss_at" INTEGER,
    "expedition_vitals" JSONB,
    "team_slots" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_rooms" (
    "id" VARCHAR(30) NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "host_id" VARCHAR(30) NOT NULL,
    "guest_id" VARCHAR(30),
    "host_character_id" VARCHAR(30),
    "guest_character_id" VARCHAR(30),
    "host_character_ids" JSONB,
    "guest_character_ids" JSONB,
    "host_ready" BOOLEAN NOT NULL DEFAULT false,
    "guest_ready" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'waiting',
    "starts_at" TIMESTAMP(3),
    "result" JSONB,
    "messages" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pvp_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_items" (
    "user_id" VARCHAR(30) NOT NULL,
    "item_id" VARCHAR(40) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quest_items_pkey" PRIMARY KEY ("user_id","item_id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" VARCHAR(30) NOT NULL,
    "user_id" VARCHAR(30) NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "weapon" "Weapon" NOT NULL,
    "is_starter" BOOLEAN NOT NULL DEFAULT false,
    "skill_2_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "upgrade_level" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "enhancement_level" INTEGER NOT NULL DEFAULT 0,
    "id" VARCHAR(30) NOT NULL,
    "user_id" VARCHAR(30) NOT NULL,
    "stat" VARCHAR(16) NOT NULL,
    "character_id" VARCHAR(30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" VARCHAR(128) NOT NULL,
    "data" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wish_payments" (
    "id" VARCHAR(30) NOT NULL,
    "user_id" VARCHAR(30) NOT NULL,
    "request_key" VARCHAR(36) NOT NULL,
    "intent_id" VARCHAR(80),
    "payment_id" VARCHAR(80),
    "event_id" VARCHAR(80),
    "amount" INTEGER NOT NULL DEFAULT 1000,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "wishes" INTEGER NOT NULL DEFAULT 100,
    "livemode" BOOLEAN NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'creating',
    "qr_image" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "credited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wish_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" VARCHAR(30) NOT NULL,
    "user_id" VARCHAR(30) NOT NULL,
    "enemy_type" VARCHAR(24) NOT NULL,
    "location" VARCHAR(16) NOT NULL DEFAULT 'meadow',
    "battle_id" VARCHAR(30),
    "team_ids" JSONB NOT NULL,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_rooms_code_key" ON "pvp_rooms"("code");

-- CreateIndex
CREATE INDEX "pvp_rooms_host_id_status_idx" ON "pvp_rooms"("host_id", "status");

-- CreateIndex
CREATE INDEX "pvp_rooms_guest_id_status_idx" ON "pvp_rooms"("guest_id", "status");

-- CreateIndex
CREATE INDEX "characters_user_id_created_at_idx" ON "characters"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_character_id_key" ON "artifacts"("character_id");

-- CreateIndex
CREATE INDEX "artifacts_user_id_created_at_idx" ON "artifacts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "wish_payments_request_key_key" ON "wish_payments"("request_key");

-- CreateIndex
CREATE UNIQUE INDEX "wish_payments_intent_id_key" ON "wish_payments"("intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "wish_payments_payment_id_key" ON "wish_payments"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "wish_payments_event_id_key" ON "wish_payments"("event_id");

-- CreateIndex
CREATE INDEX "wish_payments_user_id_created_at_idx" ON "wish_payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "encounters_user_id_created_at_idx" ON "encounters"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "pvp_rooms" ADD CONSTRAINT "pvp_rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_rooms" ADD CONSTRAINT "pvp_rooms_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_items" ADD CONSTRAINT "quest_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wish_payments" ADD CONSTRAINT "wish_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_gold_nonnegative" CHECK ("gold" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_experience_nonnegative" CHECK ("experience" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_meadow_defeats_nonnegative" CHECK ("meadow_defeats" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_meadow_boss_at_nonnegative" CHECK ("meadow_boss_at" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_tourney_defeats_nonnegative" CHECK ("tourney_defeats" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_tourney_boss_at_nonnegative" CHECK ("tourney_boss_at" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_deep_sea_floor_nonnegative" CHECK ("deep_sea_floor" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_harbor_defeats_nonnegative" CHECK ("harbor_defeats" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_harbor_boss_at_nonnegative" CHECK ("harbor_boss_at" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_forest_defeats_nonnegative" CHECK ("forest_defeats" >= 0);

ALTER TABLE "users" ADD CONSTRAINT "users_forest_boss_at_nonnegative" CHECK ("forest_boss_at" >= 0);

ALTER TABLE "characters" ADD CONSTRAINT "characters_upgrade_level_nonnegative" CHECK ("upgrade_level" >= 0);

ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_enhancement_level_nonnegative" CHECK ("enhancement_level" >= 0);
