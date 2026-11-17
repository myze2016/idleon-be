-- Upgrade only the existing admin test account. Password and player accounts are untouched.
UPDATE `users`
SET `gold` = GREATEST(`gold`, 100000000),
    `wish_currency` = GREATEST(`wish_currency`, 1000000),
    `garnaland_unlocked` = TRUE,
    `deep_sea_floor` = GREATEST(`deep_sea_floor`, 3),
    `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `username` = 'admin' AND `role` = 'admin';

INSERT INTO `quest_items` (`user_id`, `item_id`, `acquired_at`)
SELECT u.`id`, q.`item_id`, CURRENT_TIMESTAMP(3)
FROM `users` u
CROSS JOIN (
  SELECT 'deepsea-moth-map' AS `item_id`
  UNION ALL SELECT 'zugwangs-evidence'
) q
WHERE u.`username` = 'admin' AND u.`role` = 'admin'
AND NOT EXISTS (
  SELECT 1 FROM `quest_items` owned
  WHERE owned.`user_id` = u.`id` AND owned.`item_id` = q.`item_id`
);

INSERT INTO `characters` (`id`, `user_id`, `name`, `weapon`, `is_starter`, `skill_2_unlocked`, `upgrade_level`, `created_at`, `updated_at`)
SELECT LEFT(SHA2(CONCAT(u.`id`, ':admin-test:', roster.`weapon`), 256), 30),
       u.`id`, roster.`name`, roster.`weapon`, FALSE, TRUE, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `users` u
CROSS JOIN (
  SELECT 'sword-and-shield' AS `weapon`, 'Sword and Shield' AS `name`
  UNION ALL SELECT 'bow', 'Bow'
  UNION ALL SELECT 'wand', 'Wand'
  UNION ALL SELECT 'staff', 'Staff'
  UNION ALL SELECT 'book', 'Book'
  UNION ALL SELECT 'spear', 'Spear'
  UNION ALL SELECT 'axe', 'Axe'
  UNION ALL SELECT 'rifle', 'Rifle'
  UNION ALL SELECT 'dual-gun', 'Dual Gun'
  UNION ALL SELECT 'great-sword', 'Great Sword'
  UNION ALL SELECT 'dual-knife', 'Assassin'
  UNION ALL SELECT 'glaive', 'Kent'
  UNION ALL SELECT 'ice-staff', 'Juan'
  UNION ALL SELECT 'dual-axe', 'Jeffrey'
) roster
WHERE u.`username` = 'admin' AND u.`role` = 'admin'
AND NOT EXISTS (
  SELECT 1 FROM `characters` owned
  WHERE owned.`user_id` = u.`id` AND owned.`weapon` = roster.`weapon`
);

-- Keep an existing starter. Supply one if this account never created a character.
UPDATE `characters` c
JOIN `users` u ON u.`id` = c.`user_id`
LEFT JOIN `characters` starter ON starter.`user_id` = u.`id` AND starter.`is_starter` = TRUE
SET c.`is_starter` = TRUE, c.`updated_at` = CURRENT_TIMESTAMP(3)
WHERE u.`username` = 'admin' AND u.`role` = 'admin'
  AND starter.`id` IS NULL AND c.`weapon` = 'sword-and-shield';

UPDATE `characters` c
JOIN `users` u ON u.`id` = c.`user_id`
SET c.`skill_2_unlocked` = TRUE, c.`updated_at` = CURRENT_TIMESTAMP(3)
WHERE u.`username` = 'admin' AND u.`role` = 'admin';

UPDATE `users` SET `starter_created` = TRUE
WHERE `username` = 'admin' AND `role` = 'admin';
