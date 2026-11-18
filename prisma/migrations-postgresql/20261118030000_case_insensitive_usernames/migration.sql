-- Preserve the former MySQL case-insensitive username uniqueness.
CREATE UNIQUE INDEX "users_username_case_insensitive_key" ON "users" (LOWER("username"));
