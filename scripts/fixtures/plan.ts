// Fixture content for stages 1–3 of the seeded reviews (scripts/seed-fixture.ts): the idea, the short chat, the
// research question and the search plan. Test data only: never imported by the app.
//
// The texts under "AI" are written by hand in the length and tone the model produces, for the README's test idea.
// The PubMed queries are the ones scripts/fixtures/fetch-papers.ts really ran to build papers.json.
import type { Criteria, QuestionDraft } from "../../src/lib/db/schema";

export const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";

// ---------------------------------------------------------------- stage 2: chat

/** What is known so far, per element (ScopingTurn.coverage in src/lib/stages/ai-schemas.ts). */
export type Coverage = Record<"population" | "phenomenon" | "comparison" | "outcome" | "setting" | "timeframe" | "studyTypes", string | null>;

export interface ChatTurn {
  /** What the question asks about (ScopingTurn.questionTarget). */
  target: keyof Coverage;
  question: string;
  answer: string;
  /** What the AI had understood when it asked this question. */
  coverage: Coverage;
}

const POPULATION = "Health services and the health workers who set up and run telemedicine; patients as one factor";
const SETTING = "ASEAN countries, with a focus on public services and rural or remote areas";
const OUTCOME = "Services that are used and keep running after a pilot or the pandemic; health outcomes are secondary";

export const CHAT: ChatTurn[] = [
  {
    target: "population",
    question: "Who is your review mainly about: patients, health workers, or the health services that run telemedicine?",
    answer: "Mostly the health services and the people who work in them: the doctors, nurses and managers who have to set telemedicine up and keep it running. Patients' views matter too, but as one of the factors.",
    coverage: { population: null, phenomenon: "Implementing telemedicine", comparison: null, outcome: null, setting: "Southeast Asia", timeframe: null, studyTypes: null },
  },
  {
    target: "setting",
    question: "Which countries or kinds of service do you want to cover? All of Southeast Asia, or particular countries or levels of care?",
    answer: "All ASEAN countries if possible. I am most interested in public services and in rural or remote areas, where telemedicine is supposed to help most.",
    coverage: { population: POPULATION, phenomenon: "Implementing telemedicine", comparison: null, outcome: null, setting: "Southeast Asia", timeframe: null, studyTypes: null },
  },
  {
    target: "outcome",
    question: "What should count as implementation going well? For example use by patients, services that keep running after a pilot, or better health outcomes?",
    answer: "Services that are actually used and that keep running after the pilot or the pandemic. Health outcomes are useful to know about, but they are not my main interest.",
    coverage: { population: POPULATION, phenomenon: "Implementing telemedicine", comparison: null, outcome: null, setting: SETTING, timeframe: null, studyTypes: null },
  },
  {
    target: "timeframe",
    question: "From which year should the review start? Telemedicine changed a lot with smartphones, and again during COVID-19.",
    answer: "From 2015. Earlier systems were too different to compare.",
    coverage: { population: POPULATION, phenomenon: "Implementing telemedicine", comparison: null, outcome: OUTCOME, setting: SETTING, timeframe: null, studyTypes: null },
  },
];

/** What the AI had understood when it closed the chat. */
export const FINAL_COVERAGE: Coverage = { population: POPULATION, phenomenon: "Implementing telemedicine", comparison: null, outcome: OUTCOME, setting: SETTING, timeframe: "2015 onwards", studyTypes: null };

// ---------------------------------------------------------------- stage 2: the research question

export const QUESTION_DRAFTS: QuestionDraft[] = [
  {
    text: "What barriers and enablers affect the implementation of telemedicine services in Southeast Asian health systems, and where is the evidence missing?",
    framework: "PICo",
    structure: {
      Population: "Health services, health workers and patients in Southeast Asian (ASEAN) countries",
      "Phenomenon of interest": "Setting up telemedicine services and keeping them running",
      Context: "Public and private health care since 2015, including rural and remote areas",
    },
    note: "The broadest wording: every kind of barrier and enabler, across the whole region.",
  },
  {
    text: "In health services in Southeast Asia, how do policy, infrastructure and workforce conditions affect whether telemedicine services are adopted and kept running after a pilot?",
    framework: "PEO",
    structure: {
      Population: "Health services and the health workers who run telemedicine in Southeast Asian countries",
      Exposure: "Policy, regulation and financing; internet and equipment; training and workload",
      Outcome: "Services that are adopted, used and still running after the pilot or the pandemic",
    },
    note: "Focuses on what makes a service last, and names the three conditions to compare.",
  },
  {
    text: "What do health workers and patients in rural and remote parts of Southeast Asia report about using telemedicine, and what stops services from reaching them?",
    framework: "SPIDER",
    structure: {
      Sample: "Health workers and patients in rural and remote areas of Southeast Asian countries",
      "Phenomenon of interest": "Using telemedicine and the obstacles to it",
      Design: "Surveys, interviews and focus groups",
      Evaluation: "Reported experiences, acceptance and obstacles",
      "Research type": "Qualitative and mixed-methods studies",
    },
    note: "Narrower: rural and remote areas only, and what people themselves report.",
  },
];

/** The question the user confirmed: the first draft, with the ending edited by the user. */
export const QUESTION = {
  text: "What barriers and enablers affect how telemedicine services are implemented and kept running in Southeast Asian health systems, and where is the evidence thin?",
  framework: "PICo",
  structure: {
    Population: "Health services, health workers and patients in Southeast Asian (ASEAN) countries",
    "Phenomenon of interest": "Setting up telemedicine services and keeping them running",
    Context: "Public and private health care since 2015, including rural and remote areas",
  } as Record<string, string>,
};

// ---------------------------------------------------------------- stage 3: the search plan

export const SCOPING_SUMMARY: Record<string, string> = {
  population: "Health services, health workers and patients in Southeast Asian (ASEAN) countries",
  setting: "Public and private health care in ASEAN countries, with attention to rural and remote areas",
  phenomenon: "Setting up telemedicine services and keeping them running",
  outcome: "Services that are adopted, used and sustained; reported barriers and enablers; health outcomes as a secondary interest",
  timeframe: "2015 onwards",
  studyTypes: "Any empirical design and reviews; protocols and opinion pieces are of lower interest",
};

export const CONCEPT_MAP = {
  nodes: [
    { id: "tele", label: "Telemedicine services", kind: "phenomenon" },
    { id: "impl", label: "Implementation and sustainability", kind: "outcome" },
    { id: "sea", label: "Southeast Asian health systems", kind: "setting" },
    { id: "rural", label: "Rural and remote areas", kind: "context" },
    { id: "workers", label: "Health workers", kind: "population" },
    { id: "patients", label: "Patients", kind: "population" },
    { id: "policy", label: "Policy, regulation and financing", kind: "context" },
    { id: "infra", label: "Internet, devices and digital skills", kind: "context" },
    { id: "accept", label: "Acceptance and satisfaction", kind: "outcome" },
    { id: "effect", label: "Clinical and service outcomes", kind: "outcome" },
    { id: "covid", label: "COVID-19 pandemic", kind: "context" },
  ],
  edges: [
    { from: "tele", to: "impl", label: "has to be set up and sustained" },
    { from: "sea", to: "tele", label: "where it is delivered" },
    { from: "policy", to: "impl", label: "permits and pays for" },
    { from: "infra", to: "impl", label: "makes possible" },
    { from: "rural", to: "infra", label: "is weakest in" },
    { from: "workers", to: "accept", label: "decide to use it" },
    { from: "patients", to: "accept", label: "decide to use it" },
    { from: "accept", to: "impl", label: "drives uptake" },
    { from: "tele", to: "effect", label: "is judged by" },
    { from: "covid", to: "tele", label: "sped up adoption of" },
  ],
};

export const CRITERIA: Criteria = {
  yearFrom: 2015,
  yearTo: null,
  languages: ["English"],
  studyTypes: ["Systematic and scoping reviews", "Cross-sectional surveys", "Qualitative and mixed-methods studies", "Trials and cohort studies", "Policy analyses"],
  inclusion: [
    "Studies of telemedicine, telehealth or teleconsultation services for patients",
    "Set in one or more Southeast Asian (ASEAN) countries",
    "Report on implementation: barriers, enablers, acceptance, policy, infrastructure, use or outcomes",
  ],
  exclusion: [
    "Studies set entirely outside Southeast Asia",
    "Technical papers on devices or algorithms with no service delivered to patients",
    "Study protocols, editorials and news items with no data",
  ],
};

const TELE = `("Telemedicine"[majr] OR telemedicine[ti] OR telehealth[ti] OR teleconsultation*[ti] OR telepharmacy[ti] OR telerehabilitation[ti])`;
const SEA = `("Asia, Southeastern"[mh] OR "Southeast Asia"[tiab] OR "South-East Asia"[tiab] OR ASEAN[tiab] OR Indonesia*[tiab] OR Malaysia*[tiab] OR Philippine*[tiab] OR Thailand[tiab] OR Vietnam*[tiab] OR Singapore[tiab] OR Cambodia[tiab] OR Myanmar[tiab])`;
const OA_TELE = `(telemedicine OR telehealth OR teleconsultation OR telepharmacy OR mHealth OR "digital health")`;
const OA_SEA = `("Southeast Asia" OR ASEAN OR Indonesia OR Malaysia OR Philippines OR Thailand OR Vietnam OR Singapore OR Cambodia OR Myanmar)`;

export interface TopicPlan {
  key: "barriers" | "acceptance" | "policy" | "infrastructure" | "outcomes";
  name: string;
  synonyms: string[];
  controlledTerms: string[];
  rationale: string;
  pubmed: { query: string; rationale: string };
  openalex: { query: string; rationale: string };
  /** Stage 6: where the topic comes in the order of importance, and why. */
  importanceRank: number;
  importanceJustification: string;
}

export const TOPICS: TopicPlan[] = [
  {
    key: "barriers",
    name: "Barriers and enablers of implementation",
    synonyms: ["barriers", "facilitators", "enablers", "challenges", "implementation", "adoption", "scale-up", "sustainability"],
    controlledTerms: ["Telemedicine", "Health Plan Implementation", "Health Services Accessibility", "Asia, Southeastern"],
    rationale: "The centre of the question: what helps or hinders setting up telemedicine and keeping it running.",
    pubmed: {
      query: `${TELE} AND ${SEA} AND (barrier*[tiab] OR facilitator*[tiab] OR enabler*[tiab] OR challenge*[tiab] OR "Health Plan Implementation"[mh] OR implementation[tiab])`,
      rationale: "Telemedicine as a major topic or in the title, any ASEAN country, and words for obstacles, enablers or implementation.",
    },
    openalex: {
      query: `${OA_TELE} AND ${OA_SEA} AND (barriers OR facilitators OR enablers OR challenges OR implementation)`,
      rationale: "The same three ideas in plain words, because OpenAlex has no MeSH terms or field tags.",
    },
    importanceRank: 1,
    importanceJustification: "It is the question itself, and it has the most papers that match closely.",
  },
  {
    key: "acceptance",
    name: "Acceptance by patients and health workers",
    synonyms: ["acceptance", "acceptability", "satisfaction", "attitudes", "perceptions", "willingness to use", "technology acceptance model", "UTAUT"],
    controlledTerms: ["Patient Acceptance of Health Care", "Attitude of Health Personnel", "Patient Satisfaction", "Telemedicine"],
    rationale: "A service only lasts if the people on both ends are willing to use it.",
    pubmed: {
      query: `${TELE} AND ${SEA} AND (acceptance[tiab] OR acceptability[tiab] OR satisfaction[tiab] OR attitude*[tiab] OR perception*[tiab] OR "Patient Acceptance of Health Care"[mh] OR "Attitude of Health Personnel"[mh])`,
      rationale: "Adds acceptance, satisfaction and attitude terms, with the MeSH headings for patients and for health personnel.",
    },
    openalex: {
      query: `${OA_TELE} AND ${OA_SEA} AND (acceptance OR acceptability OR satisfaction OR attitudes OR perceptions)`,
      rationale: "Acceptance and satisfaction words in titles, abstracts and keywords.",
    },
    importanceRank: 2,
    importanceJustification: "Many surveys measure it, and it explains whether a service is used once it exists.",
  },
  {
    key: "policy",
    name: "Policy, regulation and financing",
    synonyms: ["policy", "regulation", "legislation", "guidelines", "governance", "reimbursement", "licensing", "data protection"],
    controlledTerms: ["Health Policy", "Government Regulation", "Reimbursement Mechanisms", "Telemedicine"],
    rationale: "Rules and payment decide whether a pilot can become a routine service.",
    pubmed: {
      query: `${TELE} AND ${SEA} AND (policy[tiab] OR policies[tiab] OR regulation*[tiab] OR legislation[tiab] OR governance[tiab] OR reimbursement[tiab] OR "Health Policy"[mh])`,
      rationale: "Policy, regulation and payment terms, plus the Health Policy heading.",
    },
    openalex: {
      query: `${OA_TELE} AND ${OA_SEA} AND (policy OR regulation OR legislation OR governance OR reimbursement)`,
      rationale: "Policy and regulation words; OpenAlex also picks up law and social-science journals that PubMed does not index.",
    },
    importanceRank: 3,
    importanceJustification: "Fewer papers, but they explain why services stall after a pilot.",
  },
  {
    key: "infrastructure",
    name: "Infrastructure and digital readiness",
    synonyms: ["infrastructure", "internet connectivity", "digital literacy", "readiness", "rural", "remote areas", "digital divide"],
    controlledTerms: ["Rural Health Services", "Internet Access", "Digital Divide", "Telemedicine"],
    rationale: "Telemedicine is meant for places with few clinicians, which are often the places with the weakest internet.",
    pubmed: {
      query: `${TELE} AND ${SEA} AND (infrastructure[tiab] OR connectivity[tiab] OR "digital literacy"[tiab] OR readiness[tiab] OR rural[tiab] OR "Rural Health Services"[mh] OR "Internet Access"[mh])`,
      rationale: "Infrastructure, connectivity, readiness and rural terms, with the two MeSH headings for rural services and internet access.",
    },
    openalex: {
      query: `${OA_TELE} AND ${OA_SEA} AND (infrastructure OR connectivity OR "digital literacy" OR readiness OR rural)`,
      rationale: "The same ideas in plain words.",
    },
    importanceRank: 4,
    importanceJustification: "Named as an obstacle in most papers, but rarely studied in its own right.",
  },
  {
    key: "outcomes",
    name: "Effectiveness and service outcomes",
    synonyms: ["effectiveness", "clinical outcomes", "cost-effectiveness", "utilisation", "service use", "randomised trial"],
    controlledTerms: ["Treatment Outcome", "Cost-Benefit Analysis", "Program Evaluation", "Telemedicine"],
    rationale: "Shows whether services that were implemented were used and whether they worked.",
    pubmed: {
      query: `${TELE} AND ${SEA} AND (effectiveness[tiab] OR "randomized controlled trial"[pt] OR "clinical outcomes"[tiab] OR "cost-effectiveness"[tiab] OR "Treatment Outcome"[mh])`,
      rationale: "Effectiveness and outcome terms, and the publication type for randomised trials.",
    },
    openalex: {
      query: `${OA_TELE} AND ${OA_SEA} AND (effectiveness OR "clinical outcomes" OR "cost-effectiveness" OR utilisation OR utilization)`,
      rationale: "Outcome and use words; trials cannot be filtered by type in OpenAlex.",
    },
    importanceRank: 5,
    importanceJustification: "Secondary to the question: it tells you what happened after implementation, not what shaped it.",
  },
];

/** Records each search collects (MAX_RESULTS_PER_QUERY on the server that ran it). */
export const CAP = 14;
/** Further PubMed records per topic, by relevance, that the fixture files under the topic's OpenAlex search. */
export const EXTRA = 3;
