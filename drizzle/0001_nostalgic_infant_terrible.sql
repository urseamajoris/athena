ALTER TABLE `appraisals` ADD `sent_ranges` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `excluded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `excluded_reason` text;