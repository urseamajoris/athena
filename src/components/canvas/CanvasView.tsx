"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useReducedMotion } from "motion/react";
import { Map as MapIcon, Maximize, Minus, Plus } from "lucide-react";
import { canvasStore, useCanvas, useSession } from "../session/SessionContext";
import { NodeCard, type FlowNode, type NodeData } from "./NodeCard";
import { AddMenu } from "./AddMenu";
import { canvasCommands, focusNode } from "./focus";
import { nextAction } from "@/lib/canvas/actions";
import { frontierNodeId, type GNode, type Graph } from "@/lib/canvas/graph";
import { NODE_H, NODE_W, QUOTE_H, elkLayout, layeredLayout, withPinned, type Positions } from "@/lib/canvas/layout";

const nodeTypes = { athena: NodeCard };
export const PANEL_W = { md: 480, xl: 560 };

/** Neighbours for arrow-key navigation along the graph. */
export function neighbour(graph: Graph, id: string, key: string): string | null {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) return null;
  if (key === "ArrowLeft") return n.parents[0] ?? null;
  if (key === "ArrowRight") return graph.edges.find((e) => e.source === id)?.target ?? null;
  const list = graph.nodes.filter((x) => x.kind === n.kind);
  const i = list.findIndex((x) => x.id === id);
  if (key === "ArrowUp") return i > 0 ? list[i - 1].id : null;
  if (key === "ArrowDown") return i >= 0 && i < list.length - 1 ? list[i + 1].id : null;
  return null;
}


function shapeKey(g: Graph) {
  return g.nodes.map((n) => n.id).join("|") + "#" + g.edges.map((e) => e.id).join("|");
}

function Canvas({ readOnly }: { readOnly: boolean }) {
  const { graph, input, ui, projectId, run, states } = useSession();
  const selected = useCanvas((s) => s.selected);
  const panel = useCanvas((s) => s.panel);
  const rf = useReactFlow<FlowNode>();
  const reduced = useReducedMotion();
  const shape = shapeKey(graph);

  // Layout: synchronous layered layout first, elkjs refinement once it has loaded.
  const auto = useMemo(() => layeredLayout(graph.nodes), [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  const [elk, setElk] = useState<{ shape: string; pos: Positions } | null>(null);
  useEffect(() => {
    let alive = true;
    const go = () =>
      elkLayout(graph.nodes, graph.edges)
        .then((pos) => alive && setElk({ shape, pos }))
        .catch(() => {});
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(go);
    else setTimeout(go, 50);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  const positions = useMemo(() => withPinned(elk?.shape === shape ? elk.pos : auto, ui.pinned), [elk, shape, auto, ui.pinned]);

  // Nodes present at first render do not animate in; later ones spring out of their parent.
  const known = useRef<Set<string> | null>(null);
  const born = useRef(new Map<string, { dx: number; dy: number } | null>());
  if (!known.current) {
    known.current = new Set(graph.nodes.map((n) => n.id));
    const intro = canvasStore.getState().intro;
    if (intro && !reduced) {
      known.current.delete(intro);
      born.current.set(intro, { dx: 0, dy: 96 });
    }
    canvasStore.getState().setIntro(null);
  }
  for (const n of graph.nodes) {
    if (born.current.has(n.id)) continue;
    if (known.current.has(n.id)) born.current.set(n.id, null);
    else {
      const p = positions[n.parents[0]];
      const me = positions[n.id];
      born.current.set(n.id, p && me && !reduced ? { dx: p.x - me.x, dy: p.y - me.y } : null);
    }
  }

  const frontier = frontierNodeId(graph, states);
  const tabbable = selected && graph.nodes.some((n) => n.id === selected) ? selected : frontier;
  const cache = useRef(new Map<string, { key: string; node: FlowNode }>());
  const flowNodes = useMemo(() => {
    const next = new Map<string, { key: string; node: FlowNode }>();
    const out = graph.nodes.map((n) => {
      const action = nextAction(n, graph, input);
      const data: NodeData = { node: n, action, primary: !!action && !panel && n.id === frontier && !n.ghost, selected: n.id === selected, tabbable: n.id === tabbable, readOnly, spawn: born.current.get(n.id) ?? null };
      const pos = positions[n.id] ?? { x: 0, y: 0 };
      const key = JSON.stringify([n, action, data.primary, data.selected, data.tabbable, readOnly, pos.x, pos.y]);
      const prev = cache.current.get(n.id);
      const node: FlowNode =
        prev && prev.key === key
          ? prev.node
          : { id: n.id, type: "athena", position: pos, data, draggable: !readOnly, connectable: !readOnly, selectable: false, focusable: false, width: NODE_W, height: n.kind === "quote" ? QUOTE_H : NODE_H, ...(prev?.node.measured ? { measured: prev.node.measured } : {}) };
      next.set(n.id, { key, node });
      return node;
    });
    cache.current = next;
    return out;
  }, [graph, input, panel, frontier, selected, tabbable, readOnly, positions]);

  // Controlled nodes; drag moves are applied locally and pinned on drop.
  const [nodes, setNodes] = useState<FlowNode[]>(flowNodes);
  useEffect(() => setNodes(flowNodes), [flowNodes]);
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((nds) => {
      const byId = new Map(nds.map((n) => [n.id, n]));
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          const n = byId.get(c.id);
          if (n) byId.set(c.id, { ...n, position: c.position, dragging: c.dragging });
        } else if (c.type === "dimensions" && c.dimensions) {
          const n = byId.get(c.id);
          if (n) byId.set(c.id, { ...n, measured: c.dimensions });
        }
      }
      return nds.map((n) => byId.get(n.id)!);
    });
  }, []);

  const edges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, className: e.running ? "running" : undefined, focusable: false, selectable: false, animated: false })),
    [graph.edges],
  );

  // Keep the selected node visible next to the Focus panel.
  useEffect(() => {
    if (!panel) return;
    const p = positions[panel];
    if (!p) return;
    const { zoom } = rf.getViewport();
    const panelW = readOnly ? 0 : window.innerWidth >= 1280 ? PANEL_W.xl : PANEL_W.md;
    const h = panel.startsWith("quote:") ? QUOTE_H : NODE_H;
    rf.setCenter(p.x + NODE_W / 2 + panelW / 2 / zoom, p.y + h / 2, { zoom, duration: reduced ? 0 : 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // Whatever selects a node (arrows, 1–9, rail, palette), pan it into view if it is off-screen.
  useEffect(() => {
    if (!selected || panel) return;
    const p = positions[selected];
    if (!p) return;
    const vp = rf.getViewport();
    const el = document.querySelector(".react-flow") as HTMLElement | null;
    const w = el?.clientWidth ?? window.innerWidth;
    const hgt = el?.clientHeight ?? window.innerHeight;
    const sx = p.x * vp.zoom + vp.x;
    const sy = p.y * vp.zoom + vp.y;
    if (sx < 0 || sy < 0 || sx + NODE_W * vp.zoom > w || sy + NODE_H * vp.zoom > hgt) rf.setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, { zoom: Math.max(vp.zoom, 0.6), duration: reduced ? 0 : 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    canvasCommands.fit = () => rf.fitView({ padding: 0.2, maxZoom: 1, duration: reduced ? 0 : 180 });
    return () => {
      canvasCommands.fit = () => {};
    };
  }, [rf, reduced]);

  const goToNode = useCallback((id: string) => {
    canvasStore.getState().select(id);
    focusNode(id);
  }, []);

  // Keyboard on nodes (global shortcuts live in the session shell).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const el = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
      if (!el) return;
      const id = el.dataset.nodeId!;
      const onCard = e.target === el;
      const n = graph.nodes.find((x) => x.id === id);
      if (!n) return;
      if (e.key.startsWith("Arrow") && onCard) {
        const to = neighbour(graph, id, e.key);
        e.preventDefault();
        if (to) goToNode(to);
        return;
      }
      if (e.key === "Enter" && onCard && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const a = nextAction(n, graph, input);
        if (a && !a.disabledReason) run(a.cmd);
        return;
      }
      if (e.key === "Enter" && onCard) {
        e.preventDefault();
        if (n.ghost) run({ type: "acceptTopic", topicId: n.topicId! });
        else canvasStore.getState().openPanel(id);
        return;
      }
      if (e.key === "Escape" && onCard) {
        e.preventDefault();
        if (n.ghost) run({ type: "dismissTopic", topicId: n.topicId! });
        else if (canvasStore.getState().panel) canvasStore.getState().closePanel();
        return;
      }
      if ((e.key === "a" || e.key === "A") && onCard && !e.metaKey && !e.ctrlKey && !e.altKey && !readOnly) {
        e.preventDefault();
        canvasStore.getState().setAddMenu({ nodeId: id, mode: e.shiftKey ? "sibling" : "child" });
      }
    },
    [graph, input, run, goToNode, readOnly],
  );

  const firstFit = useRef(false);
  const onInit = useCallback(() => {
    if (firstFit.current) return;
    firstFit.current = true;
    if (ui.viewport) rf.setViewport(ui.viewport);
    else rf.fitView({ padding: 0.2, maxZoom: 1, duration: 0 });
  }, [rf, ui.viewport]);

  return (
    <div className="absolute inset-0" onKeyDown={onKeyDown}>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onInit={onInit}
        onNodeClick={(_, n) => canvasStore.getState().select(n.id)}
        onNodeDoubleClick={(_, n) => canvasStore.getState().openPanel(n.id)}
        onNodeDragStop={(_, n) => canvasStore.getState().pinPosition(projectId, n.id, n.position)}
        onPaneClick={() => canvasStore.getState().select(null)}
        onConnectEnd={(event, state) => {
          if (readOnly || !state.fromNode || state.toNode) return;
          const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
          canvasStore.getState().setAddMenu({ nodeId: state.fromNode.id, mode: "child", at: { x: pt.clientX, y: pt.clientY }, flowAt: rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }) });
        }}
        onMoveEnd={(_, vp) => canvasStore.getState().setViewport(projectId, vp)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        {ui.minimap && <MiniMap pannable zoomable nodeClassName={(n) => `mm-${(n.data as NodeData).node.status}`} ariaLabel="Minimap" />}
      </ReactFlow>
      <CanvasControls />
      <AddMenu />
    </div>
  );
}

function CanvasControls() {
  const rf = useReactFlow();
  const { projectId, ui } = useSession();
  const reduced = useReducedMotion();
  const d = reduced ? 0 : 180;
  const btn = "btn-ghost h-11 w-11 px-0";
  return (
    <div role="toolbar" aria-label="Canvas view" className="absolute bottom-4 left-4 z-10 flex gap-1 rounded-md border border-line bg-bg-1 p-1">
      <button className={btn} onClick={() => rf.zoomIn({ duration: d })} aria-label="Zoom in"><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
      <button className={btn} onClick={() => rf.zoomOut({ duration: d })} aria-label="Zoom out"><Minus className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
      <button className={btn} onClick={() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: d })} aria-label="Fit view (F)"><Maximize className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
      <button className={btn} onClick={() => canvasStore.getState().toggleMinimap(projectId)} aria-pressed={ui.minimap} aria-label="Minimap (M)"><MapIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
    </div>
  );
}

export default function CanvasView({ readOnly }: { readOnly: boolean }) {
  return (
    <ReactFlowProvider>
      <Canvas readOnly={readOnly} />
      <CanvasKeys />
    </ReactFlowProvider>
  );
}

/** F (fit) needs React Flow; the other global keys are handled by the shell. */
function CanvasKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]")) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        canvasCommands.fit();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return null;
}

export type { GNode };
