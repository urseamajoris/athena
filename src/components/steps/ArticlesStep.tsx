"use client";
import { StepFrame } from "../workspace";
import { AppraisalPanel } from "../panels/AppraisalPanel";

/** Stage 4, article analysis. Hosts panels/AppraisalPanel (one article at a time, with its checked quotes). */
export function ArticlesStep() {
  return (
    <StepFrame step="articles" width="wide">
      <AppraisalPanel />
    </StepFrame>
  );
}
