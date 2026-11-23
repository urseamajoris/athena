import { test } from "node:test";
import assert from "node:assert/strict";
import { citationsPerYear, computeHIndex, designTierScore, impactTierOf, paperImpactEvaluation, summarizeCorpusImpact } from "./impact";
import { evaluateTopicAttention, type TopicArticleStats } from "./canvas";
import { citationSizeScale, defaultYAxis, place, type MapPoint } from "../../components/viz/paper-points";

test("citationsPerYear normalizes citation count by publication age", () => {
  assert.equal(citationsPerYear(null, 2020, 2026), null);
  assert.equal(citationsPerYear(70, 2020, 2026), 10);
  assert.equal(citationsPerYear(15, 2026, 2026), 15);
});

test("impactTierOf evaluates both raw volume and age-adjusted velocity", () => {
  assert.equal(impactTierOf(null, 2022, 2026), "unknown");
  assert.equal(impactTierOf(120, 2010, 2026), "high");
  assert.equal(impactTierOf(24, 2025, 2026), "high"); // 12/yr
  assert.equal(impactTierOf(30, 2018, 2026), "notable");
  assert.equal(impactTierOf(10, 2020, 2026), "moderate");
  assert.equal(impactTierOf(1, 2020, 2026), "low");
});

test("computeHIndex computes standard bibliometric h-index", () => {
  assert.equal(computeHIndex([]), 0);
  assert.equal(computeHIndex([null, 0, 0]), 0);
  assert.equal(computeHIndex([10, 8, 5, 4, 3]), 4);
  assert.equal(computeHIndex([25, 8, 5, 3, 3]), 3);
  assert.equal(computeHIndex([100, 50, 20, 10, 5, 1]), 5);
});

test("paperImpactEvaluation returns transparent 0-100 composite score and subscores", () => {
  const high = paperImpactEvaluation(
    { id: "p1", title: "RCT", year: 2025, citationCount: 80, studyType: "randomized_trial", oaUrl: "https://example.org/oa", sourceDatabases: ["pubmed", "openalex"] },
    2026,
  );
  assert.equal(high.tier, "high");
  assert.equal(high.hasCitations, true);
  assert.equal(high.score, 100);
  assert.deepEqual(high.breakdown, { citation: 5, design: 5, recency: 5, accessibility: 5 });

  const low = paperImpactEvaluation(
    { id: "p2", title: "Note", year: 2010, citationCount: 0, studyType: "not_reported", oaUrl: null, sourceDatabases: ["pubmed"] },
    2026,
  );
  assert.equal(low.tier, "low");
  assert.ok(low.score < 20);
  assert.equal(designTierScore("systematic_review"), 5);
  assert.equal(designTierScore(null, ["Randomized Controlled Trial"]), 5);
});

test("summarizeCorpusImpact aggregates citations, median, mean, h-index, OA and top paper", () => {
  const s = summarizeCorpusImpact(
    [
      { id: "p1", title: "Alpha", year: 2022, citationCount: 120, oaUrl: "https://oa/1", sourceDatabases: ["pubmed", "openalex"] },
      { id: "p2", title: "Beta", year: 2023, citationCount: 20, oaUrl: null, pmcid: "PMC123", sourceDatabases: ["pubmed"] },
      { id: "p3", title: "Gamma", year: 2024, citationCount: 4, oaUrl: null, sourceDatabases: ["openalex"] },
      { id: "p4", title: "Delta", year: 2021, citationCount: null, oaUrl: null, sourceDatabases: ["pubmed"] },
    ],
    2026,
  );
  assert.equal(s.totalCitations, 144);
  assert.equal(s.medianCitations, 20);
  assert.equal(s.meanCitations, 48);
  assert.equal(s.hIndex, 3);
  assert.equal(s.citedPapers, 3);
  assert.equal(s.withCitationData, 3);
  assert.equal(s.highlyCitedCount, 1);
  assert.equal(s.openAccessCount, 2);
  assert.equal(s.multiSourceCount, 1);
  assert.deepEqual(s.topPaper, { id: "p1", title: "Alpha", year: 2022, citations: 120 });
});

function baseStat(over: Partial<TopicArticleStats> = {}): TopicArticleStats {
  return {
    topicId: "t1",
    name: "Adoption",
    retrieved: 20,
    rendered: 20,
    filed: 4,
    selected: 4,
    appraised: 4,
    failedAppraisals: 0,
    undecidedQuotes: 0,
    failedRuns: 0,
    runningRuns: 0,
    totalCitations: 240,
    citedPapers: 18,
    avgCitationsPerYear: 4.5,
    hIndex: 6,
    openAccessCount: 12,
    maxCitations: 85,
    ...over,
  };
}

test("evaluateTopicAttention colour-codes every stage failure, warning, running, and healthy state", () => {
  const approvedAll = { "4": "approved", "5": "approved", "6": "approved", "7": "approved", "8": "approved" } as const;
  const ok = evaluateTopicAttention(baseStat(), { ...approvedAll });
  assert.equal(ok.tone, "ok");
  assert.deepEqual(ok.stageTones, { retrieved: "ok", rendered: "ok", filed: "ok" });

  const failedSearch = evaluateTopicAttention(baseStat({ failedRuns: 1 }), { ...approvedAll });
  assert.equal(failedSearch.tone, "err");
  assert.equal(failedSearch.stage, 4);
  assert.equal(failedSearch.stageTones.retrieved, "err");

  const zeroRetrieved = evaluateTopicAttention(baseStat({ retrieved: 0, rendered: 0, filed: 0, selected: 0 }), { "4": "needs_review" });
  assert.equal(zeroRetrieved.tone, "err");
  assert.equal(zeroRetrieved.stage, 4);

  const unrendered = evaluateTopicAttention(baseStat({ retrieved: 20, rendered: 16 }), { "4": "approved", "5": "needs_review" });
  assert.equal(unrendered.tone, "warn");
  assert.equal(unrendered.stage, 5);
  assert.equal(unrendered.stageTones.rendered, "warn");

  const thinSelection = evaluateTopicAttention(baseStat({ selected: 2, filed: 0 }), { "4": "approved", "5": "approved", "6": "needs_review" });
  assert.equal(thinSelection.tone, "warn");
  assert.equal(thinSelection.stage, 6);
  assert.equal(thinSelection.stageTones.filed, "warn");

  const undecided = evaluateTopicAttention(baseStat({ filed: 3, selected: 4, undecidedQuotes: 2 }), { "4": "approved", "5": "approved", "6": "approved", "7": "needs_review" });
  assert.equal(undecided.tone, "warn");
  assert.equal(undecided.stage, 7);
  assert.equal(undecided.stageTones.filed, "warn");

  const failedAppraisal = evaluateTopicAttention(baseStat({ failedAppraisals: 1 }), { ...approvedAll });
  assert.equal(failedAppraisal.tone, "err");
  assert.equal(failedAppraisal.stage, 7);

  const running = evaluateTopicAttention(baseStat({ runningRuns: 1 }), { "4": "running" });
  assert.equal(running.tone, "run");
  assert.equal(running.stageTones.retrieved, "run");
});

test("paper-points place supports citation, velocity, impact, and score Y-axes with log sizing", () => {
  const pts: MapPoint[] = [
    { id: "p1", title: "Low", year: 2020, score: null, layer: 0, cat: "low", citations: 0, citationsPerYear: 0, impactScore: 20 },
    { id: "p2", title: "High", year: 2024, score: null, layer: 1, cat: "high", citations: 200, citationsPerYear: 66.7, impactScore: 95 },
  ];
  assert.equal(defaultYAxis(pts), "citations");
  const byCites = place(pts, 2, "citations");
  assert.equal(byCites.yAxis.metric, "citations");
  assert.ok(byCites.placed[1].y > byCites.placed[0].y);
  assert.ok(byCites.placed[1].sizeScale > byCites.placed[0].sizeScale);
  assert.ok(citationSizeScale(200, 200) > citationSizeScale(0, 200));

  const byImpact = place(pts, 2, "impact");
  assert.equal(byImpact.yAxis.metric, "impact");
  assert.ok(byImpact.placed[1].yNorm > 0.9);

  const byVel = place(pts, 2, "velocity");
  assert.equal(byVel.yAxis.metric, "velocity");
  assert.ok(byVel.placed[1].y > byVel.placed[0].y);
});
