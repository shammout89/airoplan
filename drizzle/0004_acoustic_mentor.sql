CREATE TABLE `corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`state` text NOT NULL,
	`data` text NOT NULL,
	`etag` text NOT NULL,
	`modified_by` text NOT NULL,
	`submitted_by` text,
	`reviewed_by` text,
	`approved_by` text,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `effective_values` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`version` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `effective_target` ON `effective_values` (`workspace_id`,`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `flights` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`aircraft_id` text NOT NULL,
	`reference` text NOT NULL,
	`departure` text NOT NULL,
	`data` text NOT NULL,
	`posted_by` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flight_reference` ON `flights` (`workspace_id`,`aircraft_id`,`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `flight_departure` ON `flights` (`workspace_id`,`aircraft_id`,`departure`);