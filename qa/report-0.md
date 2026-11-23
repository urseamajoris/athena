# Visual audit, round 0

Run 2026-10-28 17:49 UTC on commit `eebc5e1`. Production build, mock mode, API keys stripped from the server environment, fresh database. 24 views × 1 variant = 21 screenshots in `qa/shots/0/`.

| # | Checklist item | Result | Checks | Failures |
|---|---|---|---|---|
| 1 | The #1 action is the only accent-filled element and sits above the fold | **FAIL** | 21 | 3 |
| 2 | Mission clear in 3 s (squint test: the primary is the highest-contrast element) | pass | 21 | 0 |
| 3 | Nothing outside “Stays visible” is expanded by default | pass | 21 | 0 |
| 4 | No text below 4.5:1; axe reports zero serious or critical issues | **FAIL** | 21 | 17 |
| 5 | Visible focus ring on every interactive element; tab through the view, nothing traps focus | pass | 21 | 0 |
| 6 | Reduced motion: no transforms or loops | not run | 0 | 0 |
| 7 | No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px | not run | 0 | 0 |
| 8 | Stale, verified and running are clear without colour (icon + text) | pass | 21 | 0 |
| 9 | 4-pt spacing grid; at most 3 type sizes per view | **FAIL** | 21 | 12 |
| 10 | Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph | **FAIL** | 3 | 1 |
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100 | not run | 0 | 0 |
| 12 | No console errors; no network calls to paid APIs | **FAIL** | 6 | 3 |

**Not all items pass yet.**

## Measurements

```json
{
  "bigSessionNodes": 299,
  "canvasPanFps": {
    "raf": 53.7,
    "trace": 15.2
  },
  "canvasJs": {
    "initialGzipKb": 281,
    "totalGzipKb": 715,
    "lazyChunks": [
      "91dbc596.b6a37ce350701a05.js 434kB"
    ]
  },
  "paidCalls": {
    "attempted": 0,
    "blocked": 0
  }
}
```

## 1. The #1 action is the only accent-filled element and sits above the fold: failures

- primary below the fold: button "Download report"  
  _1 shot: list-view 1440 dark motion-on_
- 0 accent-filled elements:   
  _1 shot: table 1440 dark motion-on_
- primary below the fold: a "Download Markdown"  
  _1 shot: export-page 1440 dark motion-on_

## 4. No text below 4.5:1; axe reports zero serious or critical issues: failures

- label-content-name-mismatch (1: .px-1)  
  _1 shot: sessions 1440 dark motion-on_
- label-content-name-mismatch (1: .font-semibold)  
  _7 shots: canvas-idea 1440 dark motion-on; canvas-ghosts 1440 dark motion-on; canvas-running 1440 dark motion-on; canvas-error 1440 dark motion-on; canvas-done 1440 dark motion-on; canvas-stale 1440 dark motion-on …_
- label-content-name-mismatch (1: a[aria-label="Athena: all sessions"])  
  _7 shots: panel-idea-scoping 1440 dark motion-on; panel-corpus-running 1440 dark motion-on; panel-table-error 1440 dark motion-on; panel-appraisal 1440 dark motion-on; panel-synthesis 1440 dark motion-on; panel-questions 1440 dark motion-on …_
- label-content-name-mismatch (15: .font-semibold | div[data-list-node="idea"] > .min-h-11.text-left)  
  _1 shot: list-view 1440 dark motion-on_
- aria-valid-attr-value (1: #radix-_r_e_-trigger-all)  
  _1 shot: table 1440 dark motion-on_

## 9. 4-pt spacing grid; at most 3 type sizes per view: failures

- 1 off-grid spacings, e.g. div "Start scoping" marginTop=14px  
  _1 shot: canvas-idea 1440 dark motion-on_
- 1 off-grid spacings, e.g. div "Answer the scoping question" marginTop=14px  
  _1 shot: panel-idea-scoping 1440 dark motion-on_
- 6 off-grid spacings, e.g. div "Accept 5 subtopics" marginTop=14px; div "Accept Dismiss" marginTop=34px; div "Accept Dismiss" marginTop=14px  
  _1 shot: canvas-ghosts 1440 dark motion-on_
- 1 off-grid spacings, e.g. div "Retry summary table" marginTop=34px  
  _2 shots: canvas-error 1440 dark motion-on; panel-table-error 1440 dark motion-on_
- 1 off-grid spacings, e.g. div "Download report" marginTop=34px  
  _5 shots: canvas-done 1440 dark motion-on; panel-appraisal 1440 dark motion-on; panel-synthesis 1440 dark motion-on; panel-export 1440 dark motion-on; canvas-300 1440 dark motion-on_
- 1 off-grid spacings, e.g. div "Export" marginTop=14px  
  _1 shot: panel-questions 1440 dark motion-on_
- 1 off-grid spacings, e.g. div "Approve topics" marginTop=14px  
  _1 shot: canvas-stale 1440 dark motion-on_

## 10. Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph: failures

- pans at 15.2 fps (rAF 53.7), below 55  
  _1 shot: canvas-300 (299 nodes)_

## 12. No console errors; no network calls to paid APIs: failures

- view failed to load: TimeoutError: locator.waitFor: Timeout 60000ms exceeded.  
  _3 shots: panel-topic-ghost 1440 dark motion-on; panel-query 1440 dark motion-on; panel-quote 1440 dark motion-on_
