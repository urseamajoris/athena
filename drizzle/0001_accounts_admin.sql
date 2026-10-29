CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text,
	`target_id` text,
	`email_hash` text,
	`ip_hash` text,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_cat_idx` ON `audit_events` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_email_idx` ON `audit_events` (`email_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_ip_idx` ON `audit_events` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `request_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`route` text NOT NULL,
	`method` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`user_id` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reqm_created_idx` ON `request_metrics` (`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `source_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	`ok` integer NOT NULL,
	`cached` integer DEFAULT false NOT NULL,
	`simulated` integer DEFAULT false NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `srcreq_created_idx` ON `source_requests` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text,
	`last_active_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `resume_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `view_prefs` text;--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`);