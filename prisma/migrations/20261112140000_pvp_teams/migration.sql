ALTER TABLE `pvp_rooms`
  ADD COLUMN `host_character_ids` JSON NULL,
  ADD COLUMN `guest_character_ids` JSON NULL;
