import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_CSV_HEAD, analysisCsvCells, analysisSummaryLines, finalQuestionDifference, questionSection, relevanceLabel } from "./report-parts";
import { markdownToHtml } from "./report-html";

const working = { text: "Do teenagers who sleep less get lower school grades?", framework: "PECO", structure: { population: "teenagers", exposure: "short sleep", outcome: "school grades" } };

test("the report states the working research question with its framework parts", () => {
  const md = questionSection(working, "2026-11-16T09:30:00.000Z").join("\n");
  assert.match(md, /^\*\*Do teenagers who sleep less get lower school grades\?\*\*/);
  assert.match(md, /Framework: PECO/);
  assert.match(md, /- \*\*population:\*\* teenagers\n- \*\*exposure:\*\* short sleep\n- \*\*outcome:\*\* school grades/);
  assert.match(md, /confirmed on 2026-11-16 before the search/);
  const html = markdownToHtml(md);
  assert.match(html, /<strong>Do teenagers who sleep less get lower school grades\?<\/strong>/);
  assert.match(html, /<li>\n?<strong>population:<\/strong> teenagers/);
});

test("a question in the user's own words has no framework lines; an unconfirmed one says so; none says so", () => {
  const own = questionSection({ text: "What do we know about sleep and grades?", framework: null, structure: null }, null).join("\n");
  assert.ok(!own.includes("Framework"));
  assert.ok(!own.includes("- **"));
  assert.match(own, /has not been confirmed yet/);
  assert.match(questionSection(null, null).join("\n"), /No research question has been set yet/);
});

test("the report says how the final question differs from the working one", () => {
  assert.deepEqual(finalQuestionDifference(working, { text: working.text, kind: "working", edited: false, gap: "" }), ["You kept your working research question unchanged after reading the evidence."]);
  const reworded = finalQuestionDifference(working, { text: "Do teenagers who sleep under eight hours get lower grades?", kind: "working", edited: true, gap: "" });
  assert.match(reworded[0], /reworded it after reading the evidence\. Before: “Do teenagers who sleep less get lower school grades\?”/);
  const revision = finalQuestionDifference(working, { text: "Do teenagers in rural schools who sleep less get lower grades?", kind: "revision", edited: false, gap: "Only 1 of the 9 studies was in a rural school. This wording narrows the population to rural schools." });
  assert.match(revision[0], /^This is a revision of the working research question \(“Do teenagers who sleep less get lower school grades\?”\), proposed from the evidence\.$/);
  assert.equal(revision[1], "**What the evidence shows is missing, and how this wording differs:** Only 1 of the 9 studies was in a rural school. This wording narrows the population to rural schools.");
  assert.match(finalQuestionDifference(working, { text: "X?", kind: "revision", edited: true, gap: "" })[0], /and then edited by you\.$/);
  assert.equal(finalQuestionDifference(working, { text: "X?", kind: "revision", edited: false, gap: " " }).length, 1);
  // A review that never had a working question.
  assert.match(finalQuestionDifference(null, { text: "X?", kind: "revision", edited: false, gap: "g" })[0], /had no working research question/);
});

test("each analysed article shows its bottom line and its relevance to the question", () => {
  const md = analysisSummaryLines({ bottomLine: "A small survey suggests short sleep goes with lower grades.", relevance: "partial", relevanceNote: "Same exposure and outcome, but university students." }).join("\n");
  assert.match(md, /\*\*Bottom line:\*\* A small survey suggests short sleep goes with lower grades\./);
  assert.match(md, /\*\*Relevance to the research question:\*\* Answers part of your question\. Same exposure and outcome, but university students\./);
  assert.equal(relevanceLabel("direct"), "Answers your question directly");
  assert.equal(relevanceLabel("background"), "Background only");
  // Analyses made before the question existed carry no judgement: nothing is printed, nothing is invented.
  assert.deepEqual(analysisSummaryLines({ bottomLine: "", relevance: "", relevanceNote: "" }), []);
  assert.equal(relevanceLabel(""), "");
});

test("the spreadsheet has bottom line and relevance columns, filled only where an analysis finished", () => {
  assert.equal(ANALYSIS_CSV_HEAD.length, 3);
  assert.deepEqual(analysisCsvCells({ status: "done", bottomLine: "B", relevance: "direct", relevanceNote: "N" }), ["B", "direct", "N"]);
  assert.deepEqual(analysisCsvCells({ status: "failed", bottomLine: "", relevance: "", relevanceNote: "" }), ["", "", ""]);
  assert.deepEqual(analysisCsvCells({ status: "running", bottomLine: "half", relevance: "direct", relevanceNote: "" }), ["", "", ""]);
  assert.deepEqual(analysisCsvCells(undefined), ["", "", ""]);
});
