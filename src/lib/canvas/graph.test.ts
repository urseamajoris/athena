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

test("all queries merge into one Corpus; its incoming edges animate while retrieval runs", () => {
  const running = buildGraph(input({ states: states(3, { 4: "running" }), summary: summary({ queries: QUERIES, retrieval: { runs: 4, done: 1, failed: 0, running: 3, fetched: 40, unique: 38, perSource: {} } }) }));
  const corpus = running.nodes.find((n) => n.id === "corpus")!;
  assert.deepEqual(corpus.parents, ["query:t1", "query:t2"]);
  assert.equal(corpus.status, "running");
  assert.equal(corpus.key, "38 papers so far");
  assert.ok(running.edges.filter((e) => e.target === "corpus").every((e) => e.running));
  const done = buildGraph(input({ states: states(3), summary: summary({ queries: QUERIES, retrieval: { runs: 4, done: 4, failed: 0, running: 0, fetched: 400, unique: 195, perSource: {} } }) }));
  assert.equal(done.nodes.find((n) => n.id === "corpus")!.key, "195 papers, 205 dupes removed");
  assert.ok(done.edges.every((e) => !e.running));
});

test("a finished review has the whole pipeline in order, with Export last", () => {
  const g = buildGraph(finished());
  assert.deepEqual(ids(g), ["idea", "topic:t1", "topic:t2", "query:t1", "query:t2", "corpus", "table", "appraisal", "synthesis", "questions", "export"]);
  assert.ok(g.nodes.every((n) => n.status === "done"));
  assert.equal(g.nodes.find((n) => n.id === "questions")!.title, "What drives adoption?");
  assert.deepEqual(g.nodes.find((n) => n.id === "appraisal")!.trust, { verified: 72, unverified: 6, accepted: 2, stale: false });
});

test("stale stages carry the stale status and the reason", () => {
  const g = buildGraph(finished({ states: states(1, { 2: "needs_review", 3: "stale", 4: "stale", 5: "stale", 6: "stale", 7: "stale", 8: "stale", 9: "stale" }), staleReasons: { 4: "Topic \"Adoption\" was edited" } }));
  const corpus = g.nodes.find((n) => n.id === "corpus")!;
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
