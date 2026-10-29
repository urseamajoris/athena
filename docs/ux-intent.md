# UX intent: what each page should say in 3 seconds

Every page must pass the **3-second test**: within 3 seconds a first-time user can say what the page is for, what to do, and the single next action. These are the intended readings. The fresh-agent tests in `docs/screenshots/ux/*/v*/` and the persona QA in `docs/qa/` are scored against them.

Shared on every step page:

- **Where am I:** "Step N of 9 · *step name*" with a 9-segment strip (done ✓, current ringed, out of date ⚠, numbered, never colour alone) and "Next: …".
- **One primary action**, accent-filled, in the panel footer (desktop) or a bottom bar (phones). A panel whose step is not the current one offers "Go to step N" instead, so no page is a dead end.
- **Headline = the task**, in plain words, then one sentence of what to do. Detail (costs, raw queries, weights, model names) sits behind "Details" or ⋯.
- **What happens in this step:** an 8-second explainer video (pre-rendered with Remotion) and the same three lines as text. Collapsed by default.
- **States:** running (live progress, "safe to close"), paused (AI off, budget, or no xAI key: "Your work is saved", Resume when possible), failed (what went wrong, Retry), out of date (why, Keep or Bring up to date, link to the step that needs approval first).
- **No xAI key:** AI steps say "AI is not set up yet" (an administrator adds a key); the work is saved, everything that needs no AI still works, and nothing is charged.

| Page | It is for | Do first | Single next action |
|---|---|---|---|
| Landing `/` | Turning a rough idea into a defensible research question, with real papers and checked quotes | Read the headline and the 3 stages | **Start a review** (sign up) |
| Sign up / Log in | Creating or opening your private account | Fill in email and password | **Create account** / **Log in** |
| My projects `/sessions` | Your literature reviews, each at a step of 9 | Find the project (title, started date, progress bar) | Open it (continues at its current step) or **Start a new review** |
| New review `/s/new` | Step 1: describe your research idea | Type a sentence (or click an example) | **Start my review** |
| Idea (scoping chat) | Step 2: answer a few questions to sharpen your idea | Answer the question in your own words | **Send answer** (up to 5; skip via ⋯) |
| Scoping (topics) | Step 2: keep the search topics you want | Keep or delete each suggested topic, open one to edit | **Keep N suggested topics**, then **Use these topics** |
| Search builder | Step 3: check the database searches before they run | Read each concept block; count matches | **Run all N searches** |
| Retrieval | Step 4: see what was found (and the mix of study and article types) | Read "N fetched, M duplicates, K papers" | **Summarise the papers** |
| Summary table | Step 5: skim the papers and fix wrong AI cells | Do the 3-item checklist (see the mix, open a paper, correct a cell) | **Rank the papers** |
| Ranking | Step 6: check which papers go forward (3–5 per topic) | Pick a topic, open a selected paper, keep 3–5 per topic | **Appraise selected papers** |
| Appraisal | Step 7: check each paper's appraisal and decide unverified quotes | Go paper by paper; "Show only quotes I need to decide" | **Next paper**, then **Summarise the evidence** |
| Synthesis | Step 8: read what is known, contested and unknown | Read each topic and where its papers disagree; fix overstated statements | **Suggest research questions** |
| Research question | Step 9: choose your research question | Compare the three candidates (gap, feasibility, weakness on each card) | **Choose this question**, then **Finish and export** |
| Export (final) | Your literature review is ready to download | Check the question and pick a format | **Download** |
| Overview (canvas / list) | The whole review at a glance | Find the highlighted step that needs you | The current step's action |
| Account | Your profile, password, AI use, data | Change what you came for | (no single primary: separate forms) |
| Settings | Appearance and how the server runs (AI on, off or not set up) | Pick a theme | (none) |
| Admin `/admin` | "Is Athena healthy, and what needs my attention?" | Read the verdict and its reasons | Act on the first reason (AI & API key panel is next) |

## Categories and colour coding

The rules (implemented in `src/lib/shared/categories.ts`, tokens `--cat-1..8`, `--cat-none`, `--seq-1..5` in `src/app/globals.css`):

1. **Only the "Colour by" dimensions have hues** (study type, topic, source, evidence status, score). Article type, year, full text and selection use their shapes in plain ink, so a colour never means two things on one screen.
2. **One meaning per colour within a dimension, everywhere.** A study type has the same colour and shape in the table cell, the facet chip, the map point, the 3D node, the legend, the retrieval mix bars, the evidence network and the admin chart.
3. **Default colour = study type.** "Colour by" switches between study type, topic, source database, evidence status and ranking score (the last as a one-hue light-to-dark ramp, labelled). The switch is saved per project and changes the 2D and 3D views together.
4. **Never colour alone.** Every category also has a **shape** (circle, square, triangle, diamond, star, cross, ring = "not reported / unknown") and a **text label**. Legends are always shown.
5. **Legend interaction:** hover or focus highlights a category; click isolates it (click again for all).
6. **Size and brightness mean something only where the legend says so:** faded = not selected for appraisal (ranking map).
7. **The palette is validated** (`dataviz` validator): adjacent-pair colour-blind separation ΔE ≥ 8, normal-vision ΔE ≥ 15, and every colour ≥ 3:1 against the page and card surfaces in both themes (`src/lib/design/categories.test.ts`).
8. **Fallbacks keep the same encoding:** with no WebGL, on weak devices, or by choice ("Show as 2D chart"), the 2D versions use the same colours, shapes and legend; under reduced motion nothing moves on its own.

| Study type (default colour) | Shape | Meaning |
|---|---|---|
| Trial | circle | assigned an intervention and compared outcomes |
| Cohort / case-control | square | followed people over time, or compared cases with controls |
| Cross-sectional | triangle | a snapshot, e.g. a survey |
| Qualitative / mixed methods | diamond | interviews, focus groups, observation |
| Systematic / scoping review | star | a structured summary of earlier studies |
| Other design | cross | narrative reviews, economic evaluations, case reports, protocols, commentaries |
| Not reported | ring (grey) | the abstract does not say |

**Filters are views, not deletions.** Category filters never remove papers from the review: the page says "Showing X of Y: …" in plain words, warns how many are hidden, and keeps **Reset filters** visible. The only way to exclude papers at the source is the optional **hard article-type filter** in the search criteria: off by default, labelled with a warning, logged, and listed in the report.

**What a first-time user should be able to say about the colours:** "The colours (and shapes) show the kind of study; the legend lists them, and I can show only one kind by clicking it."
