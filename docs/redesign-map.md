# Redesign map: brief → real code

Written before any code changed (Step 0 of the canvas-first redesign brief), then updated at the end so it matches what ships. The brief was drafted when the repository looked empty; it held a working Next.js 15 prototype, so this file records what existed, where each part went, and where the brief had to bend to fit it.

## What existed before the redesign

| Route | File | What it does |
|---|---|---|
| `/` | `src/app/page.tsx` → `src/components/HomeClient.tsx` | Create form ("Your research idea" → **Start review**) plus the list of existing reviews |
| `/projects/[id]?stage=N` | `src/app/projects/[id]/page.tsx` → `src/components/wizard/Wizard.tsx` | Nine-step wizard: sidebar stepper, stage header, stale banner, sticky **Approve and continue** bar, paper drawer, "edit an earlier step?" dialog |
| `/api/projects`, `/api/projects/[id]` | route handlers | list, create, read, delete projects |
| `/api/projects/[id]/[...path]` | `src/lib/api.ts` | every stage endpoint (approve, run, keep, reopen, scoping, topics, queries, criteria, papers, ranking, appraisals, claims, synthesis, questions, novelty, export, log, reverify) |
| `/api/projects/[id]/events` | SSE | stage states, latest job per stage, costs, live retrieval runs (800 ms tick) |
| `/api/status` | route handler | mock flags, model resolution, spend and budget |

Stage components (`src/components/stages/*`): `IdeaStage`, `ScopingStage` (chat, coverage, `TopicEditor`, `ConceptMap`), `SearchStage` (`QueryEditor`, `CriteriaCard`), `RetrievalStage`, `SummaryStage` (table with inline AI-cell editing), `RankingStage` (per-topic cards, rubric bars, swap), `AppraisalStage` (paper list, claims, checklist, highlighted source text, accept/reject), `SynthesisStage` (matrix, contradictions, known/contested/unknown, `ClaimChip`), `QuestionsStage` (three candidates, novelty, refine), `FinalSummary` (exports). Shared: `ui.tsx`, `StatusPill.tsx`, `PaperDrawer.tsx`, `api.ts` (fetch + SWR).

Mock mode already exists: `MOCK_MODE=true` (recorded HTTP fixtures + deterministic mock model). `MOCK_AI=true` mocks only the model.

## Route mapping

| Brief route | Real implementation | Notes |
|---|---|---|
| `/` Landing | **new** `src/app/page.tsx` (server component) | The create form and review list move out: the form becomes the empty canvas, the list becomes `/sessions`. |
| `/sessions` | **new**, built from the list half of `HomeClient` | Delete stays (in each card's `⋯` menu). |
| `/s/new` | **new** | Not in the brief's list, but needed: the brief's empty canvas exists *before* a project does, and `POST /api/projects` requires the idea. Pressing Enter creates the project and replaces the URL with `/s/[id]`. |
| `/s/[id]` | **new** canvas, replaces `Wizard` | Hosts every stage component in the Focus panel. |
| `/s/[id]/table` | **new**, merges `SummaryStage` + `RankingStage` | TanStack Table + Virtual. |
| `/s/[id]/export` | **new**, from `FinalSummary` + export links | Adds a text preview of each format. |
| `/settings` | **new** | Mock status, spend, keys present (booleans only), theme. Replaces the header `StatusPill`. |
| `/projects/[id]?stage=N` | **redirect** → `/s/[id]?node=<stage key>` | e.g. `?stage=7` → `?node=appraisal`. No stage → `/s/[id]`. |

## Node types → stages → components

| Node | Stage(s) | Panel content (reused from) | Card key number | Next action (the one button) |
|---|---|---|---|---|
| Idea | 1, and the stage-2 chat | idea text (`IdeaStage`), scoping chat + "what we know so far" coverage (= the scope fields) (`ScopingStage`) | questions asked / 5 | Start scoping → Send answer → Branch subtopics → Approve topics |
| Topic | 2 (one per topic) | name, synonyms, MeSH, rationale, delete; merge (collapsed) (`TopicEditor`) | synonyms + MeSH count | Accept (ghost) → Approve topics → Build queries |
| Query | 3 (one per topic, holds its PubMed and OpenAlex queries) | query chips, dry-run counts per source, **Run search**; Boolean editor, MeSH helper, filters (collapsed) (`QueryEditor`, `CriteriaCard`) | dry-run hits per source | Run search |
| Corpus | 4 | live count per source, progress, **Build table**; dedup table, job log, failed queries (collapsed) (`RetrievalStage`, `JobPanel`) | "195 papers, 205 dupes removed" | Build table |
| Table | 5–6 | summary + per-topic selection counts; full table at `/s/[id]/table` (`SummaryStage`, `RankingStage`) | rows · selected | Rank papers → Appraise selected |
| Appraisal | 7 | one paper at a time: checklist + extracted fields with quote badges, "4/15", **Next paper**; source passage inline, full text + re-appraise (collapsed) (`AppraisalStage`) | papers · ✓ verified · ✗ unverified | Synthesize |
| Synthesis | 8 | draft (known / contested / unknown) with inline quote badges, **Generate RQs**; evidence matrix (collapsed) (`SynthesisStage`) | statements · conflicts | Generate RQs |
| Questions | 9 | three candidates with choose, **Export**; rationale, novelty, refine (collapsed) (`QuestionsStage`) | candidates · chosen | Export (finishes stage 9) |
| Export | after 9 | format choice, preview, **Download** (`FinalSummary`) | 3 formats | Download |
| Quote | verification | quote beside its highlighted source passage, verdict, accept/reject (`QuoteLine` + source highlighting) | verdict | Check quote |

Edges: Idea → Topics → Query (one per topic) → Corpus (all queries merge) → Table → Appraisal → Synthesis → Questions → Export. Quote nodes hang off the Appraisal node they were pinned from.

Per-stage actions stay global on the server (one retrieval job runs every query, one appraisal job covers every selected paper), so several nodes can share the same next action (e.g. every Topic's "Approve topics" approves stage 2).

## One mission per view (what ships)

| View | #1 mission | Primary (only accent-filled) button |
|---|---|---|
| Landing | Start a review | Start a review (on phones the first screen is the headline, one sentence and this button; the demo follows) |
| Sessions | Open or create a session | New session |
| Canvas: empty | Type your idea | Create idea (Enter) |
| Canvas: with nodes | Take the next step | the next action on the frontier node (the earliest stage not yet approved); every other card's action is an outline button. With a panel open, the primary moves to the panel footer. |
| List view (phones by default, `L` on desktop) | Take the next step | the same action, in a "Next step" bar above the outline |
| Idea panel | Define the scope | Start scoping / Send / Branch subtopics / Approve topics (one at a time, by state) |
| Topic panel | Confirm this topic | Accept / Approve topics / Build queries |
| Query panel | Run the search | Run search |
| Corpus panel | Watch retrieval, then review dedup | Build table |
| Table view (`/s/[id]/table`) | Rank and pick papers | Rank papers → Appraise selected (header) |
| Appraisal panel | Finish one appraisal | Next paper (last paper: Synthesize) |
| Synthesis panel | Write and verify the synthesis | Generate RQs |
| Questions panel | Choose a research question | Export |
| Export view (`/s/[id]/export`) | Download | Download |
| Quote check | Confirm the quote matches its source | none filled (accept / reject are outline buttons; the verdict is the content) |
| Settings | Confirm mock mode | none (read-only status) |

## Where the brief bends to fit the real app

1. **A sixth node status, "Needs review".** The brief lists idle, running, done, stale, error. The app's core rule is "AI proposes, the user confirms": every stage stops in `needs_review` until approved. Folding that into "done" would hide the checkpoint, so nodes show *Needs review* between *Running* and *Done*.
2. **Keyboard: `A` adds a child, `Shift+A` adds a sibling, Enter opens the Focus panel.** The brief asks for Tab = child and Enter = sibling, but also Enter = open panel, and also "you can tab through the whole view and nothing traps focus" (QA item 5, WCAG 2.1.2). Intercepting Tab on nodes would trap keyboard users inside the canvas. The canvas is one Tab stop (roving focus, arrows move along edges); `A`/`Shift+A` open the add menu.
3. **"Re-run downstream" keeps the checkpoints.** One action starts the cascade; it re-runs the first stale step, and after each step the user reviews and approves before the next one re-runs (approval resumes the cascade automatically). A fully automatic cascade would auto-approve AI output and, in real mode, re-spend the whole pipeline budget.
4. **Ghost subtopics.** "Branch subtopics" calls the existing topic generator; the topics it returns appear as ghost nodes until accepted (Enter) or dismissed (Esc, deletes the topic). Acceptance is remembered per session in the browser; once stage 2 is approved every topic counts as accepted. Topics the user adds are never ghosts.
5. **Things in the brief with no backend, left out rather than faked:** per-query source toggles (retrieval always runs both databases), an appraisal template switcher (the template follows the study type; "Re-appraise" stays), appraisal notes, synthesis model options, export citation style. The panels show what is real (e.g. the template in use, the model used).
6. **Mock mode toggle** is a locked-on status outside production; mock vs real is a server environment setting, and flipping it from a page is the kind of switch that spends money by accident.
7. **Optional libraries** (tldraw sketch layer, three.js background) are left out for the performance budget.
8. **Zoomed-out overview.** Below 50 % zoom, where card text is too small to read, cards keep kind, status badge (icon + text), title and trust counts; the key line and outline action buttons return on zoom-in, and the dot grid is not drawn. The frontier card keeps its primary action. This is what lets a 300-node session pan at 60 fps (see `qa/report-final.md`).
9. **The first HTML carries the data.** Session, table, export, sessions and settings pages pass server-read data to SWR as `fallback`, so content renders before JavaScript and revalidates after hydration. Before hydration the viewport is unknown, so `/s/[id]` renders the List view for phones and the canvas placeholder for wider screens, and CSS shows the right one.
10. **The export preview is not an export.** The preview reads `export/<kind>?preview=1`, which is not written to the decision log; only Download logs "exported".

## Old features → where they live now

| Feature | Before | After |
|---|---|---|
| Approve a stage | sticky Approve bar | node next action / panel primary |
| Stale banner (re-run / keep) | stage header | node amber outline + badge; panel shows reason with Re-run downstream and Keep |
| "Edit an earlier step?" guard | modal in Wizard | same modal, in the canvas provider |
| Paper details drawer | `PaperDrawer` | same content in a Radix dialog |
| Exports | sidebar links + final summary | Export node, `/s/[id]/export`, ⌘K |
| Cost per stage | stage header | panel header (`⋯` → details) |
| Job log / cancel | `JobPanel` | Corpus and job panels (log collapsed) |
| Quote re-verification (`POST appraisals/reverify`) | API only | ⌘K "Re-check all quotes" |
| Decision log (`GET log`) | API + report | report (unchanged) |
