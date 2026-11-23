import { test } from "node:test";
import assert from "node:assert/strict";
import { TITLE_MIN, tableMinWidth, titleWidth } from "./columns";

// The real-run case: the per-topic ranking view with Setting and Access shown, in a 1366 px window.
const RANK_VIEW = ["expand", "select", "rank", "score", "title", "year", "studyType", "setting", "keyFinding", "access"];
const ALL_COLS = ["expand", "select", "rank", "score", "title", "authors", "year", "journal", "studyType", "article", "setting", "keyFinding", "citationCount", "access", "source"];

test("Title keeps its minimum width at the table's minimum width, whatever columns are shown", () => {
  for (const cols of [RANK_VIEW, ALL_COLS, ["expand", "title", "year", "studyType", "keyFinding"], ["expand", "title", "authors", "year", "journal", "studyType", "keyFinding"]]) {
    const w = tableMinWidth(cols);
    assert.ok(titleWidth(cols, w) >= TITLE_MIN, `${cols.join(",")}: title ${titleWidth(cols, w)} at ${w}px`);
  }
});

test("more columns than fit make the table wider than the window (it scrolls sideways) instead of squeezing Title", () => {
  // Before: a 960 px minimum left Title about 90 px here at 1366 px.
  assert.ok(titleWidth(RANK_VIEW, 1334) < TITLE_MIN);
  assert.ok(tableMinWidth(RANK_VIEW) > 1334);
});

test("the default columns still fit a laptop window without sideways scrolling", () => {
  assert.ok(tableMinWidth(["expand", "title", "year", "studyType", "keyFinding"]) <= 1000);
  assert.ok(tableMinWidth(["expand", "select", "rank", "score", "title", "year", "studyType", "keyFinding"]) <= 1300);
});
