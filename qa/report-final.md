# Visual audit: final report

**All 12 checklist items pass in every variant of round 5** (commit `9bc8442`): 24 views × 8 variants = 192 screenshots, at 1440×900 and 390×844, dark and light, with reduced motion on and off. Round 5 is the fifth full round; each earlier round's report is in this folder (`report-1.md` … `report-5.md`, with `.json`).

The round-5 screenshots are committed as WebP in `qa/screenshots/` (`<view>__<width>-<theme>-<motion>.webp`; the PNG originals go to the ignored `qa/shots/5/`).

| # | Checklist item | Result | Checks | Failures |
|---|---|---|---|---|
| 1 | The #1 action is the only accent-filled element and sits above the fold | pass | 192 | 0 |
| 2 | Mission clear in 3 s (squint test: the primary is the highest-contrast element) | pass | 192 | 0 |
| 3 | Nothing outside “Stays visible” is expanded by default | pass | 192 | 0 |
| 4 | No text below 4.5:1; axe reports zero serious or critical issues | pass | 96 | 0 |
| 5 | Visible focus ring on every interactive element; tab through the view, nothing traps focus | pass | 48 | 0 |
| 6 | Reduced motion: no transforms or loops | pass | 96 | 0 |
| 7 | No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px | pass | 96 | 0 |
| 8 | Stale, verified and running are clear without colour (icon + text) | pass | 192 | 0 |
| 9 | 4-pt spacing grid; at most 3 type sizes per view | pass | 192 | 0 |
| 10 | Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph | pass | 3 | 0 |
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip | pass | 8 | 0 |
| 12 | No console errors; no network calls to paid APIs | pass | 3 | 0 |

## How it was run

- `npm run qa -- --round=5` (`scripts/visual-audit.ts`) on a production build (`next build` then `next start`), in mock mode.
  - The server was started with every API key removed from its environment, and with a fresh SQLite database.
  - The audit refuses to run unless the server reports mock mode and not production; the keys are stripped before it starts.
  - `/api/status` reported **0 paid API calls attempted** at the end.
- Fixtures were seeded through the app's own API (mock mode), with one session per state:
  - empty;
  - scoping;
  - ghost subtopics;
  - query;
  - running (retrieval);
  - error;
  - stale;
  - done;
  - ranked;
  - 300 nodes (299: the pipeline plus 280 pinned quotes).
- Per screenshot the audit runs:
  - items 1, 2, 3, 8 and 9 in every variant;
  - items 4 (axe-core, WCAG 2.2 AA tags; serious and critical issues count) and 6 in the reduced-motion variants;
  - item 5 (a Tab walk) at 1440 px;
  - item 7 at 390 px.
- **Item 10.**
  - The 300-node session is panned for 2 s by pointer moves dispatched every animation frame. Frames drawn are counted from the Chrome trace (`DrawFrame`); rAF and the 95th-percentile frame time show whether the main thread kept up.
  - The List view must hold exactly the canvas's nodes, checked for the 300-node and done sessions.
- **Item 11.**
  - Lighthouse 13 runs in mobile emulation, with simulated slow 4G and a 4× CPU slowdown, on 7 pages.
  - Each page gets one warm-up request, then three runs. The median performance score is scored, and accessibility must be 100 in all three. The three runs are shown in brackets below.
  - The brief's two budgets are scored here as well:
    - landing LCP < 2.0 s;
    - canvas route JS < 250 kB gzip, meaning every script the browser has finished loading when the first canvas node becomes visible (Resource Timing).
- **Item 12:** console errors, page errors and any request to a host other than localhost, in every screenshot.

## Measurements (round 5)

| | |
|---|---|
| 300-node pan | **59.1 fps drawn** (rAF 57.2, p95 frame 16.8 ms) |
| Canvas route JS before the first node shows | **242 kB gzip** (first node at 633 ms; elkjs runs in a Web Worker afterwards) |
| Paid API calls | **0 attempted**, 0 blocked |

| Lighthouse (mobile) | Performance, median (runs) | Accessibility | LCP | TBT | CLS |
|---|---|---|---|---|---|
| landing | 99 (95, 99, 99) | 100 | 0.76 s | 105 ms | 0.000 |
| sessions | 93 (92, 93, 96) | 100 | 0.82 s | 304 ms | 0.000 |
| settings | 97 (92, 97, 97) | 100 | 0.77 s | 201 ms | 0.000 |
| canvas-empty | 99 (96, 99, 99) | 100 | 0.76 s | 137 ms | 0.000 |
| canvas-done | 96 (90, 96, 97) | 100 | 0.92 s | 220 ms | 0.002 |
| table | 92 (82, 92, 94) | 100 | 1.07 s | 352 ms | 0.000 |
| export-page | 93 (91, 93, 95) | 100 | 0.91 s | 301 ms | 0.000 |

The table page has the least headroom (median 92; single runs ranged 82–94 across rounds). Its TBT is hydration of a 195-paper TanStack table under the 4× CPU slowdown on this shared container. The other pages scored 93–99.

## Rounds

| Round | Failing items | What changed after it |
|---|---|---|
| 1 | 2, 4, 7, 10, 11 | Accent probe fixed; mark contrast; panel node re-centres after the elkjs layout; 44 px top-bar targets; session-card menu beside its link; the measurement drove the pan at input rate, so it was rewritten; zoomed-out overview (no dot grid, details hidden below 50 %); handles not painted until hover; server-rendered data on every session page; Radix overlays, Motion and route transitions split out of shared chunks; table and export payloads trimmed; export preview capped at 200 lines |
| 2 | 7 | Overlap check clipped to scrolling ancestors (content under a panel footer was counted); landing video waits for its poster |
| 3 | 11 (table, 85) | Server data is copied into the SWR cache instead of being fetched again after hydration; ranking details load when a row opens; canvas prefetch deferred; each page warmed before Lighthouse |
| 4 | 11 (landing LCP 2.32 s) | Phones: the landing's first screen is the mission alone (headline, sentence, one button) and the demo follows; Inter `font-display: optional` |
| 5 | none | – |

## Limits of this audit

- **Item 2 is a squint test.** It checks that the accent-filled primary has the highest contrast of any filled block against the page. It doesn't check what a person notices first.
- **Item 3 is checked on the collapsible regions the code marks.** These are Radix Collapsible (`data-collapsible`) and `<details>`.
- **Lighthouse numbers come from Lantern's simulation of a slow phone.** They move a few points from run to run on this container, which is why each page gets three runs and the median is scored.
- **The frame rate is measured in headless Chromium with software compositing.** A machine with a GPU composites the pan off the main thread.
