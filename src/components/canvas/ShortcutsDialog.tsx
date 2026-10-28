"use client";
import { Kbd, Modal } from "../ui";

export const SHORTCUTS: [string[], string][] = [
  [["Enter"], "Open the selected node (accept a suggested subtopic)"],
  [["Esc"], "Close the panel (dismiss a suggested subtopic)"],
  [["←", "→"], "Move to the parent / child node"],
  [["↑", "↓"], "Move between nodes of the same kind"],
  [["A"], "Add a child node"],
  [["Shift", "A"], "Add a sibling (topics)"],
  [["⌘", "↵"], "Run the selected node's next action"],
  [["1", "–", "9"], "Jump to a stage"],
  [["F"], "Fit the view"],
  [["M"], "Show or hide the minimap"],
  [["L"], "Switch between canvas and list view"],
  [["/"], "Command palette (also ⌘K)"],
  [["?"], "This list"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" footer={<button className="btn-secondary" onClick={onClose}>Close</button>}>
      <p className="mb-3">Tab moves into and out of the canvas; inside it, the arrow keys move along the connections.</p>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={what} className="contents">
            <dt className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
