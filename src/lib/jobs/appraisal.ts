import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import type { ChecklistItem } from "../db/schema";
import { config } from "../config";
import { structuredCall, BudgetError } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { Appraisal, EXTRACTION_FIELDS } from "../stages/ai-schemas";
import { CHECKLISTS, FIELD_GUIDANCE, TEMPLATE_LABEL, templateFor } from "../stages/templates";
import { closestPassage, normalizeWithMap, sectionAt, verifyQuote } from "../quotes";
import { errMsg, newId } from "../util";
import { logDecision } from "../project";
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
export async function reverifyProject(projectId: string) {
  const paperIds = (await db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.id);
  const apps = (await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, paperIds.concat(["-"]))).all());
  let changed = 0;
  let checked = 0;
  for (const a of apps) {
    if (!a.sourceTextId) continue;
    const st = (await db.select().from(schema.sourceTexts).where(eq(schema.sourceTexts.id, a.sourceTextId)).get());
    if (!st) continue;
    const sent = a.charsSentToModel ? st.text.slice(0, a.charsSentToModel) : st.text;
    const pre = normalizeWithMap(sent);
    for (const c of (await db.select().from(schema.claims).where(eq(schema.claims.appraisalId, a.id)).all())) {
      if (c.notReported) continue;
      checked++;
      const v = checkQuote(sent, st.sections, c.quote, pre);
      if (v.verified !== c.verified) changed++;
      (await db.update(schema.claims).set(v).where(eq(schema.claims.id, c.id)).run());
    }
  }
  return { checked, changed };
}

export async function selectedPaperIds(projectId: string): Promise<string[]> {
  const topics = (await db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.projectId, projectId)).all()).map((t) => t.id);
  const sel = (await db.select().from(schema.scores).where(inArray(schema.scores.topicId, topics.concat(["-"]))).all()).filter((s) => s.selected);
  return [...new Set(sel.map((s) => s.paperId))];
}

export async function appraisalJob(ctx: JobContext) {
  const { projectId } = ctx;
  const ids = (await selectedPaperIds(projectId));
  if (!ids.length) throw new Error("No papers are selected in the Ranking stage.");
  const onlyIds = (ctx.params.paperIds as string[] | undefined) ?? null;
  const papers = (await db.select().from(schema.papers).where(inArray(schema.papers.id, ids)).all());
  const existing = (await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids)).all());
  // Remove appraisals for papers no longer selected, and the ones being redone.
  const projectPaperIds = (await db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.id);
  const deselected = (await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, projectPaperIds.concat(["-"]))).all()).filter((a) => !ids.includes(a.paperId));
  for (const a of deselected) (await db.delete(schema.appraisals).where(eq(schema.appraisals.id, a.id)).run());
  const todo = papers.filter((p) => {
    const ex = existing.find((a) => a.paperId === p.id);
    if (onlyIds) return onlyIds.includes(p.id);
    return !ex || ex.status !== "done" || ctx.params.force;
  });
  for (const p of todo) (await db.delete(schema.appraisals).where(eq(schema.appraisals.paperId, p.id)).run());

  let finished = 0;
  (await ctx.progress(0, todo.length, `Appraising ${todo.length} selected papers`));
  await Promise.all(
    todo.map(async (paper) => {
      if ((await ctx.cancelled())) return;
      const summary = (await db.select().from(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, paper.id)).get());
      const template = templateFor(summary?.studyType);
      const appraisalId = newId("ap");
      (await db.insert(schema.appraisals).values({ id: appraisalId, paperId: paper.id, textSource: "abstract", templateType: template, status: "running" }).run());
      try {
        const txt = await getAppraisalText(paper, async (l) => (await ctx.log(l)));
        const st = (await db.select().from(schema.sourceTexts).where(eq(schema.sourceTexts.id, txt.sourceTextId)).get())!;
        const truncated = st.text.length > config.appraisalMaxChars;
        const sent = truncated ? st.text.slice(0, config.appraisalMaxChars) : st.text;
        const note = txt.note + (truncated ? ` The model was given the first ${config.appraisalMaxChars.toLocaleString()} of ${st.text.length.toLocaleString()} characters; content after that was not read.` : "");
        (await db.update(schema.appraisals).set({ sourceTextId: st.id, textSource: txt.kind, textNote: note, charsSentToModel: sent.length }).where(eq(schema.appraisals.id, appraisalId)).run());
        const checklist = CHECKLISTS[template];
        const guidance = FIELD_GUIDANCE[template];
        const { data, model, promptVersion } = await structuredCall({
          prompt: "appraisal",
          role: "reasoning",
          schema: Appraisal,
          projectId,
          stage: 7,
          vars: {
            textSource: txt.kind === "full_text" ? "FULL TEXT" : "ABSTRACT ONLY (the full text was not available; do not imply you read it)",
            textNote: truncated ? `Only the first part of the full text is provided.` : "",
            template: TEMPLATE_LABEL[template],
            fields: EXTRACTION_FIELDS.map((f) => `- ${f}: ${guidance[f]}`).join("\n"),
            checklist: checklist.map((c, i) => `${i + 1}. ${c}`).join("\n"),
            paperId: paper.id,
            title: paper.title,
            year: String(paper.year ?? "n/a"),
            text: wrapData(`source text of ${paper.id}`, sent),
          },
          mockInput: { paper, text: sent, checklist },
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

        // Verify every quote against the text that was actually retrieved and sent.
        const pre = normalizeWithMap(sent);
        const claimRows: (typeof schema.claims.$inferInsert)[] = [];
        const mk = (field: string, statement: string, quote: string, location: string, notReported: boolean) => {
          const id = newId("c");
          const v = notReported ? { verified: false, matchStart: null, matchEnd: null, verificationNote: "Marked not reported — no quote needed." } : checkQuote(sent, st.sections, quote, pre);
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
        {
    const stmts: BatchItem<"sqlite">[] = [];
                    for (const r of claimRows) stmts.push(db.insert(schema.claims).values(r));
                    stmts.push(db.update(schema.appraisals).set({ checklist: cl, status: "done", model, promptVersion }).where(eq(schema.appraisals.id, appraisalId)));
                    await batchWrite(stmts);
  }
        const unv = claimRows.filter((c) => !c.verified && !c.notReported).length;
        (await ctx.log(`✓ ${paper.title.slice(0, 60)}… — ${txt.kind === "full_text" ? "full text" : "abstract only"}, ${claimRows.length} claims, ${unv} unverified`));
      } catch (e) {
        (await db.update(schema.appraisals).set({ status: "failed", error: errMsg(e) }).where(eq(schema.appraisals.id, appraisalId)).run());
        (await ctx.log(`✗ appraisal failed for ${paper.id}: ${errMsg(e)}`));
        if (e instanceof BudgetError) throw e;
      } finally {
        finished++;
        (await ctx.progress(finished, todo.length, `Appraised ${finished}/${todo.length}`));
      }
    }),
  );
  const res = (await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids)).all());
  (await logDecision(projectId, 7, "appraisals_generated", null, { appraised: res.filter((a) => a.status === "done").length, failed: res.filter((a) => a.status === "failed").length, fullText: res.filter((a) => a.textSource === "full_text").length }, "ai"));
  if (!res.some((a) => a.status === "done")) throw new Error("No appraisal succeeded.");
}
