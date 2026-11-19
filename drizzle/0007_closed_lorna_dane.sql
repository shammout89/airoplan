CREATE TABLE `backup_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`digest` text NOT NULL,
	`manifest` text NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recovery_control` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`epoch` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `restore_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `restore_run_row` ON `restore_rows` (`run_id`,`table_name`,`row_id`);--> statement-breakpoint
CREATE TABLE `restore_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`state` text NOT NULL,
	`report` text NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `write_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor` text NOT NULL,
	`created` text NOT NULL
);
