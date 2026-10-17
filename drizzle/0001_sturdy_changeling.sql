ALTER TABLE `links` ADD `domain` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `links_domain_idx` ON `links` (`domain`);--> statement-breakpoint
UPDATE `links` SET `domain` = lower(
	CASE
		WHEN instr(substr(`url`, instr(`url`, '://') + 3), '/') > 0
			THEN substr(substr(`url`, instr(`url`, '://') + 3), 1, instr(substr(`url`, instr(`url`, '://') + 3), '/') - 1)
		ELSE substr(`url`, instr(`url`, '://') + 3)
	END
) WHERE `domain` = '';
