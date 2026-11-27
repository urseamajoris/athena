/*
 * Test-only fake model. Production has no mock mode (removed in #7): with no API key, structuredCall() pauses the
 * job. Unit tests that need an AI step to finish swap structuredCall for this deterministic responder, installed by
 * ./env before any app module loads. It never makes a network call and never needs a key.
 *
 * - config.mockAi === true (env.ts sets MOCK_MODE=true): answer from the prompt's own vars. Output is built from the
 *   records in the prompt (IDs, sentences of the source text), so the shipped schema, normalize() and grounded-ID
 *   check() still run on it, and quotes are verbatim, so quote verification passes. Free text starts "(mock)".
 * - config.mockAi === false (stage-approval's withFailingAi): every model call fails with an ordinary error, as a
 *   provider error would, so the job ends "failed" and the test checks what a failed re-run keeps. Nothing is sent.
 *   (The real no-key refusal, which pauses the job instead, is covered directly in src/lib/ai/errors.test.ts.)
 */
import { createRequire } from "node:module";
import type * as ClientModule from "../ai/client";
import type { CallOpts, CallResult } from "../ai/client";

type Vars = Record<string, string>;

const TEXT_MAX = 180;
const ID = (prefix: string) => new RegExp(`\\b${prefix}_[0-9a-zA-Z]+\\b`, "g");
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const idsIn = (s: string | undefined, prefix: string) => uniq((s ?? "").match(ID(prefix)) ?? []);
const clip = (s: string, n = TEXT_MAX) => (s.length > n ? s.slice(0, n).trimEnd() : s);
const mock = (s: string, n = TEXT_MAX) => clip(`(mock) ${s}`, n);

/** The content between <<<BEGIN DATA ...>>> markers (or the whole string). */
function unwrap(s: string | undefined): string {
  const m = (s ?? "").match(/<<<BEGIN DATA: [^>]*>>>\n([\s\S]*?)\n<<<END DATA: [^>]*>>>/);
  return m ? m[1] : (s ?? "");
}
/** Every wrapped block in a var, in order. */
function blocks(s: string | undefined): string[] {
  return [...(s ?? "").matchAll(/<<<BEGIN DATA: [^>]*>>>\n([\s\S]*?)\n<<<END DATA: [^>]*>>>/g)].map((m) => m[1]);
}
/** Sentences that appear verbatim in the text (so a quote built from one verifies). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[A-Z][A-Z ]{2,}:\s*/, "").trim())
    .filter((s) => s.length > 20 && s.length < 600 && text.includes(s));
}

const TOPICS = [
  { name: "Telemedicine adoption and use", synonyms: ["telemedicine", "telehealth"], controlledTerms: ["Telemedicine"], rationale: "(mock) Core phenomenon." },
  { name: "Barriers and facilitators", synonyms: ["barriers", "facilitators"], controlledTerms: [], rationale: "(mock) Implementation factors." },
  { name: "Digital infrastructure and connectivity", synonyms: ["connectivity", "internet access"], controlledTerms: ["Internet Access"], rationale: "(mock) A prerequisite in rural areas." },
  { name: "Patient and provider acceptance", synonyms: ["acceptance", "satisfaction"], controlledTerms: [], rationale: "(mock) Acceptance drives sustained use." },
];

function scopingTurn(v: Vars) {
  const asked = Number(v.asked ?? 0);
  const max = Number(v.maxQuestions ?? 3);
  const targets = ["population", "outcome", "timeframe", "setting", "studyTypes", "phenomenon"] as const;
  const done = asked >= max;
  return {
    coverage: { population: null, setting: "(mock) Southeast Asia", phenomenon: "(mock) Telemedicine", outcome: null, timeframe: null, studyTypes: null },
    done,
    nextQuestion: done ? null : `(mock) Question ${asked + 1}: what ${targets[asked % targets.length]} should the review cover?`,
    questionTarget: done ? null : targets[asked % targets.length],
    draftTopics: TOPICS.slice(0, Math.min(TOPICS.length, 2 + asked)).map((t) => t.name),
  };
}

function scopingTopics() {
  return {
    summary: { population: "(mock) Rural patients", setting: "(mock) Southeast Asia", phenomenon: "(mock) Telemedicine", outcome: "(mock) Adoption", timeframe: "(mock) 2015 onwards", studyTypes: "(mock) Any" },
    conceptMap: {
      nodes: [
        { id: "n1", label: "Telemedicine", kind: "phenomenon" },
        { id: "n2", label: "Southeast Asia", kind: "setting" },
        { id: "n3", label: "Patients and providers", kind: "population" },
      ],
      edges: [
        { from: "n1", to: "n2", label: "implemented in" },
        { from: "n3", to: "n1", label: "use" },
      ],
    },
    topics: TOPICS,
  };
}

function searchBuilder(v: Vars) {
  const lines = unwrap(v.topics).split("\n").filter(Boolean);
  return {
    criteria: { yearFrom: 2015, yearTo: null, languages: ["en"], studyTypes: [], inclusion: ["(mock) Telemedicine in Southeast Asia"], exclusion: ["(mock) Technical-only engineering papers"] },
    queries: lines.flatMap((line) => {
      const [topicId, name = "telemedicine"] = line.split(" — ");
      const term = name.replace(/"/g, "").trim() || "telemedicine";
      return [
        { topicId, database: "pubmed", query: `"${term}"[tiab] AND Thailand[tiab]`, rationale: "(mock) Topic AND setting." },
        { topicId, database: "openalex", query: `"${term}" AND Thailand`, rationale: "(mock) Same blocks as keywords." },
      ];
    }),
  };
}

/** "ID: p_..." records, each with its wrapped block text. */
function paperBlocks(v: string | undefined) {
  return blocks(v).flatMap((b) => {
    const id = b.match(/^ID: (\S+)/m)?.[1];
    return id ? [{ id, text: b }] : [];
  });
}

function paperSummary(v: Vars) {
  return {
    rows: paperBlocks(v.papers).map((p) => {
      const abs = p.text.match(/^Abstract: ([\s\S]*)$/m)?.[1] ?? "";
      const s = sentences(abs);
      return { paperId: p.id, studyType: "cross_sectional", setting: "(mock) Rural Thailand", keyFinding: mock(s[s.length - 1] ?? "Finding as reported in the abstract.", 300) };
    }),
  };
}

function ranking(v: Vars) {
  return {
    scores: paperBlocks(v.papers).map((p) => ({
      paperId: p.id,
      topicFit: 4,
      topicFitWhy: "(mock) Topic terms appear in the title or abstract.",
      designStrength: 3,
      designStrengthWhy: "(mock) Observational design.",
      settingMatch: 4,
      settingMatchWhy: "(mock) Mentions the review setting.",
      overall: "(mock) Keyword-overlap score.",
    })),
  };
}

function topicImportance(v: Vars) {
  const ids = unwrap(v.topics).split("\n").map((l) => l.split(" — ")[0].trim()).filter(Boolean);
  return { order: ids.map((topicId, i) => ({ topicId, rank: i + 1, justification: `(mock) Kept in scoping order (#${i + 1}).` })) };
}

const FIELDS = ["aim", "setting", "sample", "methods", "key_findings", "limitations"] as const;
function appraisal(v: Vars) {
  const s = sentences(unwrap(v.text));
  const items = (v.checklist ?? "").split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean);
  const extractions = FIELDS.map((field, i) => {
    const q = s.length ? s[i % s.length] : null;
    return q ? { field, statement: mock(q, 500), notReported: false, quote: q, location: "(mock) abstract" } : { field, statement: "not reported", notReported: true, quote: "", location: "" };
  });
  return {
    extractions,
    checklist: (items.length ? items : ["Was the sample representative?"]).map((item, i) => {
      const q = s.length ? s[i % s.length] : null;
      return q ? { item, answer: "unclear", quote: q, location: "(mock) abstract" } : { item, answer: "not_reported", quote: "", location: "" };
    }),
  };
}

function synthesis(v: Vars) {
  const claims = unwrap(v.claims)
    .split("\n")
    .map((l) => l.split(" | "))
    .filter((c) => c.length >= 4)
    .map(([id, paperId, field, statement]) => ({ id: id.trim(), paperId: paperId.trim(), field: field.trim(), statement: statement.trim() }));
  const themes = ["(mock) Main findings", "(mock) Study context"];
  const papers = uniq(claims.map((c) => c.paperId));
  const matrix = papers.map((pid) => {
    const cs = claims.filter((c) => c.paperId === pid).slice(0, 3);
    // The cell value echoes the claim statement as given (like the old mock responder): a blank statement fails the
    // schema, which is how stage-approval makes one topic's synthesis fail.
    return { paperId: pid, theme: themes[0], value: clip(cs[0].statement, 240), stance: "neutral", claimIds: cs.map((c) => c.id) };
  });
  // A "known" finding needs at least two independent studies; otherwise only an "unknown" statement.
  const onePerPaper = papers.map((pid) => claims.find((c) => c.paperId === pid)!.id);
  return {
    themes,
    matrix,
    contradictions: [],
    known: papers.length >= 2 ? [{ statement: `(mock) ${papers.length} papers report the same main finding.`, claimIds: onePerPaper.slice(0, 10) }] : [],
    contested: [],
    unknown: [{ statement: "(mock) The included papers leave the effect of connectivity investment untested.", claimIds: [claims[0].id] }],
  };
}

function researchQuestions(v: Vars) {
  const items = unwrap(v.synthesis)
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ id: l.split(" — ")[0].trim(), kind: l.split(" — ")[2]?.trim(), claims: idsIn(l.match(/\[([^\]]*)\]\s*$/)?.[1], "c") }));
  const allClaims = idsIn(unwrap(v.claims), "c");
  const gapItems = items.filter((i) => i.kind === "unknown").length ? items.filter((i) => i.kind === "unknown") : items;
  const designs = ["Cluster randomised trial", "Cross-sectional survey", "Mixed-methods implementation study"];
  return {
    questions: [0, 1, 2].map((k) => {
      const it = gapItems[k % Math.max(1, gapItems.length)];
      const gapClaimIds = (it?.claims.length ? it.claims : allClaims).slice(0, 3);
      return {
        text: `(mock) Candidate ${k + 1}: does connectivity investment increase teleconsultation uptake in rural Southeast Asia?`,
        framework: "PICO",
        structure: [{ element: "Population", value: "Rural clinics" }, { element: "Intervention", value: "Connectivity investment" }],
        design: designs[k],
        gap: "(mock) Gap drawn from the synthesis 'unknown' statements.",
        gapClaimIds,
        synthesisIds: it ? [it.id] : [],
        feasibility: "(mock) Feasible within a year.",
        weakness: "(mock) Limited generalisability.",
        noveltyQueries: { pubmed: `telemedicine[tiab] AND connectivity[tiab] AND candidate${k + 1}[tiab]`, openalex: `"telemedicine" AND "connectivity" AND candidate${k + 1}` },
      };
    }),
  };
}

const RESPONDERS: Record<string, (v: Vars) => unknown> = {
  scoping_turn: scopingTurn,
  scoping_topics: scopingTopics,
  search_builder: searchBuilder,
  paper_summary: paperSummary,
  ranking,
  topic_importance: topicImportance,
  appraisal,
  synthesis,
  research_questions: researchQuestions,
};

export function installFakeAi() {
  const req = createRequire(__filename);
  const clientPath = req.resolve("../ai/client");
  const real = req(clientPath) as typeof ClientModule;
  const { config } = req("../config") as typeof import("../config");
  const { loadPrompt } = req("../ai/prompts") as typeof import("../ai/prompts");

  async function fakeStructuredCall<T>(opts: CallOpts<T>): Promise<CallResult<T>> {
    if (!config.mockAi) throw new Error(`fake AI (tests): simulated model failure for "${opts.prompt}"`);
    const respond = RESPONDERS[opts.prompt];
    if (!respond) throw new Error(`fake AI (tests): no responder for prompt "${opts.prompt}"`);
    const prompt = loadPrompt(opts.prompt);
    const parsed = opts.schema.safeParse(respond(opts.vars));
    if (!parsed.success) throw new real.AiValidationError(`fake AI (tests) output for "${opts.prompt}" failed the schema: ${parsed.error.message}`, "");
    const data = opts.normalize ? opts.normalize(parsed.data) : parsed.data;
    const bad = opts.check?.(data);
    if (bad) throw new real.AiValidationError(`fake AI (tests) output for "${opts.prompt}" failed the check: ${bad}`, "");
    return { data, model: "mock:test", promptVersion: prompt.version };
  }

  const cached = req.cache[clientPath]!;
  cached.exports = { ...real, structuredCall: fakeStructuredCall };
}
