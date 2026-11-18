CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`field_id` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_entity` ON `files` (`entity_id`);--> statement-breakpoint
CREATE TABLE `translations` (
	`entity_id` text NOT NULL,
	`field_id` text NOT NULL,
	`lang` text NOT NULL,
	`text` text NOT NULL,
	`source_snapshot` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`entity_id`, `field_id`, `lang`),
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `entities` ADD `name_ru` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `custom_schema` text DEFAULT '[]' NOT NULL;