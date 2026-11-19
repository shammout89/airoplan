CREATE TABLE `program_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`code` text NOT NULL,
	`revision` text NOT NULL,
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
CREATE UNIQUE INDEX `program_workspace_code_revision` ON `program_revisions` (`workspace_id`,`code`,`revision`);