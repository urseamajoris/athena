"use client";
import { StepFrame } from "../workspace";
import { SynthesisPanel } from "../panels/SynthesisPanel";

/** Stage 4, evidence summary. Hosts panels/SynthesisPanel (known, contested, unknown, and the evidence matrix). */
export function EvidenceStep() {
  return (
    <StepFrame step="evidence" width="wide">
      <SynthesisPanel />
    </StepFrame>
  );
}
