-- AlterTable
ALTER TABLE `encounters` ADD COLUMN `battle_id` VARCHAR(30) NULL,
    ADD COLUMN `location` VARCHAR(16) NOT NULL DEFAULT 'meadow';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `meadow_boss_at` INTEGER UNSIGNED NULL,
    ADD COLUMN `meadow_defeats` INTEGER UNSIGNED NOT NULL DEFAULT 0;

UPDATE `encounters` SET `location` = 'forest' WHERE `enemy_type` IN ('warrior', 'slinger');
