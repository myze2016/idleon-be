CREATE TABLE "gathering_rooms" (
  "id" SERIAL PRIMARY KEY,
  "capacity" INTEGER NOT NULL DEFAULT 12 CHECK ("capacity" BETWEEN 1 AND 24),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "gathering_members" (
  "user_id" VARCHAR(30) PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "room_id" INTEGER NOT NULL REFERENCES "gathering_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token" VARCHAR(36) NOT NULL,
  "x" DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK ("x" BETWEEN 0.05 AND 0.95),
  "y" DOUBLE PRECISION NOT NULL DEFAULT 0.7 CHECK ("y" BETWEEN 0.48 AND 0.9),
  "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "gathering_members_room_id_last_seen_idx" ON "gathering_members"("room_id", "last_seen");
CREATE TABLE "gathering_messages" (
  "id" VARCHAR(30) PRIMARY KEY,
  "room_id" INTEGER NOT NULL REFERENCES "gathering_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" VARCHAR(30) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "body" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "gathering_messages_room_id_created_at_idx" ON "gathering_messages"("room_id", "created_at");
CREATE TABLE "gathering_challenges" (
  "id" VARCHAR(30) PRIMARY KEY,
  "room_id" INTEGER NOT NULL REFERENCES "gathering_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "from_id" VARCHAR(30) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "to_id" VARCHAR(30) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "pvp_code" VARCHAR(10),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "gathering_challenges_room_id_expires_at_idx" ON "gathering_challenges"("room_id", "expires_at");
CREATE INDEX "gathering_challenges_to_id_status_idx" ON "gathering_challenges"("to_id", "status");
