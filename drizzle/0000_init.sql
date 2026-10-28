CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`stage` integer,
	`prompt_name` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`cost_source` text DEFAULT 'estimate' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_project_idx` ON `ai_calls` (`project_id`,`stage`);--> statement-breakpoint
CREATE TABLE `appraisals` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`source_text_id` text,
	`text_source` text NOT NULL,
	`text_note` text DEFAULT '' NOT NULL,
	`chars_sent_to_model` integer,
	`template_type` text NOT NULL,
	`checklist` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`model` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_text_id`) REFERENCES `source_texts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appraisal_paper_idx` ON `appraisals` (`paper_id`);--> statement-breakpoint
CREATE TABLE `claim_links` (
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`claim_id` text NOT NULL,
	PRIMARY KEY(`owner_type`, `owner_id`, `claim_id`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`appraisal_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`field` text NOT NULL,
	`statement` text NOT NULL,
	`not_reported` integer DEFAULT false NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`match_start` integer,
	`match_end` integer,
	`verified` integer DEFAULT false NOT NULL,
	`user_accepted` integer DEFAULT false NOT NULL,
	`user_rejected` integer DEFAULT false NOT NULL,
	`verification_note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`appraisal_id`) REFERENCES `appraisals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claims_paper_idx` ON `claims` (`paper_id`);--> statement-breakpoint
CREATE TABLE `contradictions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`theme` text NOT NULL,
	`description` text NOT NULL,
	`claim_ids` text DEFAULT '[]' NOT NULL,
	`paper_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` integer NOT NULL,
	`actor` text DEFAULT 'user' NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `log_project_idx` ON `decision_log` (`project_id`);--> statement-breakpoint
CREATE TABLE `http_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`status` integer NOT NULL,
	`content_type` text,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`stage` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`progress` text DEFAULT '{"done":0,"total":0,"message":""}' NOT NULL,
	`log` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`heartbeat_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_project_idx` ON `jobs` (`project_id`);--> statement-breakpoint
CREATE TABLE `matrix_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`theme` text NOT NULL,
	`paper_id` text NOT NULL,
	`value` text NOT NULL,
	`stance` text DEFAULT 'neutral' NOT NULL,
	`claim_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `paper_hits` (
	`paper_id` text NOT NULL,
	`search_run_id` text NOT NULL,
	`rank` integer NOT NULL,
	`was_new` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`paper_id`, `search_run_id`),
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`search_run_id`) REFERENCES `search_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `paper_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`study_type` text NOT NULL,
	`setting` text NOT NULL,
	`key_finding` text NOT NULL,
	`abstract_derived` integer DEFAULT true NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `summary_paper_uq` ON `paper_summaries` (`paper_id`);--> statement-breakpoint
CREATE TABLE `paper_topics` (
	`paper_id` text NOT NULL,
	`topic_id` text NOT NULL,
	PRIMARY KEY(`paper_id`, `topic_id`),
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_kind` text DEFAULT 'database' NOT NULL,
	`doi` text,
	`pmid` text,
	`pmcid` text,
	`openalex_id` text,
	`title` text NOT NULL,
	`norm_title` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`year` integer,
	`journal` text,
	`abstract` text,
	`language` text,
	`publication_types` text DEFAULT '[]' NOT NULL,
	`citation_count` integer,
	`oa_url` text,
	`oa_status` text,
	`license` text,
	`source_databases` text DEFAULT '[]' NOT NULL,
	`enrichment` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `papers_project_idx` ON `papers` (`project_id`);--> statement-breakpoint
CREATE INDEX `papers_doi_idx` ON `papers` (`project_id`,`doi`);--> statement-breakpoint
CREATE INDEX `papers_pmid_idx` ON `papers` (`project_id`,`pmid`);--> statement-breakpoint
CREATE INDEX `papers_title_idx` ON `papers` (`project_id`,`norm_title`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`title` text DEFAULT '' NOT NULL,
	`idea` text NOT NULL,
	`current_stage` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`stage_states` text NOT NULL,
	`stale_reasons` text DEFAULT '{}' NOT NULL,
	`scoping_summary` text,
	`concept_map` text,
	`criteria` text,
	`final_report` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `queries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`database` text NOT NULL,
	`query_string` text NOT NULL,
	`ai_query_string` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`criteria` text,
	`dry_run_count` integer,
	`dry_run_at` text,
	`dry_run_error` text,
	`edited` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `queries_topic_idx` ON `queries` (`topic_id`);--> statement-breakpoint
CREATE TABLE `research_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`framework` text NOT NULL,
	`structure` text NOT NULL,
	`design` text DEFAULT '' NOT NULL,
	`gap` text NOT NULL,
	`feasibility` text NOT NULL,
	`weakness` text NOT NULL,
	`novelty_queries` text DEFAULT '[]' NOT NULL,
	`novelty_matches` text DEFAULT '[]' NOT NULL,
	`novelty_status` text DEFAULT 'pending' NOT NULL,
	`chosen` integer DEFAULT false NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scoping_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`order` integer NOT NULL,
	`meta` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scoping_project_idx` ON `scoping_messages` (`project_id`);--> statement-breakpoint
CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`sub_scores` text NOT NULL,
	`rationales` text NOT NULL,
	`total` real NOT NULL,
	`rationale` text NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`user_changed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_paper_topic_uq` ON `scores` (`paper_id`,`topic_id`);--> statement-breakpoint
CREATE TABLE `search_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`query_id` text NOT NULL,
	`job_id` text,
	`database` text NOT NULL,
	`query_string` text NOT NULL,
	`criteria` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_count` integer,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`new_unique_count` integer DEFAULT 0 NOT NULL,
	`cap` integer NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`error` text,
	`request_log` text DEFAULT '[]' NOT NULL,
	`started_at` text,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`query_id`) REFERENCES `queries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_project_idx` ON `search_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `source_texts` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`license` text,
	`url` text,
	`text` text NOT NULL,
	`sections` text DEFAULT '[]' NOT NULL,
	`full_length` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `synthesis_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`kind` text NOT NULL,
	`statement` text NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`synonyms` text DEFAULT '[]' NOT NULL,
	`controlled_terms` text DEFAULT '[]' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`importance_rank` integer,
	`importance_justification` text,
	`approved` integer DEFAULT false NOT NULL,
	`origin` text DEFAULT 'ai' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topics_project_idx` ON `topics` (`project_id`);