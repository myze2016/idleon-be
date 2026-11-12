ALTER TABLE `users` ADD COLUMN `garnaland_unlocked` BOOLEAN NOT NULL DEFAULT false;

-- Honor Demon Prince victories already saved before this progression flag existed.
UPDATE `users` AS u
JOIN `encounters` AS boss ON boss.user_id = u.id AND boss.enemy_type = 'demon-prince'
JOIN `encounters` AS battle ON battle.id = COALESCE(boss.battle_id, boss.id)
SET u.garnaland_unlocked = true, u.tourney_spectator = NULL
WHERE JSON_EXTRACT(battle.result, '$.won') = true
   OR JSON_EXTRACT(battle.result,
      REPLACE(REPLACE(JSON_UNQUOTE(JSON_SEARCH(battle.result, 'one', boss.id, NULL, '$.enemies[*].id')), '.enemies', '.enemyHps'), '.id', '')) = 0;
