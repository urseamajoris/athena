"use client";
import { useState } from "react";
import { AlertTriangle, Check, Pin, UserCheck, X } from "lucide-react";
import { Collapsible, Popover } from "radix-ui";
import { Badge, cx } from "../ui";
import { canvasStore, useSession } from "../session/SessionContext";
import { shortCite } from "@/lib/shared/stages";
import { partsLabel, plainNote } from "@/lib/quotes";

export interface ClaimRef { id: string; paperId: string; field: string; statement: string; quote: string; location: string; verified: boolean; userAccepted: boolean; userRejected?: boolean; ordinal?: number; ofField?: number }
export interface PaperRef { id: string; title: string; year: number | null; authors: string[]; studyType?: string | null }

const I = { className: "h-3 w-3", strokeWidth: 2, "aria-hidden": true } as const;

/** What the ✓ badge means, in one line: shown wherever the verdict badges are explained. */
export const FOUND_MEANS = "“Words are in the paper” only means Athena found these exact words in the paper. It does not show that the answer is right.";
/** The user's part, next to every explanation of the badge: the check cannot judge meaning. */
export const judgeLine = (of: "answer" | "statement" = "answer") => `Read the quote and judge for yourself whether it supports the ${of}.`;

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
  if (c.verified && parts) return <Badge state tone="ok" icon={<Check {...I} />} title={`The quote joins separate passages with "…", and each part is in the paper word for word. The highlighted passage is the first part. ${FOUND_MEANS}`}>words are in the paper{parts}</Badge>;
  if (c.verified) return <Badge state tone="ok" icon={<Check {...I} />} title={`The quote is in the paper word for word. ${FOUND_MEANS}`}>words are in the paper</Badge>;
  if (c.userAccepted) return <Badge state icon={<UserCheck {...I} />} title="The check did not find these exact words; you said the paper does say this. It is used like a quote whose words are in the paper.">accepted by you</Badge>;
  if (c.userRejected) return <Badge state icon={<X {...I} />} title="Left out of the synthesis">rejected by you</Badge>;
  return <Badge state tone="err" icon={<X {...I} />} title="The check could not find these words in the paper: accept or reject the quote">not found, you decide</Badge>;
}

/** The verdict badges, explained once with the badges themselves (the same component as on every quote). */
export function VerdictLegend({ of = "answer" }: { of?: "answer" | "statement" }) {
  const v = { verified: false, userAccepted: false };
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <QuoteVerdict c={{ ...v, verified: true }} />
      {/* The synthesis uses only quotes whose words are in the paper or that you accepted. */}
      {of === "answer" && <QuoteVerdict c={v} />}
      <QuoteVerdict c={{ ...v, userAccepted: true }} />
      <span>(used like “words are in the paper”). {FOUND_MEANS} {judgeLine(of)}</span>
    </span>
  );
}

/**
 * Why a quote was not found: one plain sentence, and the check's technical note (which part, the closest passage)
 * behind "Show detail".
 */
export function CheckNote({ note, muted }: { note: string | null; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const { lead, detail } = plainNote(note);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={cx("mt-1 text-12", muted ? "text-fg-2" : "text-err")}>
      <p className="flex flex-wrap items-center gap-x-2">
        <span>{lead}</span>
        {detail && <Collapsible.Trigger className="btn-ghost btn-sm">{open ? "Hide detail" : "Show detail"}</Collapsible.Trigger>}
      </p>
      {detail && <Collapsible.Content className="mt-1 text-fg-1">{detail}</Collapsible.Content>}
    </Collapsible.Root>
  );
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
  // Accepted quotes count like found ones, so they get the legend's "accepted by you" icon, not the ✗.
  const icon = stale ? <AlertTriangle {...I} /> : c.verified ? <Check {...I} /> : c.userAccepted ? <UserCheck {...I} /> : <X {...I} />;
  const said = stale ? "Stale" : c.verified ? `The words are in the paper${partsSuffix(c)}` : c.userAccepted ? "Not found in the paper, accepted by you" : c.userRejected ? "Rejected by you" : "Not found, you decide";
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cx(
          "inline-flex min-h-11 items-center gap-1 rounded-sm border px-2 text-12 font-medium md:min-h-6",
          stale ? "border-warn-line text-warn" : c.verified ? "border-ok-line text-ok" : c.userAccepted ? "border-line-strong text-fg-1" : c.userRejected ? "border-line text-fg-2" : "border-err-line text-err",
        )}
        aria-label={`Evidence: ${label}. ${said}. Show the quote.`}
      >
        {icon}
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} className="z-50 w-80 rounded-md border border-line-strong bg-bg-2 p-3 text-12">
          <p className="font-semibold text-fg-0">{c.statement}</p>
          <blockquote className="mt-2 border-l-2 border-line-control pl-2 italic text-fg-1">“{c.quote}”</blockquote>
          <p className="mt-2 flex items-center gap-2 text-fg-2"><QuoteVerdict c={c} stale={stale} /> {c.location}</p>
          {(c.verified || c.userAccepted) && !stale && <p className="mt-1 text-fg-2">{c.verified ? `${FOUND_MEANS} ` : ""}{judgeLine("statement")}</p>}
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
