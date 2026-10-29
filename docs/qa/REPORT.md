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
