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
