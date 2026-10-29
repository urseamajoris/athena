"use client";
import { useEffect, useState } from "react";
import { FlaskConical, X } from "lucide-react";
import { useApi } from "../api";

const KEY = "athena-demo-banner-dismissed";

/** The note's button is about to disappear: move focus to the next control after the note, where Tab would go. */
function focusAfter(el: HTMLElement) {
  const next = [...document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")]
    .find((x) => !el.parentElement?.contains(x) && el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING && x.offsetParent !== null);
  next?.focus();
}

/** Demo (mock) mode, said once in plain words: why results do not match the user's topic, and that nothing is charged. */
export function DemoBanner() {
  const { data } = useApi<{ mockMode: boolean }>("/api/status");
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (!data?.mockMode || hidden) return null;
  return (
    <div role="note" className="flex items-start gap-2 border-b border-line bg-bg-1 px-4 py-2 text-12 text-fg-1 short:items-center short:py-0.5">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-fg-1 short:mt-0" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold text-fg-0">Demo mode.</strong>{" "}
        {/* On short screens (high zoom) one line, so the page keeps its working area. */}
        <span className="short:hidden">The AI is scripted and the databases return recorded sample papers (on telemedicine in Southeast Asia), so results will not match your topic. AI text is marked “(mock)”. Nothing is charged.</span>
        <span className="hidden short:inline">Scripted AI and sample papers (not your topic). Nothing is charged.</span>
      </p>
      <button className="btn-ghost h-8 w-8 shrink-0 px-0" aria-label="Hide this note" onClick={(e) => { try { localStorage.setItem(KEY, "1"); } catch {} focusAfter(e.currentTarget); setHidden(true); }}>
        <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
