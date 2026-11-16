"use client";
import { StepFrame } from "../workspace";
import { CorpusPanel } from "../panels/CorpusPanel";

/** Stage 3, papers found. Hosts panels/CorpusPanel (the searches as they run, then what came back). */
export function FoundStep() {
  return (
    <StepFrame step="found" width="wide">
      <CorpusPanel />
    </StepFrame>
  );
}
