"use client";
import { DropdownMenu } from "radix-ui";
import { Lock } from "lucide-react";
import { canvasStore, useCanvas, useSession } from "../session/SessionContext";
import { KindIcon } from "./icons";
import { focusNode } from "./focus";
import { childOptions, siblingOptions } from "@/lib/canvas/actions";

/**
 * "Add" menu for a node (A = child, Shift+A = sibling, or drag from a handle into empty space).
 * Child types are gated by stage: locked options stay listed, dimmed, with the reason spelled out.
 */
export function AddMenu() {
  const menu = useCanvas((s) => s.addMenu);
  const { graph, input, run, announce } = useSession();
  const node = menu ? graph.nodes.find((n) => n.id === menu.nodeId) : null;
  if (!menu || !node) return null;
  const opts = menu.mode === "sibling" ? siblingOptions(node, graph, input) : childOptions(node, graph, input);
  const anchor = menu.at ?? (() => {
    const r = document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`)?.getBoundingClientRect();
    return r ? { x: r.right, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  })();
  const close = () => {
    canvasStore.getState().setAddMenu(null);
    focusNode(node.id);
  };
  return (
    <DropdownMenu.Root open onOpenChange={(o) => !o && close()} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span aria-hidden style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 1, height: 1 }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="right" align="start" sideOffset={8} onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 w-72 rounded-md border border-line-strong bg-bg-2 p-1" aria-label={menu.mode === "sibling" ? "Add a sibling" : "Add a child node"}>
          <DropdownMenu.Label className="px-3 py-2 text-12 text-fg-2">{menu.mode === "sibling" ? "Add a sibling" : `Add after ${node.title.slice(0, 32)}${node.title.length > 32 ? "…" : ""}`}</DropdownMenu.Label>
          {opts.length === 0 && <p className="px-3 py-2 text-fg-2">Nothing can be added here.</p>}
          {opts.map((o) => (
            <DropdownMenu.Item
              key={o.label}
              aria-disabled={o.reason ? true : undefined}
              onSelect={(e) => {
                if (o.reason) {
                  e.preventDefault();
                  announce(`Locked: ${o.reason}`);
                  return;
                }
                canvasStore.getState().setAddMenu(null);
                run(o.cmd, { flowAt: menu.flowAt, from: node.id });
              }}
              className="flex min-h-11 cursor-default items-start gap-3 rounded-sm px-3 py-2 outline-none data-[highlighted]:bg-bg-3"
            >
              <span className={o.reason ? "mt-1 text-fg-2" : "mt-1 text-fg-1"}>{o.reason ? <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <KindIcon kind={o.kind} />}</span>
              <span className="min-w-0">
                <span className={o.reason ? "block text-fg-2" : "block text-fg-0"}>{o.label}</span>
                {o.reason && <span className="block text-12 text-fg-2">{o.reason}</span>}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
