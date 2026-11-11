UPDATE `users` SET
  `meadow_boss_at` = CASE WHEN `meadow_boss_at` BETWEEN 75 AND 90 THEN CEIL(`meadow_boss_at` / 2) ELSE `meadow_boss_at` END,
  `forest_boss_at` = CASE WHEN `forest_boss_at` BETWEEN 75 AND 90 THEN CEIL(`forest_boss_at` / 2) ELSE `forest_boss_at` END;
