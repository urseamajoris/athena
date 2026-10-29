"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner, TextSourceBadge, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { canvasStore, useJobRefresh, useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, SectionTitle, StaleNotice } from "./common";
import { FOUND_MEANS, PinButton, QuoteVerdict, SourcePassage } from "./evidence";
import { nextAction } from "@/lib/canvas/actions";
import { isUndecided } from "@/lib/shared/canvas";
import { fmtInt } from "@/lib/shared/format";
import { Checklist } from "../guide/Checklist";
import { WhatHappens } from "../guide/WhatHappens";
import { usingKeyboard } from "../canvas/focus";

export interface AppraisalRow {
  id: string; paperId: string; status: string; error: string | null; textSource: string; textNote: string; templateType: string;
  paper: { id: string; title: string; year: number | null };
  /** unverified = not found word for word; of those, accepted / rejected by the user, and undecided (see isUndecided). */
  counts: { claims: number; verified: number; unverified: number; accepted: number; rejected: number; undecided: number; notReported: number };
}
export interface Claim { id: string; field: string; statement: string; quote: string; location: string; notReported: boolean; verified: boolean; userAccepted: boolean; userRejected: boolean; matchStart: number | null; matchEnd: number | null; verificationNote: string | null; paperId: string; appraisalId: string }
export interface AppraisalDetailData {
  appraisal: { id: string; textSource: string; textNote: string; templateType: string; checklist: { item: string; answer: string; claimId: string | null }[]; status: string; error: string | null; model: string | null; charsSentToModel: number | null };
  paper: { id: string; title: string; year: number | null; doi: string | null; pmid: string | null; pmcid: string | null };
  sourceText: { text: string; source: string; license: string | null; url: string | null; sections: { title: string; start: number }[] } | null;
  claims: Claim[];
}

const FIELD_LABEL: Record<string, string> = { aim: "Aim", setting: "Setting", sample: "Sample", methods: "Methods", key_findings: "Key findings", limitations: "Limitations" };
export const TEMPLATE_LABEL: Record<string, string> = { trial: "Trial", cohort: "Cohort", cross_sectional: "Cross-sectional", qualitative: "Qualitative", systematic_review: "Systematic review", other: "Other" };
const ANSWER_TONE: Record<string, "ok" | "err" | "neutral" | "warn"> = { yes: "ok", no: "err", not_reported: "neutral", unclear: "warn" };
const ANSWER_LABEL: Record<string, string> = { yes: "Yes", no: "No", not_reported: "Not reported", unclear: "Unclear" };

export function useAppraisals() {
  const { projectId } = useSession();
  const r = useApi<{ appraisals: AppraisalRow[] }>(projectPath(projectId, "appraisals"));
  useJobRefresh(7, r.mutate);
  return r;
}

/** Appraisal node: finish one appraisal at a time (checklist + extracted claims with verified quotes). */
export function AppraisalPanel() {
  const { projectId, ui, graph, input, states } = useSession();
  const { data, error, isLoading, mutate } = useAppraisals();
  const list = useMemo(() => data?.appraisals ?? [], [data]);
  const [active, setActive] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const firstUnreviewed = list.find((a) => a.status === "done" && !ui.reviewed.includes(a.id)) ?? list.find((a) => a.status === "done");
  const current = list.find((a) => a.id === active) ?? firstUnreviewed ?? null;
  const idx = current ? list.findIndex((a) => a.id === current.id) : -1;
  const reviewed = list.filter((a) => ui.reviewed.includes(a.id)).length;
  const node = graph.nodes.find((n) => n.id === "appraisal");
  const action = node ? nextAction(node, graph, input) : null;
  // Every "to decide" count here comes from the server's per-paper counts (the same rule as the canvas card).
  const totals = list.reduce((a, x) => ({ ft: a.ft + (x.textSource === "full_text" ? 1 : 0), left: a.left + x.counts.undecided, decided: a.decided + x.counts.accepted + x.counts.rejected }), { ft: 0, left: 0, decided: 0 });
  const leftOut = `${totals.left} quote${totals.left === 1 ? "" : "s"} you have not decided will be left out of the synthesis.`;

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;

  function go(delta: number) {
    if (!current) return;
    if (delta > 0) canvasStore.getState().markReviewed(projectId, current.id);
    const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))];
    if (next) setActive(next.id);
  }
  const last = idx === list.length - 1;
  const markLast = current && last && current.status === "done" && !ui.reviewed.includes(current.id);

  return (
    <div className="space-y-4">
      <StaleNotice stage={7} />
      {states["7"] === "running" && <JobStatus stage={7} />}
      <WhatHappens stage={7} />
      {!list.length ? (
        <EmptyState title="No appraisals yet">They appear here as each selected paper is read.</EmptyState>
      ) : (
        <>
          <Checklist
            title="Do these things"
            items={[
              { label: `Look at each paper (${reviewed} of ${list.length} looked at)`, done: reviewed >= list.filter((a) => a.status === "done").length, hint: "“Next paper” moves on and marks this one as looked at." },
              { label: `Decide every quote the check could not find (${totals.decided} decided, ${totals.left} left)`, done: totals.left === 0, hint: "Accept it if the paper does say this, reject it if not. Rejected and undecided quotes are left out of the synthesis." },
              { label: "Then summarise the evidence", done: states["7"] === "approved" },
            ]}
          />
          <p className="text-12 text-fg-1">
            For each quality question the AI gives an answer (<span className="text-fg-0">Yes, No, Unclear, Not reported</span>) and a quote from the paper. Athena then looks for the quote word for word: <span className="text-ok">✓ found word for word</span> or <span className="text-err">✗ not found, you decide</span>. {FOUND_MEANS}
          </p>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Show only quotes I need to decide</label>
          <div className="flex items-center gap-2">
            <button className="btn-ghost h-11 w-11 px-0" onClick={() => go(-1)} disabled={idx <= 0} aria-label="Previous paper"><ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
            <p className="flex-1 text-center" aria-live="polite">
              <span className="font-medium tabular-nums">Paper {idx + 1} of {list.length}</span>
              <span className="block text-12 tabular-nums text-fg-2">{reviewed}/{list.length} reviewed · {totals.ft} full text · {totals.left} quote{totals.left === 1 ? "" : "s"} to decide</span>
            </p>
            <button className="btn-ghost h-11 w-11 px-0" onClick={() => go(1)} disabled={last} aria-label="Next paper (marks this one reviewed)"><ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
          </div>
          {current && <AppraisalDetail key={current.id} row={current} onChanged={() => mutate()} onlyOpen={onlyOpen} />}
          <Disclosure title="All appraised papers" meta={`${list.length}`}>
            <ul className="space-y-1">
              {list.map((a, i) => (
                <li key={a.id}>
                  <button onClick={() => setActive(a.id)} aria-current={current?.id === a.id ? "true" : undefined} className={cx("flex min-h-11 w-full items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-bg-3", current?.id === a.id && "bg-bg-3")}>
                    <span className="w-6 shrink-0 text-12 tabular-nums text-fg-2">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2">{a.paper.title}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {a.status === "done" ? <TextSourceBadge source={a.textSource} /> : a.status === "failed" ? <Badge tone="err">failed</Badge> : <Badge tone="run">{a.status}</Badge>}
                        {a.counts.undecided > 0 && <Badge tone="err">{a.counts.undecided} to decide</Badge>}
                        {a.counts.rejected > 0 && <Badge>{a.counts.rejected} rejected by you</Badge>}
                        {ui.reviewed.includes(a.id) && <Badge>reviewed</Badge>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Disclosure>
          <JobLog stage={7} />
        </>
      )}
      {/* Once the appraisal is approved and the review has moved on, no footer here: the panel's fallback then offers
          "Go to step N" as the primary action (the arrows above still page through the papers). */}
      {!(states["7"] === "approved" && !action) && <PanelFooter note={action?.cmd.type === "approve" && totals.left > 0 ? leftOut : undefined}>
        {list.length > 0 && !last ? (
          <>
            {action && <ActionButton action={action} />}
            <button className="btn-primary" onClick={() => go(1)}>Next paper</button>
          </>
        ) : action ? (
          <>
            {markLast && <button className="btn-secondary" onClick={() => { if (!current) return; setActive(current.id); canvasStore.getState().markReviewed(projectId, current.id); }}>Mark this paper as looked at</button>}
            <ActionButton action={action} primary showReason />
          </>
        ) : list.length > 0 ? (
          <button className="btn-secondary" onClick={() => { go(0); setActive(list[0].id); }}>Back to the first paper</button>
        ) : null}
      </PanelFooter>}
    </div>
  );
}

function AppraisalDetail({ row, onChanged, onlyOpen }: { row: AppraisalRow; onChanged: () => void; onlyOpen: boolean }) {
  const { projectId, confirmEdit, refresh, openPaper, states, announce } = useSession();
  const { data, error, isLoading, mutate } = useApi<AppraisalDetailData>(projectPath(projectId, `appraisals/${row.id}`));
  const [busy, setBusy] = useState<string | null>(null);
  // Quotes decided on this visit stay in place (as "Rejected", with Undo) even under "only quotes I need to decide".
  const [decidedHere, setDecidedHere] = useState<Set<string>>(() => new Set());
  const stale = states["7"] === "stale";
  const rootRef = useRef<HTMLDivElement>(null);
  // A decision removes the button that was pressed (Reject becomes Undo). For keyboard users focus then moves on
  // to the next quote to decide (or, when none is left, to the footer's next action), not back to the panel
  // heading at the top. Layout effect: it runs before the panel's own focus recovery (FocusPanel) looks.
  const moveFrom = useRef<{ id: string; decision: "accept" | "reject" | "clear" } | null>(null);
  useLayoutEffect(() => {
    const m = moveFrom.current;
    const root = rootRef.current;
    const c = m && data?.claims.find((x) => x.id === m.id);
    if (!m || !root || !c) return;
    // Only once the decision shows on screen.
    if (m.decision === "reject" ? !c.userRejected : m.decision === "accept" ? !c.userAccepted : c.userAccepted || c.userRejected) return;
    moveFrom.current = null;
    if (!usingKeyboard()) return;
    const quotes = [...root.querySelectorAll<HTMLElement>("[data-quote]")];
    const at = quotes.findIndex((q) => q.dataset.quote === m.id);
    const next = m.decision === "clear" ? quotes[at] : [...quotes.slice(at + 1), ...quotes.slice(0, Math.max(0, at))].find((q) => q.hasAttribute("data-undecided"));
    const target =
      next?.querySelector<HTMLElement>("[data-decide]") ??
      root.closest("[data-panel]")?.querySelector<HTMLElement>("[data-panel-footer] .btn-primary") ??
      quotes[at]?.querySelector<HTMLElement>("button");
    target?.focus();
  }, [data]);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const a = data.appraisal;
  async function decide(c: Claim, decision: "accept" | "reject" | "clear") {
    if (!(await confirmEdit(7))) return;
    setBusy(c.id);
    // Kept in place first, so that under "only quotes I need to decide" it is still there to move on from.
    setDecidedHere((s) => new Set(s).add(c.id));
    moveFrom.current = { id: c.id, decision };
    try {
      await mutate(await api<AppraisalDetailData>(projectPath(projectId, `claims/${c.id}`), { method: "PATCH", body: { decision } }), { revalidate: false });
      announce(decision === "reject" ? "Quote rejected: left out of the synthesis. Undo is next to it." : decision === "accept" ? "Quote accepted: it will be used in the synthesis." : "Decision undone: the quote is waiting for you again.");
      onChanged();
      await refresh();
    } catch (e) {
      moveFrom.current = null;
      throw e;
    } finally {
      setBusy(null);
    }
  }
  const byId = new Map(data.claims.map((c) => [c.id, c]));
  const open = (c: Claim | null | undefined) => !!c && (isUndecided(c) || decidedHere.has(c.id));
  const fieldClaims = data.claims.filter((c) => c.field !== "checklist" && (!onlyOpen || open(c)));
  const checklist = a.checklist.filter((it) => !onlyOpen || open(it.claimId ? byId.get(it.claimId) : null));
  return (
    <div ref={rootRef} className="space-y-4">
      <div>
        <button className="link min-h-11 text-left font-semibold md:min-h-0" onClick={() => openPaper(data.paper.id)}>{data.paper.title}</button>
        <p className="mt-1 text-12 text-fg-2">{data.paper.year ?? "n.d."}{data.paper.doi ? ` · DOI ${data.paper.doi}` : data.paper.pmid ? ` · PMID ${data.paper.pmid}` : ""}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-fg-1">
          <TextSourceBadge source={a.textSource} />
          {a.textSource === "full_text" ? "Read on the open full text." : "Only the abstract could be read, so some questions are unclear or not reported. That is a limit of the text, not of the study."}
        </p>
        <Disclosure title="Details" meta="text source, model">
          <p className="text-12 text-fg-1">{a.textNote}</p>
          <p className="mt-1 text-12 text-fg-2">Questions used: {TEMPLATE_LABEL[a.templateType] ?? a.templateType} checklist (chosen from the study type).{a.model ? ` Model: ${a.model}.` : ""}</p>
        </Disclosure>
        {a.status === "failed" && <div className="mt-2"><ErrorState error={a.error ?? "failed"} title="This appraisal failed" /></div>}
      </div>

      <section aria-label="Quality checklist">
        <SectionTitle>{a.templateType === "other" ? "General quality questions" : `Quality questions for a ${(TEMPLATE_LABEL[a.templateType] ?? a.templateType).toLowerCase()} study`}</SectionTitle>
        {onlyOpen && !checklist.length && <p className="text-fg-2">Nothing to decide in this checklist.</p>}
        <ul className="space-y-2">
          {checklist.map((it, i) => {
            const c = it.claimId ? byId.get(it.claimId) : null;
            return (
              <li key={i} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <span>{it.item}</span>
                  <Badge tone={ANSWER_TONE[it.answer] ?? "warn"} title="The AI's answer to this question">AI: {ANSWER_LABEL[it.answer] ?? it.answer.replace("_", " ")}</Badge>
                </div>
                {c && !c.notReported && <QuoteLine c={c} text={data.sourceText?.text} stale={stale} onDecide={(d) => decide(c, d)} busy={busy === c.id} />}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Extracted findings" className="space-y-4">
        {Object.entries(FIELD_LABEL).map(([f, label]) => {
          const cs = fieldClaims.filter((c) => c.field === f);
          if (onlyOpen && !cs.length) return null;
          return (
            <div key={f}>
              <SectionTitle>{label}</SectionTitle>
              {cs.length === 0 && <p className="italic text-fg-2">not extracted</p>}
              <ul className="space-y-2">
                {cs.map((c) => (
                  <li key={c.id} className={cx("rounded-md border p-3", isUndecided(c) ? "border-err-line" : "border-line")}>
                    {c.notReported ? (
                      <p className="italic text-fg-2">Not reported in the retrieved text</p>
                    ) : (
                      <>
                        <p>{c.statement}</p>
                        <QuoteLine c={c} text={data.sourceText?.text} stale={stale} onDecide={(d) => decide(c, d)} busy={busy === c.id} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <Disclosure title="Full retrieved text" meta={data.sourceText ? `${data.sourceText.source}${data.sourceText.license ? ` · ${data.sourceText.license}` : ""}` : "none"}>
        <FullText data={data} />
      </Disclosure>
    </div>
  );
}

/** A claim's quote: verdict badge, accept/reject for unverified quotes, inline source passage, pin. */
export function QuoteLine({ c, text, stale, onDecide, busy }: { c: Claim; text?: string; stale?: boolean; onDecide: (d: "accept" | "reject" | "clear") => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const canShow = c.verified && text && c.matchStart !== null && c.matchEnd !== null;
  return (
    <div className="mt-2" data-quote={c.id} data-undecided={isUndecided(c) || undefined}>
      <blockquote className={cx("border-l-2 pl-2 text-12 italic", c.verified ? "border-ok-line text-fg-1" : c.userRejected ? "border-line text-fg-2 line-through" : "border-err-line text-fg-1")}>“{c.quote}”</blockquote>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-12 text-fg-2">
        <QuoteVerdict c={c} stale={stale} />
        <span>{c.location}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          {busy && <Spinner className="h-3 w-3" />}
          {canShow && <button className="btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide source" : "Show source"}</button>}
          {!c.verified && !c.userAccepted && <button className="btn-secondary btn-sm" data-decide onClick={() => onDecide("accept")} title="The paper does say this: keep it">Accept anyway</button>}
          {!c.verified && !c.userRejected && <button className="btn-secondary btn-sm" data-decide onClick={() => onDecide("reject")} title="Leave this claim out of the synthesis">Reject</button>}
          {!c.verified && (c.userAccepted || c.userRejected) && <button className="btn-ghost btn-sm" onClick={() => onDecide("clear")} aria-label={c.userRejected ? "Undo reject" : "Undo accept"}>Undo</button>}
          <PinButton claimId={c.id} />
        </span>
      </div>
      {c.userRejected && !c.verified ? (
        <p className="mt-1 text-12 text-fg-2">Rejected: left out of the synthesis.</p>
      ) : (
        !c.verified && c.verificationNote && <p className={cx("mt-1 text-12", c.userAccepted ? "text-fg-2" : "text-err")}>{c.verificationNote.replace(/^UNVERIFIED:\s*/, "")}</p>
      )}
      {open && canShow && <div className="mt-2"><SourcePassage text={text!} start={c.matchStart!} end={c.matchEnd!} /></div>}
    </div>
  );
}

function FullText({ data }: { data: AppraisalDetailData }) {
  const [focus, setFocus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.querySelector(`[data-claim="${focus}"]`)?.scrollIntoView({ block: "center" });
  }, [focus]);
  const segments = useMemo(() => {
    if (!data.sourceText) return [];
    const text = data.sourceText.text;
    const spans = data.claims.filter((c) => c.verified && c.matchStart !== null && c.matchEnd !== null).map((c) => ({ s: c.matchStart!, e: c.matchEnd!, id: c.id })).sort((x, y) => x.s - y.s);
    const out: { text: string; id?: string }[] = [];
    let pos = 0;
    for (const sp of spans) {
      if (sp.s < pos) continue; // overlapping quote: first one wins
      if (sp.s > pos) out.push({ text: text.slice(pos, sp.s) });
      out.push({ text: text.slice(sp.s, sp.e), id: sp.id });
      pos = sp.e;
    }
    out.push({ text: text.slice(pos) });
    return out;
  }, [data]);
  if (!data.sourceText) return <p className="italic text-fg-2">No source text stored.</p>;
  const a = data.appraisal;
  return (
    <div>
      {data.sourceText.url && <a className="link text-12" href={data.sourceText.url} target="_blank" rel="noreferrer">Open the source</a>}
      <div ref={ref} className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap font-serif text-14 leading-relaxed text-fg-1">
        {segments.map((s, i) => (s.id ? <mark key={i} data-claim={s.id} className={focus === s.id ? "q-active" : "q"} onClick={() => setFocus(s.id!)}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
      </div>
      {a.charsSentToModel && data.sourceText.text.length > a.charsSentToModel && (
        <p className="mt-2 text-12 text-warn">The model read the first {fmtInt(a.charsSentToModel)} of {fmtInt(data.sourceText.text.length)} characters.</p>
      )}
    </div>
  );
}
