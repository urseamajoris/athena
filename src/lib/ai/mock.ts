import "server-only";
/*
 * MOCK_MODE model responders. They are deterministic and build schema-valid output FROM THE INPUT they are
 * given (real records from fixtures), so every downstream check (grounded IDs, quote verification) is
 * exercised exactly as in real mode. Outputs are prefixed "(mock)" where they are free text.
 * One appraisal quote per paper is deliberately altered so the "unverified quote" path can be demoed.
 * The telemedicine test idea (scripts/e2e.mjs) gets the scripted telemedicine scope; any other idea gets topics,
 * searches and questions built from its own words and answers (mock-idea.ts), while the recorded papers stay
 * telemedicine samples, which the free text says.
 */

import { answersByField, cleanAnswer, FILLER_TOPICS, IDEA_QUESTIONS, ideaQuestions, ideaSearch, ideaTopics, inSentence, isPeople, namedPlace, phrases, quoted, SAMPLE_NOTE, summaryOf, termsOf, tiab, unwrapData, type ScopeField } from "./mock-idea";

type AnyRec = Record<string, unknown>;

const SEA = ["Southeast Asia", "Thailand", "Vietnam", "Viet Nam", "Indonesia", "Malaysia", "Philippines", "Singapore", "Myanmar", "Cambodia", "Laos", "Lao", "Brunei", "Timor-Leste", "ASEAN"];

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " \n ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 600 && !/^\s*[A-Z ]{3,}$/.test(s));
}

function firstMatch(sents: string[], re: RegExp): string | null {
  return sents.find((s) => re.test(s)) ?? null;
}

function trimWords(s: string, n = 55): string {
  const w = s.split(/\s+/);
  return w.length > n ? w.slice(0, n).join(" ") : s;
}

function studyTypeOf(text: string, pubTypes: string[] = []): string {
  const t = `${text} ${pubTypes.join(" ")}`.toLowerCase();
  if (/systematic review|meta-analys/.test(t)) return "systematic_review";
  if (/scoping review/.test(t)) return "scoping_review";
  if (/randomi[sz]ed/.test(t)) return "randomized_trial";
  if (/protocol/.test(t)) return "protocol";
  if (/qualitative|interview|focus group|thematic/.test(t)) return "qualitative";
  if (/mixed[- ]method/.test(t)) return "mixed_methods";
  if (/cross-sectional|survey|questionnaire/.test(t)) return "cross_sectional";
  if (/cohort|retrospective|prospective/.test(t)) return "cohort";
  if (/review/.test(t)) return "narrative_review";
  if (/editorial|comment|letter/.test(t)) return "commentary_or_editorial";
  return "other";
}

function settingOf(text: string): string {
  const found = SEA.filter((c) => text.includes(c));
  return found.length ? `(mock) ${[...new Set(found)].slice(0, 3).join(", ")}` : "not reported";
}

const TELEMED_TOPICS = [
  { name: "Telemedicine adoption and use", synonyms: ["telemedicine", "telehealth", "eHealth", "mHealth", "teleconsultation"], controlledTerms: ["Telemedicine"], rationale: "(mock) Core phenomenon: how telemedicine is taken up." },
  { name: "Barriers and facilitators to implementation", synonyms: ["barriers", "facilitators", "challenges", "enablers", "implementation"], controlledTerms: ["Health Services Accessibility"], rationale: "(mock) Gaps usually sit in implementation factors." },
  { name: "Policy, regulation and governance", synonyms: ["policy", "regulation", "legislation", "governance", "reimbursement"], controlledTerms: ["Health Policy"], rationale: "(mock) National policy shapes implementation." },
  { name: "Digital infrastructure and connectivity", synonyms: ["infrastructure", "internet access", "connectivity", "digital divide", "broadband"], controlledTerms: ["Internet Access"], rationale: "(mock) Infrastructure is a prerequisite in rural areas." },
  { name: "Patient and provider acceptance", synonyms: ["acceptance", "satisfaction", "attitudes", "perceptions", "readiness"], controlledTerms: ["Patient Acceptance of Health Care", "Attitude of Health Personnel"], rationale: "(mock) Acceptance drives sustained use." },
];

const isTelemed = (idea: string) => /tele(medicine|health)|mhealth|ehealth/i.test(idea);
/** The telemedicine test idea (or a prompt that does not carry the idea) keeps the scripted telemedicine scope. */
function telemedRun(inp: AnyRec, vars: Record<string, string>) {
  const idea = String(inp.idea ?? "") || unwrapData(vars.idea);
  return !idea || isTelemed(idea);
}

export async function mockRespond(prompt: string, vars: Record<string, string>, input: unknown): Promise<unknown> {
  const inp = (input ?? {}) as AnyRec;
  switch (prompt) {
    case "scoping_turn": {
      const asked = Number(inp.asked ?? 0);
      const idea = String(inp.idea ?? "");
      if (!isTelemed(idea)) {
        const byField = answersByField((inp.answers as string[]) ?? []);
        const topics = ideaTopics(idea, byField);
        const done = asked >= IDEA_QUESTIONS.length;
        return {
          coverage: {
            population: byField.population ?? topics.find((t) => isPeople(t.name))?.name ?? null,
            setting: byField.setting ?? null,
            phenomenon: topics.filter((t) => !isPeople(t.name) && !FILLER_TOPICS.includes(t.name)).map((t) => inSentence(t.name)).join(", ") || null,
            outcome: byField.outcome ?? null,
            timeframe: byField.timeframe ?? null,
            studyTypes: byField.studyTypes ?? null,
          },
          done,
          nextQuestion: done ? null : IDEA_QUESTIONS[asked].q,
          questionTarget: done ? null : IDEA_QUESTIONS[asked].t,
          draftTopics: topics.slice(0, Math.min(5, 2 + asked)).map((t) => t.name),
        };
      }
      const answers = ((inp.answers as string[]) ?? []).map((a) => a.slice(0, 80));
      const qs = [
        { q: "(mock) Who is the main population you care about — for example patients in rural areas, health workers, or health-system decision makers?", t: "population" },
        { q: "(mock) Which outcomes matter most to you — uptake, barriers and facilitators, clinical outcomes, or costs?", t: "outcome" },
        { q: "(mock) Which publication years and study types should we include — e.g. 2015 onwards, any design including qualitative studies and reviews?", t: "timeframe" },
      ];
      const done = asked >= qs.length;
      return {
        coverage: {
          population: answers[0] ?? null,
          setting: "Southeast Asia",
          phenomenon: "telemedicine implementation",
          outcome: answers[1] ?? null,
          timeframe: answers[2] ?? null,
          studyTypes: answers[2] ?? null,
        },
        done,
        nextQuestion: done ? null : qs[asked].q,
        questionTarget: done ? null : qs[asked].t,
        draftTopics: TELEMED_TOPICS.slice(0, Math.min(5, 2 + asked)).map((t) => t.name),
      };
    }
    case "scoping_topics": {
      const idea = String(inp.idea ?? "");
      if (!isTelemed(idea)) {
        const byField = answersByField((inp.answers as string[]) ?? []);
        const topics = ideaTopics(idea, byField);
        const said = (f: ScopeField, otherwise: string) => `(mock) ${byField[f] ?? otherwise}`;
        const concepts = topics.filter((t) => !isPeople(t.name) && !FILLER_TOPICS.includes(t.name)).map((t) => inSentence(t.name));
        return {
          summary: {
            population: said("population", topics.find((t) => isPeople(t.name))?.name ?? "not stated"),
            setting: said("setting", "not stated"),
            phenomenon: `(mock) ${concepts.join(", ") || cleanAnswer(idea, 120)}`,
            outcome: said("outcome", "not stated"),
            timeframe: said("timeframe", "2015 onwards"),
            studyTypes: said("studyTypes", "Any design"),
          },
          conceptMap: {
            nodes: topics.map((t, i) => ({ id: `n${i + 1}`, label: t.name, kind: isPeople(t.name) ? "population" : i === 0 ? "phenomenon" : "context" })),
            edges: topics.slice(1).map((_, i) => ({ from: "n1", to: `n${i + 2}`, label: "relates to" })),
          },
          topics,
        };
      }
      return {
        summary: { population: "(mock) Patients and health workers", setting: "(mock) Southeast Asia (ASEAN countries)", phenomenon: "(mock) Telemedicine implementation", outcome: "(mock) Uptake, barriers, facilitators", timeframe: "(mock) 2015 onwards", studyTypes: "(mock) Any design, including qualitative and reviews" },
        conceptMap: {
          nodes: [
            { id: "n1", label: "Telemedicine", kind: "phenomenon" },
            { id: "n2", label: "Southeast Asia", kind: "setting" },
            { id: "n3", label: "Patients & providers", kind: "population" },
            { id: "n4", label: "Implementation barriers", kind: "outcome" },
            { id: "n5", label: "Policy & infrastructure", kind: "context" },
          ],
          edges: [
            { from: "n1", to: "n2", label: "implemented in" },
            { from: "n3", to: "n1", label: "use" },
            { from: "n5", to: "n4", label: "shapes" },
            { from: "n1", to: "n4", label: "faces" },
          ],
        },
        topics: TELEMED_TOPICS,
      };
    }
    case "search_builder": {
      const topics = (inp.topics as { id: string; name: string; synonyms: string[]; controlledTerms: string[] }[]) ?? [];
      if (!telemedRun(inp, vars)) return ideaSearch(topics, summaryOf(inp.summary));
      const sea = '("Asia, Southeastern"[mh] OR "Southeast Asia"[tiab] OR Thailand[tiab] OR Vietnam[tiab] OR Indonesia[tiab] OR Malaysia[tiab] OR Philippines[tiab])';
      const seaOA = '("Southeast Asia" OR Thailand OR Vietnam OR Indonesia OR Malaysia OR Philippines)';
      return {
        criteria: { yearFrom: 2015, yearTo: null, languages: ["en"], studyTypes: ["any empirical design", "systematic and scoping reviews"], inclusion: ["(mock) Studies of telemedicine/telehealth in Southeast Asian countries"], exclusion: ["(mock) Studies outside Southeast Asia", "(mock) Technical-only engineering papers"] },
        queries: topics.flatMap((t) => [
          { topicId: t.id, database: "pubmed", query: `(${["telemedicine[mh]", ...termsOf(t).map((s) => `"${s}"[tiab]`)].join(" OR ")}) AND ${sea}`, rationale: "(mock) Topic synonyms AND Southeast Asia block." },
          { topicId: t.id, database: "openalex", query: `("telemedicine" OR "telehealth") AND (${quoted(termsOf(t))}) AND ${seaOA}`, rationale: "(mock) Same concept blocks as keywords." },
        ]),
      };
    }
    case "paper_summary": {
      const batch = (input as { id: string; abstract: string | null; publicationTypes: string[] }[]) ?? [];
      return {
        rows: batch.map((p) => {
          const s = sentences(p.abstract ?? "");
          const concl = firstMatch(s, /conclu|suggest|found|showed|indicat/i) ?? s[s.length - 1] ?? "not reported";
          return { paperId: p.id, studyType: studyTypeOf(p.abstract ?? "", p.publicationTypes), setting: settingOf(p.abstract ?? ""), keyFinding: `(mock) ${trimWords(concl.replace(/^[A-Z ]+:\s*/, ""), 30)}`.slice(0, 300) };
        }),
      };
    }
    case "ranking": {
      const { batch, summaries, topic } = inp as { batch: { id: string; title: string; abstract: string | null }[]; summaries: ({ studyType: string; setting: string } | null)[]; topic: { synonyms: string[]; name: string } };
      const tele = telemedRun(inp, vars);
      // Any other idea: the setting criterion uses the place the user named, if any (not Southeast Asia).
      const place = tele ? null : namedPlace(summaryOf(vars.summary));
      const placeWords = place ? phrases(place).map((w) => w.toLowerCase()) : [];
      return {
        scores: batch.map((p, i) => {
          const text = `${p.title} ${p.abstract ?? ""}`.toLowerCase();
          const hits = [topic.name, ...topic.synonyms].filter((s) => text.includes(s.toLowerCase().split(" ")[0])).length;
          const st = summaries[i]?.studyType ?? "other";
          const design = /systematic|randomized/.test(st) ? 5 : /cohort|qualitative|mixed|cross/.test(st) ? 3 : /review/.test(st) ? 3 : 1;
          if (!tele) {
            const there = placeWords.some((w) => text.includes(w));
            return { paperId: p.id, topicFit: Math.min(5, hits + 1), topicFitWhy: `(mock) ${hits} topic terms appear in title/abstract.`, designStrength: design, designStrengthWhy: `(mock) Study type: ${st}.`, settingMatch: place ? (there ? 5 : 1) : 3, settingMatchWhy: (place ? (there ? `(mock) Mentions ${place}.` : `(mock) Does not mention ${place}.`) : "(mock) You did not name a place, so every paper scores the middle.").slice(0, 200), overall: `(mock) Keyword-overlap score. ${SAMPLE_NOTE}` };
          }
          const sea = SEA.some((c) => text.includes(c.toLowerCase())) ? 5 : 1;
          return { paperId: p.id, topicFit: Math.min(5, hits + 1), topicFitWhy: `(mock) ${hits} topic terms appear in title/abstract.`, designStrength: design, designStrengthWhy: `(mock) Study type: ${st}.`, settingMatch: sea, settingMatchWhy: sea === 5 ? "(mock) Mentions a Southeast Asian setting." : "(mock) No Southeast Asian setting mentioned.", overall: "(mock) Keyword-overlap score." };
        }),
      };
    }
    case "topic_importance": {
      const topics = (inp.topics as { id: string; name: string }[]) ?? [];
      return { order: topics.map((t, i) => ({ topicId: t.id, rank: i + 1, justification: `(mock) Kept in scoping order (#${i + 1}).` })) };
    }
    case "appraisal": {
      const { text, checklist } = inp as { text: string; checklist: string[] };
      const s = sentences(text);
      const pick = (re: RegExp, used: Set<string>) => {
        const x = s.find((y) => re.test(y) && !used.has(y));
        if (x) used.add(x);
        return x ?? null;
      };
      const used = new Set<string>();
      const fields: [string, RegExp][] = [
        ["aim", /\b(aim|objective|purpose|we (sought|explored|examined|assessed))/i],
        ["setting", new RegExp(SEA.join("|"))],
        ["sample", /\b(\d[\d,]*\s+(participants|patients|respondents|studies|articles|users|health))/i],
        ["methods", /\b(method|survey|interview|questionnaire|design|searched|analys)/i],
        ["key_findings", /\b(found|results?|showed|revealed|identified|reported)/i],
        ["key_findings", /\b(significant|associated|increase|improv|reduc|major)/i],
        ["limitations", /\b(limitation|limited|bias|caution)/i],
      ];
      const extractions = fields.map(([field, re]) => {
        const q = pick(re, used);
        return q
          ? { field, statement: `(mock) ${trimWords(q, 30)}`, notReported: false, quote: trimWords(q, 55), location: "(mock) located by keyword" }
          : { field, statement: "not reported", notReported: true, quote: "", location: "" };
      });
      // Deliberately unverifiable quote to demonstrate flagging.
      const kf = extractions.find((e) => e.field === "key_findings" && e.quote);
      if (kf) extractions.push({ field: "key_findings", statement: "(mock) Paraphrase presented as a quote — should be flagged", notReported: false, quote: `${kf.quote.split(" ").slice(0, 6).join(" ")} which clearly proves the intervention works everywhere`, location: "(mock) deliberately altered" });
      return {
        extractions,
        checklist: checklist.map((item, i) => {
          const q = s[(i * 3) % Math.max(1, s.length)];
          return i % 3 === 2 || !q ? { item, answer: "not_reported", quote: "", location: "" } : { item, answer: "unclear", quote: trimWords(q, 40), location: "(mock)" };
        }),
      };
    }
    case "synthesis": {
      const { claims, papers } = inp as { claims: { id: string; paperId: string; field: string; statement: string }[]; papers: { id: string }[] };
      const themes = ["(mock) Main findings", "(mock) Study context", "(mock) Limitations"];
      const fieldTheme: Record<string, string> = { key_findings: themes[0], setting: themes[1], sample: themes[1], limitations: themes[2] };
      const matrix = papers.flatMap((p) =>
        themes.map((th) => {
          const cs = claims.filter((c) => c.paperId === p.id && fieldTheme[c.field] === th).slice(0, 2);
          return cs.length ? { paperId: p.id, theme: th, value: cs[0].statement.slice(0, 200), stance: "neutral", claimIds: cs.map((c) => c.id) } : null;
        }).filter(Boolean),
      );
      const kf = claims.filter((c) => c.field === "key_findings");
      const lim = claims.filter((c) => c.field === "limitations");
      const twoPapers = [...new Map(kf.map((c) => [c.paperId, c])).values()].slice(0, 2);
      return {
        themes,
        matrix: matrix.length ? matrix : [{ paperId: claims[0].paperId, theme: themes[0], value: claims[0].statement.slice(0, 200), stance: "neutral", claimIds: [claims[0].id] }],
        contradictions: twoPapers.length === 2 ? [{ theme: themes[0], description: "(mock) sample conflict: two papers' key findings paired at random to show how a conflict is highlighted. They do not necessarily disagree.", claimIds: twoPapers.map((c) => c.id) }] : [],
        known: kf.length ? [{ statement: `(mock) ${kf.length} key findings were extracted for this topic.`, claimIds: kf.slice(0, 5).map((c) => c.id) }] : [],
        contested: twoPapers.length === 2 ? [{ statement: "(mock) sample conflict: shows where findings that differ between studies would appear.", claimIds: twoPapers.map((c) => c.id) }] : [],
        unknown: [{ statement: "(mock) Gaps signalled by the studies' own limitations.", claimIds: (lim.length ? lim : claims).slice(0, 4).map((c) => c.id) }],
      };
    }
    case "research_questions": {
      const { items, links, topics } = inp as { items: { id: string; kind: string }[]; links: { ownerId: string; claimId: string }[]; topics: { name: string; synonyms: string[] }[] };
      const unknown = items.filter((i) => i.kind === "unknown");
      const pickClaims = (k: number) => {
        const it = (unknown.length ? unknown : items)[k % Math.max(1, (unknown.length ? unknown : items).length)];
        const cs = links.filter((l) => l.ownerId === it.id).map((l) => l.claimId).slice(0, 3);
        return { it: it.id, cs: cs.length ? cs : [links[0].claimId] };
      };
      const designs = ["Qualitative interview study", "Cross-sectional survey", "Mixed-methods implementation study"];
      if (!telemedRun(inp, vars)) {
        return {
          questions: ideaQuestions(topics, summaryOf(vars.summary)).map((c, k) => {
            const { it, cs } = pickClaims(k);
            return { ...c, design: designs[k], gapClaimIds: cs, synthesisIds: [it] };
          }),
        };
      }
      return {
        questions: [0, 1, 2].map((k) => {
          const t = topics[k % topics.length];
          const { it, cs } = pickClaims(k);
          return {
            text: `(mock) What ${t.name.toLowerCase()} factors shape telemedicine implementation in rural Southeast Asia?`,
            framework: k === 1 ? "PECO" : "PICo",
            structure: k === 1 ? [{ element: "Population", value: "Rural health workers" }, { element: "Exposure", value: t.name }, { element: "Comparison", value: "Urban counterparts" }, { element: "Outcome", value: "Telemedicine use" }] : [{ element: "Population", value: "Patients and providers" }, { element: "Interest", value: t.name }, { element: "Context", value: "Rural Southeast Asia" }],
            design: designs[k],
            gap: "(mock) Gap drawn from the synthesis 'unknown' statements.",
            gapClaimIds: cs,
            synthesisIds: [it],
            feasibility: "(mock) Feasible with a small purposive sample over 6 months.",
            weakness: "(mock) Limited generalisability across countries.",
            noveltyQueries: { pubmed: `telemedicine[mh] AND (${tiab(termsOf(t, 2))}) AND "Asia, Southeastern"[mh]`, openalex: `"telemedicine" AND (${quoted(termsOf(t, 2))}) AND "Southeast Asia"` },
          };
        }),
      };
    }
    default:
      throw new Error(`No mock responder for prompt "${prompt}" (vars: ${Object.keys(vars).join(", ")})`);
  }
}
