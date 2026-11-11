ALTER TABLE `users` ADD COLUMN `team_slots` JSON NULL;
UPDATE `users` u SET `team_slots` = JSON_ARRAY(
  (SELECT c.id FROM characters c WHERE c.user_id = u.id AND c.is_starter = true ORDER BY c.created_at, c.id LIMIT 1),
  NULL, NULL, NULL, NULL, NULL
);
