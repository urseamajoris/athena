"use client";
import { useEffect } from "react";

/** Pages without an account (the endpoint only takes reports from signed-in users). */
const PUBLIC = new Set(["/", "/login", "/signup"]);
const MAX_PER_PAGE_LOAD = 5;

/**
 * Tells the admin dashboard about errors in this browser: page errors and unhandled promise rejections. Sends the
 * page path and the error message only (the server strips IDs, URLs and quoted text); never the stack or any data.
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const sent = new Set<string>();
    const report = (kind: "error" | "unhandledrejection", message: string) => {
      const page = location.pathname;
      // Benign browser notices and duplicates are not worth a report.
      if (PUBLIC.has(page) || !message || /ResizeObserver loop/.test(message) || sent.has(message) || sent.size >= MAX_PER_PAGE_LOAD) return;
      sent.add(message);
      fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, message: message.slice(0, 2000), page }), keepalive: true }).catch(() => {});
    };
    const onError = (e: ErrorEvent) => {
      // Scripts from browser extensions or other sites are not ours to report.
      if (e.filename && !e.filename.startsWith(location.origin)) return;
      report("error", e.message || String(e.error ?? ""));
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: unknown } | undefined;
      report("unhandledrejection", typeof r?.message === "string" ? r.message : String(e.reason ?? ""));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
