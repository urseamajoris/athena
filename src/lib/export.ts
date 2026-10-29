import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { getProject, stageCosts } from "./project";
import { STAGES, STUDY_TYPE_LABEL, RUBRIC, surname, shortCite, type StudyType } from "./shared/stages";
import { appraisalsView, decisionLogView, papersView, questionsView, rankingView, retrievalView, synthesisView } from "./views";
import { selectedPaperIds } from "./jobs/appraisal";
import { describeView, type ViewPrefs } from "./shared/categories";

const ids = (a: string[]) => a.concat(["-"]);

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function summaryCsv(projectId: string): Promise<string> {
  const { papers, topics } = (await papersView(projectId));
  const head = ["paper_id", "title", "authors", "year", "journal", "study_type (abstract-derived)", "setting (abstract-derived)", "key_finding (abstract-derived)", "citation_count", "open_access_url", "source_databases", "topics", "doi", "pmid", "pmcid", "openalex_id"];
  const rows = papers.map((p) => [
    p.id,
    p.title,
    p.authors,
    p.year,
    p.journal,
    p.summary ? STUDY_TYPE_LABEL[p.summary.studyType as StudyType] ?? p.summary.studyType : "",
    p.summary?.setting ?? "",
    p.summary?.keyFinding ?? "",
    p.citationCount,
    p.oaUrl,
    p.sourceDatabases,
    p.topicIds.map((t) => topics.find((x) => x.id === t)?.name ?? t),
    p.doi,
    p.pmid,
    p.pmcid,
    p.openalexId,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

function bibKey(p: { authors: string[]; year: number | null; title: string }, used: Set<string>) {
  const last = surname(p.authors[0]).normalize("NFKD").replace(/[^A-Za-z]/g, "") || "anon";
  const word = (p.title.match(/[A-Za-z]{4,}/)?.[0] ?? "paper").toLowerCase();
  let k = `${last.toLowerCase()}${p.year ?? "nd"}${word}`;
  let i = 1;
  while (used.has(k)) k = `${last.toLowerCase()}${p.year ?? "nd"}${word}${String.fromCharCode(97 + i++)}`;
  used.add(k);
  return k;
}
const bibEsc = (s: string) => s.replace(/([{}&%$#_])/g, "\\$1");

export async function selectedBibtex(projectId: string): Promise<string> {
  const pids = (await selectedPaperIds(projectId));
  const papers = (await db.select().from(schema.papers).where(inArray(schema.papers.id, ids(pids))).all());
  const used = new Set<string>();
  return papers
    .map((p) => {
      const f: [string, string | null][] = [
        ["title", `{${bibEsc(p.title)}}`],
        ["author", p.authors.length ? `{${p.authors.map(bibEsc).join(" and ")}}` : null],
        ["journal", p.journal ? `{${bibEsc(p.journal)}}` : null],
        ["year", p.year ? String(p.year) : null],
        ["doi", p.doi ? `{${p.doi}}` : null],
        ["pmid", p.pmid ? `{${p.pmid}}` : null],
        ["url", p.oaUrl ? `{${p.oaUrl}}` : p.doi ? `{https://doi.org/${p.doi}}` : null],
        ["note", `{OpenAlex: ${p.openalexId ?? "n/a"}; sources: ${p.sourceDatabases.join(", ")}}`],
      ];
      return `@article{${bibKey(p, used)},\n${f.filter(([, v]) => v).map(([k, v]) => `  ${k} = ${v}`).join(",\n")}\n}`;
    })
    .join("\n\n") + "\n";
}

const ref = (p: { id?: string; doi: string | null; pmid: string | null; openalexId: string | null }) =>
  [p.doi ? `DOI ${p.doi}` : null, p.pmid ? `PMID ${p.pmid}` : null, p.openalexId ? `OpenAlex ${p.openalexId}` : null].filter(Boolean).join(" · ");

export async function markdownReport(projectId: string): Promise<string> {
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all());
  const qs = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  const ret = (await retrievalView(projectId));
  const { papers } = (await papersView(projectId));
  const rank = (await rankingView(projectId));
  const apps = (await appraisalsView(projectId)).appraisals;
  const syn = (await synthesisView(projectId));
  const rq = (await questionsView(projectId));
  const chosen = rq.questions.find((q) => q.chosen);
  const allPapers = (await db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all());
  const pById = new Map(allPapers.map((x) => [x.id, x]));
  const claims = (await db.select().from(schema.claims).where(inArray(schema.claims.appraisalId, ids(apps.map((a) => a.id)))).all());
  const cById = new Map(claims.map((c) => [c.id, c]));
  const cite = (cid: string) => {
    const c = cById.get(cid);
    if (!c) return `[${cid}]`;
    const pp = pById.get(c.paperId);
    return `[${pp ? shortCite(pp.authors, pp.year) : "?"}, ${cid}]`;
  };
  const costs = (await stageCosts(projectId));
  const L: string[] = [];
  L.push(`# Literature review: ${p.title || p.idea.slice(0, 80)}`);
  L.push(`_Generated by Athena prototype on ${new Date().toISOString().slice(0, 10)}. Every paper below comes from a database API record (identifier shown). AI-extracted claims carry verbatim quotes that were checked against the retrieved text._\n`);
  L.push(`## 1. Research idea\n\n${p.idea}\n`);
  if (chosen) {
    L.push(`## Chosen research question\n\n**${chosen.text}**\n`);
    L.push(`Framework: ${chosen.framework}\n`);
    for (const [k, v] of Object.entries(chosen.structure)) L.push(`- **${k}:** ${v}`);
    L.push(`\n- **Design:** ${chosen.design}\n- **Gap:** ${chosen.gap} ${chosen.claimIds.map(cite).join(" ")}\n- **Feasibility:** ${chosen.feasibility}\n- **Main weakness:** ${chosen.weakness}\n`);
    L.push(`**Novelty check (what was found — not proof of novelty):**\n`);
    for (const nq of chosen.noveltyQueries) L.push(`- ${nq.database}: \`${nq.query}\` → ${nq.error ? `failed (${nq.error})` : `${nq.count ?? "?"} hits`}`);
    for (const m of chosen.noveltyMatches) L.push(`  - ${m.title} (${m.year ?? "n.d."}) — ${ref(m)} — ${m.similarityNote}`);
    L.push("");
  }
  L.push(`## 2. Scoping\n`);
  if (p.scopingSummary) for (const [k, v] of Object.entries(p.scopingSummary)) L.push(`- **${k}:** ${v}`);
  L.push(`\n### Topics (in order of importance)\n`);
  for (const t of topics) L.push(`${t.importanceRank ?? "-"}. **${t.name}** — ${t.rationale}${t.importanceJustification ? ` _Importance: ${t.importanceJustification}_` : ""}\n   - Synonyms: ${t.synonyms.join(", ")}\n   - Controlled terms: ${t.controlledTerms.join(", ") || "none"}`);
  L.push(`\n## 3. Search strategy\n`);
  if (p.criteria) {
    L.push(`- Years: ${p.criteria.yearFrom ?? "any"}–${p.criteria.yearTo ?? "present"}\n- Languages: ${p.criteria.languages.join(", ") || "any"}\n- Study types: ${p.criteria.studyTypes.join(", ") || "any"}`);
    L.push(`- Inclusion: ${p.criteria.inclusion.join("; ")}\n- Exclusion: ${p.criteria.exclusion.join("; ")}\n`);
  }
  L.push(`| Topic | Database | Query | Edited | Hits | Fetched | New unique | Status |\n|---|---|---|---|---|---|---|---|`);
  for (const r of ret.runs) {
    const q = qs.find((x) => x.id === r.queryId);
    L.push(`| ${r.topicName} | ${r.database} | \`${r.queryString.replace(/\|/g, "\\|")}\` | ${q?.edited ? "yes" : "no"} | ${r.resultCount ?? "-"} | ${r.fetchedCount} | ${r.newUniqueCount} | ${r.status}${r.error ? `: ${r.error.replace(/\|/g, "/")}` : ""} |`);
  }
  L.push(`\nUnique papers after deduplication (DOI → PMID → normalised title): **${ret.uniquePapers}**. Per-query cap: ${ret.runs[0]?.cap ?? "-"}.\n`);
  L.push(`## 4. Selected papers and scores\n`);
  L.push(`Rubric (0–5 each): ${RUBRIC.map((r) => `${r.label} ${Math.round(r.weight * 100)}% (${r.by})`).join(", ")}.\n`);
  for (const t of rank.topics) {
    L.push(`### ${t.name}\n`);
    for (const s of t.scores.filter((x) => x.selected)) {
      const pp = pById.get(s.paperId)!;
      L.push(`- **${pp.title}** (${pp.year ?? "n.d."}) — total ${s.total}/100 — ${ref(pp)}${s.userChanged ? " — _selection changed by user_" : ""}\n  - ${s.rationale}`);
    }
    L.push("");
  }
  L.push(`## 5. Appraisals\n`);
  for (const a of apps) {
    const pp = pById.get(a.paperId)!;
    L.push(`### ${pp.title} (${pp.year ?? "n.d."})\n\n${ref(pp)}\n\n**Text source: ${a.textSource === "full_text" ? "FULL TEXT" : "ABSTRACT ONLY"}.** ${a.textNote}\n\nTemplate: ${a.templateType}. Status: ${a.status}${a.error ? ` (${a.error})` : ""}.\n`);
    const cs = claims.filter((c) => c.appraisalId === a.id);
    for (const c of cs.filter((x) => x.field !== "checklist")) {
      L.push(`- **${c.field}** ${c.notReported ? "— not reported" : `— ${c.statement}\n  > "${c.quote}" (${c.location}) — ${c.verified ? "✅ verified" : c.userAccepted ? "⚠️ unverified, accepted by user" : c.userRejected ? "❌ rejected by user" : "⚠️ UNVERIFIED"} [${c.id}]`}`);
    }
    if (a.checklist.length) {
      L.push(`\nQuality checklist:\n`);
      for (const it of a.checklist) {
        const c = it.claimId ? cById.get(it.claimId) : null;
        L.push(`- ${it.item}: **${it.answer.replace("_", " ")}**${c ? ` — "${c.quote}" ${c.verified ? "✅" : "⚠️ unverified"}` : ""}`);
      }
    }
    L.push("");
  }
  L.push(`## 6. Synthesis\n`);
  for (const t of syn.topics) {
    L.push(`### ${t.name}\n`);
    for (const kind of ["known", "contested", "unknown"] as const) {
      const its = t.items.filter((i) => i.kind === kind);
      if (!its.length) continue;
      L.push(`**${kind[0].toUpperCase() + kind.slice(1)}**\n`);
      for (const i of its) L.push(`- ${i.statement} ${i.claimIds.map(cite).join(" ")}`);
      L.push("");
    }
    if (t.contradictions.length) {
      L.push(`**Contradictions**\n`);
      for (const c of t.contradictions) L.push(`- (${c.theme}) ${c.description} ${c.claimIds.map(cite).join(" ")}`);
      L.push("");
    }
  }
  if (rq.questions.length) {
    L.push(`## 7. Candidate research questions\n`);
    for (const q of rq.questions) L.push(`- ${q.chosen ? "**[chosen]** " : ""}${q.text} _(${q.framework}; ${q.design})_ — weakness: ${q.weakness}`);
    L.push("");
  }
  L.push(`## 8. Reference list (selected papers)\n`);
  for (const pid of (await selectedPaperIds(projectId))) {
    const pp = pById.get(pid);
    if (pp) L.push(`- ${pp.authors.slice(0, 3).join(", ")}${pp.authors.length > 3 ? " et al." : ""} (${pp.year ?? "n.d."}). ${pp.title}. _${pp.journal ?? ""}_. ${ref(pp)}`);
  }
  L.push(`\n## 9. Reproducibility\n`);
  const view = describeView(p.viewPrefs as ViewPrefs | null, topics.map((t) => ({ id: t.id, name: t.name })));
  L.push(`### View choices\n\n${view ? `Your saved view of the papers: ${view}. These choices only changed what was shown; no paper was removed from the review because of them.` : "No category filters or grouping were saved."}${p.criteria && (p.criteria as { hardFilter?: string[] }).hardFilter?.length ? `\n\n**Hard retrieval filter:** only ${(p.criteria as { hardFilter?: string[] }).hardFilter!.join(", ")} were fetched from the databases. Papers of other types were never retrieved.` : ""}\n`);
  L.push(`### AI usage\n\n| Stage | Calls | Input tokens | Output tokens | Cost (USD) |\n|---|---|---|---|---|`);
  for (const s of STAGES) {
    const c = costs[String(s.n)];
    if (c) L.push(`| ${s.n}. ${s.title} | ${c.calls} | ${c.input} | ${c.output} | ${c.cost.toFixed(4)} |`);
  }
  L.push(`\n### Decision log\n`);
  for (const d of (await decisionLogView(projectId))) L.push(`- ${d.createdAt} · stage ${d.stage} · ${d.actor} · ${d.action}${d.after ? ` · ${JSON.stringify(d.after).slice(0, 300)}` : ""}`);
  L.push(`\n_Summary-table cells for study type, setting and key finding are AI-derived from abstracts only. Papers in table: ${papers.length}._`);
  return L.join("\n") + "\n";
}
