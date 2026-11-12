CREATE TABLE `quest_items` (
  `user_id` VARCHAR(30) NOT NULL,
  `item_id` VARCHAR(40) NOT NULL,
  `acquired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `item_id`),
  CONSTRAINT `quest_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
