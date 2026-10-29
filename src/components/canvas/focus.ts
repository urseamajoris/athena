/** Move keyboard focus to a node card (after React has rendered it). */
export function focusNode(id: string) {
  requestAnimationFrame(() => (document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus({ preventScroll: true }));
}

/** Imperative canvas commands, registered by the canvas while it is mounted (no-ops in List view). */
export const canvasCommands = { fit: () => {} };
