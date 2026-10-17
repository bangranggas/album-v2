CREATE TABLE `locked_domains` (
	`domain` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `links` ADD `is_favorite` integer DEFAULT false NOT NULL;