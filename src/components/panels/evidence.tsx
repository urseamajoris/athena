"use client";
import { AlertTriangle, Check, Pin, X } from "lucide-react";
import { Popover } from "radix-ui";
import { Badge, cx } from "../ui";
import { canvasStore, useSession } from "../session/SessionContext";
import { shortCite } from "@/lib/shared/stages";

export interface ClaimRef { id: string; paperId: string; field: string; statement: string; quote: string; location: string; verified: boolean; userAccepted: boolean; userRejected?: boolean; ordinal?: number; ofField?: number }
export interface PaperRef { id: string; title: string; year: number | null; authors: string[] }

const I = { className: "h-3 w-3", strokeWidth: 2, "aria-hidden": true } as const;

/** Verification verdict, always visible and never colour-only (icon + text). */
export function QuoteVerdict({ c, stale }: { c: { verified: boolean; userAccepted: boolean; userRejected?: boolean }; stale?: boolean }) {
  if (stale) return <Badge state tone="warn" icon={<AlertTriangle {...I} />}>stale</Badge>;
  if (c.verified) return <Badge state tone="ok" icon={<Check {...I} />}>verified</Badge>;
  if (c.userAccepted) return <Badge state tone="warn" icon={<Check {...I} />}>unverified · accepted</Badge>;
  if (c.userRejected) return <Badge state icon={<X {...I} />}>rejected by you</Badge>;
  return <Badge state tone="err" icon={<X {...I} />}>unverified</Badge>;
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
        aria-label={`Evidence: ${label}. ${stale ? "Stale" : c.verified ? "Quote verified" : "Unverified, accepted by you"}. Show the quote.`}
      >
        {icon}
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} className="z-50 w-80 rounded-md border border-line-strong bg-bg-2 p-3 text-12">
          <p className="font-semibold text-fg-0">{c.statement}</p>
          <blockquote className="mt-2 border-l-2 border-line-control pl-2 italic text-fg-1">“{c.quote}”</blockquote>
          <p className="mt-2 flex items-center gap-2 text-fg-2"><QuoteVerdict c={c} stale={stale} /> {c.location}</p>
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
