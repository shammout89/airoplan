CREATE TABLE `alert_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_receipt` ON `alert_receipts` (`workspace_id`,`user_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `approval_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity` text NOT NULL,
	`target_id` text NOT NULL,
	`source_etag` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_attempt` ON `approval_bindings` (`workspace_id`,`entity`,`target_id`,`source_etag`);--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`revision` text NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` text NOT NULL,
	`digest` text NOT NULL,
	`note` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`published` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_revision` ON `document_versions` (`document_id`,`revision`);--> statement-breakpoint
CREATE TABLE `extension_items` (
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
CREATE UNIQUE INDEX `extension_code` ON `extension_items` (`workspace_id`,`kind`,`code`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`data` text NOT NULL,
	`etag` text NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`data` text NOT NULL,
	`previous_id` text,
	`created_by` text NOT NULL,
	`created` text NOT NULL
);
