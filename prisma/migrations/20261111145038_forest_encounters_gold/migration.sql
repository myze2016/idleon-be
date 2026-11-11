-- AlterTable
ALTER TABLE `users` ADD COLUMN `gold` INTEGER UNSIGNED NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `encounters` (
    `id` VARCHAR(30) NOT NULL,
    `user_id` VARCHAR(30) NOT NULL,
    `enemy_type` VARCHAR(24) NOT NULL,
    `team_ids` JSON NOT NULL,
    `result` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `encounters_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
