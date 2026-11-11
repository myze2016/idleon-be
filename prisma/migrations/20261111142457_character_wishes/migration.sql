-- DropForeignKey
ALTER TABLE `characters` DROP FOREIGN KEY `characters_user_id_fkey`;

-- DropIndex
DROP INDEX `characters_user_id_key` ON `characters`;

-- AlterTable
ALTER TABLE `characters` ADD COLUMN `is_starter` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `starter_created` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `wish_currency` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `characters_user_id_created_at_idx` ON `characters`(`user_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `characters` ADD CONSTRAINT `characters_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing characters were all created through the free starter screen.
UPDATE `characters` SET `is_starter` = true;
UPDATE `users` u SET u.`starter_created` = true, u.`wish_currency` = 1
WHERE EXISTS (SELECT 1 FROM `characters` c WHERE c.`user_id` = u.`id`);
