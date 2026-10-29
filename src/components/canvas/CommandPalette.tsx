"use client";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { Search } from "lucide-react";
import { api, projectPath } from "../api";
import { canvasStore, useSession } from "../session/SessionContext";
import { KindIcon } from "./icons";
import { focusNode } from "./focus";
import { KIND_LABEL, anyStale, frontierStage, nodeForStage } from "@/lib/canvas/graph";
import { stageAction } from "@/lib/canvas/actions";
import { STAGES } from "@/lib/shared/stages";
import { applyThemePref } from "@/lib/theme";

interface Cmd { id: string; label: string; group: string; hint?: string; run: () => void; disabled?: string }

/** ⌘K: every secondary command, searchable. Loaded the first time it opens. */
export default function CommandPalette({ open, onClose, onFit, onShortcuts }: { open: boolean; onClose: () => void; onFit: () => void; onShortcuts: () => void }) {
  const router = useRouter();
  const { graph, input, states, projectId, run, refresh, claims, ui } = useSession();
  const st = canvasStore.getState();
  const go = (id: string) => {
    st.openPanel(id);
    focusNode(id);
  };
  const next = stageAction(frontierStage(states), input);
  const cmds: Cmd[] = [
    ...(next ? [{ id: "next", label: next.label, group: "Next step", hint: "⌘↵", run: () => run(next.cmd), disabled: next.disabledReason }] : []),
    ...(anyStale(states) ? [{ id: "rerun", label: "Re-run downstream", group: "Next step", run: () => run({ type: "rerunDownstream" }) }] : []),
    ...STAGES.map((s) => ({ id: `stage-${s.n}`, label: `Go to ${s.n}. ${s.title}`, group: "Stages", hint: String(s.n), run: () => { const id = nodeForStage(graph, s.n); if (id) go(id); } })),
    ...graph.nodes.map((n) => ({ id: `node-${n.id}`, label: `Open ${KIND_LABEL[n.kind]}: ${n.title.slice(0, 80)}`, group: "Nodes", run: () => go(n.id) })),
    { id: "fit", label: "Fit the view", group: "View", hint: "F", run: onFit },
    { id: "list", label: ui.view === "list" ? "Switch to the canvas" : "Switch to the list view", group: "View", hint: "L", run: () => st.setView(projectId, ui.view === "list" ? "canvas" : "list") },
    { id: "minimap", label: ui.minimap ? "Hide the minimap" : "Show the minimap", group: "View", hint: "M", run: () => st.toggleMinimap(projectId) },
    { id: "reset", label: "Tidy layout (forget hand-placed positions)", group: "View", run: () => st.resetLayout(projectId) },
    { id: "pin-all", label: "Pin every quote to the canvas", group: "Evidence", run: () => claims && st.pinQuotes(projectId, claims.map((c) => c.id)), disabled: graph.nodes.some((n) => n.id === "appraisal") ? undefined : "No appraisals yet" },
    { id: "unpin-all", label: "Remove all pinned quotes", group: "Evidence", run: () => ui.pinnedQuotes.forEach((c) => st.unpinQuote(projectId, c)), disabled: ui.pinnedQuotes.length ? undefined : "Nothing pinned" },
    { id: "reverify", label: "Re-check all quotes against their sources", group: "Evidence", hint: "no AI cost", run: async () => { await api(projectPath(projectId, "appraisals/reverify"), { body: {} }); await refresh(); }, disabled: graph.nodes.some((n) => n.id === "appraisal") ? undefined : "No appraisals yet" },
    { id: "add-topic", label: "Add a topic", group: "Edit", run: () => run({ type: "addTopic" }), disabled: states["1"] === "approved" ? undefined : "Start scoping first" },
    { id: "table", label: "Open the full summary table", group: "Go to", run: () => router.push(`/s/${projectId}/table`), disabled: graph.nodes.some((n) => n.id === "table") ? undefined : "No table yet" },
    { id: "export", label: "Open the export preview", group: "Go to", run: () => router.push(`/s/${projectId}/export`) },
    { id: "md", label: "Download the report (Markdown)", group: "Export", run: () => window.location.assign(projectPath(projectId, "export/markdown")) },
    { id: "csv", label: "Download the summary table (CSV)", group: "Export", run: () => window.location.assign(projectPath(projectId, "export/csv")) },
    { id: "bib", label: "Download the selected papers (BibTeX)", group: "Export", run: () => window.location.assign(projectPath(projectId, "export/bibtex")) },
    { id: "sessions", label: "All sessions", group: "Go to", run: () => router.push("/sessions") },
    { id: "new", label: "New session", group: "Go to", run: () => router.push("/s/new") },
    { id: "settings", label: "Settings", group: "Go to", run: () => router.push("/settings") },
    { id: "dark", label: "Theme: dark", group: "Theme", run: () => applyThemePref("dark") },
    { id: "light", label: "Theme: light", group: "Theme", run: () => applyThemePref("light") },
    { id: "system", label: "Theme: match the system", group: "Theme", run: () => applyThemePref("system") },
    { id: "keys", label: "Keyboard shortcuts", group: "Help", hint: "?", run: onShortcuts },
  ];
  const groups = [...new Set(cmds.map((c) => c.group))];
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-md border border-line-strong bg-bg-1">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Commands" loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="h-4 w-4 text-fg-2" strokeWidth={1.5} aria-hidden />
              <Command.Input autoFocus placeholder="Type a command or a node…" className="h-12 w-full bg-transparent text-fg-0 outline-none placeholder:text-fg-2" />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-4 text-fg-2">No matching command.</Command.Empty>
              {groups.map((g) => (
                <Command.Group key={g} heading={g} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-12 [&_[cmdk-group-heading]]:text-fg-2">
                  {cmds.filter((c) => c.group === g).map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`${c.label} ${c.id}`}
                      disabled={!!c.disabled}
                      onSelect={() => {
                        onClose();
                        c.run();
                      }}
                      className="flex min-h-11 cursor-default items-center gap-3 rounded-sm px-3 py-2 text-fg-0 data-[disabled=true]:text-fg-2 data-[selected=true]:bg-bg-3"
                    >
                      {c.id.startsWith("node-") ? <KindIcon kind={graph.nodes.find((n) => `node-${n.id}` === c.id)!.kind} /> : null}
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.disabled ? <span className="text-12 text-fg-2">{c.disabled}</span> : c.hint ? <span className="text-12 text-fg-2">{c.hint}</span> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
