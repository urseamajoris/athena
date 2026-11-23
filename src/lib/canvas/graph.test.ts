import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, frontierNodeId, frontierStage, nodeForStage, toStatus } from "./graph";
import { QUERIES, finished, input, states, summary } from "./fixtures";

const ids = (g: ReturnType<typeof buildGraph>) => g.nodes.map((n) => n.id);

test("a new session is just the Idea node", () => {
  const g = buildGraph(input({ summary: summary({ topics: [] }) }));
  assert.deepEqual(ids(g), ["idea"]);
  assert.equal(g.nodes[0].status, "review");
  assert.equal(g.edges.length, 0);
});

test("stage states map onto the node statuses", () => {
  assert.equal(toStatus("not_started"), "idle");
  assert.equal(toStatus("running"), "running");
  assert.equal(toStatus("needs_review"), "review");
  assert.equal(toStatus("approved"), "done");
  assert.equal(toStatus("stale"), "stale");
  assert.equal(toStatus("failed"), "error");
});

test("AI-suggested topics are ghosts until accepted; accepted ones are not", () => {
  const g = buildGraph(input({ states: states(1), client: { acceptedTopics: ["t2"], pinnedQuotes: [] } }));
  const t1 = g.nodes.find((n) => n.id === "topic:t1")!;
  const t2 = g.nodes.find((n) => n.id === "topic:t2")!;
  assert.equal(t1.ghost, true);
  assert.equal(t2.ghost, false);
  assert.deepEqual(t1.parents, ["idea"]);
  // A kept topic reads as done, not "Your turn"; step 2's remaining action stays on the Idea card.
  assert.equal(t1.status, "review");
  assert.equal(t2.status, "done");
  assert.equal(g.nodes.find((n) => n.id === "idea")!.status, "review");
});

test("kept topics follow step 2 once it is out of date", () => {
  const g = buildGraph(input({ states: { ...states(2), "2": "stale" }, client: { acceptedTopics: ["t1", "t2"], pinnedQuotes: [] } }));
  const topics = g.nodes.filter((n) => n.kind === "topic");
  assert.equal(topics.length, 2);
  assert.ok(topics.every((n) => n.status === "stale"));
});

test("once topics are approved on the server, nothing is a ghost (even with no browser state)", () => {
  const g = buildGraph(input({ states: states(2) }));
  assert.ok(g.nodes.filter((n) => n.kind === "topic").every((n) => !n.ghost));
});

test("user-added topics are never ghosts", () => {
  const s = summary({ topics: [{ id: "u1", name: "Mine", origin: "user", approved: false, synonyms: 0, controlledTerms: 0 }] });
  assert.equal(buildGraph(input({ states: states(1), summary: s })).nodes.find((n) => n.id === "topic:u1")!.ghost, false);
});

test("one Query node per topic, showing dry-run counts per database", () => {
  const g = buildGraph(input({ states: states(2), summary: summary({ queries: QUERIES }) }));
  const q1 = g.nodes.find((n) => n.id === "query:t1")!;
  assert.equal(q1.key, "PubMed 979 · OpenAlex 1,630");
  assert.deepEqual(q1.parents, ["topic:t1"]);
  assert.equal(g.nodes.find((n) => n.id === "query:t2")!.key, "PubMed not counted · OpenAlex failed");
});

test("after retrieval, a Query node shows what each search matched when it ran", () => {
  const ran = QUERIES.map((q) => ({ ...q, run: q.topicId === "t2" ? { count: q.database === "pubmed" ? 2207 : null, failed: q.database === "openalex" } : null }));
  const g = buildGraph(input({ states: states(3), summary: summary({ queries: ran }) }));
  assert.equal(g.nodes.find((n) => n.id === "query:t2")!.key, "Ran: PubMed 2,207 · OpenAlex failed");
  assert.equal(g.nodes.find((n) => n.id === "query:t1")!.key, "PubMed 979 · OpenAlex 1,630");
});

test("retrieved papers are divided into per-topic boxes; incoming edges animate while retrieval runs", () => {
  const running = buildGraph(input({ states: states(3, { 4: "running" }), summary: summary({ queries: QUERIES, retrieval: { runs: 4, done: 1, failed: 0, running: 3, fetched: 40, unique: 38, perSource: {} } }) }));
  const tc1 = running.nodes.find((n) => n.id === "corpus:topic:t1")!;
  const tc2 = running.nodes.find((n) => n.id === "corpus:topic:t2")!;
  assert.deepEqual(tc1.parents, ["query:t1"]);
  assert.deepEqual(tc2.parents, ["query:t2"]);
  assert.equal(tc1.status, "running");
  assert.ok(running.edges.filter((e) => e.target === "corpus:topic:t1" || e.target === "corpus:topic:t2").every((e) => e.running));
  const done = buildGraph(input({ states: states(3), summary: summary({ queries: QUERIES, retrieval: { runs: 4, done: 4, failed: 0, running: 0, fetched: 400, unique: 195, perSource: {} } }) }));
  assert.ok(done.nodes.some((n) => n.id === "corpus:topic:t1"));
  assert.ok(done.nodes.some((n) => n.id === "corpus:topic:t2"));
  assert.ok(done.edges.every((e) => !e.running));
});

test("a finished review has the whole pipeline in order with topic-divided retrieval boxes and Export last", () => {
  const g = buildGraph(finished());
  assert.deepEqual(ids(g), ["idea", "topic:t1", "topic:t2", "query:t1", "query:t2", "corpus:topic:t1", "corpus:topic:t2", "table", "appraisal", "synthesis", "questions", "export"]);
  assert.ok(g.nodes.every((n) => n.status === "done"));
  assert.equal(g.nodes.find((n) => n.id === "questions")!.title, "What drives adoption?");
  assert.deepEqual(g.nodes.find((n) => n.id === "appraisal")!.trust, { verified: 72, unverified: 6, accepted: 2, stale: false });
});

test("stale stages carry the stale status and the reason", () => {
  const g = buildGraph(finished({ states: states(1, { 2: "needs_review", 3: "stale", 4: "stale", 5: "stale", 6: "stale", 7: "stale", 8: "stale", 9: "stale" }), staleReasons: { 4: "Topic \"Adoption\" was edited" } }));
  const corpus = g.nodes.find((n) => n.id === "corpus:topic:t1")!;
  assert.equal(corpus.status, "stale");
  assert.equal(corpus.staleReason, 'Topic "Adoption" was edited');
  assert.equal(g.nodes.find((n) => n.id === "appraisal")!.trust!.stale, true);
  assert.equal(g.nodes.find((n) => n.id === "export"), undefined, "export only exists while stage 9 is approved");
});

test("pinned quotes become Quote nodes under the Appraisal, with their verdict", () => {
  const claims = [
    { id: "c1", appraisalId: "a1", paperId: "p1", paperTitle: "Paper one", field: "aim", statement: "s", quote: "q one", verified: true, userAccepted: false, userRejected: false },
    { id: "c2", appraisalId: "a1", paperId: "p1", paperTitle: "Paper one", field: "aim", statement: "s", quote: "q two", verified: false, userAccepted: false, userRejected: false },
  ];
  const g = buildGraph(finished({ claims, client: { acceptedTopics: [], pinnedQuotes: ["c1", "c2", "gone"] } }));
  const quotes = g.nodes.filter((n) => n.kind === "quote");
  assert.deepEqual(quotes.map((q) => q.id), ["quote:c1", "quote:c2"], "unknown claim ids are ignored");
  assert.equal(quotes[0].key, "Found word for word · Paper one");
  assert.equal(quotes[1].status, "review");
  assert.deepEqual(quotes[1].parents, ["appraisal"]);
});

test("frontier: the earliest stage that is not approved, and the node that holds it", () => {
  assert.equal(frontierStage(states(0)), 1);
  assert.equal(frontierStage(states(4)), 5);
  assert.equal(frontierStage(states(9)), null);
  const g = buildGraph(finished());
  assert.equal(frontierNodeId(g, states(9)), "export");
  assert.equal(nodeForStage(g, 6), "table");
  assert.equal(nodeForStage(g, 3), "query:t1");
  const noQueries = buildGraph(input({ states: states(2) }));
  assert.equal(nodeForStage(noQueries, 3), "topic:t1", "before queries exist, stage 3 lives on the first topic");
});

test("topicStats propagate Retrieved/Rendered/Filed counts, attention tones and impact onto canvas nodes", () => {
  const g = buildGraph(
    finished({
      states: states(5, { 6: "approved", 7: "needs_review", 8: "not_started", 9: "not_started" }),
      summary: summary({
        topics: [
          { id: "t1", name: "Adoption", origin: "ai", approved: true, synonyms: 3, controlledTerms: 1 },
          { id: "t2", name: "Barriers", origin: "ai", approved: true, synonyms: 2, controlledTerms: 0 },
        ],
        queries: QUERIES,
        retrieval: { runs: 4, done: 4, failed: 0, running: 0, fetched: 100, unique: 50, perSource: {} },
        table: { papers: 50, summarised: 47, edited: 0, selectedPapers: 8 },
        appraisal: { papers: 8, done: 8, failed: 0, running: 0, fullText: 5, claims: 40, verified: 38, pending: 2, accepted: 0, rejected: 0, notReported: 0, appraisalIds: ["a1"] },
        topicStats: [
          { topicId: "t1", name: "Adoption", retrieved: 30, rendered: 30, filed: 4, selected: 4, appraised: 4, failedAppraisals: 0, undecidedQuotes: 0, failedRuns: 0, runningRuns: 0, totalCitations: 450, citedPapers: 25, avgCitationsPerYear: 6.2, hIndex: 8, openAccessCount: 15, maxCitations: 120 },
          { topicId: "t2", name: "Barriers", retrieved: 20, rendered: 17, filed: 2, selected: 4, appraised: 4, failedAppraisals: 0, undecidedQuotes: 2, failedRuns: 0, runningRuns: 0, totalCitations: 90, citedPapers: 12, avgCitationsPerYear: 2.1, hIndex: 4, openAccessCount: 8, maxCitations: 35 },
        ],
        impact: { totalCitations: 540, medianCitations: 12, meanCitations: 14.6, avgCitationsPerYear: 4.1, hIndex: 9, citedPapers: 37, withCitationData: 45, highlyCitedCount: 3, openAccessCount: 23, multiSourceCount: 10, topPaper: { id: "p1", title: "Top", year: 2023, citations: 120 } },
      }),
    }),
  );
  const t1 = g.nodes.find((n) => n.id === "topic:t1")!;
  const t2 = g.nodes.find((n) => n.id === "topic:t2")!;
  const table = g.nodes.find((n) => n.id === "table")!;
  assert.equal(t1.articleStats?.retrieved, 30);
  assert.equal(t1.articleStats?.rendered, 30);
  assert.equal(t1.articleStats?.filed, 4);
  assert.equal(t1.attention?.tone, "ok");
  assert.equal(t2.attention?.tone, "warn");
  assert.equal(t2.attention?.stage, 5);
  assert.equal(t2.attention?.stageTones.rendered, "warn");
  assert.equal(t2.attention?.stageTones.filed, "warn");
  assert.equal(table.pipelineCounts?.retrieved, 50);
  assert.equal(table.pipelineCounts?.rendered, 47);
  assert.equal(table.impactSummary?.totalCitations, 540);
  assert.equal(table.impactSummary?.hIndex, 9);
});

test("expanding topic retrieval boxes fans out per-query retrieval and paper-attention sub-boxes", () => {
  const queryStats = [
    {
      queryId: "q1",
      topicId: "t1",
      database: "pubmed",
      queryString: '"telemedicine"[mh]',
      label: "PubMed #1",
      runStatus: "done" as const,
      resultCount: 40,
      error: null,
      retrieved: 12,
      newUnique: 12,
      duplicates: 0,
      rendered: 10,
      selected: 4,
      filed: 3,
      needsAttention: 3,
      attentionBreakdown: { missingSummary: 2, unscored: 0, failedAppraisal: 0, undecidedQuotes: 1, undecidedQuoteCount: 2 },
      papers: [
        { id: "p1", title: "Rural clinic study", year: 2023, citations: 18, hasSummary: true, selected: true, appraised: true, failedAppraisal: false, undecidedQuotes: 2, needsAttention: true, attentionReason: "2 quotes to check" },
        { id: "p2", title: "Ready paper", year: 2022, citations: 25, hasSummary: true, selected: true, appraised: true, failedAppraisal: false, undecidedQuotes: 0, needsAttention: false, attentionReason: null },
      ],
    },
    {
      queryId: "q2",
      topicId: "t1",
      database: "pubmed",
      queryString: '"telehealth"[tiab]',
      label: "PubMed #2",
      runStatus: "done" as const,
      resultCount: 20,
      error: null,
      retrieved: 8,
      newUnique: 5,
      duplicates: 3,
      rendered: 8,
      selected: 2,
      filed: 2,
      needsAttention: 0,
      attentionBreakdown: { missingSummary: 0, unscored: 0, failedAppraisal: 0, undecidedQuotes: 0, undecidedQuoteCount: 0 },
      papers: [
        { id: "p3", title: "Clean telehealth paper", year: 2024, citations: 10, hasSummary: true, selected: true, appraised: true, failedAppraisal: false, undecidedQuotes: 0, needsAttention: false, attentionReason: null },
      ],
    },
  ];
  const base = finished({
    summary: summary({
      queries: [
        { id: "q1", topicId: "t1", database: "pubmed", queryString: '"telemedicine"[mh]', dryRunCount: 40, dryRunError: null },
        { id: "q2", topicId: "t1", database: "pubmed", queryString: '"telehealth"[tiab]', dryRunCount: 20, dryRunError: null },
      ],
      queryStats,
      retrieval: { runs: 2, done: 2, failed: 0, running: 0, fetched: 20, unique: 17, perSource: {} },
      table: { papers: 17, summarised: 15, edited: 0 },
    }),
    client: { acceptedTopics: [], pinnedQuotes: [], expandedNodes: ["query:t1", "corpus:topic:t1", "corpus:query:q1"] },
  });
  const g = buildGraph(base);
  assert.ok(g.nodes.some((n) => n.id === "query-item:q1" && n.kind === "query_item"));
  assert.ok(g.nodes.some((n) => n.id === "query-item:q2" && n.kind === "query_item"));
  const qc1 = g.nodes.find((n) => n.id === "corpus:query:q1")!;
  assert.equal(qc1.kind, "query_corpus");
  assert.equal(qc1.queryStats?.retrieved, 12);
  assert.equal(qc1.queryStats?.needsAttention, 3);
  const attnBox = g.nodes.find((n) => n.id === "papers:attention:q1")!;
  const okBox = g.nodes.find((n) => n.id === "papers:ok:q1")!;
  assert.equal(attnBox.kind, "paper_group");
  assert.equal(attnBox.paperGroupKind, "attention");
  assert.equal(attnBox.paperCount, 3);
  assert.equal(okBox.paperGroupKind, "ok");
  assert.equal(okBox.paperCount, 9);
});

test("admin AI engine box appears on the canvas only for admins", () => {
  const nonAdmin = buildGraph(finished({ isAdmin: false }));
  assert.equal(nonAdmin.nodes.find((n) => n.id === "admin:ai"), undefined);
  const admin = buildGraph(finished({ isAdmin: true, ai: { enabled: true, budgetReached: false, keyMissing: false, provider: "anthropic", activeModel: "claude-sonnet-4-6" } }));
  const box = admin.nodes.find((n) => n.id === "admin:ai")!;
  assert.equal(box.kind, "ai_config");
  assert.equal(box.status, "done");
  assert.match(box.key, /Anthropic.*claude-sonnet-4-6/);
});

import { queryChips } from "./query-chips";
test("query chips: terms keep their field tag, parentheses drop, operators stay", () => {
  assert.deepEqual(queryChips('("telemedicine"[mh] OR telehealth*[tiab]) AND ("Southeast Asia" OR Indonesia)'), [
    { type: "term", text: "telemedicine", field: "mh" },
    { type: "op", text: "OR" },
    { type: "term", text: "telehealth*", field: "tiab" },
    { type: "op", text: "AND" },
    { type: "term", text: "Southeast Asia", field: undefined },
    { type: "op", text: "OR" },
    { type: "term", text: "Indonesia", field: undefined },
  ]);
  assert.deepEqual(queryChips("AND ( )"), []);
});

import { queryBlocks } from "./query-chips";
test("query blocks: top-level AND splits concepts; OR terms stay together", () => {
  const b = queryBlocks('(telemedicine[mh] OR "telehealth"[tiab]) AND ("Southeast Asia"[tiab] OR Thailand[tiab])');
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].terms.map((t) => t.text), ["telemedicine", "telehealth"]);
  assert.equal(b[0].terms[0].field, "mh");
  assert.equal(b[1].join, "AND");
  assert.equal(queryBlocks("sleep AND grades NOT children").map((x) => x.join).join(","), ",AND,NOT");
});
