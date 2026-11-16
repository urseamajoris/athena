"use client";
import { StepActions, StepFrame, useSession } from "../workspace";
import { TableView } from "../table/TableView";

/** Stage 3, choose papers. Hosts table/TableView (every paper summarised and ranked; tick the ones to analyse). */
export function ChooseStep() {
  const { actionFor } = useSession();
  return (
    <StepFrame step="choose" width="wide">
      {/* The table scrolls its own rows inside this box, with its header kept in view. */}
      <div className="h-[80dvh] min-h-[32rem] overflow-hidden rounded-md border border-line bg-bg-1">
        <TableView />
      </div>
      <StepActions action={actionFor("choose")} />
    </StepFrame>
  );
}
