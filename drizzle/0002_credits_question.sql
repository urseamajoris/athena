CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`credits` real NOT NULL,
	`amount_usd` real,
	`pack_id` text,
	`stripe_session_id` text,
	`stripe_payment_intent` text,
	`actor_id` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_user_idx` ON `credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_stripe_session_uq` ON `credit_ledger` (`stripe_session_id`);--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `credits` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_calls_user_idx` ON `ai_calls` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `appraisals` ADD `bottom_line` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `appraisals` ADD `relevance` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `appraisals` ADD `relevance_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `question` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `question_framework` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `question_structure` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `question_drafts` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `question_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `credit_balance` real DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Accounts that existed before credits get the same welcome credits a new sign-up gets (100).
UPDATE `users` SET `credit_balance` = 100;--> statement-breakpoint
INSERT INTO `credit_ledger` (`id`, `user_id`, `kind`, `credits`, `note`, `created_at`)
SELECT 'cl_' || lower(hex(randomblob(8))), `id`, 'signup', 100, 'Welcome credits (account created before credits existed)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `users`;
