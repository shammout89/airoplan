CREATE TABLE `acceptance_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`release` text NOT NULL,
	`data` text NOT NULL,
	`tester` text NOT NULL,
	`created` text NOT NULL
);
