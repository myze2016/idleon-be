UPDATE `users` SET
  `meadow_boss_at` = CASE WHEN `meadow_boss_at` BETWEEN 25 AND 30 THEN `meadow_boss_at` * 3 ELSE `meadow_boss_at` END,
  `forest_boss_at` = CASE WHEN `forest_boss_at` BETWEEN 25 AND 30 THEN `forest_boss_at` * 3 ELSE `forest_boss_at` END;
