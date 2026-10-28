"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner, TextSourceBadge, cx } from "../ui";
import { JobPanel, useJobRefresh, useWizard } from "../wizard/Wizard";

interface AppraisalRow {
  id: string; paperId: string; status: string; error: string | null; textSource: string; textNote: string; templateType: string;
  paper: { id: string; title: string; year: number | null };
  counts: { claims: number; verified: number; unverified: number; accepted: number; notReported: number };
}
interface Claim { id: string; field: string; statement: string; quote: string; location: string; notReported: boolean; verified: boolean; userAccepted: boolean; userRejected: boolean; matchStart: number | null; matchEnd: number | null; verificationNote: string | null }
interface Detail {
  appraisal: { id: string; textSource: string; textNote: string; templateType: string; checklist: { item: string; answer: string; claimId: string | null }[]; status: string; error: string | null; model: string | null; charsSentToModel: number | null };
  paper: { id: string; title: string; year: number | null; doi: string | null; pmid: string | null; pmcid: string | null };
  sourceText: { text: string; source: string; license: string | null; url: string | null; sections: { title: string; start: number }[] } | null;
  claims: Claim[];
}

const FIELD_LABEL: Record<string, string> = { aim: "Aim", setting: "Setting", sample: "Sample", methods: "Methods", key_findings: "Key findings", limitations: "Limitations" };
const TEMPLATE_LABEL: Record<string, string> = { trial: "Trial", cohort: "Cohort", cross_sectional: "Cross-sectional", qualitative: "Qualitative", systematic_review: "Systematic review", other: "Other" };

export function AppraisalStage() {
  const { projectId, states } = useWizard();
  const { data, error, isLoading, mutate } = useApi<{ appraisals: AppraisalRow[] }>(projectPath(projectId, "appraisals"));
  useJobRefresh(7, mutate);
  const [active, setActive] = useState<string | null>(null);
  const list = data?.appraisals ?? [];
  const current = active ?? list.find((a) => a.status === "done")?.id ?? null;

  if (states["6"] !== "approved" && (states["7"] ?? "not_started") === "not_started") return <EmptyState title="Approve the ranking first">Appraisal reads each selected paper.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  const totals = list.reduce((a, x) => ({ ft: a.ft + (x.textSource === "full_text" ? 1 : 0), unv: a.unv + x.counts.unverified - x.counts.accepted }), { ft: 0, unv: 0 });

  return (
    <div className="space-y-4">
      <JobPanel stage={7} runLabel="Appraise selected papers" />
      {list.length > 0 && (
        <p className="text-sm text-gray-600">
          {list.length} papers · <strong>{totals.ft}</strong> appraised from open full text, <strong>{list.length - totals.ft}</strong> from the abstract only ·{" "}
          <span className={totals.unv > 0 ? "font-semibold text-rose-700" : ""}>{totals.unv} unverified quote{totals.unv === 1 ? "" : "s"} awaiting your decision</span>
        </p>
      )}
      {!list.length ? (
        <EmptyState title="No appraisals yet">Run this step to appraise the selected papers.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Appraised papers" className="card max-h-[75vh] overflow-y-auto p-2">
            <ul className="space-y-1">
              {list.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setActive(a.id)} aria-current={current === a.id ? "true" : undefined} className={cx("w-full rounded-lg px-2 py-2 text-left text-sm", current === a.id ? "bg-[var(--color-accent-soft)]" : "hover:bg-gray-50")}>
                    <span className="line-clamp-2 font-medium text-gray-900">{a.paper.title}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {a.status === "done" ? <TextSourceBadge source={a.textSource} /> : a.status === "failed" ? <Badge tone="rose">failed</Badge> : <Badge tone="sky">{a.status}</Badge>}
                      {a.counts.unverified - a.counts.accepted > 0 && <Badge tone="rose">{a.counts.unverified - a.counts.accepted} unverified</Badge>}
                      {a.status === "done" && a.counts.unverified - a.counts.accepted <= 0 && <Badge tone="emerald">quotes checked</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {current ? <AppraisalDetail key={current} id={current} onChanged={() => mutate()} /> : <EmptyState title="Select a paper" />}
        </div>
      )}
    </div>
  );
}

function AppraisalDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { projectId, confirmEdit, refresh, openPaper } = useWizard();
  const { data, error, isLoading, mutate } = useApi<Detail>(projectPath(projectId, `appraisals/${id}`));
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    const el = textRef.current?.querySelector(`[data-claim="${focus}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  const segments = useMemo(() => {
    if (!data?.sourceText) return [];
    const text = data.sourceText.text;
    const spans = data.claims.filter((c) => c.verified && c.matchStart !== null && c.matchEnd !== null).map((c) => ({ s: c.matchStart!, e: c.matchEnd!, id: c.id })).sort((a, b) => a.s - b.s);
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

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const a = data.appraisal;

  async function decide(c: Claim, decision: "accept" | "reject" | "clear") {
    if (!(await confirmEdit(7))) return;
    setBusy(c.id);
    try {
      await mutate(await api<Detail>(projectPath(projectId, `claims/${c.id}`), { method: "PATCH", body: { decision } }), { revalidate: false });
      onChanged();
      await refresh();
    } finally {
      setBusy(null);
    }
  }
  async function redo() {
    await api(projectPath(projectId, `appraisals/${a.id}/redo`), { body: {} });
    await refresh();
    onChanged();
  }

  const fieldClaims = data.claims.filter((c) => c.field !== "checklist");
  const byId = new Map(data.claims.map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <button className="text-left text-base font-semibold text-gray-900 hover:underline" onClick={() => openPaper(data.paper.id)}>{data.paper.title}</button>
            <p className="text-xs text-gray-500">{data.paper.year ?? "n.d."} · {data.paper.doi ? `DOI ${data.paper.doi}` : data.paper.pmid ? `PMID ${data.paper.pmid}` : ""} · template: {TEMPLATE_LABEL[a.templateType] ?? a.templateType}{a.model ? ` · model ${a.model}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <TextSourceBadge source={a.textSource} />
            <button className="btn-ghost text-xs" onClick={redo}>Re-appraise</button>
          </div>
        </div>
        <p className={cx("mt-2 rounded-lg px-3 py-2 text-sm", a.textSource === "full_text" ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950")}>
          <strong>{a.textSource === "full_text" ? "Full text read." : "Abstract only."}</strong> {a.textNote}
        </p>
        {a.status === "failed" && <div className="mt-2"><ErrorState error={a.error ?? "failed"} title="This appraisal failed" onRetry={redo} /></div>}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* Extracted fields */}
        <section aria-label="Extracted fields" className="card max-h-[75vh] space-y-4 overflow-y-auto p-4">
          {Object.entries(FIELD_LABEL).map(([f, label]) => {
            const cs = fieldClaims.filter((c) => c.field === f);
            return (
              <div key={f}>
                <h3 className="label">{label}</h3>
                {cs.length === 0 && <p className="text-sm italic text-gray-400">not extracted</p>}
                <ul className="space-y-2">{cs.map((c) => <ClaimItem key={c.id} c={c} active={focus === c.id} onFocus={() => setFocus(c.id)} onDecide={(d) => decide(c, d)} busy={busy === c.id} />)}</ul>
              </div>
            );
          })}
          <div>
            <h3 className="label">Quality checklist ({TEMPLATE_LABEL[a.templateType]})</h3>
            <ul className="space-y-2">
              {a.checklist.map((it, i) => {
                const c = it.claimId ? byId.get(it.claimId) : null;
                return (
                  <li key={i} className="rounded-lg border border-gray-100 p-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span>{it.item}</span>
                      <Badge tone={it.answer === "yes" ? "emerald" : it.answer === "no" ? "rose" : it.answer === "not_reported" ? "gray" : "amber"}>{it.answer.replace("_", " ")}</Badge>
                    </div>
                    {c && !c.notReported && <QuoteLine c={c} onFocus={() => setFocus(c.id)} onDecide={(d) => decide(c, d)} busy={busy === c.id} />}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Source text */}
        <section aria-label="Source text" className="card flex max-h-[75vh] flex-col">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-600">
            <span><strong>Retrieved text</strong> · {data.sourceText?.source}{data.sourceText?.license ? ` · licence ${data.sourceText.license}` : ""}</span>
            {data.sourceText?.url && <a className="text-teal-800 underline" href={data.sourceText.url} target="_blank" rel="noreferrer">source</a>}
          </div>
          <div ref={textRef} className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-serif text-[13px] leading-relaxed text-gray-800">
            {data.sourceText ? (
              segments.map((s, i) =>
                s.id ? (
                  <mark key={i} data-claim={s.id} className={focus === s.id ? "q-active" : "q"} onClick={() => setFocus(s.id!)}>{s.text}</mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )
            ) : (
              <p className="italic text-gray-400">No source text stored.</p>
            )}
          </div>
          {a.charsSentToModel && data.sourceText && data.sourceText.text.length > a.charsSentToModel && (
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-amber-800">The model read the first {a.charsSentToModel.toLocaleString()} of {data.sourceText.text.length.toLocaleString()} characters.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ClaimItem({ c, active, onFocus, onDecide, busy }: { c: Claim; active: boolean; onFocus: () => void; onDecide: (d: "accept" | "reject" | "clear") => void; busy: boolean }) {
  return (
    <li className={cx("rounded-lg border p-2.5 text-sm", active ? "border-amber-400 bg-amber-50/50" : c.notReported ? "border-gray-100 bg-gray-50" : !c.verified && !c.userAccepted ? "border-rose-200 bg-rose-50/40" : "border-gray-200")}>
      {c.notReported ? (
        <p className="italic text-gray-500">Not reported in the retrieved text</p>
      ) : (
        <>
          <p className="text-gray-900">{c.statement}</p>
          <QuoteLine c={c} onFocus={onFocus} onDecide={onDecide} busy={busy} />
        </>
      )}
    </li>
  );
}

function QuoteLine({ c, onFocus, onDecide, busy }: { c: Claim; onFocus: () => void; onDecide: (d: "accept" | "reject" | "clear") => void; busy: boolean }) {
  const status = c.verified ? (
    <Badge tone="emerald" title={c.verificationNote ?? ""}>✓ verified</Badge>
  ) : c.userAccepted ? (
    <Badge tone="amber" title={c.verificationNote ?? ""}>unverified · accepted by you</Badge>
  ) : c.userRejected ? (
    <Badge tone="gray">rejected by you</Badge>
  ) : (
    <Badge tone="rose" title={c.verificationNote ?? ""}>✗ unverified</Badge>
  );
  return (
    <div className="mt-1.5">
      <button onClick={onFocus} disabled={!c.verified} className={cx("block w-full rounded border-l-2 py-0.5 pl-2 text-left text-xs italic", c.verified ? "border-amber-300 text-gray-700 hover:bg-amber-50" : "border-rose-300 text-gray-600")} title={c.verified ? "Show in source text" : "This quote was not found in the retrieved text"}>
        “{c.quote}”
      </button>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
        {status}
        <span>{c.location}</span>
        {!c.verified && (
          <span className="ml-auto flex gap-1">
            {busy && <Spinner className="h-3 w-3" />}
            {!c.userAccepted && <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => onDecide("accept")}>Accept anyway</button>}
            {!c.userRejected && <button className="btn-ghost px-1.5 py-0.5 text-[11px] text-rose-700" onClick={() => onDecide("reject")}>Reject</button>}
            {(c.userAccepted || c.userRejected) && <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => onDecide("clear")}>Undo</button>}
          </span>
        )}
      </div>
      {!c.verified && c.verificationNote && <p className="mt-0.5 text-[11px] text-rose-700">{c.verificationNote}</p>}
    </div>
  );
}
