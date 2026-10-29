# Handoff prompt for Claude Opus: Athena UI redesign, accounts, admin telemetry, simulated-user QA

Paste everything below the line into a new Claude Code session on this repository.

---

You are continuing work on **Athena**, a Next.js web app that guides a novice researcher from a rough idea to a literature-grounded research question. Read `README.md` first, then `docs/real-run-results.json` and `docs/screenshots/`. They describe the working baseline.

## Where the project stands

- **Stack:** Next.js 15 (App Router), React 19, Tailwind 4, SQLite via Drizzle, zod 4, SWR. AI calls go through the `openai` SDK pointed at xAI (Grok). Background jobs run in-process and stream progress over SSE.
- **Nine stages:** Idea, Scoping, Search builder, Retrieval, Summary table, Ranking, Appraisal, Synthesis, Research question. Each ends in an editable checkpoint the user approves. Stage components are in `src/components/stages/` (about 1,640 lines in total). The shell is `src/components/wizard/Wizard.tsx`. The home page is `src/components/HomeClient.tsx`.
- **Verified so far:**
  - `npm test`: 18/18 pass.
  - `node scripts/e2e.mjs` in `MOCK_MODE=true`: 29/29 checks pass in about 1 minute.
  - Two real-mode runs: 28/28 checks pass, about $1 each, 0 validation retries on the last one.
  - Three QA loops have been done on **data correctness** (prompts, quote verification, retrieval). Nothing yet on **UX clarity**.
- **Not built yet:**
  - No authentication. The README says "single user, local only". `projects.owner_id` exists in the schema but is unused.
  - No admin or telemetry UI. The raw data exists in `ai_calls`, `jobs`, `search_runs`, `http_cache` and `decision_log`, but nothing shows it.
  - No `three`, `@react-three/fiber` or `remotion` packages are installed.
  - UI was tested only at 1366×900 in Chromium. There has been no screen-reader audit.
- **Known small issue:** `package.json` has `"e2e": "tsx scripts/e2e.ts"`, but the file is `scripts/e2e.mjs`. Fix it.

## Rules that must not break

These are core to the product. Do not weaken them for the sake of looks.

1. **AI proposes, the user confirms.** Every AI output stays in an editable checkpoint before the next stage runs.
2. **Honest data access.** Full text vs abstract-only labels, truncation notices, and the "unverified quote" path stay visible.
3. **Stale tracking** (`markDownstreamStale`) and its banner keep working. Nothing re-runs silently.
4. **Logging.** Every user decision still goes to `decision_log`.
5. **Mock mode keeps working** with no keys: `MOCK_MODE=true npm run dev`. `scripts/e2e.mjs` must stay green after every phase. Update its selectors deliberately when you change the UI, and keep every acceptance check it makes.
6. Real-mode runs cost money (about $1 each; `XAI_BUDGET_USD` is a hard cap). Do all development and QA in mock mode. Run real mode at most once, at the very end, and only if the user's keys are present.

## Branching

Work on a feature branch and commit in small, descriptive steps. Do not open a pull request unless the user asks.

---

## Phase 1: Iterative UI redesign

### Goal

Every page must pass the **3-second test**. Within 3 seconds of opening it, a first-time user can say what this page is for, what they must do, and what the single next action is. The page then guides them step by step to finish that page's goal.

### Design brief

For every page (Home, Idea, Scoping, Search, Retrieval, Summary, Ranking, Appraisal, Synthesis, Questions, Final):

- **One headline that states the task** in plain words, for example "Tell us what you want to research", not "Stage 1: Idea".
- **One primary action,** visually dominant. Everything else is clearly secondary.
- **Progressive disclosure.** Show the minimum needed now. Put detail (token costs, raw queries, rubric weights) behind "Details" controls.
- **A visible "where am I and what's next"** strip: step N of 9, what is done, what comes after.
- **Plain-language microcopy** written for a novice. Define jargon (MeSH, PICO, appraisal) inline the first time. Use the `design:ux-copy` skill if available.
- **Empty, loading, error and stale states** that each say what is happening and what to do. A long job (retrieval, summaries, appraisal) shows live progress and what the user can do while waiting.
- **Guided checklists on busy pages** (Summary, Ranking, Appraisal): a short "do these 2–3 things" panel that ticks off as the user acts.

### Creative direction: professional and immersive

Be ambitious. The look should feel like a serious research instrument that is also a pleasure to use.

- **Three.js** (`three` + `@react-three/fiber` + `@react-three/drei`):
  - an immersive hero or backdrop on Home;
  - a live 3D concept map or topic constellation during Scoping;
  - a papers-as-points visualization during Retrieval and Ranking, where retrieved papers appear as they arrive over SSE;
  - an evidence-network view in Synthesis.
- **Remotion** (`remotion` + `@remotion/player`): embed short, scripted animated explainers with `<Player>`, one per stage ("What happens in this step", 5–10 seconds). They should also serve as animated empty and loading states and as a Home intro. Use the Remotion skills available to you (`motion-design-system`) for tokens, springs and safe zones. You do not need to render video files.
- Pair these with a coherent design system: type scale, color tokens (light and dark), spacing, elevation and motion tokens. Put the tokens in `src/app/globals.css` and the primitives in `src/components/ui.tsx`.

**Guardrails.** Spectacle must never cost clarity.

- Every 3D or Remotion element is decorative or explanatory. The task and primary action must be readable and usable without it.
- Load heavy modules with `next/dynamic` and `ssr: false`. Never block first paint on them.
- Honor `prefers-reduced-motion`. Provide a static fallback when WebGL is unavailable or the device is weak. Cap the frame rate and pause when the tab is hidden.
- Keep it readable: WCAG AA contrast, keyboard operability, visible focus, and text alternatives for any information a visualization carries.
- Budget the first-load JS per route and report it (`next build` output) before and after.
- Works at 375, 768 and 1366 widths.

### The iteration loop (do this per page, repeat until it passes)

1. **Baseline.** Screenshot the page with Playwright in mock mode at 375, 768 and 1366 widths, in the key states (empty, loading, populated, error, stale). Save them under `docs/screenshots/ux/<page>/v<N>/`.
2. **Critique.** Run the `design:design-critique` and `design:accessibility-review` skills on the screenshots. List concrete problems.
3. **Redesign** the page against the brief above.
4. **3-second test.** Spawn a **fresh Sonnet subagent** with *only* the new screenshot (no code, no README). Ask: "You have 3 seconds. What is this page for? What would you do first? What would you do next?" Compare its answer with the intended task. A mismatch means the page fails. Fix and repeat.
5. **Regression.** Run `npm run typecheck`, `npm test` and `node scripts/e2e.mjs` (mock mode). All must pass.
6. Commit with the page name and iteration number.

Do the pages in user-journey order: Home, Idea, Scoping, then onward. Establish the shared design system and shell (`Wizard.tsx`) first, so the pages stay consistent. Record each page's final "intended 3-second reading" in `docs/ux-intent.md`. The QA agents in Phase 4 will use it.

---

## Phase 2: Account management

There is no auth today. Add it simply and securely, and keep mock mode and e2e working.

- **Sign up, log in, log out,** password change, and account deletion (delete the user's projects too, with a confirmation that states what will be lost). Email + password is enough. Hash with Node `crypto.scrypt` or argon2, never store plain text. Use HTTP-only, SameSite session cookies backed by a `sessions` table. Add rate limiting on login.
- **Roles:** `user` and `admin`. Create the first admin from env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) at startup. Document them in `.env.example`.
- **Data isolation (critical).** Fill and enforce `projects.owner_id`. Every route in the `src/lib/api.ts` router, the SSE route, and the exports must check that the project belongs to the session user. A user must never reach another user's project by changing an ID. Admins must not read project content by default (see Phase 3).
- **Home becomes "My projects":** list, create, rename, delete, resume at the right stage.
- **Account page:** profile, password, this user's own usage (AI calls and cost for their projects), data export, delete account.
- A migration for the new tables, committed in `drizzle/`. Existing local projects should be assigned to the first admin on upgrade.
- Auth pages must also pass the 3-second test and use the new design system.

## Phase 3: Admin dashboard

An admin-only area (`/admin`) that shows the **telemetry of everything relevant to the web app and the server.** Build it as a clear, glanceable dashboard, with the same 3-second rule: the top of the page answers "is everything healthy, and what needs my attention?".

Show at least:

- **Health:** server uptime, Node and process memory, DB size, job-runner state, error rate, and a green/amber/red verdict.
- **Users:** total, active in the last 24 h / 7 d, signups over time, projects per user, funnel (how many reach each of the 9 stages and how many finish).
- **AI usage:** calls, tokens (including reasoning tokens), cost by day / stage / model / prompt version, spend vs `XAI_BUDGET_USD`, validation-retry rate, failure rate, latency percentiles.
- **Data sources:** per source (PubMed, OpenAlex, Crossref, Unpaywall, Europe PMC), request counts, error and 429 rates, latency, cache hit rate, and any simulated failure.
- **Jobs:** queue and running jobs, durations, failures, and resumed-after-restart counts.
- **Quality signals:** share of quotes verified vs unverified, abstract-only vs full-text appraisals, stale-stage frequency, and where users abandon the flow.
- **Recent errors and an audit view** of admin actions and security events (failed logins, role changes).
- Admin actions: disable or delete a user, reset a password, change role, adjust the budget display. Log every admin action.

Implementation notes:

- Mostly aggregate queries over the existing tables. Add lightweight request and error telemetry (a `request_metrics` table or equivalent, with retention) only where the existing tables cannot answer.
- **Privacy:** the dashboard shows aggregates and metadata. It must not expose users' research ideas, papers or notes, and must never show API keys, emails in URLs or password hashes. If the admin needs per-user detail, show counts, not content.
- Use Three.js and Remotion sparingly here. Charts must be accurate and readable first (use the `dataviz` skill). Data should refresh live (SWR polling or SSE).
- Add tests for the aggregation queries and for the authorization on every admin route (non-admin gets 403, anonymous gets 401).

---

## Phase 4: Simulated-user QA with multiple Sonnet agents

Start this phase only when Phases 1–3 are done, the build passes, and `node scripts/e2e.mjs` is green.

Run several **Claude Sonnet** agents in parallel (use the `Agent` tool, or a `Workflow` script; the user has asked for this multi-agent run). Each agent plays a real user who wants to **create a research question and complete a thorough literature review** with Athena. They must behave like real people using the product, not like test scripts.

### Setup

- Start the app in mock mode (`MOCK_MODE=true`). If the user's keys are present and they approve, one or two agents may use `MOCK_AI=true` with live databases instead. Do **not** burn real xAI budget.
- **Isolate each agent.** SQLite is single-writer, so give each agent its own server instance, port and `DATABASE_PATH` (for example `data/qa-<persona>.db`), each seeded with the admin from env. Each agent signs up through the UI as its own user.
- Agents drive the app with Playwright (available at `require('playwright')`; Chromium is preinstalled; never run `playwright install`).
- Each agent receives only: its persona, its goal, the app URL, and the rules below. **Do not give agents the source code or the README.** They must find their way from the UI alone, the way a real user would. They may read `docs/ux-intent.md` only after finishing, to compare.

### Personas (at least six; vary them)

1. First-year undergraduate with a vague idea ("I'm interested in sleep and grades"), low confidence, never did a literature review.
2. Master's student with a precise topic and a deadline, impatient, skims instructions.
3. PhD candidate who wants rigor: checks the search syntax, edits topics, challenges the ranking, inspects quotes.
4. Clinician with limited time, on a 375-px phone-sized viewport.
5. Non-native English speaker with a typo-heavy, ambiguous idea.
6. Keyboard-only user, with browser zoom at 200%.
7. Adversarial/chaotic user: double-clicks, goes back mid-job, reloads during retrieval, edits an approved stage, abandons and returns, tries another user's project URL.
8. Admin: after the others finish, reviews the dashboard and checks that the telemetry matches what the other agents actually did (call counts, users, stages reached, errors).

### What each agent does and reports

Each agent tries to reach a chosen research question and the exported report. While doing so it thinks aloud and records:

- **Time to understand** each page, and whether it knew what to do next without help. It notes every moment of hesitation or confusion, with the page, the control and why.
- **Dead ends, wrong turns, misleading copy,** jargon it did not understand, unclear buttons, and anything it expected to happen that did not.
- **Bugs:** console errors, failed requests, broken layout, stuck spinners, lost input, accessibility failures.
- **Trust and validity:** did the resulting research question and literature review actually seem valid and grounded? Are claims traceable to real papers and quotes? Did the app ever overstate (for example, "novel" without the caveat)? Any fabricated or unverifiable content?
- **Whether it completed the goal,** and where it would have quit if it were a real user.
- Screenshots as evidence, saved under `docs/qa/<persona>/`.

Each agent writes a structured report (JSON plus a short narrative) with this shape:

```json
{
  "persona": "",
  "completed": true,
  "stage_reached": 9,
  "findings": [
    {
      "severity": "blocker|major|minor|polish",
      "category": "clarity|bug|a11y|validity|performance|copy",
      "page": "",
      "what_happened": "",
      "expected": "",
      "evidence": "path/to/screenshot",
      "suggested_fix": ""
    }
  ],
  "three_second_test": [{ "page": "", "understood_in_3s": true, "note": "" }],
  "validity_assessment": ""
}
```

### Close the loop

1. Merge and deduplicate the findings into `docs/qa/REPORT.md`, ranked by severity and by how many personas hit them.
2. Fix every blocker and major, and any minor that more than one persona hit. Re-run the affected personas to confirm. This is one QA iteration.
3. Repeat for up to three iterations, or until no persona reports a blocker or major and every page passes the 3-second test for at least 6 of 7 user personas.
4. Re-run `npm run typecheck`, `npm test`, `npm run build` and `node scripts/e2e.mjs`. Report the results exactly, including any failures.

---

## Definition of done

- Every page passes the 3-second test, confirmed by fresh agents, with before/after screenshots at three widths.
- Three.js and Remotion are used meaningfully, with reduced-motion and no-WebGL fallbacks, and the per-route JS cost is reported.
- Accounts work, and data isolation is proven by tests (user A cannot read or modify user B's project through any route).
- The admin dashboard shows accurate telemetry for the app and the server, and the admin persona confirmed it matches the other agents' actual activity.
- `docs/qa/REPORT.md` exists, with all iterations, what was fixed, and what remains.
- README is updated: new env vars, accounts, admin, the new test commands, and the "known limitations" section (it currently says "single user, local only").
- Final message to the user: a short summary, with what changed, what you could not verify, and the remaining known issues stated plainly.
