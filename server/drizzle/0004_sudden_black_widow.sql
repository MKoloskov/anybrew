CREATE TABLE `request_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `request_messages_request` ON `request_messages` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`player_id` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `requests_system` ON `requests` (`system_id`,`player_id`);