import { sqliteTable, text, integer, real, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JobProgress } from "../shared/progress";

/*
 * Schema notes
 * - The Claim is the central evidence object; synthesis items and research questions cite claims via claim_links.
 * - Papers belong to a project today. `ownerId` / `sourceKind` columns leave room for multiple users and PDF upload.
 * - JSON columns use text({ mode: "json" }).
 */

const now = () => new Date().toISOString();
const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull().$defaultFn(now);

export type StageState = "not_started" | "running" | "needs_review" | "approved" | "stale" | "failed";

export interface Criteria {
  yearFrom: number | null;
  yearTo: number | null;
  languages: string[];
  studyTypes: string[];
  inclusion: string[];
  exclusion: string[];
  /**
   * Optional HARD retrieval filter: only these article types are fetched from the databases
   * ("journal_article" | "review" | "preprint"). Off by default, because it silently drops papers the databases
   * mislabel; the UI warns about that and the choice is logged.
   */
  hardFilter?: string[];
}

export const projects = sqliteTable("projects", {
  id: id(),
  ownerId: text("owner_id"), // users.id; enforced on every project route (src/lib/auth/access.ts)
  title: text("title").notNull().default(""),
  idea: text("idea").notNull(),
  currentStage: integer("current_stage").notNull().default(1),
  status: text("status").notNull().default("active"),
  stageStates: text("stage_states", { mode: "json" }).$type<Record<string, StageState>>().notNull(),
  staleReasons: text("stale_reasons", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  scopingSummary: text("scoping_summary", { mode: "json" }).$type<Record<string, string> | null>(),
  conceptMap: text("concept_map", { mode: "json" }).$type<{ nodes: { id: string; label: string; kind: string }[]; edges: { from: string; to: string; label: string }[] } | null>(),
  criteria: text("criteria", { mode: "json" }).$type<Criteria | null>(),
  finalReport: text("final_report"),
  /** Category view choices (filters, group-by, colour-by) saved per project and listed in the report. */
  viewPrefs: text("view_prefs", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (t) => [index("projects_owner_idx").on(t.ownerId)]);

export const scopingMessages = sqliteTable("scoping_messages", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  text: text("text").notNull(),
  order: integer("order").notNull(),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
}, (t) => [index("scoping_project_idx").on(t.projectId)]);

export const topics = sqliteTable("topics", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  synonyms: text("synonyms", { mode: "json" }).$type<string[]>().notNull().default([]),
  controlledTerms: text("controlled_terms", { mode: "json" }).$type<string[]>().notNull().default([]),
  rationale: text("rationale").notNull().default(""),
  importanceRank: integer("importance_rank"),
  importanceJustification: text("importance_justification"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  origin: text("origin").notNull().default("ai"), // ai | user | merged
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("topics_project_idx").on(t.projectId)]);

export interface QueryScope {
  /** The query's topic compares the idea's setting with other settings, so it is not limited to the setting. */
  comparesSettings: boolean;
}

export const queries = sqliteTable("queries", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  database: text("database").notNull(), // pubmed | openalex
  queryString: text("query_string").notNull(),
  aiQueryString: text("ai_query_string").notNull(),
  rationale: text("rationale").notNull().default(""),
  /** How the query relates to the idea's setting (kept in the unused "criteria" column, so no migration). */
  scope: text("criteria", { mode: "json" }).$type<QueryScope | null>(),
  dryRunCount: integer("dry_run_count"),
  dryRunAt: text("dry_run_at"),
  dryRunError: text("dry_run_error"),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("queries_topic_idx").on(t.topicId)]);

export const searchRuns = sqliteTable("search_runs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  queryId: text("query_id").notNull().references(() => queries.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  database: text("database").notNull(),
  queryString: text("query_string").notNull(), // exact string executed (snapshot)
  criteria: text("criteria", { mode: "json" }).$type<Criteria | null>(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  resultCount: integer("result_count"), // total hits reported by the database
  fetchedCount: integer("fetched_count").notNull().default(0),
  newUniqueCount: integer("new_unique_count").notNull().default(0),
  cap: integer("cap").notNull(),
  order: integer("order").notNull().default(0),
  error: text("error"),
  requestLog: text("request_log", { mode: "json" }).$type<string[]>().notNull().default([]),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  createdAt: createdAt(),
}, (t) => [index("runs_project_idx").on(t.projectId)]);

export const papers = sqliteTable("papers", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull().default("database"), // database | upload (future)
  doi: text("doi"),
  pmid: text("pmid"),
  pmcid: text("pmcid"),
  openalexId: text("openalex_id"),
  title: text("title").notNull(),
  normTitle: text("norm_title").notNull(),
  authors: text("authors", { mode: "json" }).$type<string[]>().notNull().default([]),
  year: integer("year"),
  journal: text("journal"),
  abstract: text("abstract"),
  language: text("language"),
  publicationTypes: text("publication_types", { mode: "json" }).$type<string[]>().notNull().default([]),
  citationCount: integer("citation_count"),
  oaUrl: text("oa_url"),
  oaStatus: text("oa_status"),
  license: text("license"),
  sourceDatabases: text("source_databases", { mode: "json" }).$type<string[]>().notNull().default([]),
  enrichment: text("enrichment", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  index("papers_project_idx").on(t.projectId),
  index("papers_doi_idx").on(t.projectId, t.doi),
  index("papers_pmid_idx").on(t.projectId, t.pmid),
  index("papers_title_idx").on(t.projectId, t.normTitle),
]);

export const paperTopics = sqliteTable("paper_topics", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.paperId, t.topicId] })]);

export const paperHits = sqliteTable("paper_hits", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  searchRunId: text("search_run_id").notNull().references(() => searchRuns.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  wasNew: integer("was_new", { mode: "boolean" }).notNull().default(false),
}, (t) => [primaryKey({ columns: [t.paperId, t.searchRunId] })]);

export const paperSummaries = sqliteTable("paper_summaries", {
  id: id(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  studyType: text("study_type").notNull(),
  setting: text("setting").notNull(),
  keyFinding: text("key_finding").notNull(),
  abstractDerived: integer("abstract_derived", { mode: "boolean" }).notNull().default(true),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  model: text("model"),
  promptVersion: text("prompt_version"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("summary_paper_uq").on(t.paperId)]);

export interface RubricScores {
  topicFit: number;
  designStrength: number;
  recency: number;
  citationImpact: number;
  settingMatch: number;
}

export const scores = sqliteTable("scores", {
  id: id(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  subScores: text("sub_scores", { mode: "json" }).$type<RubricScores>().notNull(),
  rationales: text("rationales", { mode: "json" }).$type<Record<keyof RubricScores, string>>().notNull(),
  total: real("total").notNull(),
  rationale: text("rationale").notNull(),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  userChanged: integer("user_changed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("score_paper_topic_uq").on(t.paperId, t.topicId)]);

export const sourceTexts = sqliteTable("source_texts", {
  id: id(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // full_text | abstract
  source: text("source").notNull(), // europepmc | pmc | unpaywall_pdf | pubmed | openalex
  license: text("license"),
  url: text("url"),
  text: text("text").notNull(),
  sections: text("sections", { mode: "json" }).$type<{ title: string; start: number }[]>().notNull().default([]),
  fullLength: integer("full_length").notNull(),
  createdAt: createdAt(),
});

export interface ChecklistItem {
  item: string;
  answer: "yes" | "no" | "unclear" | "not_reported";
  claimId: string | null;
  /** Set when Athena changed the AI's answer to "not_reported" (the AI used one quote for several questions). */
  downgraded?: { aiAnswer: "yes" | "no" | "unclear" | "not_reported"; sharedWith: number };
}

export const appraisals = sqliteTable("appraisals", {
  id: id(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  sourceTextId: text("source_text_id").references(() => sourceTexts.id),
  textSource: text("text_source").notNull(), // full_text | abstract
  textNote: text("text_note").notNull().default(""), // e.g. truncation, licence, why abstract-only
  charsSentToModel: integer("chars_sent_to_model"),
  templateType: text("template_type").notNull(), // trial | cohort | cross_sectional | qualitative | systematic_review | other
  checklist: text("checklist", { mode: "json" }).$type<ChecklistItem[]>().notNull().default([]),
  status: text("status").notNull().default("pending"), // pending | running | done | failed
  error: text("error"),
  model: text("model"),
  promptVersion: text("prompt_version"),
  createdAt: createdAt(),
}, (t) => [index("appraisal_paper_idx").on(t.paperId)]);

export const claims = sqliteTable("claims", {
  id: id(),
  appraisalId: text("appraisal_id").notNull().references(() => appraisals.id, { onDelete: "cascade" }),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  field: text("field").notNull(), // aim | setting | sample | methods | key_finding | limitation | checklist
  statement: text("statement").notNull(),
  notReported: integer("not_reported", { mode: "boolean" }).notNull().default(false),
  quote: text("quote").notNull().default(""),
  location: text("location").notNull().default(""),
  matchStart: integer("match_start"),
  matchEnd: integer("match_end"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  userAccepted: integer("user_accepted", { mode: "boolean" }).notNull().default(false),
  userRejected: integer("user_rejected", { mode: "boolean" }).notNull().default(false),
  verificationNote: text("verification_note"),
  createdAt: createdAt(),
}, (t) => [index("claims_paper_idx").on(t.paperId)]);

export const synthesisItems = sqliteTable("synthesis_items", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // known | contested | unknown
  statement: text("statement").notNull(),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const matrixCells = sqliteTable("matrix_cells", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  theme: text("theme").notNull(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  stance: text("stance").notNull().default("neutral"), // supports | contradicts | mixed | neutral | not_addressed
  claimIds: text("claim_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
});

export const contradictions = sqliteTable("contradictions", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  theme: text("theme").notNull(),
  description: text("description").notNull(),
  claimIds: text("claim_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  paperIds: text("paper_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
});

export interface NoveltyMatch {
  title: string;
  year: number | null;
  doi: string | null;
  pmid: string | null;
  openalexId: string | null;
  database: string;
  similarityNote: string;
}

export const researchQuestions = sqliteTable("research_questions", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  framework: text("framework").notNull(), // PICO | PEO | PICo | SPIDER | other
  structure: text("structure", { mode: "json" }).$type<Record<string, string>>().notNull(),
  design: text("design").notNull().default(""),
  gap: text("gap").notNull(),
  feasibility: text("feasibility").notNull(),
  weakness: text("weakness").notNull(),
  noveltyQueries: text("novelty_queries", { mode: "json" }).$type<{ database: string; query: string; count: number | null; error: string | null }[]>().notNull().default([]),
  noveltyMatches: text("novelty_matches", { mode: "json" }).$type<NoveltyMatch[]>().notNull().default([]),
  noveltyStatus: text("novelty_status").notNull().default("pending"),
  chosen: integer("chosen", { mode: "boolean" }).notNull().default(false),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: createdAt(),
});

/** Generic link table from a citing object (synthesis item, contradiction, research question) to claims. */
export const claimLinks = sqliteTable("claim_links", {
  ownerType: text("owner_type").notNull(), // synthesis | research_question
  ownerId: text("owner_id").notNull(),
  claimId: text("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.ownerType, t.ownerId, t.claimId] })]);

export const decisionLog = sqliteTable("decision_log", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: integer("stage").notNull(),
  actor: text("actor").notNull().default("user"), // user | ai | system
  action: text("action").notNull(),
  before: text("before", { mode: "json" }).$type<unknown>(),
  after: text("after", { mode: "json" }).$type<unknown>(),
  createdAt: createdAt(),
}, (t) => [index("log_project_idx").on(t.projectId)]);

export const jobs = sqliteTable("jobs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // retrieval | summaries | ranking | appraisal | synthesis | questions
  stage: integer("stage").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed | cancelled
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  progress: text("progress", { mode: "json" }).$type<JobProgress>().notNull().default({ done: 0, total: 0, message: "" }),
  log: text("log", { mode: "json" }).$type<string[]>().notNull().default([]),
  error: text("error"),
  createdAt: createdAt(),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  heartbeatAt: text("heartbeat_at"),
  /** Times this job was picked up again after a server restart. */
  resumeCount: integer("resume_count").notNull().default(0),
}, (t) => [index("jobs_project_idx").on(t.projectId)]);

export const httpCache = sqliteTable("http_cache", {
  key: text("key").primaryKey(),
  url: text("url").notNull(), // sanitised: no keys or email
  status: integer("status").notNull(),
  contentType: text("content_type"),
  body: text("body").notNull(),
  createdAt: createdAt(),
  expiresAt: text("expires_at").notNull(),
});

export const aiCalls = sqliteTable("ai_calls", {
  id: id(),
  projectId: text("project_id"),
  stage: integer("stage"),
  promptName: text("prompt_name").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  costSource: text("cost_source").notNull().default("estimate"), // api | estimate
  status: text("status").notNull(), // ok | invalid | error | refused
  error: text("error"),
  attempt: integer("attempt").notNull().default(1),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("ai_calls_project_idx").on(t.projectId, t.stage)]);

// ---------- accounts, admin and telemetry ----------

export type Role = "user" | "admin";

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull(), // stored lower-cased
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(), // scrypt; see src/lib/auth/password.ts
  role: text("role").$type<Role>().notNull().default("user"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  /** Set when an admin resets the password: the next login must choose a new one. */
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  lastLoginAt: text("last_login_at"),
  lastActiveAt: text("last_active_at"),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token; the token itself is never stored
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/** Security events (logins, sign-ups, password changes) and admin actions. Never holds secrets or project content. */
export const auditEvents = sqliteTable("audit_events", {
  id: id(),
  category: text("category").$type<"security" | "admin">().notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id"),
  targetId: text("target_id"),
  /** sha256 of the lower-cased email / client IP, for rate limiting without storing either in the clear. */
  emailHash: text("email_hash"),
  ipHash: text("ip_hash"),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
}, (t) => [index("audit_cat_idx").on(t.category, t.createdAt), index("audit_email_idx").on(t.emailHash, t.createdAt), index("audit_ip_idx").on(t.ipHash, t.createdAt)]);

/** Runtime settings an admin can change (AI on/off, the encrypted xAI key, the budget). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
  updatedBy: text("updated_by"),
});

/** One row per API request (route pattern, not the URL; no bodies). Pruned after RETENTION_DAYS. */
export const requestMetrics = sqliteTable("request_metrics", {
  id: id(),
  route: text("route").notNull(),
  method: text("method").notNull(),
  status: integer("status").notNull(),
  durationMs: integer("duration_ms").notNull(),
  userId: text("user_id"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("reqm_created_idx").on(t.createdAt)]);

/** One row per outbound literature-API request (including cache hits and simulated failures). */
export const sourceRequests = sqliteTable("source_requests", {
  id: id(),
  source: text("source").notNull(),
  status: integer("status").notNull().default(0), // HTTP status, 0 = network error / not sent
  ok: integer("ok", { mode: "boolean" }).notNull(),
  cached: integer("cached", { mode: "boolean" }).notNull().default(false),
  simulated: integer("simulated", { mode: "boolean" }).notNull().default(false),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("srcreq_created_idx").on(t.createdAt)]);
