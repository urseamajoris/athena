# Visual audit, round 1

Run 2026-10-28 18:05 UTC on commit `ad32356`. Production build, mock mode, API keys stripped from the server environment, fresh database. 24 views × 8 variants (1440×900 and 390×844, dark and light, reduced motion on and off) = 192 screenshots in `qa/shots/1/`.

| # | Checklist item | Result | Checks | Failures |
|---|---|---|---|---|
| 1 | The #1 action is the only accent-filled element and sits above the fold | pass | 192 | 0 |
| 2 | Mission clear in 3 s (squint test: the primary is the highest-contrast element) | **FAIL** | 192 | 89 |
| 3 | Nothing outside “Stays visible” is expanded by default | pass | 192 | 0 |
| 4 | No text below 4.5:1; axe reports zero serious or critical issues | **FAIL** | 96 | 4 |
| 5 | Visible focus ring on every interactive element; tab through the view, nothing traps focus | pass | 48 | 0 |
| 6 | Reduced motion: no transforms or loops | pass | 96 | 0 |
| 7 | No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px | **FAIL** | 96 | 88 |
| 8 | Stale, verified and running are clear without colour (icon + text) | pass | 192 | 0 |
| 9 | 4-pt spacing grid; at most 3 type sizes per view | pass | 192 | 0 |
| 10 | Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph | **FAIL** | 3 | 1 |
| 11 | Lighthouse (mobile): Performance ≥ 90, Accessibility 100 | **FAIL** | 7 | 3 |
| 12 | No console errors; no network calls to paid APIs | pass | 3 | 0 |

**Not all items pass yet.**

## Measurements

```json
{
  "bigSessionNodes": 299,
  "canvasPanFps": {
    "raf": 59.1,
    "trace": 18.7
  },
  "canvasJs": {
    "initialGzipKb": 279,
    "totalGzipKb": 712,
    "lazyChunks": [
      "91dbc596.b6a37ce350701a05.js 434kB"
    ]
  },
  "lighthouse": {
    "landing": {
      "performance": 91,
      "accessibility": 100,
      "lcpMs": 1780,
      "tbtMs": 355,
      "cls": 0,
      "failedA11y": []
    },
    "sessions": {
      "performance": 90,
      "accessibility": 100,
      "lcpMs": 2869,
      "tbtMs": 271,
      "cls": 0.000009566058639212014,
      "failedA11y": []
    },
    "settings": {
      "performance": 93,
      "accessibility": 100,
      "lcpMs": 2846,
      "tbtMs": 189,
      "cls": 0,
      "failedA11y": []
    },
    "canvas-empty": {
      "performance": 95,
      "accessibility": 100,
      "lcpMs": 765,
      "tbtMs": 257,
      "cls": 0,
      "failedA11y": []
    },
    "canvas-done": {
      "performance": 81,
      "accessibility": 100,
      "lcpMs": 3809,
      "tbtMs": 339,
      "cls": 0,
      "failedA11y": []
    },
    "table": {
      "performance": 43,
      "accessibility": 100,
      "lcpMs": 6760,
      "tbtMs": 397,
      "cls": 0.8389977468178226,
      "failedA11y": []
    },
    "export-page": {
      "performance": 73,
      "accessibility": 98,
      "lcpMs": 4646,
      "tbtMs": 366,
      "cls": 0.0940001858492224,
      "failedA11y": [
        "heading-order"
      ]
    }
  },
  "paidCalls": {
    "attempted": 0,
    "blocked": 0
  }
}
```

## 2. Mission clear in 3 s (squint test: the primary is the highest-contrast element): failures

- div "Athena Your sessions Turn a rough idea into a re" (contrast 7.59) outshines the primary (1.00)  
  _2 shots: landing 1440 dark motion-reduced; landing 390 dark motion-reduced_
- div "Athena Sessions New session Sort and filter 11 o" (contrast 7.59) outshines the primary (1.00)  
  _2 shots: sessions 1440 dark motion-reduced; sessions 390 dark motion-reduced_
- div "What do you want to understand? Enter creates yo" (contrast 7.59) outshines the primary (1.00)  
  _2 shots: canvas-empty 1440 dark motion-reduced; canvas-empty 390 dark motion-reduced_
- div "Athena What is the knowledge gap in implementing" (contrast 7.59) outshines the primary (1.00)  
  _14 shots: canvas-idea 1440 dark motion-reduced; panel-idea-scoping 1440 dark motion-reduced; canvas-ghosts 1440 dark motion-reduced; panel-topic-ghost 1440 dark motion-reduced; panel-query 1440 dark motion-reduced; canvas-error 1440 dark motion-reduced …_
- div "Canvas Summary and ranking Appraise selected All" (contrast 7.59) outshines the primary (1.00)  
  _2 shots: table 1440 dark motion-reduced; table 390 dark motion-reduced_
- div "Canvas Export Your research question (mock) What" (contrast 7.59) outshines the primary (1.00)  
  _2 shots: export-page 1440 dark motion-reduced; export-page 390 dark motion-reduced_
- div "Idea Needs review What is the knowledge gap in i" (contrast 17.66) outshines the primary (5.92)  
  _5 shots: canvas-idea 1440 light motion-on; panel-idea-scoping 1440 light motion-on; canvas-ghosts 1440 light motion-on; panel-topic-ghost 1440 light motion-on; canvas-stale 1440 light motion-on_
- div "Idea Done What is the knowledge gap in implement" (contrast 17.66) outshines the primary (5.92)  
  _8 shots: panel-query 1440 light motion-on; canvas-error 1440 light motion-on; panel-table-error 1440 light motion-on; canvas-done 1440 light motion-on; panel-appraisal 1440 light motion-on; panel-questions 1440 light motion-on …_
- div "Athena Your sessions Turn a rough idea into a re" (contrast 5.92) outshines the primary (1.00)  
  _2 shots: landing 1440 light motion-reduced; landing 390 light motion-reduced_
- li "What is the knowledge gap in implementing teleme" (contrast 6.17) outshines the primary (1.00)  
  _2 shots: sessions 1440 light motion-reduced; sessions 390 light motion-reduced_
- textarea#idea (contrast 6.17) outshines the primary (1.00)  
  _2 shots: canvas-empty 1440 light motion-reduced; canvas-empty 390 light motion-reduced_
- div "Idea: What is the knowledge gap in implementing " (contrast 6.17) outshines the primary (1.00)  
  _8 shots: canvas-idea 1440 light motion-reduced; panel-idea-scoping 1440 light motion-reduced; canvas-ghosts 1440 light motion-reduced; panel-topic-ghost 1440 light motion-reduced; canvas-error 1440 light motion-reduced; canvas-done 1440 light motion-reduced …_
- div "Topic: Telemedicine adoption and use. Done. 5 sy" (contrast 6.17) outshines the primary (1.00)  
  _1 shot: panel-query 1440 light motion-reduced_
- div "Corpus: Retrieved papers. Done. 195 papers, 205 " (contrast 6.17) outshines the primary (1.00)  
  _1 shot: panel-table-error 1440 light motion-reduced_
- div "Table: Summary & ranking. Done. 195 rows · 20 se" (contrast 6.17) outshines the primary (1.00)  
  _1 shot: panel-appraisal 1440 light motion-reduced_
- div "Synthesis: Synthesis. Done. 15 statements · 5 co" (contrast 6.17) outshines the primary (1.00)  
  _1 shot: panel-questions 1440 light motion-reduced_
- div "Questions: (mock) What telemedicine adoption and" (contrast 6.17) outshines the primary (1.00)  
  _1 shot: panel-export 1440 light motion-reduced_
- span (contrast 6.17) outshines the primary (1.00)  
  _15 shots: list-view 1440 light motion-reduced; canvas-idea 390 light motion-reduced; panel-idea-scoping 390 light motion-reduced; canvas-ghosts 390 light motion-reduced; panel-topic-ghost 390 light motion-reduced; panel-query 390 light motion-reduced …_
- thead "Details Best score Title Year Study type Key fin" (contrast 6.17) outshines the primary (1.00)  
  _2 shots: table 1440 light motion-reduced; table 390 light motion-reduced_
- div "Canvas Export Your research question (mock) What" (contrast 5.92) outshines the primary (1.00)  
  _2 shots: export-page 1440 light motion-reduced; export-page 390 light motion-reduced_
- div "Step 1/9 · Idea Canvas List Next step · Idea Wha" (contrast 7.59) outshines the primary (1.00)  
  _1 shot: canvas-idea 390 dark motion-reduced_
- div "Step 2/9 · Scoping Canvas List Next step · Idea " (contrast 7.59) outshines the primary (1.00)  
  _3 shots: panel-idea-scoping 390 dark motion-reduced; canvas-ghosts 390 dark motion-reduced; panel-topic-ghost 390 dark motion-reduced_
- div "Step 3/9 · Search builder Canvas List Next step " (contrast 7.59) outshines the primary (1.00)  
  _1 shot: panel-query 390 dark motion-reduced_
- div "Step 5/9 · Summary table Canvas List Next step ·" (contrast 7.59) outshines the primary (1.00)  
  _2 shots: canvas-error 390 dark motion-reduced; panel-table-error 390 dark motion-reduced_
- div "Finished Canvas List Next step · Export Report D" (contrast 7.59) outshines the primary (1.00)  
  _5 shots: canvas-done 390 dark motion-reduced; panel-appraisal 390 dark motion-reduced; panel-export 390 dark motion-reduced; canvas-300 390 dark motion-reduced; list-view 390 dark motion-reduced_
- div "Step 9/9 · Research question Canvas List Next st" (contrast 7.59) outshines the primary (1.00)  
  _1 shot: panel-questions 390 dark motion-reduced_
- div "Step 2/9 · Scoping · 7 stale Canvas List Next st" (contrast 7.59) outshines the primary (1.00)  
  _1 shot: canvas-stale 390 dark motion-reduced_

## 4. No text below 4.5:1; axe reports zero serious or critical issues: failures

- target-size (1: .w-full)  
  _2 shots: panel-topic-ghost 1440 dark motion-reduced; panel-topic-ghost 1440 light motion-reduced_
- color-contrast (1: mark)  
  _2 shots: panel-quote 1440 dark motion-reduced; panel-quote 390 dark motion-reduced_

## 7. No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px: failures

- overlap: a "What is the knowledge gap in implementin" ∩ button "Actions for What is the knowledge gap in", a "What is the knowledge gap in implementin" ∩ button "Actions for What is the knowledge gap in"  
  _4 shots: sessions 390 dark motion-on; sessions 390 dark motion-reduced; sessions 390 light motion-on; sessions 390 light motion-reduced_
- tap targets under 44px: button "" 48×28  
  _4 shots: settings 390 dark motion-on; settings 390 dark motion-reduced; settings 390 light motion-on; settings 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44  
  _4 shots: canvas-empty 390 dark motion-on; canvas-empty 390 dark motion-reduced; canvas-empty 390 light motion-on; canvas-empty 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44  
  _32 shots: canvas-idea 390 dark motion-on; canvas-ghosts 390 dark motion-on; canvas-running 390 dark motion-on; canvas-error 390 dark motion-on; canvas-done 390 dark motion-on; canvas-stale 390 dark motion-on …_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Idea", button "Command palette (⌘K or /)" ∩ button "More actions for Idea"  
  _4 shots: panel-idea-scoping 390 dark motion-on; panel-idea-scoping 390 dark motion-reduced; panel-idea-scoping 390 light motion-on; panel-idea-scoping 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Topic", button "Command palette (⌘K or /)" ∩ button "More actions for Topic"  
  _4 shots: panel-topic-ghost 390 dark motion-on; panel-topic-ghost 390 dark motion-reduced; panel-topic-ghost 390 light motion-on; panel-topic-ghost 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Query", button "Command palette (⌘K or /)" ∩ button "More actions for Query"  
  _4 shots: panel-query 390 dark motion-on; panel-query 390 dark motion-reduced; panel-query 390 light motion-on; panel-query 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Corpus", button "Command palette (⌘K or /)" ∩ button "More actions for Corpus"  
  _4 shots: panel-corpus-running 390 dark motion-on; panel-corpus-running 390 dark motion-reduced; panel-corpus-running 390 light motion-on; panel-corpus-running 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Table", button "Command palette (⌘K or /)" ∩ button "More actions for Table"  
  _4 shots: panel-table-error 390 dark motion-on; panel-table-error 390 dark motion-reduced; panel-table-error 390 light motion-on; panel-table-error 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Appraisal", button "Command palette (⌘K or /)" ∩ button "More actions for Appraisal"  
  _4 shots: panel-appraisal 390 dark motion-on; panel-appraisal 390 dark motion-reduced; panel-appraisal 390 light motion-on; panel-appraisal 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Synthesis", button "Command palette (⌘K or /)" ∩ button "More actions for Synthesis"  
  _4 shots: panel-synthesis 390 dark motion-on; panel-synthesis 390 dark motion-reduced; panel-synthesis 390 light motion-on; panel-synthesis 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Questions", button "Command palette (⌘K or /)" ∩ button "More actions for Questions"  
  _4 shots: panel-questions 390 dark motion-on; panel-questions 390 dark motion-reduced; panel-questions 390 light motion-on; panel-questions 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Export", button "Command palette (⌘K or /)" ∩ button "More actions for Export"  
  _4 shots: panel-export 390 dark motion-on; panel-export 390 dark motion-reduced; panel-export 390 light motion-on; panel-export 390 light motion-reduced_
- tap targets under 44px: a "Athena: all sessions" 32×44, button "Canvas" 40×44, button "List" 40×44, button "Command palette (⌘K or /)" 32×44; overlap: button "List" ∩ button "More actions for Quote", button "Command palette (⌘K or /)" ∩ button "More actions for Quote"  
  _4 shots: panel-quote 390 dark motion-on; panel-quote 390 dark motion-reduced; panel-quote 390 light motion-on; panel-quote 390 light motion-reduced_
- tap targets under 44px: button "Best score" 85×32, button "Title" 49×32, button "Year" 50×32, button "Study type" 86×32  
  _4 shots: table 390 dark motion-on; table 390 dark motion-reduced; table 390 light motion-on; table 390 light motion-reduced_

## 10. Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph: failures

- pans at 18.7 fps (rAF 59.1), below 55  
  _1 shot: canvas-300 (299 nodes)_

## 11. Lighthouse (mobile): Performance ≥ 90, Accessibility 100: failures

- performance 81, accessibility 100, LCP 3809 ms, TBT 339 ms  
  _1 shot: canvas-done_
- performance 43, accessibility 100, LCP 6760 ms, TBT 397 ms  
  _1 shot: table_
- performance 73, accessibility 98 (heading-order), LCP 4646 ms, TBT 366 ms  
  _1 shot: export-page_
