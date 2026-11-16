"use client";
import { Suspense, lazy, type ComponentType } from "react";
import { Loading } from "../ui";
import { PageShell } from "../AppChrome";
import { SessionProvider, useSession } from "../session/SessionContext";
import { SessionUnavailable } from "../session/SessionUnavailable";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { stepHref } from "./StageRail";
import type { StepKey } from "@/lib/shared/flow";

/** One file per screen, loaded when its screen opens. (React.lazy, not next/dynamic: the latter adds a preload
 *  element on the server only, which makes every generated id below it differ between server and browser.) */
const STEP_VIEW: Record<StepKey, ComponentType> = {
  idea: lazy(() => import("../steps/IdeaStep").then((m) => ({ default: m.IdeaStep }))),
  question: lazy(() => import("../steps/QuestionStep").then((m) => ({ default: m.QuestionStep }))),
  search: lazy(() => import("../steps/SearchStep").then((m) => ({ default: m.SearchStep }))),
  found: lazy(() => import("../steps/FoundStep").then((m) => ({ default: m.FoundStep }))),
  choose: lazy(() => import("../steps/ChooseStep").then((m) => ({ default: m.ChooseStep }))),
  articles: lazy(() => import("../steps/ArticlesStep").then((m) => ({ default: m.ArticlesStep }))),
  evidence: lazy(() => import("../steps/EvidenceStep").then((m) => ({ default: m.EvidenceStep }))),
  report: lazy(() => import("../steps/ReportStep").then((m) => ({ default: m.ReportStep }))),
};

/** A review: /s/[id], optionally ?step=<StepKey>. With no ?step it opens the screen that needs the user. */
export function Workspace({ projectId }: { projectId: string }) {
  return (
    <SessionProvider projectId={projectId} fallback={(s) => (s ? <SessionUnavailable error={s.error} retry={s.retry} /> : <PageShell><Loading label="Opening your review…" /></PageShell>)}>
      <OpenStep />
    </SessionProvider>
  );
}

function OpenStep() {
  const { projectId, project, states, step } = useSession();
  const View = STEP_VIEW[step];
  return (
    <WorkspaceLayout rail={{ states, open: step, hrefFor: stepHref(projectId, states), name: (project.question ?? "").trim() || project.idea }}>
      <Suspense fallback={<div className="px-4 py-10 md:px-10"><Loading /></div>}>
        <View key={step} />
      </Suspense>
    </WorkspaceLayout>
  );
}
