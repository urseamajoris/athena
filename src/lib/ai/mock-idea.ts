/*
 * Demo (mock) mode only: read a research idea and the scoping answers in the user's own words, so the scripted
 * AI suggests topics, searches and questions about THEIR idea (the recorded papers stay telemedicine samples), and
 * write synthesis statements from the claims they cite. Pure (no server code) so it can be unit-tested; used by mock.ts.
 */
import { shortCite } from "../shared/stages";

export type ScopeField = "population" | "setting" | "outcome" | "timeframe" | "studyTypes";
export type Answers = Partial<Record<ScopeField, string>>;
export interface MockTopic { name: string; synonyms: string[]; controlledTerms: string[]; rationale: string }

// Function words, generic verbs and vague nouns that never make a search topic on their own.
const STOP = new Set(
  ("a an and are as at be been being by can could do does did doing for from has have had how i im in into is it its me my of on or our " +
    "should so than that the their them then there these they this those to under up down go goes went use used using was we were what when where " +
    "which while who whom why will with would about between among amongst during after before over via vs versus within without across toward towards " +
    "interested want wants know knowledge gap gaps effect effects impact impacts role relationship relationships association associations influence " +
    "influences factor factors help helps helping improve improves improving affect affects affecting reduce reduces reducing increase increases " +
    "increasing recover recovers recovering control controls shape shapes compare compared comparing study studies research review evidence measure " +
    "measured measuring any all kind kinds aged way ways lot lots get gets make makes some other whether if because since means").split(" "),
);
// Inside an answer, words that make a clause of it ("less sleep means lower grades"): an answer gives search words
// only from the terms around them ("sleep", "grades"), never the sentence.
const ANSWER_STOP = new Set([
  ...STOP,
  ..."mean meaning lower higher better worse more less fewer lead leads leading cause causes caused become becomes think feel like linked link links".split(" "),
]);
const PEOPLE = /^(adults?|children|child|kids|nurses?|workers?|students?|pat(?:ie|ei)nts?|teenagers?|adolescents?|youth|women|men|mothers?|fathers?|parents?|people|persons?|staff|doctors?|physicians?|clinicians?|residents?|infants?|carers?|caregivers?|users?|girls?|boys?|families|employees?|survivors?|veterans?|elderly|seniors?|pupils?|learners?|teachers?|midwives|pharmacists?|athletes?|smokers?|drivers?|populations?)$/i;
const ANYWHERE = /^(any|anywhere|any (country|countries|place|setting|where)|all countries|global(ly)?|worldwide|world ?wide|not important|no preference|doesn'?t matter|does not matter)$/i;
// Answers that name no place even though they are longer ("any country is fine", "not sure", "no specific country").
const NO_PLACE = /\b(anywhere|any (country|countries|place|setting|region)|all countries|global(ly)?|worldwide|world ?wide|internationally|no (preference|specific|particular)|not (sure|important|specific)|unsure|don'?t know|doesn'?t matter|does not matter|whatever)\b/i;
// Place names keep their capital inside a sentence, however the user typed them ("thailand" → "Thailand").
const PLACES = new Map(
  ("Afghanistan Africa America Argentina Asia Australia Austria Bangladesh Belgium Brazil Brunei Cambodia Canada Chile China Colombia Denmark Egypt England " +
    "Ethiopia Europe Finland France Germany Ghana Greece India Indonesia Iran Iraq Ireland Israel Italy Japan Kenya Korea Laos Malawi Malaysia Mexico Morocco " +
    "Myanmar Nepal Netherlands Nigeria Norway Pakistan Peru Philippines Poland Portugal Russia Rwanda Scotland Singapore Spain Sweden Switzerland Taiwan " +
    "Tanzania Thailand Turkey Uganda Ukraine Vietnam Wales Zambia Zimbabwe Bangkok London Nairobi Manila Jakarta Hanoi").split(" ").map((p) => [p.toLowerCase(), p]),
);
const NO_SINGULAR = new Set(["diabetes", "measles", "mumps", "rabies", "herpes", "scabies", "series", "species", "news", "status", "analysis", "physics", "aids"]);
/** Filler topics used only to reach the minimum of four. */
export const FILLER_TOPICS = ["Measurement and outcomes", "Context and setting"];

const norm = (w: string) => w.toLowerCase().replace(/['’]/g, "");
const isAcronym = (w: string) => /[A-Z].*[A-Z]|[a-z][A-Z]/.test(w) || /^[A-Z]{2,}$/.test(w);
/** Lower-case a phrase for use inside a sentence, keeping acronyms ("long COVID", "ICU nurses"). */
export const inSentence = (p: string) => p.split(" ").map((w) => (isAcronym(w) ? w : PLACES.get(w.toLowerCase()) ?? w.toLowerCase())).join(" ");
const capFirst = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

/** Text between wrapData markers (the model input), or the text itself. */
export function unwrapData(s: string | undefined): string {
  return (s ?? "").replace(/^<<<BEGIN DATA:[^>]*>>>\n?/, "").replace(/\n?<<<END DATA:[^>]*>>>$/, "").trim();
}

/** An answer as the user wrote it, tidied and capped. */
export function cleanAnswer(s: string | undefined | null, max = 200): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").replace(/[\s;,.]+$/, "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
}

/** True when a setting answer names a place (not "any country"). */
export const isSpecificPlace = (s: string | null | undefined) => !!s && !ANYWHERE.test(s.trim().replace(/[.!]+$/, "")) && !NO_PLACE.test(s);

export function firstYear(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/\b(19[5-9]\d|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

// Common words in health ideas, fixed when one letter is off even if the user never spelt them right ("pateint").
// Real words one letter away from them are listed too, so they are kept as typed ("patent" is not "patient").
const COMMON = ("patient patients diabetes diabetic children disease diseases hospital hospitals treatment pregnancy pregnant depression " +
  "anxiety dementia hypertension rehabilitation adolescents elderly students nurses doctors mothers").split(" ");
const REAL = new Set(["patent", "patents", "diseased", "nursed"]);

/**
 * Fix a misspelt word when the user spelt it correctly in one of their answers ("diabtes" → "diabetes"), or when it
 * is one letter (or one swap) away from a common health word.
 */
function respell(word: string, vocab: string[]): string {
  const w = word.toLowerCase();
  if (w.length < 5 || COMMON.includes(w) || REAL.has(w)) return word;
  const near = (v: string, most: number) => v[0] === w[0] && v !== `${w}s` && w !== `${v}s` && editDistance(w, v) <= most;
  // The common words first: the same typo in the idea and the answers must not count as the right spelling.
  const fix = (w.length >= 6 ? COMMON.find((v) => near(v, 1)) : undefined) ?? (vocab.includes(w) ? undefined : vocab.find((v) => near(v, w.length >= 6 ? 2 : 1)));
  return fix ? (word[0] === word[0].toUpperCase() ? capFirst(fix) : fix) : word;
}

/** A sentence with common health words spelt right (only those: other words stay as the user wrote them). */
export const respellCommon = (text: string) => text.replace(/[A-Za-z]{6,}/g, (w) => respell(w, []));

/**
 * Key phrases in the user's words: runs of words between stop words and punctuation, so multi-word concepts stay
 * together ("hip fracture surgery", "long COVID", "peer support groups"). At most four words per phrase.
 */
export function phrases(text: string, vocabFrom: string[] = [], stop: Set<string> = STOP): string[] {
  const vocab = [...new Set(vocabFrom.join(" ").toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length >= 5))];
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const words = run.slice(-4);
    run = [];
    if (!words.length || words.every((w) => /^\d+$/.test(w))) return;
    if (words.length === 1 && words[0].length <= 2 && !isAcronym(words[0])) return;
    const p = words.join(" ");
    if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  };
  for (const tok of text.replace(/[^A-Za-z0-9'’\-\s]+/g, " | ").split(/\s+/)) {
    const w = tok.replace(/^[-'’]+|[-'’]+$/g, "");
    if (!w || tok === "|" || stop.has(norm(w))) flush();
    else run.push(respell(w, vocab));
  }
  flush();
  return out;
}

export const isPeople = (p: string) => PEOPLE.test(p.split(" ").pop() ?? "");

/** Search words for a phrase: the phrase, a spelling variant for hyphenated words, and the singular. */
export function synonymsFor(phrase: string): string[] {
  const base = inSentence(phrase);
  const out = [base];
  if (base.includes("-")) {
    out.push(base.replace(/-/g, " "));
    if (/^(tele|e|m|post|pre|non|co|re)-/i.test(base)) out.push(base.replace(/^(\w+)-/, "$1"));
  }
  const words = base.split(" ");
  const last = words[words.length - 1];
  if (/[a-z]s$/.test(last) && !/(ss|us|is)$/.test(last) && !NO_SINGULAR.has(last.toLowerCase()) && last.length > 3) {
    out.push([...words.slice(0, -1), last.replace(/ies$/, "y").replace(/([^i])s$/, "$1")].join(" "));
  }
  return [...new Set(out)].slice(0, 4);
}

const shares = (a: string, b: string) => {
  const wa = new Set(a.toLowerCase().split(/[\s-]+/).filter((w) => w.length > 2));
  return b.toLowerCase().split(/[\s-]+/).some((w) => w.length > 2 && wa.has(w));
};

/**
 * Four to six topics from the idea and the answers: the idea's own phrases first, then the people, outcome and
 * place the user named (an answer that overlaps a topic is added to its synonyms instead), then filler.
 */
export function ideaTopics(idea: string, answers: Answers = {}): MockTopic[] {
  const answerText = Object.values(answers).filter(Boolean) as string[];
  const topics: MockTopic[] = phrases(idea, answerText).slice(0, 4).map((p) => ({ name: capFirst(p), synonyms: synonymsFor(p), controlledTerms: [], rationale: `(mock) From your idea: "${inSentence(p)}".` }));
  const fromAnswer = (field: ScopeField, label: string) => {
    const a = answers[field];
    if (!a || (field === "setting" && !isSpecificPlace(a))) return;
    const p = phrases(a.split(/[,;]/)[0], answerText, ANSWER_STOP)[0];
    if (!p) return;
    const near = topics.find((t) => shares(t.name, p));
    // A synonym is a short term; a longer run of words from an answer is not one.
    if (near) near.synonyms = p.split(" ").length <= 3 ? [...new Set([...near.synonyms, inSentence(p)])].slice(0, 6) : near.synonyms;
    else topics.push({ name: capFirst(p), synonyms: synonymsFor(p), controlledTerms: [], rationale: `(mock) From your answer about ${label}: "${inSentence(p)}".` });
  };
  fromAnswer("population", "who to study");
  fromAnswer("outcome", "the outcome");
  fromAnswer("setting", "where");
  const filler: MockTopic[] = [
    { name: FILLER_TOPICS[0], synonyms: ["outcomes", "measurement", "assessment"], controlledTerms: [], rationale: "(mock) How the outcome is measured shapes what is found." },
    { name: FILLER_TOPICS[1], synonyms: ["setting", "context", "population"], controlledTerms: [], rationale: "(mock) Where and with whom the studies were done." },
  ];
  for (const f of filler) if (topics.length < 4) topics.push(f);
  return topics.slice(0, 6);
}

/** The idea's concepts: topics that are not a group of people, the place the user named, or filler. */
const conceptsOf = <T extends { name: string }>(topics: T[], place: string | null = null) => topics.filter((t) => !isPeople(t.name) && !FILLER_TOPICS.includes(t.name) && !(place && shares(t.name, place)));

/** Said wherever demo output could be read as being about the user's topic. */
export const SAMPLE_NOTE = "Demo mode searches recorded sample papers on telemedicine, so few will match your topic.";

/** Scoping questions for any idea but the telemedicine test idea: one plain question per field. */
export const IDEA_QUESTIONS: { q: string; t: ScopeField }[] = [
  { q: "(mock) Who do you want to study? For example: which people, what age, which group.", t: "population" },
  { q: "(mock) Where? Name a country, region or kind of place, or say “anywhere”.", t: "setting" },
  { q: "(mock) What result matters most to you, and how would you measure it?", t: "outcome" },
  { q: "(mock) From which year should papers count? For example: from 2015 to now.", t: "timeframe" },
  { q: "(mock) What kinds of study should count? For example: surveys, trials, interviews, reviews, or any kind.", t: "studyTypes" },
];
/** Each answer under the field its question asked about (answers come in the order the questions were asked). */
export const answersByField = (answers: string[]): Answers =>
  Object.fromEntries(answers.slice(0, IDEA_QUESTIONS.length).map((a, i) => [IDEA_QUESTIONS[i].t, cleanAnswer(a, 180) ?? undefined]));

/** The scoping summary (object or wrapped JSON), without the "(mock)" prefix and "not stated". */
export function summaryOf(raw: unknown): Record<string, string | null> {
  let o: Record<string, unknown> = {};
  try {
    o = (typeof raw === "string" ? JSON.parse(unwrapData(raw) || "{}") : (raw ?? {})) as Record<string, unknown>;
  } catch {
    /* no usable summary */
  }
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => {
      const t = typeof v === "string" ? v.replace(/^\(mock\)\s*/, "").trim() : "";
      return [k, t && !/^not stated$/i.test(t) ? t : null];
    }),
  );
}
/** At most `max` characters, cut between words (never inside one) and without a dangling "of a" at the end. */
export function upToWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const words = s.slice(0, max + 1).split(/\s+/).slice(0, -1);
  while (words.length > 1 && STOP.has(norm(words[words.length - 1]))) words.pop();
  return words.join(" ") || s.slice(0, max);
}
/** The first clause of an answer, for use inside a sentence. */
export const clause = (s: string | null | undefined) => (s ? inSentence(upToWord(s.split(/[,;(]/)[0].trim(), 90)) : null);
/** The place the user named, or null for "anywhere" / no answer. */
export const namedPlace = (sum: Record<string, string | null>) => (isSpecificPlace(sum.setting) ? clause(sum.setting) : null);

export const tiab = (terms: string[]) => terms.map((s) => `"${s}"[tiab]`).join(" OR ");
export const quoted = (terms: string[]) => terms.map((s) => `"${s}"`).join(" OR ");
/** A topic's search words; a topic added without synonyms is searched by its name, so no group is ever empty. */
export const termsOf = (t: { name?: string; synonyms?: string[] }, n = 4) => (t.synonyms?.length ? t.synonyms : [t.name || "topic"]).slice(0, n);

/** Searches built from the user's topics: each topic's words AND the main concept (the main concept AND the next one). */
export function ideaSearch<T extends { id: string; name: string; synonyms: string[] }>(topics: T[], sum: Record<string, string | null>, note = SAMPLE_NOTE) {
  const pop = clause(sum.population);
  const place = namedPlace(sum);
  const concepts = conceptsOf(topics, place);
  const core = concepts[0] ?? topics[0];
  const partnerOf = (t: T) => (t === core ? concepts.find((c) => c !== core) : core);
  return {
    criteria: {
      yearFrom: firstYear(sum.timeframe) ?? 2015,
      yearTo: null,
      languages: ["en"],
      studyTypes: ["any empirical design", "systematic and scoping reviews"],
      inclusion: [`(mock) Studies about ${(concepts.length ? concepts : topics).slice(0, 3).map((t) => inSentence(t.name)).join(" and ")}`, pop && `(mock) Studies of ${pop}`, place && `(mock) Studies in ${place}`].filter((x): x is string => !!x).map((x) => x.slice(0, 200)),
      exclusion: ["(mock) Studies that do not address these topics", "(mock) Opinion pieces with no data"],
    },
    queries: topics.flatMap((t) => {
      const partner = partnerOf(t);
      return [
        { topicId: t.id, database: "pubmed" as const, query: `(${tiab(termsOf(t))})${partner ? ` AND (${tiab(termsOf(partner, 3))})` : ""}`, rationale: `(mock) This topic's words${partner ? ` AND "${inSentence(partner.name)}"` : ""}.${note ? ` ${note}` : ""}`.slice(0, 240) },
        { topicId: t.id, database: "openalex" as const, query: `(${quoted(termsOf(t))})${partner ? ` AND (${quoted(termsOf(partner, 3))})` : ""}`, rationale: `(mock) Same concept blocks as keywords.${note ? ` ${note}` : ""}` },
      ];
    }),
  };
}

// Things done to people to help them (an effect question compares them with usual care), and health conditions.
const INTERVENTION = /(intervention|therap|treatment|rehabilitation|counsel|coaching|programme|program|training|support group|tele-?\w|mhealth|e-?health|mobile app|exercise)/i;
const CONDITION = /(covid|depress|anxiety|burnout|disease|disorder|syndrome|diabetes|obesity|pain|injury|fracture|infection|cancer|stroke|illness|dementia|asthma|hypertension)/i;
// The idea asks whether something works ("Does tele-rehabilitation help…", "can an app reduce…"); not "return-to-work".
const ASKS_EFFECT = /(?<![-\w])(help|helps|helped|work|works|improve|improves|reduce|reduces|lower|lowers|effective|effectiveness|efficacy|benefit|benefits|prevent|prevents)(?![-\w])/i;

/** Topics in the order the idea names them ("sleep affects grades": sleep, then grades); topics not in it keep their order, last. */
function inIdeaOrder<T extends { name: string; synonyms: string[] }>(topics: T[], idea: string): T[] {
  const low = idea.toLowerCase();
  const at = (t: T) => Math.min(Infinity, ...[t.name, ...t.synonyms].map((w) => low.indexOf(w.toLowerCase())).filter((n) => n >= 0));
  return topics.map((t, i) => ({ t, i, at: at(t) })).sort((x, y) => (x.at === y.at ? x.i - y.i : x.at - y.at)).map((x) => x.t);
}

/** What an exposure is compared with: usual care for a treatment, people without a condition, otherwise less of it. */
const USED = /\b(apps?|applications?|devices?|phones?|smartphones?|screens?|media|internet|platforms?|tools?|games?|gaming|technolog\w*|wearables?|drugs?|medicines?|medications?|substances?|alcohol|cannabis|tobacco|cigarettes?|vaping|e-cigarettes?|chatbots?|software|websites?)\b/i;
function contrastOf(name: string): string {
  const a = inSentence(name);
  if (INTERVENTION.test(a)) return `Usual care, without ${a}`;
  if (CONDITION.test(a)) return `Without ${a}`;
  // Only things people use get "less use of" (apps, phones, alcohol); other plurals are counted ("fewer night shifts").
  if (USED.test(a)) return `Less use of ${a}`;
  const last = a.split(" ").pop() ?? "";
  return /[a-z]s$/.test(last) && !/(ss|us|is)$/.test(last) && !NO_SINGULAR.has(last) ? `Fewer ${a}` : `Less ${a}`;
}

/**
 * The outcome in the idea's verb: "help older adults recover after hip fracture surgery" → "recovery after hip fracture
 * surgery", or just "recovery" when the population already says what it is after ("adults … after surgical repair of a
 * hip fracture"), so the question does not say it twice.
 */
function outcomeInIdea(idea: string, pop: string | null): string | null {
  const m = idea.match(/\brecover(?:y|s|ing|ed)?\b(?:\s+(after|from)\s+([^?.!,;]+))?/i);
  if (!m) return null;
  const what = m[2] ? inSentence(m[2].trim().split(/\s+/).slice(0, 5).join(" ")) : null;
  if (!what) return "recovery";
  const popWords = new Set((pop ?? "").toLowerCase().split(/[^a-z0-9]+/));
  const content = what.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const repeated = content.length > 0 && content.filter((w) => popWords.has(w)).length * 2 >= content.length;
  return repeated ? "recovery" : `recovery ${m[1].toLowerCase()} ${what}`;
}

/**
 * Three well-formed candidate questions in the user's words: how people experience the main concept (PICo), whether
 * it is associated with the second concept (PECO, exposure and outcome in the order the idea names them) or, when the
 * idea asks whether something helps, what its effect is compared with usual care (PICO), and what helps or hinders it
 * (PICo). Each has its own design, gap, feasibility and weakness.
 */
export function ideaQuestions(topics: { name: string; synonyms: string[] }[], sum: Record<string, string | null>, note = SAMPLE_NOTE, idea = "") {
  const place = namedPlace(sum);
  const people = topics.find((t) => isPeople(t.name));
  const pop = clause(sum.population) ?? (people ? inSentence(people.name) : null);
  // A concept the population already names is not a second concept ("adults over 65 after hip fracture surgery").
  const inPop = (t: { name: string }) => !!pop && pop.toLowerCase().includes(inSentence(t.name).toLowerCase());
  const concepts = inIdeaOrder(conceptsOf(topics, place), idea);
  const a = concepts[0] ?? topics[0];
  const b = concepts.find((t) => t !== a && !inPop(t)) ?? { name: clause(sum.outcome) ?? "outcomes", synonyms: [] };
  const A = inSentence(a.name);
  const B = inSentence(b.name);
  const among = pop ? ` among ${pop}` : "";
  const where = place && !(pop ?? "").toLowerCase().includes(place.toLowerCase()) ? ` in ${place}` : "";
  const who = { element: "Population", value: pop ?? "(mock) not stated" };
  const context = { element: "Context", value: place ?? "Any setting" };
  const novelty = { pubmed: `(${tiab(termsOf(a, 2))}) AND (${tiab(termsOf(b, 2))})`, openalex: `(${quoted(termsOf(a, 2))}) AND (${quoted(termsOf(b, 2))})` };
  // An effect question when the idea asks whether a treatment (something done to help people) works.
  const effect = INTERVENTION.test(A) && (ASKS_EFFECT.test(idea) || /\beffects? of\b/i.test(idea));
  // The second concept is the outcome (an outcome answer is merged into it or follows it), unless the verb names one.
  const outcome = outcomeInIdea(idea, pop) ?? B;
  const second = effect
    ? { framework: "PICO" as const, text: `(mock) What is the effect of ${A} compared with usual care on ${outcome}${among}${where}?`, structure: [who, { element: "Intervention", value: a.name }, { element: "Comparison", value: "Usual care" }, { element: "Outcome", value: capFirst(outcome) }], design: "Randomised controlled trial (a small pilot first)", gap: `(mock) Sample gap: few included papers compare ${A} with usual care.`, feasibility: "(mock) Feasible as a pilot trial with about 60 people over 12 months.", weakness: "(mock) A pilot this small may not show a difference even if there is one." }
    : { framework: "PECO" as const, text: `(mock) Is there an association between ${A} and ${B}${among}?`, structure: [who, { element: "Exposure", value: a.name }, { element: "Comparison", value: contrastOf(a.name) }, { element: "Outcome", value: b.name }], design: "Cross-sectional survey", gap: "(mock) Sample gap: the included papers do not measure this link directly.", feasibility: "(mock) Feasible with an online survey of about 300 people.", weakness: "(mock) A survey shows an association, not a cause." };
  return [
    { framework: "PICo" as const, text: `(mock) How do ${pop ?? "the people involved"} experience ${A}${where}?`, structure: [who, { element: "Interest", value: a.name }, context], design: "Qualitative interview study", gap: "(mock) Sample gap: few included papers describe how people experience this.", feasibility: "(mock) Feasible with 15 to 25 interviews over 6 months.", weakness: "(mock) A small sample may not transfer to other groups." },
    second,
    { framework: "PICo" as const, text: `(mock) What helps or hinders ${A}${among}${where}?`, structure: [who, { element: "Interest", value: `What helps or hinders ${A}` }, context], design: "Mixed-methods implementation study", gap: "(mock) Sample gap: barriers and enablers are rarely compared across settings.", feasibility: "(mock) Feasible over 12 months with a survey and follow-up interviews.", weakness: "(mock) Larger and slower than a single-method study." },
  ].map((c) => ({ ...c, text: c.text.slice(0, 400), structure: c.structure.map((s) => ({ ...s, value: s.value.slice(0, 300) })), gap: `${c.gap}${note ? ` ${note}` : ""}`, noveltyQueries: novelty }));
}

/** A claim in plain words for a synthesis statement: no "(mock)", section label or lead-in ("The results showed that"). */
export function gist(statement: string, words = 24): string {
  const s = statement
    .replace(/^\(mock\)\s*/, "")
    .replace(/^[A-Z][A-Z /]+:\s*/, "")
    .replace(/^(in conclusion|overall|in summary|taken together|finally),?\s+/i, "")
    .replace(/^(the |these |our |this )?(results?|findings?|study|data|analysis|review|authors?|we)( also)? (showed?|shows|suggest(?:ed|s)?|found|finds|indicated?|indicates|revealed?|reveals|demonstrated?|demonstrates|reported|reports|highlighted?|highlights|concluded?|concludes)( that)?\s+/i, "")
    .split(/;\s/)[0]
    .trim();
  const w = s.split(/\s+/);
  const t = w.length > words ? `${w.slice(0, words).join(" ").replace(/[\s,;:.]+$/, "")}…` : s.replace(/[\s,;:.]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface MockClaim { id: string; paperId: string; field: string; statement: string; verified?: boolean }

/**
 * Demo synthesis statements that say what the claims they cite say: Known condenses one paper's finding, Contested sets
 * two other findings from different papers side by side, Unknown comes from the papers' own limitations. Only the
 * claims given (verified or accepted ones) are cited; quotes found in the paper come before ones the user accepted.
 */
export function synthesisStatements(claims: MockClaim[], papers: { id: string; authors?: string[]; year?: number | null }[], theme: string) {
  const cite = (paperId: string) => {
    const p = papers.find((x) => x.id === paperId);
    return p ? shortCite(p.authors ?? [], p.year ?? null) : "one paper";
  };
  const foundFirst = (cs: MockClaim[]) => [...cs].sort((x, y) => Number(y.verified !== false) - Number(x.verified !== false));
  const byPaper = (field: string) => {
    const m = new Map<string, MockClaim[]>();
    for (const c of foundFirst(claims.filter((x) => x.field === field))) m.set(c.paperId, [...(m.get(c.paperId) ?? []), c]);
    return [...m.values()];
  };
  const kf = byPaper("key_findings");
  const known = kf.slice(0, 3).map(([c]) => ({ statement: `(mock) ${gist(c.statement)} (reported by ${cite(c.paperId)}).`.slice(0, 600), claimIds: [c.id] }));
  const knownIds = new Set(known.flatMap((k) => k.claimIds));
  // Two papers' other findings, so Contested does not repeat Known (unless there are no others).
  const spare = kf.map((cs) => cs.find((c) => !knownIds.has(c.id))).filter((c): c is MockClaim => !!c);
  const [pa, pb] = spare.length >= 2 ? spare : kf.map(([c]) => c);
  const lims = byPaper("limitations").slice(0, 2).map(([c]) => c);
  const how = foundFirst(claims.filter((c) => c.field === "methods" || c.field === "sample"))[0] ?? claims[0];
  return {
    contradictions: pa && pb ? [{ theme, description: `(mock) Possible conflict between ${cite(pa.paperId)} and ${cite(pb.paperId)}: the demo sets two findings from different papers side by side. Compare the quotes to see whether they really disagree.`.slice(0, 400), claimIds: [pa.id, pb.id] }] : [],
    known,
    contested: pa && pb ? [{ statement: `(mock) Possible difference to check. ${cite(pa.paperId)}: ${gist(pa.statement)}. ${cite(pb.paperId)}: ${gist(pb.statement)}. Read both quotes before treating this as a real disagreement.`.slice(0, 600), claimIds: [pa.id, pb.id] }] : [],
    unknown: lims.length
      ? lims.map((c) => ({ statement: `(mock) Still uncertain: ${gist(c.statement)} (a limitation noted by ${cite(c.paperId)}).`.slice(0, 600), claimIds: [c.id] }))
      : how
        ? [{ statement: `(mock) None of these ${papers.length} papers states its limitations, so what is still unknown is unclear; check how they were done. For example, ${cite(how.paperId)}: ${gist(how.statement)}.`.slice(0, 600), claimIds: [how.id] }]
        : [],
  };
}
