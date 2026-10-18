CREATE TABLE `album_links` (
	`album_id` text NOT NULL,
	`link_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`album_id`, `link_id`)
);
--> statement-breakpoint
CREATE INDEX `album_links_link_idx` ON `album_links` (`link_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_name_key_unique` ON `albums` (`name_key`);