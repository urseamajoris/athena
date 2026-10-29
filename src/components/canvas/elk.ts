import type { ElkLike } from "@/lib/canvas/layout";

let elkPromise: Promise<ElkLike> | null = null;
/** elkjs, loaded only when the canvas needs it. The layout engine (about 430 kB gzip) is parsed and run in a
 *  Web Worker, so it never blocks the main thread; only the small API wrapper loads here. */
export function loadElk(): Promise<ElkLike> {
  return (elkPromise ??= import("elkjs/lib/elk-api.js").then((m) => {
    const ELK = (m as unknown as { default: new (o: { workerFactory: () => Worker }) => ElkLike }).default;
    return new ELK({ workerFactory: () => new Worker(new URL("./elk.worker.ts", import.meta.url)) });
  }));
}
