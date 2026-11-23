import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { ChecklistItem } from "../db/schema";
import { config } from "../config";
import { structuredCall, BudgetError } from "../ai/client";
import { Appraisal, EXTRACTION_FIELDS } from "../stages/ai-schemas";
import { CHECKLISTS, templateFor } from "../stages/templates";
import { closestPassage, normalizeWithMap, sectionAt, verifyQuote } from "../quotes";
import { errMsg, newId } from "../util";
import { getProject, logDecision } from "../project";
import { claimIdsOfAppraisals, dropOutputCiting } from "../evidence";
import { buildAppraisalInput, reconstructSentText } from "../appraisal-text";
import { buildAppraisalPromptVars, verifyQuoteInSentRanges } from "../review-guards";
import { getAppraisalText } from "./fulltext";
import type { JobContext } from "./runner";

/** Lenient key for matching checklist items: ignores numbering, case and punctuation. */
const itemKey = (s: string) => s.toLowerCase().replace(/^\s*\d+[.)]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Verify one quote against the text that was sent to the model; returns the claim's verification fields. */
export function checkQuote(sent: string, sections: { title: string; start: number }[], quote: string, pre?: ReturnType<typeof normalizeWithMap>) {
  const r = verifyQuote(sent, quote, pre);
  if (r.verified) {
    const sec = sectionAt(sections, r.start!);
    return { verified: true, matchStart: r.start, matchEnd: r.end, verificationNote: `${r.note}${sec ? ` Found in: ${sec}.` : ""}` };
  }
  const near = closestPassage(sent, quote);
  return {
    verified: false,
    matchStart: null,
    matchEnd: null,
    verificationNote: `UNVERIFIED: ${r.note}${near && near.overlap >= 0.5 ? ` Closest passage in the text (${Math.round(near.overlap * 100)}% of words match): "${near.text.slice(0, 400)}"` : ""}`,
  };
}

/**
 * Re-run quote verification on stored claims against the stored text (no AI call). Used after the verifier
 * improves. User accept/reject decisions are kept. Returns how many claims changed status.
 */
export function reverifyProject(projectId: string) {
  const paperIds = db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().map((r) => r.id);
  const apps = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, paperIds.concat(["-"]))).all();
  let changed = 0;
  let checked = 0;
  for (const a of apps) {
    if (!a.sourceTextId) continue;
    const st = db.select().from(schema.sourceTexts).where(eq(schema.sourceTexts.id, a.sourceTextId)).get();
    if (!st) continue;
    const sentRanges =
      a.sentRanges && a.sentRanges.length
        ? a.sentRanges
        : [{ start: 0, end: a.charsSentToModel ? Math.min(a.charsSentToModel, st.text.length) : st.text.length }];
    const sent = reconstructSentText(st.text, sentRanges);
    const pre = normalizeWithMap(sent);
    for (const c of db.select().from(schema.claims).where(eq(schema.claims.appraisalId, a.id)).all()) {
      if (c.notReported) continue;
      checked++;
      const v = verifyQuoteInSentRanges(st.text, st.sections, sentRanges, c.quote, pre);
      if (v.verified !== c.verified) changed++;
      db.update(schema.claims).set(v).where(eq(schema.claims.id, c.id)).run();
    }
  }
  return { checked, changed };
}

export function selectedPaperIds(projectId: string): string[] {
  const topics = db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.projectId, projectId)).all().map((t) => t.id);
  const sel = db.select().from(schema.scores).where(inArray(schema.scores.topicId, topics.concat(["-"]))).all().filter((s) => s.selected);
  const pids = [...new Set(sel.map((s) => s.paperId))];
  if (!pids.length) return [];
  const active = db.select({ id: schema.papers.id, excluded: schema.papers.excluded }).from(schema.papers).where(inArray(schema.papers.id, pids)).all();
  const ok = new Set(active.filter((p) => !p.excluded).map((p) => p.id));
  return pids.filter((id) => ok.has(id));
}

/** Selected, non-excluded papers of each topic: the papers that topic's synthesis may draw on. */
export function selectedPaperIdsByTopic(projectId: string): Map<string, string[]> {
  const topics = db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.projectId, projectId)).all().map((t) => t.id);
  const sel = db.select().from(schema.scores).where(inArray(schema.scores.topicId, topics.concat(["-"]))).all().filter((s) => s.selected);
  const excluded = new Set(
    db.select({ id: schema.papers.id, excluded: schema.papers.excluded }).from(schema.papers).where(inArray(schema.papers.id, sel.map((s) => s.paperId).concat(["-"]))).all().filter((p) => p.excluded).map((p) => p.id),
  );
  const out = new Map<string, string[]>(topics.map((t) => [t, []]));
  for (const s of sel) if (!excluded.has(s.paperId)) out.get(s.topicId)!.push(s.paperId);
  return out;
}

type AppraisalRow = typeof schema.appraisals.$inferSelect;
type ClaimInsert = typeof schema.claims.$inferInsert;
/** A finished appraisal, ready to store. */
interface AppraisalDraft {
  appraisalId: string;
  paperId: string;
  templateType: string;
  text: Pick<AppraisalRow, "sourceTextId" | "textSource" | "textNote" | "charsSentToModel" | "sentRanges">;
  checklist: ChecklistItem[];
  claimRows: ClaimInsert[];
  model: string;
  promptVersion: string;
  logLine: string;
}

/**
 * Appraise the selected papers. A finished appraisal that is being redone (a full re-run with `force`, or one
 * paper with `paperIds`) holds the researcher's accept/reject decisions, so it stays in place until its
 * replacement has succeeded: a failed or cancelled re-run leaves it, and the synthesis that cites it, untouched.
 * When a replacement does succeed, the decisions it replaces are written to the decision log first.
 */
export async function appraisalJob(ctx: JobContext) {
  const { projectId } = ctx;
  const project = getProject(projectId);
  const ids = selectedPaperIds(projectId);
  if (!ids.length) throw new Error("No papers are selected in the Ranking stage.");
  const onlyIds = (ctx.params.paperIds as string[] | undefined) ?? null;
  const papers = db.select().from(schema.papers).where(inArray(schema.papers.id, ids)).all();
  const existing = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids)).all();
  const projectPapers = db.select({ id: schema.papers.id, title: schema.papers.title }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  // Appraisals of papers no longer selected are removed once this run has finished (not when it is cancelled).
  const deselected = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, projectPapers.map((r) => r.id).concat(["-"]))).all().filter((a) => !ids.includes(a.paperId));
  const todo = papers.filter((p) => {
    const ex = existing.find((a) => a.paperId === p.id);
    if (onlyIds) return onlyIds.includes(p.id);
    return !ex || ex.status !== "done" || ctx.params.force;
  });
  /** Finished appraisals being redone, by paper: kept until the new one is ready. */
  const kept = new Map(existing.filter((a) => a.status === "done" && todo.some((p) => p.id === a.paperId)).map((a) => [a.paperId, a]));
  // Failed or unfinished appraisals of the papers being (re)done hold no claims and no decisions: clear them now.
  for (const p of todo) {
    for (const a of existing.filter((x) => x.paperId === p.id && x.id !== kept.get(p.id)?.id)) db.delete(schema.appraisals).where(eq(schema.appraisals.id, a.id)).run();
  }

  const appraise = async (paper: (typeof papers)[number], appraisalId: string, template: ReturnType<typeof templateFor>, onText?: (t: AppraisalDraft["text"]) => void): Promise<AppraisalDraft> => {
    const txt = await getAppraisalText(paper, (l) => ctx.log(l));
    const st = db.select().from(schema.sourceTexts).where(eq(schema.sourceTexts.id, txt.sourceTextId)).get()!;
    const input = buildAppraisalInput(st.text, st.sections, config.appraisalMaxChars);
    const note = [txt.note, input.note].filter(Boolean).join(" ");
    const text: AppraisalDraft["text"] = { sourceTextId: st.id, textSource: txt.kind, textNote: note, charsSentToModel: input.charsSent, sentRanges: input.sentRanges };
    onText?.(text);
    const checklist = CHECKLISTS[template];
    const { data, model, promptVersion } = await structuredCall({
      prompt: "appraisal",
      role: "reasoning",
      schema: Appraisal,
      projectId,
      stage: 7,
      vars: buildAppraisalPromptVars({
        criteria: project.criteria,
        paper,
        template,
        textSourceKind: txt.kind,
        sourceOrigin: st.source,
        input,
        sourceNote: txt.note,
      }),
      mockInput: { paper, text: input.text, checklist },
      check: (o) => {
        const missing = EXTRACTION_FIELDS.filter((f) => !o.extractions.some((e) => e.field === f));
        if (missing.length) return `Missing extraction fields: ${missing.join(", ")}`;
        const noQuote = o.extractions.filter((e) => !e.notReported && !e.quote.trim());
        if (noQuote.length) return `Items without a quote must set notReported=true: ${noQuote.map((e) => e.field).join(", ")}`;
        const want = new Set(checklist.map(itemKey));
        const got = new Set(o.checklist.map((c) => itemKey(c.item)));
        const missingItems = checklist.filter((c) => !got.has(itemKey(c)));
        const off = o.checklist.filter((c) => !want.has(itemKey(c.item)));
        if (off.length || missingItems.length) return `Checklist must contain exactly these items, written as given: ${checklist.join(" | ")}${missingItems.length ? `. Missing: ${missingItems.join(" | ")}` : ""}`;
        const cNoQuote = o.checklist.filter((c) => c.answer !== "not_reported" && !c.quote.trim());
        return cNoQuote.length ? `Checklist answers other than not_reported need a quote: ${cNoQuote.map((c) => c.item).join("; ")}` : null;
      },
    });

    // Verify every quote strictly against the ranges actually sent to the model, mapped back to st.text offsets.
    const pre = normalizeWithMap(input.text);
    const claimRows: ClaimInsert[] = [];
    const mk = (field: string, statement: string, quote: string, location: string, notReported: boolean) => {
      const id = newId("c");
      const v = notReported
        ? { verified: false, matchStart: null, matchEnd: null, verificationNote: "Marked not reported — no quote needed." }
        : verifyQuoteInSentRanges(st.text, st.sections, input.sentRanges, quote, pre);
      claimRows.push({ id, appraisalId, paperId: paper.id, field, statement, quote, location, notReported, ...v });
      return id;
    };
    for (const e of data.extractions) mk(e.field, e.statement, e.quote, e.location, e.notReported);
    // One answer per canonical checklist item (in template order), using the template's wording.
    const answers = checklist.map((item) => data.checklist.find((c) => itemKey(c.item) === itemKey(item))!);
    const cl: ChecklistItem[] = answers.map((c, i) => ({
      item: checklist[i],
      answer: c.answer,
      claimId: c.answer === "not_reported" && !c.quote.trim() ? null : mk("checklist", `${c.item}: ${c.answer.replace("_", " ")}`, c.quote, c.location, c.answer === "not_reported" && !c.quote.trim()),
    }));
    const unv = claimRows.filter((c) => !c.verified && !c.notReported).length;
    return {
      appraisalId,
      paperId: paper.id,
      templateType: template,
      text,
      checklist: cl,
      claimRows,
      model,
      promptVersion,
      logLine: `✓ ${paper.title.slice(0, 60)}… — ${txt.kind === "full_text" ? "full text" : "abstract only"}, ${claimRows.length} claims, ${unv} unverified`,
    };
  };

  let finished = 0;
  let newOk = 0;
  let redoFailed = 0;
  const redone: AppraisalDraft[] = [];
  ctx.progress(0, todo.length, `Appraising ${todo.length} selected papers`);
  await Promise.all(
    todo.map(async (paper) => {
      if (ctx.cancelled()) return;
      const summary = db.select().from(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, paper.id)).get();
      const template = templateFor(summary?.studyType);
      const appraisalId = newId("ap");
      const redo = kept.has(paper.id);
      // A paper with nothing to lose gets its row straight away, so its progress (and any failure) shows as before.
      if (!redo) db.insert(schema.appraisals).values({ id: appraisalId, paperId: paper.id, textSource: "abstract", templateType: template, status: "running" }).run();
      try {
        const d = await appraise(paper, appraisalId, template, redo ? undefined : (t) => db.update(schema.appraisals).set(t).where(eq(schema.appraisals.id, appraisalId)).run());
        if (redo) redone.push(d);
        else {
          db.transaction((tx) => {
            for (const r of d.claimRows) tx.insert(schema.claims).values(r).run();
            tx.update(schema.appraisals).set({ checklist: d.checklist, status: "done", model: d.model, promptVersion: d.promptVersion }).where(eq(schema.appraisals.id, appraisalId)).run();
          });
          newOk++;
        }
        ctx.log(d.logLine);
      } catch (e) {
        if (redo) {
          redoFailed++;
          ctx.log(`✗ re-appraisal failed for ${paper.id}: ${errMsg(e)} — the previous appraisal and your quote decisions were kept`);
        } else {
          db.update(schema.appraisals).set({ status: "failed", error: errMsg(e) }).where(eq(schema.appraisals.id, appraisalId)).run();
          ctx.log(`✗ appraisal failed for ${paper.id}: ${errMsg(e)}`);
        }
        if (e instanceof BudgetError) throw e;
      } finally {
        finished++;
        ctx.progress(finished, todo.length, `Appraised ${finished}/${todo.length}`);
      }
    }),
  );
  // Cancelled: nothing that existed before this run has been removed.
  if (ctx.cancelled()) return;

  // Swap in the redone appraisals and drop those of deselected papers. Their claims go with them (cascade), so
  // first record the decisions being replaced and remove synthesis/questions that cite those claims.
  const leaving = [...deselected, ...redone.map((d) => kept.get(d.paperId)!)];
  if (leaving.length) {
    const title = new Map(projectPapers.map((p) => [p.id, p.title]));
    const old = db.select().from(schema.claims).where(inArray(schema.claims.appraisalId, leaving.map((a) => a.id))).all();
    const decided = old.filter((c) => c.userAccepted || c.userRejected);
    if (decided.length) {
      logDecision(
        projectId,
        7,
        "appraisal_decisions_replaced",
        decided.map((c) => ({ paperId: c.paperId, paper: title.get(c.paperId) ?? null, field: c.field, statement: c.statement, quote: c.quote, decision: c.userAccepted ? "accepted" : "rejected" })),
        { decisions: decided.length, redone: redone.length, deselected: deselected.length, jobId: ctx.jobId },
        "system",
      );
    }
    dropOutputCiting(projectId, claimIdsOfAppraisals(leaving.map((a) => a.id)), 7, "Appraisals were redone, or removed for papers no longer selected");
    db.transaction((tx) => {
      for (const a of leaving) tx.delete(schema.appraisals).where(eq(schema.appraisals.id, a.id)).run();
      for (const d of redone) {
        tx.insert(schema.appraisals).values({ id: d.appraisalId, paperId: d.paperId, templateType: d.templateType, ...d.text, checklist: d.checklist, status: "done", model: d.model, promptVersion: d.promptVersion }).run();
        for (const r of d.claimRows) tx.insert(schema.claims).values(r).run();
      }
    });
  }

  const res = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids)).all();
  logDecision(
    projectId,
    7,
    "appraisals_generated",
    null,
    { appraised: res.filter((a) => a.status === "done").length, failed: res.filter((a) => a.status === "failed").length, fullText: res.filter((a) => a.textSource === "full_text").length, ...(redoFailed ? { keptAfterFailedRedo: redoFailed } : {}) },
    "ai",
  );
  if (!res.some((a) => a.status === "done")) throw new Error("No appraisal succeeded.");
  if (redoFailed && !redone.length && !newOk) throw new Error("No appraisal could be redone. The previous appraisals and your quote decisions were kept.");
}
