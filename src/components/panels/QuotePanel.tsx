"use client";
import { useState } from "react";
import { api, projectPath, useApi } from "../api";
import { ErrorState, Loading, Spinner } from "../ui";
import { Disclosure } from "../disclosure";
import { canvasStore, useSession } from "../session/SessionContext";
import { FOUND_MEANS, QuoteVerdict, SourcePassage, partsSuffix } from "./evidence";
import type { AppraisalDetailData } from "./AppraisalPanel";

/** Quote node: does the quote match its source? Quote beside the highlighted passage, and the verdict. */
export function QuotePanel({ claimId }: { claimId: string }) {
  const { projectId, claims, confirmEdit, refresh, states, openPaper } = useSession();
  const lite = claims?.find((c) => c.id === claimId);
  const { data, error, isLoading, mutate } = useApi<AppraisalDetailData>(lite ? projectPath(projectId, `appraisals/${lite.appraisalId}`) : null);
  const [busy, setBusy] = useState(false);
  if (!lite) return <p className="text-fg-2">This quote is no longer in the appraisal.</p>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  const c = data?.claims.find((x) => x.id === claimId);
  if (!data || !c) return null;
  const stale = states["7"] === "stale";
  const text = data.sourceText?.text;
  async function decide(decision: "accept" | "reject" | "clear") {
    if (!(await confirmEdit(7))) return;
    setBusy(true);
    try {
      await mutate(await api<AppraisalDetailData>(projectPath(projectId, `claims/${claimId}`), { method: "PATCH", body: { decision } }), { revalidate: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <QuoteVerdict c={c} stale={stale} />
        <span className="text-12 text-fg-2">{c.location}</span>
      </div>
      <p>{c.statement}</p>
      <div className="grid gap-3">
        <section aria-label="Quote">
          <h3 className="label">Quote</h3>
          <blockquote className="border-l-2 border-line-control pl-3 italic text-fg-1">“{c.quote}”</blockquote>
        </section>
        <section aria-label="Source passage">
          <h3 className="label">Source passage</h3>
          {c.verified && text && c.matchStart !== null && c.matchEnd !== null ? (
            <>
              <SourcePassage text={text} start={c.matchStart} end={c.matchEnd} />
              {partsSuffix(c) && c.verificationNote && <p className="mt-1 text-12 text-fg-2">{c.verificationNote} The passage above is the first part.</p>}
            </>
          ) : (
            <p className="rounded-sm border border-err-line px-3 py-2 text-fg-1">Not found word for word in the retrieved text. {c.verificationNote?.replace(/^(UNVERIFIED:\s*)?(Quote not found in the retrieved source text\.\s*)?/, "")}</p>
          )}
        </section>
      </div>
      <p className="text-12 text-fg-2">{FOUND_MEANS} Nor does it prove the sentence above says the same as the quote.</p>
      {!c.verified && c.userRejected && <p className="text-12 text-fg-2">Rejected: left out of the synthesis.</p>}
      <div className="flex flex-wrap gap-2">
        {busy && <Spinner />}
        {!c.verified && !c.userAccepted && <button className="btn-secondary" onClick={() => decide("accept")}>Accept anyway</button>}
        {!c.verified && !c.userRejected && <button className="btn-danger" onClick={() => decide("reject")}>Reject</button>}
        {!c.verified && (c.userAccepted || c.userRejected) && <button className="btn-ghost" onClick={() => decide("clear")}>Undo decision</button>}
        <button className="btn-ghost" onClick={() => openPaper(c.paperId)}>Open paper</button>
        <button className="btn-ghost" onClick={() => { canvasStore.getState().unpinQuote(projectId, claimId); canvasStore.getState().closePanel(); }}>Unpin</button>
      </div>
      <Disclosure title="Full retrieved text" meta={data.sourceText?.source}>
        <p className="max-h-80 overflow-y-auto whitespace-pre-wrap font-serif text-14 leading-relaxed text-fg-1">{text ?? "No source text stored."}</p>
      </Disclosure>
    </div>
  );
}
