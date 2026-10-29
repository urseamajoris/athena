# Visual audit, round 3

Run 2026-10-28 20:11 UTC on commit `3b854d2`. Production build, mock mode, API keys stripped from the server environment, fresh database. 24 views × 8 variants (1440×900 and 390×844, dark and light, reduced motion on and off) = 192 screenshots in `qa/shots/3/`.

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
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip | **FAIL** | 8 | 1 |
| 12 | No console errors; no network calls to paid APIs | pass | 3 | 0 |

**Not all items pass yet.**

## Measurements

```json
{
  "bigSessionNodes": 299,
  "canvasPanFps": {
    "raf": 59.4,
    "rafP95FrameMs": 16.8,
    "trace": 59.9,
    "framesWithPan": 119
  },
  "canvasJs": {
    "firstNodeMs": 675,
    "initialGzipKb": 242,
    "totalGzipKb": 287,
    "lazyChunks": [
      "6305.48fbef8785c683f8.js 2kB",
      "6200.1b072df436c8acda.js 1kB",
      "663-18a66eb98b8496ae.js 4kB",
      "535-f73bce449852306b.js 8kB",
      "3500-91711a1ed0059196.js 10kB",
      "7308-b4637169013c4db1.js 5kB",
      "7971-b985933d11d94b61.js 5kB",
      "1646-e99e47a95fdd2b0e.js 4kB",
      "page-9e35893c2974ac1c.js 7kB"
    ]
  },
  "lighthouse": {
    "landing": {
      "performance": 99,
      "accessibility": 100,
      "lcpMs": 1727,
      "tbtMs": 122,
      "cls": 0,
      "failedA11y": [],
      "shifts": [],
      "runs": [
        99,
        99,
        99
      ]
    },
    "sessions": {
      "performance": 92,
      "accessibility": 100,
      "lcpMs": 773,
      "tbtMs": 347,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<span class=\"line-clamp-3 font-medium text-fg-0\">",
      "shifts": [],
      "runs": [
        92,
        92,
        96
      ]
    },
    "settings": {
      "performance": 98,
      "accessibility": 100,
      "lcpMs": 766,
      "tbtMs": 167,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<p class=\"mt-1 text-fg-1\">",
      "shifts": [],
      "runs": [
        94,
        98,
        98
      ]
    },
    "canvas-empty": {
      "performance": 99,
      "accessibility": 100,
      "lcpMs": 766,
      "tbtMs": 121,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<label for=\"idea\" class=\"block text-center text-28 font-semibold\">",
      "shifts": [],
      "runs": [
        97,
        99,
        99
      ]
    },
    "canvas-done": {
      "performance": 92,
      "accessibility": 100,
      "lcpMs": 917,
      "tbtMs": 364,
      "cls": 0.002311872159987875,
      "failedA11y": [],
      "shifts": [
        "0.002 <div class=\"flex items-center rounded-md border border-line\" role=\"group\" aria-label=\"View\">"
      ],
      "runs": [
        90,
        92,
        95
      ]
    },
    "table": {
      "performance": 85,
      "accessibility": 100,
      "lcpMs": 1230,
      "tbtMs": 512,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<button class=\"link min-h-11 text-left font-medium md:min-h-0\">",
      "shifts": [],
      "runs": [
        83,
        85,
        92
      ]
    },
    "export-page": {
      "performance": 95,
      "accessibility": 100,
      "lcpMs": 911,
      "tbtMs": 258,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<span class=\"block [content-visibility:auto] [contain-intrinsic-size:auto_20rem]\">",
      "shifts": [],
      "runs": [
        87,
        95,
        95
      ]
    }
  },
  "paidCalls": {
    "attempted": 0,
    "blocked": 0
  }
}
```

## 11. Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip: failures

- performance 85, accessibility 100, LCP 1230 ms, TBT 512 ms  
  _1 shot: table_
