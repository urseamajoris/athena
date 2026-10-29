# Athena: a guided literature review for novice researchers

Athena is a working prototype of a web app that takes a student from a rough research idea to a research question grounded in real literature. The interface is a canvas: a session opens to an empty canvas with one prompt, and the review grows outward as connected nodes (idea → topics → queries → corpus → table → appraisal → synthesis → questions → export), with each stage's work done inside its node's Focus panel. There are nine stages, and each one ends in a checkpoint the student edits and approves:

1. **Idea**: free text.
2. **Scoping**: a short AI chat (at most five questions), then a concept map and 4–8 editable search topics with synonyms and MeSH terms.
3. **Search builder**: one query per database per topic in that database's real syntax, shared criteria, and a dry-run count for each query.
4. **Retrieval**: a server-side background job runs every query against PubMed and OpenAlex. It paginates up to a cap, deduplicates, streams progress to the browser, and shows how many new unique papers each query added.
5. **Summary table**: one row per paper, sortable, filterable and grouped by topic. The study type, setting and key finding cells are AI-derived from the abstract and badged as such.
6. **Ranking**: a visible rubric with a score bar and a rationale for each paper. The top papers per topic are selected and can be swapped. Topics are ordered by importance.
7. **Appraisal**: open full text where it is legally available, otherwise the abstract, with a clear label. Uses a study-type template and a quality checklist. Every item carries a verbatim quote that the app verifies against the retrieved text.
8. **Synthesis**: an evidence matrix, flagged contradictions, and "known / contested / unknown" statements. Every statement links to the claims behind it.
9. **Research question**: three structured candidates (PICO or equivalent), each with the gap it addresses, feasibility notes, its main weakness, and a novelty search. The student picks one, edits it, and exports the result.

Each person has their own account and sees only their own reviews. An administrator has a dashboard at `/admin` with the server's health, usage and AI spend, a switch that turns all AI calls off and on, and a place to set the xAI key (stored encrypted). See **Accounts, admin and the AI switch** below.

The rules the app is built around:

- **AI proposes, the user confirms.** Every AI output appears in an editable checkpoint before the next stage runs.
- **No invented citations.** Every paper comes from a PubMed, OpenAlex or Crossref API record and carries its DOI, PMID or OpenAlex ID. The model only ever sees retrieved records, refers to them by internal ID, and any ID it returns that was not in its input is rejected.
- **Quotes are checked, not trusted.** Unverified quotes are flagged and kept out of synthesis unless the user explicitly accepts them.
- **Honest data access.** Every appraisal is labelled *Full text* or *Abstract only*, says why, and says whether the text was truncated before it was sent to the model.
- **Everything is logged.** Queries, databases, counts, dates, AI calls with their tokens and cost, and every user decision are stored, and the decision log is exported in the report.

---

## Quick start

```bash
npm install
cp .env.example .env      # keys are only needed for production runs
npm run dev               # http://localhost:3000, mock mode by default
```

Requires Node 20 or later (tested on Node 22). The local SQLite database is created and migrated automatically at `data/athena.db` (or set `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` to use Turso).

### Mock mode (the default; no keys needed)

Mock mode is on everywhere except `ATHENA_ENV=production`, so `npm run dev`, the tests and the QA scripts never spend money.

- Paid APIs (xAI model calls, OpenAlex, which is metered by key) are only called when `ATHENA_ENV=production`.
- Every attempted paid call is counted in `/api/status` (`paidCalls`); outside production the call throws and is logged.
- A server started outside production with `MOCK_MODE=false` (or `MOCK_AI=true` alone, which still hits OpenAlex) refuses to start and says why.
- Keys present in the environment during a mock run are reported in the log and never used.

For a real run: `ATHENA_ENV=production MOCK_MODE=false npm run dev`.

Mock mode replays recorded HTTP fixtures from `fixtures/http/` (real PubMed, OpenAlex, Europe PMC, Crossref and Unpaywall responses, with keys and email removed) and uses deterministic mock model responders in `src/lib/ai/mock.ts`.

- The responders build schema-valid output from the real input records, so grounding checks, quote verification, deduplication and the whole UI behave as they do in real mode.
- Free-text mock output is prefixed `(mock)`.
- In one or two appraised papers per review, one quote is altered on purpose, so you can see the "unverified" path.
- With the test idea and the mock scoping answers, queries match the recorded fixtures exactly. For other queries a fixture recorded for the same endpoint is served.
- Full text that came from open PDFs is not in the fixtures, because PDFs and PDF text are never recorded. Those papers fall back to abstract-only in mock mode.

`MOCK_AI=true` mocks only the model and calls the real databases. It costs nothing in xAI credit, but OpenAlex is metered, so it also needs `ATHENA_ENV=production`. Combine it with `RECORD_FIXTURES=true` to re-record `fixtures/http/`.

### Keys and configuration (`.env.example`)

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | xAI (Grok) key. Server-side only. |
| `OPENALEX_API_KEY` | OpenAlex key, sent as a bearer header and never put in URLs. |
| `CONTACT_EMAIL` | Sent to PubMed (`email=`), Crossref (`mailto=`) and Unpaywall (`email=`), as their terms ask. |
| `NCBI_API_KEY` | Optional. Raises PubMed from 3 to 10 requests per second. |
| `XAI_MODEL_FAST`, `XAI_MODEL_SUMMARY`, `XAI_MODEL_REASONING` | Model IDs for each role (see below). |
| `XAI_FAST_REASONING_EFFORT` | `reasoning_effort` for the fast models (default `low`). Dropped automatically if a model rejects it. |
| `XAI_BUDGET_USD` | Hard cap on recorded xAI spend in this database (default 5). AI calls are refused once it is reached. An admin can lower it in the dashboard; raising it above this value needs an explicit confirmation. |
| `AI_CONCURRENCY` | Concurrency limit for per-paper model calls (default 4). |
| `MAX_RESULTS_PER_QUERY` | Pagination cap per query (default 40). |
| `APPRAISAL_MAX_CHARS` | Characters of full text sent to the model per appraisal (default 60,000). Truncation is shown in the UI and the report. |
| `HTTP_CACHE_TTL_HOURS` | HTTP cache lifetime (default 168). |
| `ATHENA_ENV` | `production` allows paid API calls. Anything else (the default) forces mock mode. |
| `MOCK_MODE`, `MOCK_AI`, `RECORD_FIXTURES` | See above. |
| `SIMULATE_SOURCE_FAILURE` | Comma list such as `openalex`. Forces that source to fail, to test failure handling. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Turso (libSQL) database for production. When the URL is empty the app uses the local file at `DATABASE_PATH`. |
| `DATABASE_PATH` | Local SQLite file (default `data/athena.db`), used when `TURSO_DATABASE_URL` is empty. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first administrator, created at server start if no account has this email (an existing account with it becomes an admin only if ADMIN_PASSWORD is its password, which is not changed; the address cannot be used to sign up). Projects created before accounts existed are assigned to this admin. |
| `ALLOW_SIGNUP` | `false` closes the sign-up page, so only an admin can create accounts. Open by default. |
| `SETTINGS_ENCRYPTION_KEY` | 32+ characters (e.g. `openssl rand -base64 32`). Encrypts an xAI key set from the dashboard (AES-256-GCM). Without it the dashboard refuses to store a key. |

### Accounts, admin and the AI switch

- **Accounts.** Sign up, log in, log out, change password, download your data, delete your account (with its projects). Passwords are hashed with scrypt; sessions are HTTP-only, SameSite=Lax cookies backed by the `sessions` table; logins are rate-limited per email and per IP; state-changing requests must come from the same origin.
- **Isolation.** Every project route, the live-progress stream and the exports check that the project belongs to the signed-in user, and every paper, quote, appraisal or question ID is checked against that project. Another user's project answers 404, for admins too: the dashboard shows counts and metadata, never research ideas, papers or notes.
- **Admin dashboard (`/admin`).** A green/amber/red verdict with its reasons; health (uptime, memory, database size, job runner, error rate); users, sign-ups and how far projects get through the nine steps; AI calls, tokens, cost by day, step and model, latency and failures; data-source requests, errors, 429s and latency; jobs; quality signals; recent errors and an audit log. Admins can disable, delete or reset the password of a user and change roles; every action is logged.
- **AI switch.** Turning AI off stops every model call at once, with no restart: running jobs pause at their next call ("AI is paused by the administrator. Your work is saved.") and resume when it is back on. Nothing falls back to mock output, and searching PubMed and OpenAlex keeps working.
- **xAI key.** An admin can paste, test, replace and clear a key. It is encrypted at rest, never sent back to the browser (only its last 4 characters, who set it and when, and the last test result), and never written to logs, the decision log, `ai_calls`, errors or exports. A key set in the dashboard takes precedence over `XAI_API_KEY`; clearing it falls back to the environment.
- **Budget.** Spend against the limit, by step, model and day, with a projection; a warning at 80%, and a hard stop at the limit that users see as "AI budget reached".
- **Upgrading an existing database.** `drizzle/0001_accounts_admin.sql` only adds tables and columns. At the first start with `ADMIN_EMAIL`/`ADMIN_PASSWORD` set, the admin is created and every project without an owner is assigned to it.

---

## Plan: stack, folders and build order

**Stack.** TypeScript end to end:

- **App:** Next.js 15 (App Router) with React 19 and Tailwind 4. API routes handle all server work.
- **Storage:** libSQL through Drizzle and `@libsql/client`: a Turso database when `TURSO_DATABASE_URL` is set, otherwise a local SQLite file. Migrations are committed in `drizzle/` and applied on server start (`src/instrumentation-node.ts`).
- **Validation:** zod 4 for every model response and every request body.
- **Model calls:** the `openai` SDK pointed at `https://api.x.ai/v1`.
- **Background jobs:** an in-process runner whose state lives in SQLite. Progress streams to the browser over server-sent events.
- **Interface:** React Flow 12 (canvas) with elkjs layout (lazy-loaded, runs in a Web Worker), Motion (`motion`) with `reducedMotion="user"`, Radix UI primitives, cmdk (⌘K), TanStack Table + Virtual (summary and ranking table), Zustand with persist (canvas state per session), Lucide icons, Inter and JetBrains Mono (self-hosted). The landing demo is a Remotion composition rendered at build time; Remotion is a dev dependency and never ships to the browser. Remotion's licence is free for individuals and small teams, but larger companies need a paid company licence (remotion.dev/license) to keep re-rendering the demo. The rendered video and poster are plain files in `public/demo/` and need no licence to serve.

```
prompts/                 one versioned prompt file per AI step (<name>.v<N>.md)
fixtures/http/           recorded API responses for MOCK_MODE (keys/email stripped)
drizzle/                 SQL migrations
remotion/                the landing-page demo composition (rendered by scripts/render-demo.mjs)
public/demo/             rendered demo video (MP4, WebM) and poster
scripts/                 e2e.mjs (Playwright UI test), api-flow.mjs (API-only run), visual-audit.ts (QA loop),
                         render-demo.mjs, screens.mjs
qa/                      visual-audit reports (qa/report-<round>.md); screenshots in qa/shots/ (git-ignored)
docs/redesign-map.md     how the canvas redesign maps onto the real routes and components
src/app/                 /, /sessions, /s/new, /s/[id] (canvas), /s/[id]/table, /s/[id]/export, /settings,
                         /projects/[id] (redirects to the canvas), and the API routes
  api/projects/[id]/[...path]/route.ts   → src/lib/api.ts (small router for all stage endpoints)
  api/projects/[id]/events/route.ts      → SSE progress stream (stage states, jobs, costs, canvas summary)
src/components/canvas/   canvas shell, node cards, Focus panel host, stage rail, List view, ⌘K palette, add menu
src/components/panels/   one Focus panel per node type (the stage UIs), evidence chips, shared panel parts
src/components/session/  session provider (data, SSE, commands, confirm dialogs), paper dialog, full-page frame
src/components/table/    the summary and ranking table
src/components/ui.tsx    base components on design tokens (badges, dialogs, menus, disclosure)
src/lib/canvas/          graph derivation, next actions and stage gating, layout, canvas store (unit-tested)
src/lib/paid-guard.ts    when paid APIs may be called (unit-tested)
src/lib/design/          WCAG contrast helpers and the token contrast test
src/lib/db/              Drizzle schema + client
src/lib/ai/              xAI client (structured calls, budget, cost), prompt loader, schema conversion, model check, mock responders
src/lib/sources/         pubmed, openalex, crossref, unpaywall, europepmc + cached/rate-limited HTTP layer
src/lib/stages/          zod schemas for AI outputs, appraisal templates, scoping/search logic
src/lib/jobs/            job runner + retrieval, summaries, ranking, appraisal (+ full text), synthesis, questions
src/lib/quotes.ts        quote normalisation and verification (unit-tested)
src/lib/project.ts       stage states, stale tracking, decision log, costs
src/lib/export.ts        Markdown report, CSV, BibTeX
```

**Build order.** I built it in the vertical slices the brief listed:

1. scaffold, schema and mock mode
2. stages 1–3
3. retrieval: PubMed, then OpenAlex, with deduplication and SSE
4. stages 5–6
5. appraisal with full text and quote verification
6. synthesis, questions and export
7. stale tracking, error states and polish

---

## How the key rules are enforced

**Structured outputs only** (`src/lib/ai/client.ts`)

- Every schema is written once in zod and converted with `z.toJSONSchema`.
- `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `allOf`, `format` and `default` are stripped before the schema is sent as `response_format: json_schema` (strict). zod still enforces all of them.
- Each call also runs a semantic `check`: grounded IDs, one row per paper, required fields, exact checklist items, contradictions that span two papers, and so on.
- On any failure the call is retried once, with the error message added to the conversation. If the retry also fails, the user sees a clear failure state. Unvalidated output is never stored or rendered.
- No tools are passed to the model, so Grok's built-in web and X search are never enabled.

**Grounded context**

- Prompts contain only retrieved records and text, wrapped in `<<<BEGIN DATA …>>>` delimiters.
- A shared rule block tells the model to treat delimited text as data, ignore instructions inside it, never add references from memory, and prefer "not reported" over guessing.

**Quote verification** (`src/lib/quotes.ts`)

- Whitespace, curly quotes, dashes and case are normalised.
- A quote containing "…" is matched fragment by fragment, in order.
- Very short quotes cannot be verified.
- Matches are mapped back to character offsets so the UI can highlight them in the source text.
- Unverified quotes are labelled with the reason. Synthesis cites only verified quotes or quotes the user explicitly accepted.

**Data access** (`src/lib/jobs/fulltext.ts`)

- Full text is used only when it is legally open:
  1. Europe PMC `fullTextXML`, which is served only for the PMC open-access subset.
  2. An Unpaywall best open-access PDF with a Creative Commons or public-domain licence. Its text is extracted in memory and the PDF itself is never stored.
- Otherwise the abstract is used, and the label states the reason (for example "open-access copy exists but licence is not stated, so it is not used").

**Stale tracking** (`src/lib/project.ts`)

- Every edit endpoint calls `markDownstreamStale`. That includes edits to the idea, topics, queries and criteria, summary cells, selections, claim decisions and synthesis statements.
- Before the first edit to an approved stage with downstream work, the UI asks for confirmation.
- A stale stage shows a banner with the reason and two choices: "Re-run this step" or "Keep current results and review them". Nothing re-runs silently.

**Logging**

- `decision_log` records every user and system action with before and after values.
- `search_runs` stores the exact query string, criteria, total hits, fetched and new-unique counts, errors, and the request log with sanitised URLs.
- `ai_calls` stores model, prompt version, tokens (reasoning tokens included), cost, status and duration.

**Cost control**

- Per-paper calls run through a concurrency limiter.
- The OpenAI SDK retries xAI 429 and 5xx responses with exponential backoff (up to 5 retries).
- Summaries and scores are batched (8 and 10 papers per call).
- The fast models run with `reasoning_effort=low`.
- Each stage header shows calls, tokens and dollars for that stage. Cost is taken from xAI's `cost_in_usd_ticks` when present, otherwise estimated from published prices.
- `XAI_BUDGET_USD` is a hard stop.

**HTTP layer** (`src/lib/sources/http.ts`)

- Every response is cached in SQLite, keyed by a sanitised URL with keys and email removed, with a TTL.
- Requests are spaced per source and back off exponentially on 429, 5xx and network errors.
- If one source fails, its runs are marked failed and the job continues with the other sources. The UI shows a banner naming the failed source.

### Source APIs: what I checked and respect

- **PubMed E-utilities.** `tool` and `email` are sent. Requests are spaced at ≤3 per second, or ≤10 per second with `NCBI_API_KEY`. `esearch` returns IDs and counts, and `efetch` returns XML in batches of 100.
- **OpenAlex.** The API key now governs metering. The free key buys $1/day; a search costs $1 per 1,000 calls, list+filter $0.10 per 1,000, single-record lookups are free.
  - Search uses `search.title_abstract_keywords` with `select=` limited to the fields needed, `per_page` up to 100 and cursor paging.
  - Missing citation counts for PubMed records are filled with cheap batched `filter=doi:a|b|…` calls.
  - All responses are cached.
- **Crossref.** Uses the polite pool via `mailto=`. It only fills DOI and metadata gaps, and a DOI is accepted only on an exact normalised-title match, never a fuzzy guess.
- **Unpaywall.** `email=` is sent. Used for open-access links and licences.
- **Europe PMC.** No key is needed. The `core` search result supplies the licence, and `fullTextXML` the open-access full text.
- **Content rules.** Only metadata, abstracts, openly licensed full text, and the app's own derived data are stored. Paywalled PDFs and PDF bytes are never stored.

### Models

Model roles are read from the environment and checked against `GET /v1/models` at startup. The resolution appears in the header tooltip and `/api/status`. If a configured slug has been retired, the closest current Grok text model is substituted and flagged in the UI.

| Role | Used for | Default | Status (checked 2026-10-28) |
|---|---|---|---|
| fast | scoping, search building, ranking, topic importance | `grok-4.3` | listed by xAI, used as is |
| summary | per-paper summary rows | `grok-4.3` | listed by xAI, used as is |
| reasoning | appraisal, synthesis, research questions | `grok-4.20-0309-reasoning` | listed by xAI, used as is |

Both default models were present, so no substitution was needed. xAI lists both at $1.25 per million input tokens and $2.50 per million output tokens, below 200k prompt tokens. `grok-4.20-0309-reasoning` rejects the `reasoning_effort` parameter, so it is only sent to the fast and summary roles.

### Data model

The **Claim** is the central evidence object: one extracted finding, with its verbatim quote, location, character offsets, verified flag and user decision. Papers are containers. Synthesis items and research questions cite claims through `claim_links`. The tables:

- `projects`, `scoping_messages`, `topics`, `queries`
- `search_runs`, `papers`, `paper_topics`, `paper_hits` (which run found which paper, at what rank, and whether it was new)
- `paper_summaries` (with the abstract-derived flag), `scores` (rubric sub-scores, rationales, selected flag)
- `source_texts` (the exact text that was read), `appraisals`, `claims`
- `synthesis_items`, `matrix_cells`, `contradictions`, `research_questions` (with the novelty queries and matches), `claim_links`
- `decision_log`, `jobs`, `http_cache`, `ai_calls`

Room for later features is already in the schema:

- **Multiple users:** `projects.owner_id`.
- **PDF upload:** `papers.source_kind`.
- **Proposal builder:** a generic `claim_links.owner_type`, so a proposal section can cite claims the same way.

---

## Defaults and decisions taken where the brief was open

- **Databases searched:** PubMed and OpenAlex. Crossref, Unpaywall and Europe PMC are used for enrichment and full text, not as search sources.
- **Criteria:** stored once on the project and copied onto each query and search run at execution time.
  - Years and language are applied as database filters.
  - Study types and inclusion/exclusion statements guide the AI and are reported, but are not hard filters. Mapping free-text study types onto each database's publication-type filters is lossy and would silently drop papers.
  - OpenAlex is restricted to `type:article|review|preprint`.
- **Rubric:** topic fit, design strength and setting match are scored by the AI (0–5) with a reason each. Recency and citation impact are computed by a fixed, displayed formula (citations per year, log-banded), which is more accurate and transparent than asking a model.
  - Weights: topic fit 35%, design 20%, setting 20%, recency 15%, citations 10%.
  - The top 4 per topic are pre-selected.
  - At most 60 papers per topic are scored, highest database relevance first, to bound cost.
- **Appraisal:** each paper is appraised once, even when it is selected under several topics.
  - Templates: trial, cohort (which also covers case-control), cross-sectional, qualitative (which also covers mixed methods), systematic review (which also covers scoping reviews), other.
  - Checklists are short CASP/JBI-style lists defined in `src/lib/stages/templates.ts`.
- **"Not reported":** these entries are stored as claims flagged `not_reported`, with no quote. They are never cited by synthesis.
- **Novelty check:** the AI writes one targeted query per database for each candidate question. The app runs them and shows the top five real records from each, marking any already in the review. It is presented as "what was found", never as proof of novelty.
- **Scoping:** the topic list builds live as draft names while the chat runs. Full topics (synonyms, MeSH, rationale) are generated when the user clicks "Build my search topics". This saves a model call per chat turn. A user may approve fewer than 4 topics; the UI warns but allows it.
- **Next.js config:** `next.config.mjs` instead of `.ts`, because Next 15's TypeScript config loader breaks with TypeScript 7. TypeScript is pinned to 5.9.
- **Dev watcher:** the dev server ignores `data/`, `fixtures/` and `e2e-artifacts/`. SQLite writes there would otherwise trigger rebuilds and Fast Refresh remounts that wipe form state.

---

## Testing

Everything here runs in mock mode with no keys; it is the default outside production, and a real key is refused there (see **Mock mode**).

```bash
npm test                                          # unit tests: quote verification, paid-API guard, colour contrast of the tokens,
                                                  # canvas graph, stage gating and next actions, layout, persisted canvas state
npm run build && npm start                        # production build on :3000
node scripts/api-flow.mjs                         # drive all nine stages through the HTTP API
node scripts/e2e.mjs http://localhost:3000        # drive all nine stages through the canvas in a browser (Playwright), with checks
npm run qa -- --round=N                           # visual audit: builds fixtures, screenshots every view, scores the 12-item checklist
npm run demo:render                               # re-render the landing page's canvas demo video (Remotion, build time only)
npm run explainers:render                         # re-render the nine "What happens in this step" explainers (Remotion → public/explainers/)
ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3000 npm run test:security
                                                  # 47 checks: isolation between users on every route, login rate limits, same-origin,
                                                  # admin-only routes (403), the AI switch pausing and resuming a job, the key never
                                                  # appearing in any response, log or export, budget changes, the audit log
node scripts/ux-shots.mjs http://localhost:3000 N # screenshots of every page and state at 375/768/1366 px → docs/screenshots/ux/<page>/vN/
node scripts/qa-browser.mjs <persona> <command>   # a persistent browser driven from the shell (used by the simulated-user QA agents)
```

`scripts/e2e.mjs` checks the acceptance criteria directly. It uses the test idea throughout: *"What is the knowledge gap in implementing telemedicine in Southeast Asia?"*

- ≤5 scoping questions and 4–8 topics.
- One query per database per topic, with dry-run counts.
- Retrieval completes and deduplicates, including after a page reload.
- Every paper has a DOI, PMID or OpenAlex ID.
- 3–5 papers are selected per topic, and topics carry an importance order.
- A paper swap works.
- Every appraisal is labelled; every extracted claim has a quote; verified quotes map to real spans.
- Accepting an unverified quote works.
- Synthesis cites only verified or accepted claims.
- There are three questions with claim links and novelty results.
- A question can be chosen and edited, and all three exports download.
- Editing a topic after retrieval marks stages 3–9 stale.
- No browser console errors.

`scripts/visual-audit.ts` (`npm run qa`) starts its own production server in mock mode with the keys stripped from its environment and a fresh database. It seeds sessions through the API (empty, scoping, ghost subtopics, running, error, stale, done, ranked, and a 300-node session). It then screenshots every view and Focus panel at 1440×900 and 390×844, in dark and light, with reduced motion on and off, into `qa/shots/<round>/`, and scores each shot against the 12-item checklist into `qa/report-<round>.md`. The checks are:
- the accent count and the squint test;
- collapsed-by-default disclosures;
- axe-core (serious and critical issues);
- a Tab walk for focus rings and traps;
- transforms under reduced motion;
- overflow, overlap and 44 px tap targets at 390 px;
- state badges carrying icon and text;
- the 4-pt grid and type-size count;
- 300-node pan frame rate and List-view parity;
- Lighthouse mobile;
- console errors and paid-API calls.

See **Test results** below for what was actually run.

## Test results

### Canvas redesign (mock mode, no keys, $0)

All of this ran with every API key removed from the server's environment. The paid-API guard counted **0 attempted calls**, so the redesign spent nothing.

| Run | Result |
|---|---|
| `npm test` | 57/57 pass. The earlier tests plus:<ul><li>the paid-API guard;</li><li>colour contrast of every token pair in both themes;</li><li>the canvas graph (nodes, statuses, ghosts, quotes);</li><li>stage gating and next actions (frontier only, locked options with reasons, the checkpointed re-run cascade);</li><li>layout (pinned nodes never move);</li><li>persisted canvas state;</li><li>number and time formatting.</li></ul> |
| `npm run build` | compiles and type-checks. First-load JS: `/` 116 kB; `/s/[id]` 148 kB, with the canvas itself loaded after first paint; `/s/[id]/table` 188 kB. |
| `node scripts/e2e.mjs` | 29/29 checks pass, driving the whole pipeline through the canvas (nodes, Focus panel, table page, export page) in about 30 s. |
| `npm run qa` (visual audit), round 5 of 5 | **All 12 checklist items pass in all 192 screenshots** (24 views × 1440/390 px × dark/light × motion on/reduced). The full results are in `qa/report-final.md`, with WebP screenshots in `qa/screenshots/`. Highlights:<ul><li>The 300-node canvas pans at 59 fps.</li><li>The canvas route loads 242 kB gzip of JS before the first node shows.</li><li>Landing LCP is 0.76 s on simulated slow-4G mobile.</li><li>Lighthouse mobile performance is 92–99 and accessibility 100 on all 7 pages.</li></ul> |

Rounds 1–4 and what each fixed are summarised in `qa/report-final.md`.

### Before the redesign (wizard UI)

Everything below was run in this repository on 2026-10-28. Total xAI spend for the whole session, development included, was **$2.12** against a $5 cap. Screenshots from the final real run are in `docs/screenshots/`. Its machine-readable check results are in `docs/real-run-results.json`.

#### Automated checks

| Run | Mode | Result |
|---|---|---|
| `npm test` | unit | 18/18 pass. Covers quote verification (normalisation, ellipsis fragments, citation skipping, PDF hyphenation, closest passage), schema stripping, DOI and title normalisation, scoring formulas, ID repair, ID scrubbing. |
| `npm run build` | production build | compiles and type-checks |
| `node scripts/e2e.mjs` | `MOCK_MODE=true` with **no keys in the environment** | 29/29 checks pass (≈1 min) |
| `node scripts/api-flow.mjs` | `MOCK_MODE=true SIMULATE_SOURCE_FAILURE=openalex` | All OpenAlex queries fail. Retrieval continues with PubMed (73 papers). The UI shows the failure banner and the run proceeds through the next stages. |
| `node scripts/e2e.mjs` | **real mode** (live xAI, PubMed, OpenAlex, Crossref, Unpaywall, Europe PMC), run #1 | 28/28 checks pass, $0.94, ≈20 min |
| `node scripts/e2e.mjs` | **real mode**, final run after QA fixes | 28/28 checks pass, $1.04, ≈16 min, **0 validation retries** |

The real runs used the test idea, with the scripted student answers in `scripts/e2e.mjs`. They made no manual database or code intervention.

#### Final real run (`prj_c43ca2ca16a8457c`)

- **Scoping:** Grok asked 3 questions and skipped what the idea already stated. It proposed 5 topics with MeSH terms.
- **Search:** 10 queries in correct PubMed (`[mh]`, `[tiab]`, truncation) and OpenAlex syntax, with dry-run counts from 7 to 268.
  - One OpenAlex query used a wildcard, which OpenAlex rejects in stemmed search. The query failed, was marked failed, and the run continued without it. That is the failure isolation working on a real error.
  - The adapter now switches such queries to OpenAlex's documented `.exact` search; that query re-run returns 643 records.
- **Retrieval:** 327 records fetched, **231 unique** after deduplication.
  - Every paper has an OpenAlex ID, 223 have a DOI and 178 a PMID. **No paper lacks an identifier.**
- **Summary table:** 231 of 231 rows filled from abstracts. Settings are specific ("Malaysia, public primary healthcare clinics") and say "not reported" where the abstract is silent.
- **Ranking:** 4 papers selected per topic, topics ordered with justifications, and one swap made by the script.
- **Appraisal:** 18 papers.
  - **14 from open full text** (Europe PMC open-access subset and CC-licensed PDFs via Unpaywall) and **4 abstract-only**. Each abstract-only paper carries its reason.
  - 269 quoted claims. 261 verified (97%) after the verifier improvements described below.
  - The 8 still unverified were inspected by hand. All 8 are genuinely non-verbatim: the model joined non-adjacent sentences without an ellipsis. They are flagged in the UI with the closest real passage.
- **Synthesis:** 35 known / contested / unknown statements, every one linked to verified claims, and 1 contradiction.
- **Research questions:** three structured candidates (PEO, PICO-style), each with gap claims, feasibility and weakness.
  - Novelty searches found 7, 7 and 0 close matches. The 0 is reported as "what was found", not as proof of novelty.
  - One candidate was chosen, edited and exported.
- **Stale tracking:** renaming a topic after the run marked stages 3–9 stale.

Approximate AI cost by stage in that run:

| Stage | Cost (USD) |
|---|---|
| Scoping | 0.017 |
| Search builder | 0.006 |
| Summary table (231 papers) | 0.246 |
| Ranking | 0.234 |
| Appraisal (18 papers) | 0.383 |
| Synthesis | 0.129 |
| Research questions | 0.027 |

#### QA loops (three, as budgeted)

1. **Real run #1, then a review of the screenshots, outputs and logs.** Fixed:
   - The model wrote internal IDs into prose. Fixed with v2 prompts that forbid it, plus a display-time scrub.
   - Repeated identical evidence chips could not be told apart. They are now numbered ("finding 2").
   - "Abstract only" was duplicated in the note.
   - The chat panel stretched to the height of the topic list.
   - The concept map text was too small to read.
   - The 230-row summary table rendered at once. Each group now shows 15 rows with "Show all".
   - Stale stages hid their results. They now stay readable, with guidance on what to re-approve first.
   - Duplicate "Design" rows on question cards.
2. **Targeted real re-run of stages 8–9 only ($0.31).**
   - Confirmed the v2 prompts give no IDs in prose.
   - Found a false contradiction: two *different* interventions had been set against each other. The v3 synthesis prompt now requires the same intervention and outcome.
   - Found avoidable retries: zod length limits were too tight, and Grok sometimes dropped the underscore from claim IDs. Limits are loosened. A strict `repairId` only fixes unambiguous formatting slips; an unknown ID is still rejected.
3. **Final full real run, then an accuracy audit of every unverified quote.**
   - Found false negatives caused by citation remnants (`[]`, `(Table )`, author-year citations) and PDF hyphenation.
   - The verifier now skips citation apparatus and hyphenation symmetrically, so real wording changes still fail. It is unit-tested.
   - Stored claims were re-checked with the new `POST /api/projects/:id/appraisals/reverify` endpoint, at no AI cost: unverified went from 16 to 8, all genuine.
   - Found the OpenAlex wildcard failure described above, and fixed it.

## Known limitations

- **Accounts are basic.** Email and password only: no email verification and no self-service password reset (an admin resets it and the user must choose a new one). The job runner lives in the one Node process. A restarted server resumes interrupted jobs: retrieval continues from the unfinished queries, summaries and appraisals continue with the remaining papers, and ranking, synthesis and questions restart.
- **Retrieval depth.** By default only the first 40 records per query, in database relevance order, are fetched (`MAX_RESULTS_PER_QUERY`). Ranking scores at most 60 papers per topic. This is a scoping aid, not an exhaustive systematic search.
- **No formal title/abstract screening stage.** Ranking stands in for it. Study types and inclusion/exclusion statements are recorded and shown to the AI, but are not hard filters.
- **Deduplication** uses DOI, then PMID, then OpenAlex ID, then exact normalised title. A preprint and its published version with a different title stay separate.
- **Full text coverage.**
  - Only the PMC open-access subset and CC-licensed PDFs are used.
  - Open-access copies with no stated licence are deliberately not used.
  - PDF text extraction can garble tables and two-column layouts.
  - At most 60,000 characters are sent per appraisal, and the UI says when text was cut.
- **What quote verification proves.** It shows that the quoted words exist in the text. It does not prove the AI's paraphrase is faithful to the quote. The "location" field is supplied by the model; the app adds the computed section for verified quotes.
- **Synthesis** is per topic, over the selected papers only. There is no cross-topic synthesis.
- **Novelty check** shows the top five relevance-ranked records per database for one AI-written query. It is a prompt for the student's own checking, not a guarantee.
- **Mock-mode fixtures** match the test idea. Other ideas in mock mode get fixture data borrowed from the same endpoint, which is fine for UI work and meaningless as evidence.
- **Cost display.** Costs come from xAI's reported `cost_in_usd_ticks`. If xAI stops reporting it, the app falls back to the price table in `src/lib/config.ts`, which must then be kept current.
- **Accessibility and browsers.** The app is keyboard-navigable, with labelled controls, `aria-current`, `aria-sort`, a focus-managed drawer and dialog, and visible focus rings. It has not been audited with a screen reader. It was tested at 1366×900 in Chromium; narrow screens get a stage drop-down instead of the sidebar.
