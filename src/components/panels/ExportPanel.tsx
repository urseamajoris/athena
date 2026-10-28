"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Maximize2 } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { projectPath } from "../api";
import { Disclosure, ErrorState, Spinner, cx } from "../ui";
import { useSession } from "../session/SessionContext";
import { PanelFooter, Stat } from "./common";
import { useQuestions } from "./QuestionsPanel";

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
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const href = projectPath(projectId, `export/${format}`);
  useEffect(() => {
    let alive = true;
    setPreview(null);
    setErr(null);
    fetch(href)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Preview failed (${r.status})`);
        const t = await r.text();
        if (alive) setPreview(t);
      })
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [href]);
  const q = data?.questions.find((x) => x.chosen);
  const lines = preview?.split("\n") ?? [];
  const shown = full ? lines : lines.slice(0, 40);
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
      <section aria-label="Preview">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-12 font-medium text-fg-2">Preview{!full && lines.length > 40 ? ` · first 40 of ${lines.length} lines` : ""}</h3>
          {!full && <Link href={`/s/${projectId}/export`} className="btn-ghost btn-sm"><Maximize2 className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Full preview</Link>}
        </div>
        {err ? <ErrorState error={err} /> : preview === null ? <p className="flex items-center gap-2 text-fg-2"><Spinner /> Loading preview…</p> : (
          <pre tabIndex={0} aria-label={`${FORMATS.find((f) => f.id === format)!.label} preview`} className={cx("overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg-0 p-3 font-mono text-12 text-fg-1", full ? "max-h-[60vh]" : "max-h-72")}>{shown.join("\n")}</pre>
        )}
      </section>
      <Disclosure title="What the files include">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Unique papers" value={(summary?.retrieval.unique ?? 0).toLocaleString()} />
          <Stat label="Papers appraised" value={a?.papers ?? 0} />
          <Stat label="Full text / abstract" value={`${a?.fullText ?? 0} / ${(a?.papers ?? 0) - (a?.fullText ?? 0)}`} />
          <Stat label="Quotes verified / not" value={`${a?.verified ?? 0} / ${(a?.pending ?? 0) + (a?.accepted ?? 0) + (a?.rejected ?? 0)}`} />
        </div>
        <p className="mt-2 text-12 text-fg-2">The report includes the full search strategy with dates and counts, every selection you changed, the appraisals with their verified quotes, the synthesis and the decision log, so the review can be reproduced.</p>
      </Disclosure>
      <PanelFooter>
        <a className="btn-primary" href={href} download>
          <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download {FORMATS.find((f) => f.id === format)!.ext}
        </a>
      </PanelFooter>
    </div>
  );
}
