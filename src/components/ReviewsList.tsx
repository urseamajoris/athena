"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api, useApi } from "./api";
import { PageHeader, PageShell } from "./AppChrome";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Loading, ProgressBar, StepStatusLabel } from "./ui";
import { MoreMenu, Modal } from "./overlays";
import { currentStep, phaseLabel, progress, stepStatus } from "@/lib/shared/flow";
import type { StageState } from "@/lib/shared/stages";
import { relTime } from "@/lib/shared/format";

interface ReviewRow {
  id: string;
  title: string;
  idea: string;
  /** The working research question, once there is one. */
  question?: string | null;
  status?: string;
  stageStates: Record<string, StageState>;
  createdAt: string;
  updatedAt: string;
}

const nameOf = (p: ReviewRow) => (p.question ?? "").trim() || p.idea || p.title;

/** My reviews: one card per review (where it is, how far, Continue), and one primary action: start a new one. */
export function ReviewsList() {
  const { data, error, mutate } = useApi<{ projects: ReviewRow[] }>("/api/projects");
  const [confirm, setConfirm] = useState<ReviewRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const rows = data?.projects ?? [];

  async function remove() {
    if (!confirm) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/api/projects/${confirm.id}`, { method: "DELETE" });
      setConfirm(null);
      await mutate();
    } catch (e) {
      setDeleteError(e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="My reviews"
        lead="Each review goes from a rough idea to a finished report in four stages. Continue one where you left it, or start a new one."
        action={<ButtonLink variant="primary" href="/s/new" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />}>Start a new review</ButtonLink>}
      />
      <div className="mt-8">
        {!data && !error && <Loading label="Loading your reviews…" />}
        {error && <ErrorState error={error} onRetry={() => mutate()} title="Your reviews could not load" />}
        {data && rows.length === 0 && (
          <EmptyState title="You have no reviews yet">
            A review starts with a rough idea: one sentence is enough. Use “Start a new review” above.
          </EmptyState>
        )}
        <ul className="space-y-4">
          {rows.map((p) => {
            const step = currentStep(p.stageStates);
            const status = stepStatus(step, p.stageStates);
            const { done, total } = progress(p.stageStates);
            const finished = done === total;
            const name = nameOf(p);
            return (
              <Card as="li" key={p.id} className="flex flex-wrap items-center gap-x-8 gap-y-4" >
                <div className="min-w-0 flex-1 basis-80">
                  <h2 className="line-clamp-2 font-semibold text-fg-0">{name}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-1">
                    <span>{finished ? "Finished: your report is ready" : `${phaseLabel(step.key)}: ${step.title}`}</span>
                    {!finished && <StepStatusLabel status={status} />}
                  </p>
                  <div className="mt-3 flex max-w-md items-center gap-3">
                    <ProgressBar value={done} max={total} label={`Progress of ${name}`} />
                    <span className="shrink-0 text-small tabular-nums text-fg-2">{done} of {total} steps done</span>
                  </div>
                  <p className="mt-2 text-small text-fg-2" suppressHydrationWarning>Last changed {relTime(p.updatedAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <MoreMenu label={`More actions for the review: ${name}`} items={[{ label: "Delete this review", danger: true, onSelect: () => { setDeleteError(null); setConfirm(p); } }]} />
                  <ButtonLink href={`/s/${p.id}`} aria-label={`${finished ? "Open" : "Continue"} the review: ${name}`}>{finished ? "Open" : "Continue"}</ButtonLink>
                </div>
              </Card>
            );
          })}
        </ul>
      </div>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this review?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="danger" onClick={remove} busy={deleting}>Delete review</Button>
          </>
        }
      >
        <p>“{confirm ? nameOf(confirm) : ""}” and everything in it (papers, article analyses, the evidence summary and the decision log) will be deleted. This cannot be undone.</p>
        {deleteError ? <p role="alert" className="mt-2 font-medium text-err">{deleteError instanceof Error ? deleteError.message : String(deleteError)}</p> : null}
      </Modal>
    </PageShell>
  );
}
