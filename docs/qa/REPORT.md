# Simulated-user QA

Eight Sonnet agents played real users of Athena: seven user personas and one admin. They used the app **only through a browser**, driven from the shell with `scripts/qa-browser.mjs`. They had no source code, no README and no API access. Each user persona had its own production-build server and database in **demo mode** (scripted AI, recorded sample papers, $0). Each signed up through the UI. The admin persona ran afterwards. It logged into every server's dashboard and checked the telemetry against what each user said they did. On one server it also turned AI off and on.

Screenshots are in `docs/qa/iteration-<n>/<persona>/`. Each persona's structured report is in `docs/qa/iteration-<n>/<persona>/report-<n>.json`. The raw results of each iteration are in `docs/qa/iteration-<n>/results.json`.

| Persona | Who | Viewport |
|---|---|---|
| `undergrad` | First-year student, vague idea ("I'm interested in sleep and grades"), anxious about jargon | 1366×900 |
| `masters` | Nursing master's student, precise topic, deadline in two days, skims | 1366×900 |
| `phd` | PhD candidate who wants rigour: checks syntax, edits topics, swaps a ranked paper, inspects quotes | 1366×900 |
| `clinician` | Physician on a phone with 15 minutes | 375×812 |
| `nonnative` | Non-native speaker, typo-heavy idea ("how mobile app help diabtes pateint in thailand…") | 768×1024 |
| `keyboard` | Keyboard only, 200% zoom, low vision | 1366×900 at 2× |
| `chaos` | Double-clicks, reloads mid-job, presses back, edits approved steps, tries another user's project URL | 1366×900 |
| `admin` | Reviews all seven dashboards; turns AI off on one server, checks a user sees the pause, turns it back on | 1366×900 |

## Iteration 1

**Outcome:** all 8 personas completed (step 9 and the export). Nobody hit a blocker. They raised 146 findings: 51 major, 78 minor and 17 polish.

**3-second test:** each persona recorded, for every page it reached, whether it understood that page within 3 seconds.

| Persona | Pages understood in 3 s |
|---|---|
| undergrad | 12/14 |
| masters | 10/16 |
| phd | 13/14 |
| clinician | 13/14 |
| nonnative | 9/15 |
| keyboard | 12/15 |
| chaos | 16/19 |
| admin | 6/7 |

**Isolation held.** The chaos persona opened another user's project URL, both signed out and signed in. Both times it got "Project not found", the same answer as for an invented ID, so it could not even tell the project existed.

**Telemetry matched.** On all seven servers the admin found that the user, project, funnel, quote and appraisal counts matched what each user said they did. The AI switch worked: while AI was off, the new user saw "AI is paused by the administrator. Your work is saved.", got HTTP 503, nothing was faked, and the dashboard's AI-call count did not move. Once AI was back on, the work continued, but the user needed a reload first (see finding 14). The admin saw no ideas, papers, keys or emails in URLs, only counts and a masked key.

The admin could not confirm three things from the dashboard: rejected quotes, the step that chaos reopened, and 15 extra ranking and synthesis calls on the non-native persona's server.

**Colours were understood without being told.** Every persona correctly described the study-type colour + shape + label code, found the study-type and article-type filters, and found the legend.

### Findings, merged and ranked

Counts are how many of the 8 personas hit each problem.

| # | Severity | Personas | Finding |
|---|---|---|---|
| 1 | major (bug) | 6 | After **"Appraise selected papers"** on the table page, the page kept showing step 6. The button vanished, and there was no progress and no way to step 7, while the header said step 7. A browser `removeChild` page error occurred at the 4→5 and 6→7 transitions. |
| 2 | major (validity) | 8 | **Demo mode looked unrelated to the user's idea.** Searches, ranking criteria, candidate questions and the report were about telemedicine in Southeast Asia. The exported report did not say it was a demo. |
| 3 | major (validity) | 5 | **"Verified" was read as "the claim is confirmed"**, but it only means the quoted words are in the paper. |
| 4 | major (bug) | 5 | **Appraisal counters did not go down** after rejecting or accepting quotes ("11 left" stayed 11). A rejected quote vanished with no undo. |
| 5 | major (validity) | 4 | **"Summarise the evidence" went ahead with undecided quotes**, with no warning that they are left out. |
| 6 | major (bug) | 4 | **After "Skip the rest"**, "What we know so far" said "not answered yet" for questions the user had answered. Some answers landed under the wrong field. |
| 7 | major (validity) | 3 | **Ranking pre-selected papers with no topic match** ("Topic fit 1/5: 0 topic terms"). Topics with 0 selected papers gave no warning. |
| 8 | major (validity) | 3 | **Mock topics were single words or typos** ("Help", "Diabtes", "Peer"), and the candidate questions were ungrammatical ("What grades factors shape…"). |
| 9 | major (a11y) | 1 | **Keyboard focus was lost after most actions.** The answer box was not focused when a question appeared. At 200% zoom the panel's scroll area was about 350 px. |
| 10 | major (bug) | 2 | **Search builder:** after the searches ran, query cards still said "Not counted yet". Unsaved criteria were silently lost on "Count matches". An empty `AND ()` group appeared in a generated OpenAlex query. |
| 11 | major (clarity) | 1 | "Go to step 3: Search builder" opened a topic editor. |
| 12 | major (clarity) | 2 | **Step 9:** "you can edit it after", but no edit control was visible. The question-type label did not match the framework used. |
| 13 | major (clarity) | 1 | **Export on a phone:** Markdown was the only report format. |
| 14 | major (admin) | 1 | The **AI calls tile disagreed with the charts** after a pause (56 vs 58). Browser-side errors did not reach the health verdict. Clicking an AI step while AI was off showed a red "That step failed" box instead of the pause message. |
| 15 | minor | 2+ | The report leaked internal claim IDs ("[Lotfi et al. 2026, c_fda84…]"). The "Project not found" page mixed the words session, project and review. Repeated 404 console errors appeared on the new-review page. |

The full list, persona by persona with evidence, is in `docs/qa/iteration-1/results.json`.

### Fixed after iteration 1

Six fix agents worked in parallel, one area each, each in its own git worktree. Each branch was reviewed by an independent agent, then merged. The reviews raised 18 follow-ups; 16 were fixed before iteration 2 (the two left are under "Still open" below). After merging: `npm test` 101/101, `npm run build` clean, `node scripts/e2e.mjs` 30/30, `npm run test:security` 48/48.

| Finding | What changed |
|---|---|
| 1. Stuck after "Appraise selected papers" | **Cause:** the table page only knew stages 5 and 6, so once step 7 started it had nothing to show. It now takes you to the step that is running, which shows live progress. A full page whose step is not the current one offers "Go to step N: …". **The `removeChild` error:** drei's `<Html>` labels moved their DOM while React was rendering. Reproduced in Chromium, then fixed with a fixed label layer in `Scene3D`. |
| 2. Demo unrelated to the idea | **Demo topics, searches and questions:** for any idea other than the telemedicine test idea, they are now built from the user's own words. Topics are multi-word phrases, typos are corrected from the user's own answers, searches contain no telemedicine or Southeast Asia blocks, and candidate questions are grammatical. **Honesty:** the search builder has a point-of-use demo note. In demo mode the report, the spreadsheet and the BibTeX file all carry a "Demo: scripted AI and recorded sample papers; not a real review" line. The telemedicine test idea behaves exactly as before. |
| 3. "Verified" misread | The badges now read **"found word for word"**, "not found, you decide", "not found · accepted by you" and "rejected by you", with one line: "Found means the words are in the paper, not that they prove the answer." |
| 4. Appraisal counters | **Cause:** two different counting rules. There is now one rule (`isUndecided`) for every counter. A rejected quote stays visible, struck through, with Undo. |
| 5. Summarising with undecided quotes | A dialog asks first ("N quotes not decided yet … will be left out of the synthesis"). It uses a fresh count. |
| 6. Answers lost after "Skip the rest" | **Cause:** coverage was read only from the last assistant message, and skipping adds a message with no coverage. Coverage is now taken from the whole conversation, in both real and demo mode. In demo mode each answer is filed under the question it answered. |
| 7. Off-topic pre-selection | A paper is pre-selected only if its topic fit is at least 2/5 (`defaultSelection()`, unit-tested). A topic with fewer than 3 papers is named on the ranking page, and "Appraise selected papers" asks first. |
| 9. Keyboard and zoom | **Focus:** focus moves to the panel heading with a visible ring for keyboard users, or to the answer box when a question appears, and comes back after dialogs close. **Short screens:** below 640 px tall the whole panel scrolls, and the demo banner shrinks to one line. **Navigation:** a "Skip to the next action" link was added, and "Go to step 3" now opens step 3. |
| 10. Search builder | **Counts after the run:** cards show what each search matched when it ran. **Unsaved edits:** criteria are never reset by a re-fetch, and Save sits next to the primary action. **Count changes:** each count remembers what it was counted with, except in demo mode, where counts come from recorded samples. **Syntax:** an empty `AND ()` group is never stored or sent. **Article type:** the retrieval page's article-type bars now filter the chart. |
| 12. Step 9 | An "Edit this question" button sits on the chosen card. The question-type label that guessed from the framework name was removed. |
| 13. Phones | A new "Open printable report" option is a self-contained HTML page that you can save as a PDF. |
| 14. Admin | **AI calls:** one definition everywhere, "calls sent to the model". **Browser errors:** they are now reported to the server (rate-limited, no personal data) and count in the health verdict. **AI paused:** clicking an AI step while AI is off shows the calm paused card, not a red failure. |
| 15. Minor | **Report:** no internal claim IDs; citations name only the papers. **Sign-up page:** the password hint no longer overlaps the field. **Labels:** canvas badges are explained in their tooltips. |

## Iteration 2

The same eight personas ran again on fresh servers built from the merged fixes.

**Outcome:** all 7 user personas reached step 9 and the export. Nobody hit a blocker. Majors fell from 51 to **29**; there were 71 minor and 13 polish findings.

**3-second test:**

| Persona | Iteration 1 | Iteration 2 |
|---|---|---|
| undergrad | 12/14 | 10/14 |
| masters | 10/16 | 11/16 |
| phd | 13/14 | 10/14 |
| clinician | 13/14 | 12/14 |
| nonnative | 9/15 | 11/14 |
| keyboard | 12/15 | 12/14 |
| chaos | 16/19 | 13/15 |

The pages a persona misread were mostly the busy ones: ranking, appraisal and the search builder.

**What iteration 1's fixes changed for users:**

- **No dead end after "Appraise selected papers".** No persona reported the `removeChild` error.
- **Counters agreed** and rejected quotes stayed visible with Undo.
- **"Found word for word" was read correctly** by most personas. Some still asked for a separate "does this quote support the answer?" check.
- **Demo topics, searches and questions used the user's words**, and the exported files said they were a demo.
- **Isolation held again.** Another user's project gave "Project not found", which reveals nothing about it.

**Admin:** the kill-switch check passed again. The AI-call count stayed at 48 while AI was off and rose to 50 only after AI was turned back on. The blocked call was shown as "1 blocked, not sent". The admin found no ideas, papers, keys or emails in URLs.

The admin's first report failed the report schema, and it then sent a blank placeholder. The workflow now tells agents to resend the same content when the schema rejects it. Its 9 minor and polish findings were recovered from its transcript, but its per-server telemetry comparison was not. One of them: the mock QA servers had inherited the real xAI key from the environment. The dashboard showed only its masked last 4 characters, and the key was never used. QA servers now start with every API key removed from their environment.

### Findings, merged and ranked

| # | Severity | Personas | Finding |
|---|---|---|---|
| 1 | major (clarity) | 4 | The ranking checklist ticked "Keep 3–5 papers per topic" while the warning on the same page said topics had fewer than 3. |
| 2 | major (validity) | 2 | A paper was marked both "does not match the topic" and "Selected for appraisal". |
| 3 | major (validity) | 4 | The novelty check said "No closely matching records were returned" directly under "2,207 matching records". |
| 4 | major (validity) | 6 | Demo synthesis statements were content-free ("(mock) 8 key findings were extracted"). Gap quotes were unrelated to the gap. The planted altered quote appeared in every paper. |
| 5 | major (validity) | 2 | Demo candidate questions: the PECO breakdown reversed exposure and outcome. For "does X help?" no candidate was an effect question. |
| 6 | major (bug) | 2 | After "Summarise without them", the panel stayed on step 7, with "Next paper" as its primary action. |
| 7 | major (validity) | 3 | A topic with 0 papers silently disappeared from the synthesis. |
| 8 | major (a11y) | 1 | On the table page the primary button came after about 95 Tab stops. Focus was lost after Esc in List view, after hiding the demo note, after moving to a new page, and after "Keep" on a list row. |
| 9 | major (clarity) | 1 | Editing a topic at step 3 reopened step 2 for the whole review, with no message. |
| 10 | major (clarity) | 1 | The export gave no visible confirmation on a phone, and the printable report was easy to miss. |
| 11 | major (validity) | 1 | The report did not say the search is a scoping aid, capped at 40 records per search and run topic by topic, not an exhaustive systematic search. |
| 12 | major (validity) | 1 | Demo counts did not reconcile between the dry run and the retrieval run. This is a demo-fixture artefact: recorded samples are picked by request. |
| 13 | minor | 2+ | After typing the idea, step 1 asked for it again. Deleting a topic had no undo. The "Project not found" page had no header, a pointless "Try again", and called it a "session". The demo admin panel showed a key tail and real model names for mock calls. Skipped scoping questions appeared in the report as mock defaults. |

### Fixed after iteration 2

Four fix agents worked in parallel worktrees, each followed by an independent review; I then merged their branches. The reviews raised 9 follow-ups. I fixed 8; the ninth (a small layout shift when the download message appears) is left as a known minor.

After merging, `node scripts/e2e.mjs` caught a React hook-order error (#310). The new idea-autosave hook ran after the panel's early returns; it now runs before them. Final results: `npm test` 113/113, `npm run build` clean, `node scripts/e2e.mjs` 30/30, `npm run test:security` 48/48.

| Finding | What changed |
|---|---|
| 1. Checklist contradicted the warning | **Checklist:** when few papers match a topic, the item reads "Keep 3–5 papers per topic, or every matching paper where fewer match", and it ticks only when that is true. **Thin topics:** the dialog and the ranking warning offer "Edit the searches for *topic* (step 3)", which opens that topic's own searches. |
| 2. "Does not match" yet "Selected" | Pre-selection and the labels now use one threshold. A paper the user keeps anyway says "Kept by you, but it does not match the topic". Phone and tablet cards show the same words as the table, including under "All topics". |
| 3. Novelty contradiction | One shared verdict in `src/lib/shared/novelty.ts`, unit-tested, keeps two things apart: how many records contain the search words, and whether a top record looks like the same question. **"The same question":** a title must touch the intervention or exposure, and hyphen spellings now match. **Large counts:** never headlined as a hint that the question is new. **Demo records:** never given a novelty verdict. The exported report uses the same wording. |
| 4. Vacuous demo synthesis | **Statements:** Known statements condense a cited finding and name the paper. Unknown statements come from the cited limitations. Contested statements set two findings from different papers side by side, saying they may not really disagree. **Altered quote:** planted in only one or two papers per review, and it comes back after re-retrieval. **Gap quotes:** limitations first. |
| 5. Demo questions | **Direction:** exposure and outcome follow the order in the idea. **Comparison:** a contrast that fits, e.g. "usual care, without …", "fewer …" or "less use of …" (only for things people use). **Effect question:** "Does X help…?" now gets a PICO effect question. **Skipped scoping questions:** they read "not stated". |
| 6. Panel stayed on step 7 | After "Summarise without them" the panel moves to the synthesis step. |
| 7. Empty topics vanished | **Note:** the synthesis names each topic that has no evidence, and why (no papers found, none matched, none selected). **Out of date:** if the synthesis is stale, it gives no reason. |
| 8. Keyboard | **Tab order:** a "Skip to the next action" link on the table page. **Focus:** handled after Esc in List view, after hiding the demo note, on new pages and after "Keep". |
| 9. Silent reopening of step 2 | Editing a topic after step 2 was approved now says plainly that step 2 has reopened and what to do. |
| 10–11. Export and report | **Phones:** the printable report is the first choice on narrow screens, and Download shows a visible confirmation. **Report header:** it says the search is a scoping aid, at most 40 records per search, with topics searched one at a time, and is not exhaustive. |
| 13. Minor | **Step 1:** it reads as a confirmation of the idea already entered, and the idea saves itself. **Topics:** deleting one offers Undo. **Review not found:** a page with a header and plain words, and no pointless retry. **Demo admin panel:** says "Demo mode: no key is used and nothing is spent", and labels mock calls as mock. |

## Iteration 3

The same eight personas ran on fresh servers built from the iteration-2 fixes. Every API key was removed from the servers' environment.

The usage limit stopped six personas partway through. After the reset I restarted the two finished personas' servers with their databases intact, so the admin could still check them. The other five personas started over on fresh servers, and the workflow resumed with the finished two taken from cache.

**Outcome:** all 7 user personas reached step 9 and the export. There were 26 majors (29 in iteration 2, 51 in iteration 1), 75 minor and 17 polish findings. Nobody hit a blocker.

**3-second test:**

| Persona | Iter 1 | Iter 2 | Iter 3 |
|---|---|---|---|
| undergrad | 12/14 | 10/14 | 12/16 |
| masters | 10/16 | 11/16 | 11/14 |
| phd | 13/14 | 10/14 | 14/15 |
| clinician | 13/14 | 12/14 | 12/14 |
| nonnative | 9/15 | 11/14 | 14/17 |
| keyboard | 12/15 | 12/14 | 14/16 |
| chaos | 16/19 | 13/15 | 15/17 |
| admin | 6/7 | – | 6/6 |

The page understood least was the **first canvas view**. Several personas asked why "Sharpen my idea" (on the card) and "Open step 1" (at the top) both appear.

**Isolation held.** Another user's project URL showed "This review could not be opened. The link may be wrong, or the review belongs to another account.", the same as for an invented ID. Signed out, it asked the user to log in.

**Telemetry:** on 6 of 7 servers the admin found that the dashboard matched what the user did: users, projects, the funnel, AI calls and errors. On the chaos user's server the funnel contradicted the "1 finished" tile after the user edited an approved step. The fix for that is listed under "Fixed after iteration 3".

**The AI switch improved.** While AI was off the call count stayed at 46, with "1 blocked, not sent" and then 2. When it was turned back on, the user's step resumed by itself; in iteration 1 the user had to reload.

**Separate check: 3-second test round 4.** Fresh agents were shown only the final v4 screenshots of 32 page states, at 375, 768 and 1366 px. For all 32, they gave the purpose, first action and next action that `docs/ux-intent.md` intends. The results are in `docs/screenshots/ux/round-4-results.json`.

### Findings, merged and ranked

| # | Severity | Personas | Finding |
|---|---|---|---|
| 1 | major (clarity) | 4 | After "Write the searches", the panel stayed on the topic editor ("Viewing step 2") while the canvas showed the new searches. |
| 2 | major (validity) | 2 | An appraisal quoted a **different paper's** text, marked "found word for word". In demo mode this comes from recorded full-text fixtures matched by request. The app never checked that a fetched full text belongs to the paper. |
| 3 | major (validity) | 6 | Demo artefacts: off-topic sample papers score 60–70 and are pre-selected as "matching". Synthesis and gap quotes come from off-topic papers. "(mock)" appears in the exported question. Each of these is labelled as demo output, but personas still found them confusing. |
| 4 | major (a11y) | 1 | **Keyboard:** "Reject" sends focus to the heading of a long paper. A fifth scoping answer was typed into nothing after the chat ended. At 200% zoom the focused answer box sits half behind the footer. |
| 5 | major (validity) | 2 | **Demo questions:** a truncated word ("…hip fract?"), a repeated phrase, and a clause from an answer used as a search synonym. |
| 6 | major (clarity) | 1 | A paper deselected in one topic still went to appraisal because it is selected in another topic, and the count did not change. |
| 7 | major (admin) | 1 | The funnel and the "finished" tile disagreed after a user edited an approved step. |
| 8 | major (bug) | 1 | A topic was deleted with no visible Undo (the Undo was only announced to screen readers). |

### Fixed after iteration 3

Three fix agents worked in parallel worktrees, and each branch got an independent review. The reviews raised 5 follow-ups, all fixed before merging. After merging: `npm test` 122/122, `npm run build` clean, `node scripts/e2e.mjs` 30/30, `npm run test:security` 48/48.

| Finding | What changed |
|---|---|
| 1. Searches not shown after writing them | **Cause:** the live summary arrived after the request, so the panel opened the first topic's editor before the search nodes existed. The panel now waits for them and opens the first topic's searches, on the canvas and in List view. |
| 2. Another paper's full text | A new title check (`src/lib/sources/match.ts`, unit-tested) compares a fetched full text's own title, or for a PDF its opening, with the paper's title. Word pairs made only of study-design words or place names do not count. When the titles do not match, the text is discarded and the abstract is used, with a plain note. This applies in real mode too. |
| 4. Keyboard | **Typing while an answer is sent:** the text stays in the box, and is kept if the send fails. Text typed after the last question is shown as "not sent". **Quote decisions:** after Accept or Reject, focus moves to the next undecided quote. **Short screens:** the focused control scrolls into view above the footer, for keyboard focus only, so a mouse click is never moved away. The footer is compact below 640 px tall. |
| 5. Demo questions | No word is cut mid-way, the population's phrase is not repeated, and synonyms are short terms, not clauses from answers. |
| 6. Cross-topic selection | Deselecting a paper that is still selected in another topic now says so, and says that it will still be appraised. |
| 7. Admin funnel | One progress rule for the tiles, the funnel and the accounts table, with labels that say what each counts. Unit-tested. |
| 8. Topic Undo | A visible Undo restores a deleted topic in place and returns focus to it. |
| First canvas view | The next-step bar on a new review offers the card's own action ("Sharpen my idea"), not a second "Open step 1". The canvas cards say Keep/Delete, like the panel. |

## Visual audit (`npm run qa`), final rounds

**Round 6** covered 24 views, at 1440 and 390 px, in dark and light, with motion on and reduced. That is 188 screenshots plus Lighthouse on 8 pages, and the full report is in `qa/report-6.md`. 8 of the 12 checklist items passed everywhere. The failures were:

- tap targets under 44 px at 390 px: the example chips, the demo note's close button and the article-type bars;
- the landing page's largest paint at 2.45 s, against a 2 s budget;
- the canvas page's JavaScript at 252 kB before the first node, against a 250 kB budget;
- the audit's own table-view selector, which waited for table rows that phones show as cards;
- typography: views with more than 3 text sizes, and a few 6 px gaps.

**After the fixes**, rounds 7 and 8 re-checked the affected views. **Tap targets:** all 44 px on phones. **Landing page:** on phones the first screen is now the mission alone (headline, one sentence, one button), so the largest paint dropped to 0.76 s with Lighthouse mobile performance 94 and accessibility 100. **Canvas JavaScript:** within budget, after the error page is loaded only when needed. **Table:** loads at both widths. **Typography:** panels use three sizes, and the chip gaps are on the 4 pt grid. The landing and export pages still use 4–5 sizes. That breaks only the audit's own 3-size rule and is left as a known minor.

## Real-AI validation

Only real model output can show whether the research question and the review are valid, so a small, planned part of the budget went on real runs.

**Setup:**

- **Server:** production mode (`ATHENA_ENV=production`, `MOCK_MODE=false`), using the real xAI models and the real PubMed and OpenAlex databases.
- **Database:** its own, `data/qa-real.db`, with the budget capped at **$10**. This keeps at least $5 of the key's $15 limit in reserve.
- **The xAI key:** used only by that server, from the server's environment. It was never shown to an agent or printed.
- **Runs:** one persona at a time, with spend read from `ai_calls` after each run.

All three model IDs were confirmed through the free `/v1/models` check before the first run.

### Real run 1: the PhD candidate

**Spend: $0.85** for 72 AI calls, of which 71 succeeded.

**The run:**

- **Retrieval:** 204 real papers.
- **Appraisal:** 11 papers, 8 from full text and 3 from abstracts.
- **Quote check:** 159 of 179 quotes found word for word.
- **Chosen question:** *"What is the long-term trajectory of return-to-work outcomes beyond 24 months among healthcare workers who develop long COVID compared to those who do not?"*

The persona finished all nine steps. Its summary of the run was lost with the failed report (see below), but its findings were recovered. It found 18 issues that demo mode could not show (6 major), and all of them were fixed before run 2:

| Finding (real mode) | What changed |
|---|---|
| False "not found" flags. The model joins passages with "…"; hyphens and spacing such as "n = 463" differ from the paper. | **What a match tolerates:** hyphens count as spaces, no space is kept next to = and %, and a single quotation mark is dropped. **What it still requires:** word boundaries and apostrophes are kept, so "a symptomatic" ≠ "asymptomatic" and "patient's" ≠ "patients". **Quotes with "…":** checked part by part, in the paper's order, and each part must be 4 or more words. Parts in another order stay "not found", with a note saying why. Sentences joined without "…" get a note too. **Re-check on run 1's quotes:** none of the 159 verified quotes was lost, and 1 more genuine quote verifies. |
| A paper's "abstract" was only a data-availability notice, and the AI used it as the key finding. | Boilerplate (data availability, funding, conflicts of interest, copyright) is cut at ingestion, from OpenAlex, PubMed and Crossref. A text too short to be an abstract counts as no abstract, so the PubMed abstract can be used instead. Unit-tested. |
| A search without the main concept. A topic with no terms of its own. A study design turned into a topic. | New prompt versions `search_builder.v2` and `scoping_topics.v2`. **Searches:** every query includes the main concept, and each topic has its own terms. **Topics:** study designs, languages and years are criteria, never topics. |
| "Known: what the papers agree on" listed a single study, and a preprint and its journal version looked like two sources. | **Prompt:** `synthesis.v4` requires two independent studies for "known" and treats a preprint and its journal version as one study. **Panel:** every statement shows how many papers its quotes come from ("1 paper only" for a single-paper Known), with a reminder to check that they are separate studies. |
| The question said 24 months, its gap 6 and its feasibility 12. A near-identical study was flagged only inside the reasoning. | **Prompt:** `research_questions.v3` requires one population, time frame and outcome throughout. **Card:** a "May already be studied" warning now sits on the candidate's card itself. |
| UI bugs. **Table:** the Title column collapsed when extra columns were shown. **Searches:** writing them showed only a 75-second spinner. **Footer:** said "Go to step 3" while on step 3. **Checklists:** ticked items before any work. **Topics:** a kept topic still said "Your turn". | **Table:** Title keeps a readable width and the table scrolls sideways. **Searches:** a status line while they are written. **Footer:** on the current step it shows that step's own action. **Checklists:** an item ticks only once it is true with data loaded. **Topics:** a kept topic shows as kept. |

After the fixes: `npm test` 145/145, `npm run build` clean, `node scripts/e2e.mjs` 30/30, `npm run test:security` 48/48.

The persona's report failed the report schema on its first attempt (findings only), and its retry was a placeholder. It was recovered from the transcript. For the later runs the schema asks for the summary fields first and the findings last.

### Real run 2: the first-year undergraduate

**Spend: $0.85** for 71 AI calls (cumulative after two runs: **$1.70**, 143 calls, 142 succeeded).

**The run:**

- **Idea:** "I'm interested in sleep and grades", sharpened through the scoping chat into 5 topics.
- **Appraisal:** 14 papers.
- **Quote check:** 184 of 190 quotes found word for word. The 6 others were real text joined without "…", and the note said so; the persona accepted 5 and rejected 1.
- **Report:** the persona's report is complete this time (the schema change worked): `docs/qa/real-2/undergrad/report.json`.

The persona finished all nine steps. Its verdict: "Nothing looked fabricated. The risk is overstated gaps and false-comfort novelty, not invented papers." It found 19 issues (4 major, 13 minor, 2 polish). What changed:

| Finding (real mode) | What changed |
|---|---|
| **Gap contradicted by the review's own papers.** The chosen question claimed "all existing studies examined only specific exam performance rather than cumulative GPA", while three appraised papers studied GPA. The novelty check did not notice. | **Prompt:** `research_questions.v4` forbids absolute gap claims ("no study", "all studies") and asks for the closest existing study by name. **Novelty check:** every question is now also compared with the papers this review collected. A match puts "One of the papers in this review looks like the same question" at the top of the check, lists it on the card's "May already be studied" warning ("already in this review") and in the export. Unit-tested on this exact case. |
| **False novelty warning.** A paper on sleep and *periodontal disease* in students was flagged as "the same question" as a GPA question. | A title that shares the exposure and population but names another outcome no longer counts as the same question. A title that names the outcome in full ("… GPA and college graduation") needs only one word of the exposure. Unit-tested with both titles. |
| **Synthesis overgeneralised.** "All studies used cross-sectional designs" cited 2 papers while cohort studies were in the set; a "Known" statement rested on R² = 0.0008 with no caveat; two papers from one cohort were shown as a disagreement. | **Prompt:** `synthesis.v5`: quantities ("all", "few", "most") must match the papers actually counted, effect sizes are kept with the statement, and papers from the same cohort count as one study. |
| Dense step 7 and 8 panels. | Not changed in this PR (see Remaining issues). |
| The typed answer did not show in the scoping chat for about 20 seconds. | The answer appears as your message at once, with "Thinking about the next question…" under it. |
| While papers were being scored, step 6 showed "0 selected" on every topic and "no papers match" warnings. | The counts and warnings wait until scoring has finished. |
| An abstract was labelled "Full retrieved text". | It is now labelled "The abstract that was read". |
| The report was titled with the raw idea ("I'm interested in sleep and grades"). | The report is titled with the chosen research question. |
