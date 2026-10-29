"use client";
import { AlertTriangle, Check, Pin, X } from "lucide-react";
import { Popover } from "radix-ui";
import { Badge, cx } from "../ui";
import { canvasStore, useSession } from "../session/SessionContext";
import { shortCite } from "@/lib/shared/stages";
import { partsLabel } from "@/lib/quotes";

export interface ClaimRef { id: string; paperId: string; field: string; statement: string; quote: string; location: string; verified: boolean; userAccepted: boolean; userRejected?: boolean; ordinal?: number; ofField?: number }
export interface PaperRef { id: string; title: string; year: number | null; authors: string[]; studyType?: string | null }

const I = { className: "h-3 w-3", strokeWidth: 2, "aria-hidden": true } as const;

/** What "found" means, in one line: shown wherever the verdict badges are explained. */
export const FOUND_MEANS = "Found means the words are in the paper, not that they prove the answer.";

/**
 * ", in two parts" for a verified quote joined from separate passages with "…" (counted as the check counts them).
 * Only when the stored check itself says so: a quote verified by the older check (one span across all parts) shows
 * the plain wording until it is re-checked.
 */
export function partsSuffix(c: { verified: boolean; quote?: string; verificationNote?: string | null }) {
  return c.verified && c.quote && (c.verificationNote ?? "").startsWith("Found word for word, in") ? partsLabel(c.quote) : "";
}

/** The quote check's verdict, always visible and never colour-only (icon + text). */
export function QuoteVerdict({ c, stale }: { c: { verified: boolean; userAccepted: boolean; userRejected?: boolean; quote?: string }; stale?: boolean }) {
  if (stale) return <Badge state tone="warn" icon={<AlertTriangle {...I} />}>stale</Badge>;
  const parts = partsSuffix(c);
  if (c.verified && parts) return <Badge state tone="ok" icon={<Check {...I} />} title={`The quote joins separate passages with "…", and each part is in the paper word for word. The highlighted passage is the first part. ${FOUND_MEANS}`}>found word for word{parts}</Badge>;
  if (c.verified) return <Badge state tone="ok" icon={<Check {...I} />} title={`The quote is in the paper word for word. ${FOUND_MEANS}`}>found word for word</Badge>;
  if (c.userAccepted) return <Badge state tone="warn" icon={<Check {...I} />} title="Not found word for word; you said the paper does say this">not found · accepted by you</Badge>;
  if (c.userRejected) return <Badge state icon={<X {...I} />} title="Left out of the synthesis">rejected by you</Badge>;
  return <Badge state tone="err" icon={<X {...I} />} title="The check could not find these words in the paper: accept or reject the quote">not found, you decide</Badge>;
}

const FIELD_SHORT: Record<string, string> = { key_findings: "finding", limitations: "limitation", checklist: "quality item", methods: "methods", sample: "sample", setting: "setting", aim: "aim" };

export function short(p?: PaperRef) {
  return p ? shortCite(p.authors, p.year) : "?";
}

/** Inline citation to a claim (scite-style): verdict badge always visible; the quote opens in a popover. */
export function ClaimChip({ id, claims, papers, stale }: { id: string; claims: Record<string, ClaimRef>; papers: Record<string, PaperRef>; stale?: boolean }) {
  const { openPaper, projectId } = useSession();
  const c = claims[id];
  if (!c) return <Badge tone="err">{id}?</Badge>;
  const label = `${short(papers[c.paperId])} · ${FIELD_SHORT[c.field] ?? c.field.replace("_", " ")}${c.ofField && c.ofField > 1 ? ` ${c.ordinal}` : ""}`;
  const icon = stale ? <AlertTriangle {...I} /> : c.verified ? <Check {...I} /> : <X {...I} />;
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cx(
          "inline-flex min-h-11 items-center gap-1 rounded-sm border px-2 text-12 font-medium md:min-h-6",
          stale ? "border-warn-line text-warn" : c.verified ? "border-ok-line text-ok" : "border-warn-line text-warn",
        )}
        aria-label={`Evidence: ${label}. ${stale ? "Stale" : c.verified ? `Quote found word for word in the paper${partsSuffix(c)}` : "Quote not found, accepted by you"}. Show the quote.`}
      >
        {icon}
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} className="z-50 w-80 rounded-md border border-line-strong bg-bg-2 p-3 text-12">
          <p className="font-semibold text-fg-0">{c.statement}</p>
          <blockquote className="mt-2 border-l-2 border-line-control pl-2 italic text-fg-1">“{c.quote}”</blockquote>
          <p className="mt-2 flex items-center gap-2 text-fg-2"><QuoteVerdict c={c} stale={stale} /> {c.location}</p>
          {c.verified && !stale && <p className="mt-1 text-fg-2">{FOUND_MEANS}</p>}
          <div className="mt-2 flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => openPaper(c.paperId)}>Open paper</button>
            <button className="btn-ghost btn-sm" onClick={() => canvasStore.getState().pinQuotes(projectId, [c.id])}><Pin className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Pin to canvas</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The matched source passage, with a little context either side. */
export function SourcePassage({ text, start, end, context = 180 }: { text: string; start: number; end: number; context?: number }) {
  const a = Math.max(0, start - context);
  const b = Math.min(text.length, end + context);
  return (
    <p className="whitespace-pre-wrap rounded-sm bg-bg-0 px-3 py-2 font-serif text-14 leading-relaxed text-fg-1">
      {a > 0 && "…"}
      {text.slice(a, start)}
      <mark className="q-active">{text.slice(start, end)}</mark>
      {text.slice(end, b)}
      {b < text.length && "…"}
    </p>
  );
}

export function PinButton({ claimId }: { claimId: string }) {
  const { projectId, ui, announce } = useSession();
  const pinned = ui.pinnedQuotes.includes(claimId);
  return (
    <button
      className="btn-ghost btn-sm"
      aria-pressed={pinned}
      onClick={() => {
        const st = canvasStore.getState();
        if (pinned) st.unpinQuote(projectId, claimId);
        else st.pinQuotes(projectId, [claimId]);
        announce(pinned ? "Quote removed from the canvas." : "Quote pinned to the canvas.");
      }}
    >
      <Pin className="h-3 w-3" strokeWidth={1.5} aria-hidden /> {pinned ? "Unpin" : "Pin to canvas"}
    </button>
  );
}
