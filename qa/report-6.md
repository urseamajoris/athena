# Visual audit, round 6

Run 2026-10-29 11:57 UTC on commit `68e3289`. Production build, mock mode, API keys stripped from the server environment, fresh database. 24 views × 8 variants (1440×900 and 390×844, dark and light, reduced motion on and off) = 188 screenshots in `qa/shots/6/`.

| # | Checklist item | Result | Checks | Failures |
|---|---|---|---|---|
| 1 | The #1 action is the only accent-filled element and sits above the fold | pass | 188 | 0 |
| 2 | Mission clear in 3 s (squint test: the primary is the highest-contrast element) | pass | 188 | 0 |
| 3 | Nothing outside “Stays visible” is expanded by default | pass | 188 | 0 |
| 4 | No text below 4.5:1; axe reports zero serious or critical issues | pass | 94 | 0 |
| 5 | Visible focus ring on every interactive element; tab through the view, nothing traps focus | pass | 47 | 0 |
| 6 | Reduced motion: no transforms or loops | pass | 94 | 0 |
| 7 | No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px | **FAIL** | 92 | 44 |
| 8 | Stale, verified and running are clear without colour (icon + text) | pass | 188 | 0 |
| 9 | 4-pt spacing grid; at most 3 type sizes per view | **FAIL** | 188 | 44 |
| 10 | Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph | pass | 3 | 0 |
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip | **FAIL** | 8 | 3 |
| 12 | No console errors; no network calls to paid APIs | **FAIL** | 7 | 4 |

**Not all items pass yet.**

## Measurements

```json
{
  "bigSessionNodes": 243,
  "canvasPanFps": {
    "raf": 60.4,
    "rafP95FrameMs": 16.8,
    "trace": 60.2,
    "framesWithPan": 121
  },
  "canvasJs": {
    "firstNodeMs": 475,
    "initialGzipKb": 252,
    "totalGzipKb": 295,
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
  "lighthouse": {
    "landing": {
      "performance": 91,
      "accessibility": 100,
      "lcpMs": 2453,
      "tbtMs": 310,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<img src=\"/explainers/stage-2.webp\" alt=\"\" width=\"640\" height=\"360\" loading=\"lazy\" decoding=\"async\" class=\"aspect-video w-full object-cover\">",
      "shifts": [],
      "runs": [
        89,
        91,
        93
      ]
    },
    "sessions": {
      "performance": 100,
      "accessibility": 100,
      "lcpMs": 761,
      "tbtMs": 79,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<p class=\"mt-1 text-fg-1\">",
      "shifts": [],
      "runs": [
        99,
        100,
        100
      ]
    },
    "settings": {
      "performance": 100,
      "accessibility": 100,
      "lcpMs": 756,
      "tbtMs": 70,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<span class=\"block text-fg-1\">",
      "shifts": [],
      "runs": [
        100,
        100,
        100
      ]
    },
    "canvas-empty": {
      "performance": 100,
      "accessibility": 100,
      "lcpMs": 758,
      "tbtMs": 61,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<label for=\"idea\" class=\"mt-1 block text-center text-28 font-semibold\">",
      "shifts": [],
      "runs": [
        100,
        100,
        100
      ]
    },
    "canvas-done": {
      "performance": 89,
      "accessibility": 100,
      "lcpMs": 3395,
      "tbtMs": 73,
      "cls": 0.09499209107871127,
      "failedA11y": [],
      "lcpElement": "<p class=\"min-w-0 flex-1\">",
      "shifts": [
        "0.093 <main id=\"main\" class=\"relative flex-1 overflow-hidden\" aria-label=\"Review list\">",
        "0.002 <div class=\"flex items-center rounded-md border border-line\" role=\"group\" aria-label=\"View\">"
      ],
      "runs": [
        88,
        89,
        89
      ]
    },
    "table": {
      "performance": 96,
      "accessibility": 100,
      "lcpMs": 1210,
      "tbtMs": 165,
      "cls": 0.08478745188822566,
      "failedA11y": [],
      "lcpElement": "<p class=\"mt-1 max-w-3xl text-fg-1\">",
      "shifts": [
        "0.085 <main id=\"main\" class=\"min-h-0 flex-1 overflow-hidden\">"
      ],
      "runs": [
        96,
        96,
        97
      ]
    },
    "export-page": {
      "performance": 97,
      "accessibility": 100,
      "lcpMs": 905,
      "tbtMs": 98,
      "cls": 0.09208228202247357,
      "failedA11y": [],
      "lcpElement": "<p class=\"text-16 font-semibold leading-snug\">",
      "shifts": [
        "0.092 <main id=\"main\" class=\"min-h-0 flex-1 overflow-hidden\">"
      ],
      "runs": [
        97,
        97,
        97
      ]
    }
  },
  "paidCalls": {
    "attempted": 0,
    "blocked": 0
  }
}
```

## 7. No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px: failures

- tap targets under 44px: button "Does sleep affect exam grades in univers" 324×26, button "What helps nurses stay in rural hospital" 253×26, button "How does telemedicine work for older pat" 358×42  
  _4 shots: canvas-empty 390 dark motion-on; canvas-empty 390 dark motion-reduced; canvas-empty 390 light motion-on; canvas-empty 390 light motion-reduced_
- tap targets under 44px: button "Hide this note" 32×44  
  _36 shots: canvas-idea 390 dark motion-on; canvas-ghosts 390 dark motion-on; canvas-running 390 dark motion-on; canvas-error 390 dark motion-on; canvas-done 390 dark motion-on; canvas-stale 390 dark motion-on …_
- tap targets under 44px: button "Journal article
155" 331×32, button "Review article
23" 331×32, button "Preprint
7" 331×32, button "Editorial / letter / comment
10" 331×32  
  _4 shots: panel-corpus-running 390 dark motion-on; panel-corpus-running 390 dark motion-reduced; panel-corpus-running 390 light motion-on; panel-corpus-running 390 light motion-reduced_

## 9. 4-pt spacing grid; at most 3 type sizes per view: failures

- 5 type sizes: 12/14/16/20/44px  
  _4 shots: landing 1440 dark motion-on; landing 1440 dark motion-reduced; landing 1440 light motion-on; landing 1440 light motion-reduced_
- 4 type sizes: 12/14/16/20px  
  _24 shots: panel-corpus-running 1440 dark motion-on; panel-table-error 1440 dark motion-on; panel-export 1440 dark motion-on; panel-corpus-running 1440 dark motion-reduced; panel-table-error 1440 dark motion-reduced; panel-export 1440 dark motion-reduced …_
- 32 off-grid spacings, e.g. span "Systematic / scoping review Systematic review / " rowGap=6px; span "(mock) Horst.Technology Literacy as a Barrier to" rowGap=6px; span "Systematic / scoping review Systematic review / " rowGap=6px  
  _4 shots: table 1440 dark motion-on; table 1440 dark motion-reduced; table 1440 light motion-on; table 1440 light motion-reduced_
- 5 type sizes: 12/14/16/20/28px  
  _12 shots: export-page 1440 dark motion-on; export-page 1440 dark motion-reduced; export-page 1440 light motion-on; export-page 1440 light motion-reduced; landing 390 dark motion-on; export-page 390 dark motion-on …_

## 11. Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip: failures

- 252 kB gzip before the first node shows (budget 250)  
  _1 shot: canvas route JS_
- LCP 2453 ms (budget 2000)  
  _1 shot: landing_
- performance 89, accessibility 100, LCP 3395 ms, TBT 73 ms  
  _1 shot: canvas-done_

## 12. No console errors; no network calls to paid APIs: failures

- view failed to load: TimeoutError: locator.waitFor: Timeout 60000ms exceeded.  
  _4 shots: table 390 dark motion-on; table 390 dark motion-reduced; table 390 light motion-on; table 390 light motion-reduced_
