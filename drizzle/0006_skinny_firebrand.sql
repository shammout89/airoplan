CREATE TABLE `planning_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
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
CREATE UNIQUE INDEX `planning_workspace_kind_code` ON `planning_items` (`workspace_id`,`kind`,`code`);--> statement-breakpoint
CREATE TABLE `planning_mutex` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL
);
