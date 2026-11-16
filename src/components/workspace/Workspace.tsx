"use client";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Loading } from "../ui";
import { PageShell } from "../AppChrome";
import { SessionProvider, useSession } from "../session/SessionContext";
import { SessionUnavailable } from "../session/SessionUnavailable";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { stepHref } from "./StageRail";
import type { StepKey } from "@/lib/shared/flow";

const loading = () => <div className="px-4 py-10 md:px-10"><Loading /></div>;
/** One file per screen, loaded when its screen opens. */
const STEP_VIEW: Record<StepKey, ComponentType> = {
  idea: dynamic(() => import("../steps/IdeaStep").then((m) => m.IdeaStep), { loading }),
  question: dynamic(() => import("../steps/QuestionStep").then((m) => m.QuestionStep), { loading }),
  search: dynamic(() => import("../steps/SearchStep").then((m) => m.SearchStep), { loading }),
  found: dynamic(() => import("../steps/FoundStep").then((m) => m.FoundStep), { loading }),
  choose: dynamic(() => import("../steps/ChooseStep").then((m) => m.ChooseStep), { loading }),
  articles: dynamic(() => import("../steps/ArticlesStep").then((m) => m.ArticlesStep), { loading }),
  evidence: dynamic(() => import("../steps/EvidenceStep").then((m) => m.EvidenceStep), { loading }),
  report: dynamic(() => import("../steps/ReportStep").then((m) => m.ReportStep), { loading }),
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
      <View key={step} />
    </WorkspaceLayout>
  );
}
