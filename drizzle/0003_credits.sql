ALTER TABLE `users` ADD `credits_balance` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`job_id` text,
	`stage` integer,
	`operation` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`article_count` integer,
	`total_chars` integer,
	`approx_tokens` integer,
	`stripe_session_id` text,
	`amount_cents` integer,
	`description` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `credits_user_idx` ON `credit_transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credits_project_idx` ON `credit_transactions` (`project_id`,`stage`);--> statement-breakpoint
CREATE UNIQUE INDEX `credits_stripe_session_uq` ON `credit_transactions` (`stripe_session_id`);
