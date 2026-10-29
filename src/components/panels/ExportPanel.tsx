"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Maximize2, Pencil, Printer } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { projectPath, useApi } from "../api";
import { ErrorState, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { canvasStore, useSession } from "../session/SessionContext";
import { PanelFooter, Stat } from "./common";
import { useQuestions } from "./QuestionsPanel";
import { fmtInt } from "@/lib/shared/format";

export const FORMATS = [
  { id: "markdown", label: "Report", ext: "Markdown", open: "plain text with formatting marks such as # for headings; for a formatted copy, open the printable report", help: "Your question, the search strategy, the papers you chose, appraisals with checked quotes, the synthesis and every decision you made." },
  { id: "csv", label: "Spreadsheet of all papers", ext: "CSV", open: "opens in Excel, Numbers or Google Sheets", help: "Every paper found, with its study type, setting and key finding (AI-drafted, plus your corrections)." },
  { id: "bibtex", label: "Reference list", ext: "BibTeX", open: "imports into Zotero, EndNote or Mendeley", help: "The papers you selected for appraisal, ready to cite." },
] as const;

/** A light Markdown preview (headings, bold, lists, paragraphs) so the report reads like a document, not code. */
function MarkdownPreview({ lines }: { lines: string[] }) {
  const inline = (t: string) => t.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => (part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("_") && part.endsWith("_") && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em> : part));
  return (
    <div className="space-y-2 text-14 leading-relaxed text-fg-1">
      {lines.map((l, i) =>
        l.startsWith("### ") ? <h4 key={i} className="pt-2 font-semibold text-fg-0">{inline(l.slice(4))}</h4>
        : l.startsWith("## ") ? <h3 key={i} className="pt-3 text-16 font-semibold text-fg-0">{inline(l.slice(3))}</h3>
        : l.startsWith("# ") ? <h2 key={i} className="text-20 font-semibold text-fg-0">{inline(l.slice(2))}</h2>
        : l.startsWith("- ") ? <p key={i} className="pl-4 -indent-3">• {inline(l.slice(2))}</p>
        : l.startsWith("|") ? <p key={i} className="whitespace-pre font-mono text-12">{l}</p>
        : l.trim() ? <p key={i}>{inline(l)}</p> : null,
      )}
    </div>
  );
}
type Format = (typeof FORMATS)[number]["id"];

/** Format choice, a preview of the actual file, and Download. Shared by the Export node and /s/[id]/export. */
export function ExportView({ full = false }: { full?: boolean }) {
  const { projectId, summary } = useSession();
  const { data } = useQuestions();
  const [format, setFormat] = useState<Format>("markdown");
  const [downloaded, setDownloaded] = useState<Format | null>(null);
  const href = projectPath(projectId, `export/${format}`);
  const fmt = FORMATS.find((f) => f.id === format)!;
  // The first lines of the real file (the server caps the preview; Download gets everything).
  const { data: preview, error: err } = useApi<{ text: string; lines: number }>(`${href}?preview=1`);
  const q = data?.questions.find((x) => x.chosen);
  const lines = preview?.text.split("\n") ?? [];
  const shown = full ? lines : lines.slice(0, 40);
  const total = preview?.lines ?? 0;
  const count = total > shown.length ? ` · first ${shown.length} of ${fmtInt(total)} lines` : "";
  const a = summary?.appraisal;
  return (
    <div className="space-y-4">
      {full && (
        <div>
          <p className="text-12 font-medium text-fg-1">All 9 steps done</p>
          <h2 className="text-28 font-semibold">Your literature review is ready</h2>
          <p className="mt-1 text-fg-1">Download the report to share with your supervisor, the spreadsheet to keep working on the papers, and the reference list for your citation manager.</p>
        </div>
      )}
      {q && (
        <section aria-label="Your research question" className="rounded-md border border-line bg-bg-1 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-12 text-fg-2">Your research question</p>
            {full ? (
              <Link href={`/s/${projectId}?node=questions`} className="btn-ghost btn-sm"><Pencil className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Edit the question</Link>
            ) : (
              <button className="btn-ghost btn-sm" onClick={() => canvasStore.getState().openPanel("questions")}><Pencil className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Edit the question</button>
            )}
          </div>
          <p className="text-16 font-semibold leading-snug">{q.text}</p>
        </section>
      )}
      <RadioGroup.Root value={format} onValueChange={(v) => setFormat(v as Format)} aria-label="Format" className={cx("grid gap-2", full && "sm:grid-cols-3")}>
        {FORMATS.map((f) => (
          <RadioGroup.Item key={f.id} value={f.id} className={cx("flex min-h-11 items-start gap-3 rounded-md border px-3 py-2 text-left", format === f.id ? "border-fg-1 bg-bg-2" : "border-line hover:bg-bg-2")}>
            <span aria-hidden className={cx("mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-control")}>
              <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-fg-0" />
            </span>
            <span>
              <span className="font-medium">{f.label}</span> <span className="text-fg-2">· {f.ext}, {f.open}</span>
              <span className="block text-12 text-fg-1">{f.help}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {/* Phones cannot open Markdown: the same report as a web page, to read, print or save as PDF. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a className="btn-secondary min-h-11" href={projectPath(projectId, "export/html")} target="_blank" rel="noopener">
          <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Open printable report
        </a>
        <span className="text-12 text-fg-2">The report as a web page: read it on any device, print it or save it as PDF.</span>
      </p>
      {full && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-bg-0 px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <a className="btn-primary min-h-11 w-full sm:w-auto" href={href} download onClick={() => setDownloaded(format)}>
            <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download the {fmt.label.toLowerCase()} ({fmt.ext})
          </a>
        </div>
      )}
      <p role="status" className="text-12 text-fg-1 empty:sr-only">{downloaded === format ? `Downloading the ${fmt.label.toLowerCase()} (${fmt.ext}). It will be in your browser’s downloads.` : ""}</p>
      <section aria-label="Preview">
        <div className="mb-2 flex items-center justify-between gap-2">
          {full ? <h2 className="text-12 font-medium text-fg-2">Preview{count}</h2> : <h3 className="text-12 font-medium text-fg-2">Preview{count}</h3>}
          {!full && <Link href={`/s/${projectId}/export`} className="btn-ghost btn-sm"><Maximize2 className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Larger preview</Link>}
        </div>
        {err ? <ErrorState error={err} /> : !preview ? <p className="flex items-center gap-2 text-fg-2"><Spinner /> Loading preview…</p> : (
          format === "markdown" ? (
            <div tabIndex={0} aria-label="Report preview" className={cx("overflow-auto rounded-md border border-line bg-bg-0 p-4", full ? "max-h-[60vh]" : "max-h-72")}><MarkdownPreview lines={shown} /></div>
          ) : (
          <pre tabIndex={0} aria-label={`${fmt.label} preview`} className={cx("overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg-0 p-3 font-mono text-12 text-fg-1", full ? "max-h-[60vh]" : "max-h-72")}>
            {/* Blocks of 20 lines: the browser lays out only the blocks scrolled into view. */}
            {Array.from({ length: Math.ceil(shown.length / 20) }, (_, i) => (
              <span key={i} className="block [content-visibility:auto] [contain-intrinsic-size:auto_20rem]">{shown.slice(i * 20, i * 20 + 20).join("\n")}</span>
            ))}
          </pre>
          )
        )}
      </section>
      <Disclosure title="What the files include">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Unique papers" value={fmtInt(summary?.retrieval.unique ?? 0)} />
          <Stat label="Papers appraised" value={a?.papers ?? 0} />
          <Stat label="Full text / abstract" value={`${a?.fullText ?? 0} / ${(a?.papers ?? 0) - (a?.fullText ?? 0)}`} />
          <Stat label="Quotes found / not found" value={`${a?.verified ?? 0} / ${(a?.pending ?? 0) + (a?.accepted ?? 0) + (a?.rejected ?? 0)}`} />
        </div>
        <p className="mt-2 text-12 text-fg-2">The report includes the full search strategy with dates and counts, every selection you changed, the appraisals with their quotes (and whether each was found in the paper), the synthesis and the decision log, so the review can be reproduced.</p>
      </Disclosure>
      {!full && (
        <PanelFooter>
          <a className="btn-primary" href={href} download onClick={() => setDownloaded(format)}>
            <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download {fmt.ext}
          </a>
        </PanelFooter>
      )}
    </div>
  );
}
