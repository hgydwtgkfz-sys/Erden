CREATE TABLE `emberfall_rooms` (
  `code` text PRIMARY KEY NOT NULL,
  `version` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `data_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `emberfall_rooms_expiry_idx` ON `emberfall_rooms` (`expires_at`);
