# Visual audit, round 2

Run 2026-10-28 19:54 UTC on commit `00b374c`. Production build, mock mode, API keys stripped from the server environment, fresh database. 24 views × 8 variants (1440×900 and 390×844, dark and light, reduced motion on and off) = 192 screenshots in `qa/shots/2/`.

| # | Checklist item | Result | Checks | Failures |
|---|---|---|---|---|
| 1 | The #1 action is the only accent-filled element and sits above the fold | pass | 192 | 0 |
| 2 | Mission clear in 3 s (squint test: the primary is the highest-contrast element) | pass | 192 | 0 |
| 3 | Nothing outside “Stays visible” is expanded by default | pass | 192 | 0 |
| 4 | No text below 4.5:1; axe reports zero serious or critical issues | pass | 96 | 0 |
| 5 | Visible focus ring on every interactive element; tab through the view, nothing traps focus | pass | 48 | 0 |
| 6 | Reduced motion: no transforms or loops | pass | 96 | 0 |
| 7 | No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px | **FAIL** | 96 | 4 |
| 8 | Stale, verified and running are clear without colour (icon + text) | pass | 192 | 0 |
| 9 | 4-pt spacing grid; at most 3 type sizes per view | pass | 192 | 0 |
| 10 | Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph | pass | 3 | 0 |
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip | pass | 8 | 0 |
| 12 | No console errors; no network calls to paid APIs | pass | 3 | 0 |

**Not all items pass yet.**

## Measurements

```json
{
  "bigSessionNodes": 299,
  "canvasPanFps": {
    "raf": 58.3,
    "rafP95FrameMs": 16.8,
    "trace": 59,
    "framesWithPan": 117
  },
  "canvasJs": {
    "firstNodeMs": 585,
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
      "performance": 97,
      "accessibility": 100,
      "lcpMs": 1976,
      "tbtMs": 184,
      "cls": 0,
      "failedA11y": [],
      "shifts": [],
      "runs": [
        97,
        97,
        98
      ]
    },
    "sessions": {
      "performance": 94,
      "accessibility": 100,
      "lcpMs": 768,
      "tbtMs": 293,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<span class=\"line-clamp-3 font-medium text-fg-0\">",
      "shifts": [],
      "runs": [
        94,
        94,
        96
      ]
    },
    "settings": {
      "performance": 95,
      "accessibility": 100,
      "lcpMs": 777,
      "tbtMs": 254,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<p class=\"mt-1 text-fg-1\">",
      "shifts": [],
      "runs": [
        92,
        95,
        95
      ]
    },
    "canvas-empty": {
      "performance": 98,
      "accessibility": 100,
      "lcpMs": 755,
      "tbtMs": 176,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<label for=\"idea\" class=\"block text-center text-28 font-semibold\">",
      "shifts": [],
      "runs": [
        92,
        98,
        98
      ]
    },
    "canvas-done": {
      "performance": 92,
      "accessibility": 100,
      "lcpMs": 919,
      "tbtMs": 349,
      "cls": 0.002311872159987875,
      "failedA11y": [],
      "shifts": [
        "0.002 <div class=\"flex items-center rounded-md border border-line\" role=\"group\" aria-label=\"View\">"
      ],
      "runs": [
        91,
        92,
        93
      ]
    },
    "table": {
      "performance": 91,
      "accessibility": 100,
      "lcpMs": 1218,
      "tbtMs": 391,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<button class=\"link min-h-11 text-left font-medium md:min-h-0\">",
      "shifts": [],
      "runs": [
        90,
        91,
        93
      ]
    },
    "export-page": {
      "performance": 96,
      "accessibility": 100,
      "lcpMs": 920,
      "tbtMs": 226,
      "cls": 0,
      "failedA11y": [],
      "lcpElement": "<span class=\"block [content-visibility:auto] [contain-intrinsic-size:auto_20rem]\">",
      "shifts": [],
      "runs": [
        95,
        96,
        96
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

- overlap: pre "# Literature review: What is the knowled" ∩ a "Download Markdown"  
  _4 shots: panel-export 390 dark motion-on; panel-export 390 dark motion-reduced; panel-export 390 light motion-on; panel-export 390 light motion-reduced_
