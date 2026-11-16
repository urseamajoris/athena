"use client";
import { Section, StepFrame, useSession } from "../workspace";
import { QuestionsPanel } from "../panels/QuestionsPanel";
import { ExportView } from "../panels/ExportPanel";

/**
 * Stage 4, final question and report. Hosts panels/QuestionsPanel (keep the question or take a revision) and,
 * once the question is settled, panels/ExportPanel (the downloads).
 */
export function ReportStep() {
  const { states } = useSession();
  const settled = states["9"] === "approved";
  return (
    <StepFrame step="report" width="wide">
      <Section title="Your research question">
        <QuestionsPanel />
      </Section>
      {settled && (
        <Section title="Download your review">
          <ExportView />
        </Section>
      )}
    </StepFrame>
  );
}
