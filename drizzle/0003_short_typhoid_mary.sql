CREATE TABLE `accomplishments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
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
CREATE UNIQUE INDEX `accomplishment_workspace_task` ON `accomplishments` (`workspace_id`,`task_id`);