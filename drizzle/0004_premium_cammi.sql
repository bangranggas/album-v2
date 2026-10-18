DROP INDEX `albums_name_key_unique`;--> statement-breakpoint
ALTER TABLE `albums` ADD `scope` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
-- Hand-written backfill: `drizzle-kit generate` only knows the shape of the schema,
-- not where an album that already exists belongs. An album whose members are all
-- hidden becomes a locked album; everything else (a mixed album, an empty album, an
-- album of visible links) stays on the light page. `albums_scope_name_key_unique` is
-- strictly weaker than the index dropped above, so this cannot collide.
UPDATE `albums` SET `scope` = 'locked'
WHERE EXISTS (
    SELECT 1 FROM `album_links` `al`
    INNER JOIN `links` `l` ON `l`.`id` = `al`.`link_id`
    WHERE `al`.`album_id` = `albums`.`id`
      AND `l`.`domain` IN (SELECT `domain` FROM `locked_domains`)
  )
  AND NOT EXISTS (
    SELECT 1 FROM `album_links` `al`
    INNER JOIN `links` `l` ON `l`.`id` = `al`.`link_id`
    WHERE `al`.`album_id` = `albums`.`id`
      AND `l`.`domain` NOT IN (SELECT `domain` FROM `locked_domains`)
  );--> statement-breakpoint
CREATE UNIQUE INDEX `albums_scope_name_key_unique` ON `albums` (`scope`,`name_key`);
