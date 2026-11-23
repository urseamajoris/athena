import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  detectCriteriaFlags,
  detectPublicationTypeFlags,
  formatCriteriaGuidance,
  shouldAvoidAutoSelect,
  type CriteriaLike,
} from "./shared/criteria";
import {
  buildAppraisalInput,
  fullTextSourceLabel,
  fullTextSourceNote,
  partitionSourceForDisplay,
  reconstructSentText,
} from "./appraisal-text";
import {
  buildAppraisalPromptVars,
  buildRankingPromptVars,
  filterClaimsForSynthesis,
  selectInitialRankingIds,
  validateSynthesisKnownFindings,
  verifyQuoteInSentRanges,
} from "./review-guards";

const SAMPLE_CRITERIA: CriteriaLike = {
  yearFrom: 2018,
  yearTo: null,
  languages: ["en"],
  studyTypes: ["randomized controlled trials", "cohort studies", "qualitative studies"],
  inclusion: ["Telemedicine implementation in primary care in Southeast Asia"],
  exclusion: ["Studies outside Southeast Asia", "Technical-only engineering papers", "Case reports", "Animal studies"],
};

function loadPromptRaw(file: string) {
  const raw = fs.readFileSync(path.resolve(process.cwd(), "prompts", file), "utf8");
  const system = raw.match(/^# system\s*\n([\s\S]*?)(?=^# user\s*$)/m)?.[1]?.trim() ?? "";
  const user = raw.match(/^# user\s*\n([\s\S]*)$/m)?.[1]?.trim() ?? "";
  return { system, user };
}

function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    assert.ok(k in vars, `Prompt variable {{${k}}} must be provided`);
    return vars[k];
  });
}

test("ranking prompt vars include saved inclusion, exclusion, and study-type criteria as guidance", () => {
  const vars = buildRankingPromptVars({
    idea: "Telemedicine implementation gaps in Southeast Asia",
    scopingSummary: { setting: "Southeast Asia" },
    criteria: SAMPLE_CRITERIA,
    topic: { name: "Implementation barriers", rationale: "Core barriers to adoption" },
    batch: [
      {
        id: "p_study1",
        title: "Qualitative evaluation of rural telehealth in Thailand",
        year: 2024,
        abstract: "We interviewed 40 primary care providers in rural Thailand about telemedicine barriers.",
        publicationTypes: ["Journal Article"],
      },
      {
        id: "p_proto1",
        title: "Telehealth rollout in rural clinics: a study protocol",
        year: 2025,
        abstract: "This protocol outlines a planned stepped-wedge trial.",
        publicationTypes: ["Clinical Trial Protocol"],
      },
    ],
    summaries: new Map([
      ["p_study1", { studyType: "qualitative", setting: "Rural Thailand", keyFinding: "Connectivity and training are key barriers." }],
      ["p_proto1", { studyType: "protocol", setting: "Rural Vietnam", keyFinding: "Planned trial protocol with no results yet." }],
    ]),
  });

  assert.match(vars.criteria, /guidance/i);
  assert.match(vars.criteria, /NOT a hard database filter/i);
  assert.match(vars.criteria, /randomized controlled trials/i);
  assert.match(vars.criteria, /Telemedicine implementation in primary care in Southeast Asia/);
  assert.match(vars.criteria, /Technical-only engineering papers/);
  assert.match(vars.papers, /Clinical Trial Protocol/);
  assert.match(vars.papers, /Protocol/);

  // Verify the actual shipped ranking.v2.md prompt fills with zero missing variables.
  const prompt = loadPromptRaw("ranking.v2.md");
  const filledSys = fillTemplate(prompt.system, vars);
  const filledUser = fillTemplate(prompt.user, vars);
  assert.match(filledSys, /NOT a hard database filter/i);
  assert.match(filledUser, /Technical-only engineering papers/);
  assert.match(filledUser, /randomized controlled trials/i);
});

test("appraisal prompt vars include saved criteria, Europe PMC no-table-bodies note, and section-sampled text", () => {
  const fullText = [
    "TITLE\nRural telemedicine in Thailand\n",
    "ABSTRACT\nWe evaluated rural clinics.\n",
    "INTRODUCTION\n" + "Background context sentence. ".repeat(120) + "\n",
    "METHODS\nWe interviewed 48 clinicians across 12 rural primary care clinics in Northern Thailand.\n",
    "RESULTS\n" + "Detailed clinic adoption metrics were recorded across visits. ".repeat(80) + "\n[Table] Table 2: Adoption rates by district and clinic tier.\n",
    "DISCUSSION\nClinicians valued remote triage despite intermittent broadband.\n",
    "LIMITATIONS\nOur sample excluded private urban hospitals and relied on self-reported adherence.\n",
  ].join("\n");
  const sections = [
    { title: "Title", start: fullText.indexOf("TITLE") },
    { title: "Abstract", start: fullText.indexOf("ABSTRACT") },
    { title: "Introduction", start: fullText.indexOf("INTRODUCTION") },
    { title: "Methods", start: fullText.indexOf("METHODS") },
    { title: "Results", start: fullText.indexOf("RESULTS") },
    { title: "Discussion", start: fullText.indexOf("DISCUSSION") },
    { title: "Limitations", start: fullText.indexOf("LIMITATIONS") },
  ];

  const input = buildAppraisalInput(fullText, sections, 1600);
  const sourceNote = fullTextSourceNote("europepmc", "cc-by", "PMC9999999");
  const vars = buildAppraisalPromptVars({
    criteria: SAMPLE_CRITERIA,
    paper: { id: "p_study1", title: "Rural telemedicine in Thailand", year: 2024 },
    template: "qualitative",
    textSourceKind: "full_text",
    sourceOrigin: "europepmc",
    input,
    sourceNote,
  });

  assert.match(vars.criteria, /Telemedicine implementation in primary care in Southeast Asia/);
  assert.match(vars.criteria, /Technical-only engineering papers/);
  assert.match(vars.textSource, /EUROPE PMC XML/i);
  assert.match(vars.textSource, /TABLE AND FIGURE BODIES NOT INCLUDED/i);
  assert.match(vars.textNote, /Table and figure bodies were not included/i);
  assert.match(vars.textNote, /PDF extraction/i);

  // Verify the actual shipped appraisal.v2.md prompt fills cleanly.
  const prompt = loadPromptRaw("appraisal.v2.md");
  const filledSys = fillTemplate(prompt.system, vars);
  const filledUser = fillTemplate(prompt.user, vars);
  assert.match(filledSys, /NOT a hard database filter/i);
  assert.match(filledSys, /Table and figure bodies were not included/i);
  assert.match(filledUser, /Technical-only engineering papers/);
  assert.match(filledUser, /Our sample excluded private urban hospitals/);
});

test("publication-type flags catch protocol, editorial, letter, comment, and erratum", () => {
  for (const [pubType, expected] of [
    ["Clinical Trial Protocol", "Protocol"],
    ["Editorial", "Editorial"],
    ["Letter", "Letter"],
    ["Comment", "Comment"],
    ["Published Erratum", "Erratum"],
  ] as const) {
    const flags = detectPublicationTypeFlags([pubType], "other", "A paper title");
    assert.ok(flags.some((f) => f.kind === "publication_type" && f.label === expected), `Expected ${expected} for ${pubType}`);
  }
  // Protocol caught even when OpenAlex labels type as "article"
  const byTitle = detectPublicationTypeFlags(["article"], "protocol", "Telehealth intervention: a study protocol");
  assert.ok(byTitle.some((f) => f.label === "Protocol"));
  const byLeadingTitle = detectPublicationTypeFlags(["article"], "other", "Protocol for a cluster randomized trial of rural telemedicine");
  assert.ok(byLeadingTitle.some((f) => f.label === "Protocol"));
});

test("criteria exclusion matches non-randomized trials when explicitly excluded", () => {
  const c: CriteriaLike = {
    yearFrom: 2020,
    yearTo: null,
    languages: ["en"],
    studyTypes: ["randomized controlled trials"],
    inclusion: ["RCTs of telehealth"],
    exclusion: ["Non-randomized trials"],
  };
  const flags = detectCriteriaFlags(
    { title: "Before-after telehealth trial in clinics", abstract: "A non-randomized trial.", publicationTypes: ["Journal Article"] },
    { studyType: "non_randomized_trial", setting: "Thailand", keyFinding: "Modest uptake." },
    c,
  );
  assert.ok(flags.some((f) => f.kind === "criteria_exclusion"));
});

test("buildAppraisalInput inherits parent section bucket for nested JATS subsections and preserves discussion-embedded limitations", () => {
  const intro = "Long introduction context. ".repeat(300);
  const discussionLead = "Detailed comparison with previous regional literature. ".repeat(180);
  const fullText = [
    "TITLE\nNested JATS paper",
    "ABSTRACT\nSummary of findings.",
    `INTRODUCTION\n${intro}`,
    "METHODS\nOverview of design.",
    "DATA COLLECTION\nWe conducted 36 semi-structured interviews in rural clinics.",
    "RESULTS\nOverview of results.",
    "BARRIERS TO ADOPTION\nIntermittent connectivity delayed 42% of teleconsultations.",
    `DISCUSSION\n${discussionLead}\n\nA key limitation of our study is selection bias toward better-resourced provincial clinics.`,
    "FUNDING\nSupported by grant 12345.",
  ].join("\n\n");
  const sections = [
    "TITLE",
    "ABSTRACT",
    "INTRODUCTION",
    "METHODS",
    "DATA COLLECTION",
    "RESULTS",
    "BARRIERS TO ADOPTION",
    "DISCUSSION",
    "FUNDING",
  ].map((h) => ({ title: h, start: fullText.indexOf(h) }));

  const input = buildAppraisalInput(fullText, sections, 2500);
  assert.equal(input.strategy, "sections");
  assert.ok(input.text.length <= 2500);
  assert.ok(input.text.includes("Intermittent connectivity delayed 42%"), "Keeps subsection nested under Results");
  assert.ok(input.text.includes("selection bias toward better-resourced provincial clinics"), "Preserves limitations paragraph embedded in Discussion");
  assert.ok(!input.text.includes("Supported by grant 12345"), "Drops funding boilerplate");
});

test("criteria exclusion flagging flags matching exclusions without false-flagging negated regional rules", () => {
  // Genuine SEA qualitative study should NOT be flagged by "Studies outside Southeast Asia"
  const goodFlags = detectCriteriaFlags(
    {
      title: "Telemedicine adoption in rural primary care in Southeast Asia",
      abstract: "A qualitative study of 35 health workers in Thailand and Vietnam.",
      publicationTypes: ["Journal Article"],
    },
    { studyType: "qualitative", setting: "Thailand and Vietnam, Southeast Asia", keyFinding: "Training improved uptake." },
    SAMPLE_CRITERIA,
  );
  assert.deepEqual(goodFlags, []);

  // Technical-only engineering paper SHOULD be flagged
  const engFlags = detectCriteriaFlags(
    {
      title: "Low-power antenna engineering for technical-only telemedicine hardware",
      abstract: "We simulated RF antenna waveforms using engineering benchmarks.",
      publicationTypes: ["Journal Article"],
    },
    { studyType: "other", setting: "Laboratory", keyFinding: "Antenna gain improved by 2 dB." },
    SAMPLE_CRITERIA,
  );
  assert.ok(engFlags.some((f) => f.kind === "criteria_exclusion"), "Expected engineering exclusion flag");

  // Case report SHOULD be flagged both by exclusion criterion and study type mismatch
  const caseFlags = detectCriteriaFlags(
    {
      title: "Single patient teleconsultation follow-up",
      abstract: "We present a case report of one patient.",
      publicationTypes: ["Case Reports"],
    },
    { studyType: "case_report_or_series", setting: "Bangkok hospital", keyFinding: "Patient recovered." },
    SAMPLE_CRITERIA,
  );
  assert.ok(caseFlags.some((f) => f.kind === "criteria_exclusion"));
});

test("selectInitialRankingIds never silently pre-selects flagged publication types or excluded papers", () => {
  const scores = [
    { id: "sc_proto", paperId: "p_proto", total: 98 },
    { id: "sc_edit", paperId: "p_edit", total: 95 },
    { id: "sc_excl", paperId: "p_excl", total: 94 },
    { id: "sc_study1", paperId: "p_study1", total: 80 },
    { id: "sc_study2", paperId: "p_study2", total: 75 },
  ];
  const flagsById = new Map([
    ["p_proto", { flags: detectPublicationTypeFlags(["Clinical Trial Protocol"], "protocol"), excluded: false }],
    ["p_edit", { flags: detectPublicationTypeFlags(["Editorial"], "commentary_or_editorial"), excluded: false }],
    ["p_excl", { flags: [], excluded: true }],
    ["p_study1", { flags: [], excluded: false }],
    ["p_study2", { flags: [], excluded: false }],
  ]);

  assert.equal(shouldAvoidAutoSelect(flagsById.get("p_proto")!.flags, false), true);
  assert.equal(shouldAvoidAutoSelect([], true), true);
  assert.equal(shouldAvoidAutoSelect([], false), false);

  const selected = selectInitialRankingIds(scores, flagsById, 4);
  assert.deepEqual(selected, ["sc_study1", "sc_study2"]);
});

test("buildAppraisalInput prefers title, abstract, methods, results, discussion, limitations, and table captions over a blind prefix", () => {
  const introFiller = "Historical background on telecommunications infrastructure. ".repeat(400); // ~22,800 chars
  const resultsFiller = "Subgroup breakdown across individual clinics showed moderate variation. ".repeat(350); // ~25,200 chars
  const ackFiller = "We thank all administrative staff and funding agencies for support. ".repeat(200);
  const fullText = [
    "TITLE\nEvaluating rural telemedicine in Mekong provinces",
    "ABSTRACT\nA stepped-wedge cohort evaluation of 24 rural health centres.",
    `INTRODUCTION\n${introFiller}`,
    "METHODS\nWe enrolled 1,200 patients across 24 primary care clinics using a mixed-methods cohort design.",
    `RESULTS\nTeleconsultation uptake reached 68% within six months.\n${resultsFiller}\n[Table] Table 3: Uptake stratified by clinic connectivity tier and staffing level.`,
    "DISCUSSION\nSustained adoption depended on local nurse champions and reliable reimbursement.",
    "LIMITATIONS\nKey limitation: follow-up lasted only six months and excluded mountainous border districts without mobile coverage.",
    `ACKNOWLEDGEMENTS\n${ackFiller}`,
  ].join("\n\n");

  const sections = [
    "TITLE",
    "ABSTRACT",
    "INTRODUCTION",
    "METHODS",
    "RESULTS",
    "DISCUSSION",
    "LIMITATIONS",
    "ACKNOWLEDGEMENTS",
  ].map((h) => ({ title: h[0] + h.slice(1).toLowerCase(), start: fullText.indexOf(h) }));

  const maxChars = 6000;
  // Confirm a blind prefix would completely miss Discussion, Limitations, and Table 3!
  const blindPrefix = fullText.slice(0, maxChars);
  assert.ok(!blindPrefix.includes("LIMITATIONS"));
  assert.ok(!blindPrefix.includes("Sustained adoption depended"));
  assert.ok(!blindPrefix.includes("[Table] Table 3"));

  const input = buildAppraisalInput(fullText, sections, maxChars);
  assert.equal(input.truncated, true);
  assert.equal(input.strategy, "sections");
  assert.ok(input.text.length <= maxChars, `Expected sent text (${input.text.length}) <= ${maxChars}`);
  assert.ok(input.text.includes("Evaluating rural telemedicine in Mekong provinces"), "Includes Title");
  assert.ok(input.text.includes("stepped-wedge cohort evaluation"), "Includes Abstract");
  assert.ok(input.text.includes("enrolled 1,200 patients across 24 primary care clinics"), "Includes Methods");
  assert.ok(input.text.includes("Teleconsultation uptake reached 68%"), "Includes Results");
  assert.ok(input.text.includes("[Table] Table 3: Uptake stratified by clinic connectivity tier"), "Preserves Table caption from trimmed Results");
  assert.ok(input.text.includes("Sustained adoption depended on local nurse champions"), "Includes Discussion");
  assert.ok(input.text.includes("excluded mountainous border districts without mobile coverage"), "Includes Limitations at the end of the paper");
  assert.ok(!input.text.includes("We thank all administrative staff"), "Drops Acknowledgements boilerplate");

  // Quote from Limitations (located past offset 50,000 in fullText) verifies AND maps to exact original offsets!
  const limQuote = "Key limitation: follow-up lasted only six months and excluded mountainous border districts without mobile coverage.";
  const vLim = verifyQuoteInSentRanges(fullText, sections, input.sentRanges, limQuote);
  assert.equal(vLim.verified, true);
  assert.ok(vLim.matchStart !== null && vLim.matchEnd !== null);
  assert.ok(vLim.matchStart! > maxChars, "Verified offset maps back to true position in full source text");
  assert.equal(fullText.slice(vLim.matchStart!, vLim.matchEnd!), limQuote.replace(/\.$/, ""));

  // Quote from omitted Acknowledgements region is rejected and explicitly flagged as NOT sent to the model!
  const unreadQuote = "We thank all administrative staff and funding agencies for support.";
  const vUnread = verifyQuoteInSentRanges(fullText, sections, input.sentRanges, unreadQuote);
  assert.equal(vUnread.verified, false);
  assert.match(vUnread.verificationNote, /NOT sent to the model/i);

  // Display partitioning produces explicit sent:false regions covering every omitted char with no gaps,
  // and never creates trivial whitespace-only omitted regions.
  const parts = partitionSourceForDisplay(fullText, input.sentRanges, input.charsSent);
  assert.ok(parts.some((p) => !p.sent), "Must produce at least one 'not sent to the model' region");
  assert.ok(parts.filter((p) => !p.sent).every((p) => fullText.slice(p.start, p.end).trim().length > 0), "Omitted regions must contain substantive omitted text, not blank lines");
  assert.equal(parts[0].start, 0);
  assert.equal(parts[parts.length - 1].end, fullText.length);
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].start, parts[i - 1].end);
  assert.equal(reconstructSentText(fullText, input.sentRanges), input.text);
});

test("buildAppraisalInput detects headings in PDF page-only sections and falls back to head+tail on unstructured text", () => {
  const pdfText = [
    "Telemedicine PDF Title",
    "ABSTRACT\nShort abstract of the study.",
    "INTRODUCTION\n" + "Intro prose. ".repeat(300),
    "METHODS\nSurvey of 300 rural patients.",
    "RESULTS\n74% reported satisfaction.",
    "DISCUSSION\nFindings align with prior work.",
    "LIMITATIONS\nCross-sectional design precludes causal inference.",
  ].join("\n\n");
  const pageSections = [
    { title: "Page 1", start: 0 },
    { title: "Page 2", start: Math.floor(pdfText.length / 2) },
  ];
  const pdfInput = buildAppraisalInput(pdfText, pageSections, 1200);
  assert.equal(pdfInput.strategy, "sections");
  assert.ok(pdfInput.text.includes("Cross-sectional design precludes causal inference."));

  const unstructured = "Opening text sentence. " + "Middle filler text. ".repeat(300) + "Closing limitations sentence at the very end.";
  const rawInput = buildAppraisalInput(unstructured, [], 800);
  assert.equal(rawInput.strategy, "head_tail");
  assert.ok(rawInput.text.includes("Opening text sentence."));
  assert.ok(rawInput.text.includes("Closing limitations sentence at the very end."));
});

test("Europe PMC and PDF full-text provenance notes are clearly distinguished", () => {
  const epmc = fullTextSourceNote("europepmc", "cc-by", "PMC123456");
  const pdf = fullTextSourceNote("unpaywall_pdf", "cc-by");
  assert.match(epmc, /table and figure bodies were not included/i);
  assert.match(epmc, /PDF extraction/i);
  assert.match(pdf, /garble tables/i);
  assert.match(pdf, /Europe PMC XML/i);
  assert.notEqual(fullTextSourceLabel("full_text", "europepmc"), fullTextSourceLabel("full_text", "unpaywall_pdf"));
});

test("synthesis deterministic guard blocks excluded papers, unread-tail claims, and protocol-only Known findings", () => {
  const fullText =
    "METHODS\nWe surveyed 200 clinics in rural Thailand.\n\nUNREAD TAIL\nUnverified tail claim from unread section about nationwide 99% cure rate.";
  const sentEnd = fullText.indexOf("UNREAD TAIL");
  const sentRanges = [{ start: 0, end: sentEnd }];

  const papersById = new Map([
    ["p_good", { id: "p_good", excluded: false, publicationTypes: ["Journal Article"] }],
    ["p_excluded", { id: "p_excluded", excluded: true, publicationTypes: ["Journal Article"] }],
    ["p_proto", { id: "p_proto", excluded: false, publicationTypes: ["Clinical Trial Protocol"] }],
  ]);
  const appraisalsById = new Map([
    ["ap_good", { id: "ap_good", paperId: "p_good", sourceTextId: "st_good", charsSentToModel: sentEnd, sentRanges }],
    ["ap_excl", { id: "ap_excl", paperId: "p_excluded", sourceTextId: "st_good", charsSentToModel: sentEnd, sentRanges }],
    ["ap_proto", { id: "ap_proto", paperId: "p_proto", sourceTextId: "st_good", charsSentToModel: sentEnd, sentRanges }],
  ]);
  const sourceTextsById = new Map([["st_good", { id: "st_good", text: fullText, fullLength: fullText.length }]]);

  const claims = [
    // Valid verified claim inside sentRanges -> ALLOWED
    {
      id: "c_valid",
      appraisalId: "ap_good",
      paperId: "p_good",
      field: "key_findings",
      statement: "200 clinics surveyed",
      quote: "We surveyed 200 clinics in rural Thailand.",
      notReported: false,
      verified: true,
      userAccepted: false,
      userRejected: false,
      matchStart: fullText.indexOf("We surveyed"),
      matchEnd: fullText.indexOf("We surveyed") + "We surveyed 200 clinics in rural Thailand.".length,
    },
    // Claim from researcher-excluded paper -> BLOCKED
    {
      id: "c_from_excluded",
      appraisalId: "ap_excl",
      paperId: "p_excluded",
      field: "key_findings",
      statement: "Excluded paper finding",
      quote: "We surveyed 200 clinics in rural Thailand.",
      notReported: false,
      verified: true,
      userAccepted: false,
      userRejected: false,
      matchStart: fullText.indexOf("We surveyed"),
      matchEnd: fullText.indexOf("We surveyed") + "We surveyed 200 clinics in rural Thailand.".length,
    },
    // Verified claim whose offsets fall in the unread tail -> BLOCKED
    {
      id: "c_unread_verified",
      appraisalId: "ap_good",
      paperId: "p_good",
      field: "key_findings",
      statement: "99% cure rate",
      quote: "Unverified tail claim from unread section about nationwide 99% cure rate.",
      notReported: false,
      verified: true,
      userAccepted: false,
      userRejected: false,
      matchStart: fullText.indexOf("Unverified tail claim"),
      matchEnd: fullText.length,
    },
    // Unverified user-accepted claim whose quote only exists in the unread tail -> BLOCKED
    {
      id: "c_unread_accepted",
      appraisalId: "ap_good",
      paperId: "p_good",
      field: "key_findings",
      statement: "99% cure rate accepted",
      quote: "Unverified tail claim from unread section about nationwide 99% cure rate.",
      notReported: false,
      verified: false,
      userAccepted: true,
      userRejected: false,
      matchStart: null,
      matchEnd: null,
    },
    // Valid claim from non-excluded protocol -> enters pool, but blocked from Known findings by validateSynthesisKnownFindings
    {
      id: "c_proto",
      appraisalId: "ap_proto",
      paperId: "p_proto",
      field: "key_findings",
      statement: "Planned protocol outcome",
      quote: "We surveyed 200 clinics in rural Thailand.",
      notReported: false,
      verified: true,
      userAccepted: false,
      userRejected: false,
      matchStart: fullText.indexOf("We surveyed"),
      matchEnd: fullText.indexOf("We surveyed") + "We surveyed 200 clinics in rural Thailand.".length,
    },
  ];

  const usable = filterClaimsForSynthesis({ claims, papersById, appraisalsById, sourceTextsById });
  assert.deepEqual(
    usable.map((c) => c.id),
    ["c_valid", "c_proto"],
  );

  // Synthesis Known guard rejects a Known finding backed only by a protocol paper
  const claimToPaper = new Map(usable.map((c) => [c.id, c.paperId]));
  const nonStudy = new Set(["p_proto"]);
  const err = validateSynthesisKnownFindings([{ statement: "Telemedicine works everywhere.", claimIds: ["c_proto"] }], claimToPaper, nonStudy);
  assert.ok(err && /non-study/i.test(err));
  assert.equal(validateSynthesisKnownFindings([{ statement: "200 clinics were surveyed.", claimIds: ["c_valid"] }], claimToPaper, nonStudy), null);

  // Verify synthesis.v4.md prompt fills cleanly and contains the unread/excluded guard instructions.
  const synPrompt = loadPromptRaw("synthesis.v4.md");
  const synSys = fillTemplate(synPrompt.system, {});
  const synUser = fillTemplate(synPrompt.user, {
    idea: "idea",
    criteria: formatCriteriaGuidance(SAMPLE_CRITERIA),
    topic: "topic",
    papers: "p_good",
    claims: "c_valid",
  });
  assert.match(synSys, /unread\/omitted section/i);
  assert.match(synSys, /protocol/i);
  assert.match(synUser, /Technical-only engineering papers/);
});
