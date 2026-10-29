"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Maximize2 } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { projectPath, useApi } from "../api";
import { ErrorState, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useSession } from "../session/SessionContext";
import { PanelFooter, Stat } from "./common";
import { useQuestions } from "./QuestionsPanel";
import { fmtInt } from "@/lib/shared/format";

export const FORMATS = [
  { id: "markdown", label: "Report", ext: "Markdown", help: "Search strategy, selections, appraisals with verified quotes, synthesis, questions and the decision log." },
  { id: "csv", label: "Summary table", ext: "CSV", help: "Every retrieved paper with its AI-derived and edited summary cells." },
  { id: "bibtex", label: "Selected papers", ext: "BibTeX", help: "The papers selected for appraisal, ready for a reference manager." },
] as const;
type Format = (typeof FORMATS)[number]["id"];

/** Format choice, a preview of the actual file, and Download. Shared by the Export node and /s/[id]/export. */
export function ExportView({ full = false }: { full?: boolean }) {
  const { projectId, summary } = useSession();
  const { data } = useQuestions();
  const [format, setFormat] = useState<Format>("markdown");
  const href = projectPath(projectId, `export/${format}`);
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
      {q && (
        <section aria-label="Your research question">
          <p className="text-12 text-fg-2">Your research question</p>
          <p className="text-16 font-semibold leading-snug">{q.text}</p>
        </section>
      )}
      <RadioGroup.Root value={format} onValueChange={(v) => setFormat(v as Format)} aria-label="Format" className="grid gap-2">
        {FORMATS.map((f) => (
          <RadioGroup.Item key={f.id} value={f.id} className={cx("flex min-h-11 items-start gap-3 rounded-md border px-3 py-2 text-left", format === f.id ? "border-fg-1 bg-bg-2" : "border-line hover:bg-bg-2")}>
            <span aria-hidden className={cx("mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-control")}>
              <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-fg-0" />
            </span>
            <span>
              <span className="font-medium">{f.label}</span> <span className="text-fg-2">· {f.ext}</span>
              <span className="block text-12 text-fg-2">{f.help}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {full && (
        <a className="btn-primary min-h-11" href={href} download>
          <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download {FORMATS.find((f) => f.id === format)!.ext}
        </a>
      )}
      <section aria-label="Preview">
        <div className="mb-2 flex items-center justify-between gap-2">
          {full ? <h2 className="text-12 font-medium text-fg-2">Preview{count}</h2> : <h3 className="text-12 font-medium text-fg-2">Preview{count}</h3>}
          {!full && <Link href={`/s/${projectId}/export`} className="btn-ghost btn-sm"><Maximize2 className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Larger preview</Link>}
        </div>
        {err ? <ErrorState error={err} /> : !preview ? <p className="flex items-center gap-2 text-fg-2"><Spinner /> Loading preview…</p> : (
          <pre tabIndex={0} aria-label={`${FORMATS.find((f) => f.id === format)!.label} preview`} className={cx("overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg-0 p-3 font-mono text-12 text-fg-1", full ? "max-h-[60vh]" : "max-h-72")}>
            {/* Blocks of 20 lines: the browser lays out only the blocks scrolled into view. */}
            {Array.from({ length: Math.ceil(shown.length / 20) }, (_, i) => (
              <span key={i} className="block [content-visibility:auto] [contain-intrinsic-size:auto_20rem]">{shown.slice(i * 20, i * 20 + 20).join("\n")}</span>
            ))}
          </pre>
        )}
      </section>
      <Disclosure title="What the files include">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Unique papers" value={fmtInt(summary?.retrieval.unique ?? 0)} />
          <Stat label="Papers appraised" value={a?.papers ?? 0} />
          <Stat label="Full text / abstract" value={`${a?.fullText ?? 0} / ${(a?.papers ?? 0) - (a?.fullText ?? 0)}`} />
          <Stat label="Quotes verified / not" value={`${a?.verified ?? 0} / ${(a?.pending ?? 0) + (a?.accepted ?? 0) + (a?.rejected ?? 0)}`} />
        </div>
        <p className="mt-2 text-12 text-fg-2">The report includes the full search strategy with dates and counts, every selection you changed, the appraisals with their verified quotes, the synthesis and the decision log, so the review can be reproduced.</p>
      </Disclosure>
      {!full && (
        <PanelFooter>
          <a className="btn-primary" href={href} download>
            <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download {FORMATS.find((f) => f.id === format)!.ext}
          </a>
        </PanelFooter>
      )}
    </div>
  );
}
