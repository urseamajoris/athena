# Visual audit, round nomock

Run 2026-10-29 15:14 UTC on commit `4cea58c`. Production build, no xAI key (API keys stripped from the server environment), fresh database, so every AI step was refused and nothing was spent. 19 views × 1 variant = 19 screenshots in `qa/shots/nomock/`.

| # | Checklist item | Result | Checks | Failures |
|---|---|---|---|---|
| 1 | The #1 action is the only accent-filled element and sits above the fold | pass | 19 | 0 |
| 2 | Mission clear in 3 s (squint test: the primary is the highest-contrast element) | pass | 19 | 0 |
| 3 | Nothing outside “Stays visible” is expanded by default | pass | 19 | 0 |
| 4 | No text below 4.5:1; axe reports zero serious or critical issues | pass | 19 | 0 |
| 5 | Visible focus ring on every interactive element; tab through the view, nothing traps focus | **FAIL** | 19 | 2 |
| 6 | Reduced motion: no transforms or loops | not run | 0 | 0 |
| 7 | No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px | not run | 0 | 0 |
| 8 | Stale, verified and running are clear without colour (icon + text) | pass | 19 | 0 |
| 9 | 4-pt spacing grid; at most 3 type sizes per view | **FAIL** | 19 | 4 |
| 10 | Canvas: 300 nodes pan at ≥ 55 fps (needs AI output: not run without a key); List view matches the graph | pass | 1 | 0 |
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip | **FAIL** | 1 | 1 |
| 12 | No console errors; no network calls to paid APIs | pass | 4 | 0 |

**Not all items pass yet.**

## Not covered without an xAI key

Mock mode was removed, so views that need AI output are not seeded here; they need a real run with a key (which spends money):

- panel-idea-scoping (the scoping chat: AI questions)
- canvas-ghosts, panel-topic-ghost (topics suggested by the AI)
- panel-query (searches written by the AI)
- canvas-running, panel-corpus-running (retrieval needs the searches)
- canvas-error, panel-table-error (summary rows are AI output)
- canvas-done, panel-appraisal, panel-synthesis, panel-questions, panel-export, panel-quote (a finished review)
- canvas-stale (needs retrieval and later steps)
- table (papers, summaries and ranking)
- canvas-300 and item 10's 300-node pan at ≥ 55 fps (the 300 nodes are pinned quotes from appraisals)

## Measurements

```json
{
  "canvasNodes": 5,
  "canvasJs": {
    "firstNodeMs": 441,
    "initialGzipKb": 251,
    "totalGzipKb": 294,
    "lazyChunks": [
      "6305.48fbef8785c683f8.js 2kB",
      "6200.1b072df436c8acda.js 1kB",
      "663-18a66eb98b8496ae.js 4kB",
      "535-f73bce449852306b.js 8kB",
      "3500-91711a1ed0059196.js 10kB",
      "7308-b4637169013c4db1.js 5kB",
      "7971-b985933d11d94b61.js 5kB",
      "1646-7bfce879cade0381.js 4kB",
      "page-bdc3bf28867ec2c0.js 5kB"
    ]
  },
  "paidCalls": {
    "attempted": 0,
    "blocked": 0
  },
  "spendUsd": 0
}
```

## 5. Visible focus ring on every interactive element; tab through the view, nothing traps focus: failures

- focus is stuck on button:Table:442  
  _2 shots: admin 1440 dark motion-on; admin-ai-off 1440 dark motion-on_

## 9. 4-pt spacing grid; at most 3 type sizes per view: failures

- 4 type sizes: 12/14/16/44px  
  _1 shot: landing 1440 dark motion-on_
- 4 type sizes: 12/14/20/28px  
  _1 shot: export-page 1440 dark motion-on_
- 4 type sizes: 12/14/16/20px  
  _2 shots: admin 1440 dark motion-on; admin-ai-off 1440 dark motion-on_

## 11. Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip: failures

- 251 kB gzip before the first node shows (budget 250)  
  _1 shot: canvas route JS_
