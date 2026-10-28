"use client";
import { useApi } from "./api";
import { Badge } from "./ui";

interface Status {
  mockMode: boolean;
  mockAi: boolean;
  spendUsd: number;
  budgetUsd: number;
  models: Record<string, { resolved: string; status: string; note: string }>;
}

export function StatusPill() {
  const { data } = useApi<Status>("/api/status", { refreshInterval: 15000 });
  if (!data) return null;
  const subs = Object.values(data.models).filter((m) => m.status === "substituted");
  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      {data.mockMode ? <Badge tone="violet" title="MOCK_MODE=true: recorded API fixtures and canned model responses">Mock mode</Badge> : data.mockAi ? <Badge tone="violet" title="MOCK_AI=true: real database APIs, canned model responses">Mock AI · live databases</Badge> : <Badge tone="teal">Live APIs</Badge>}
      {subs.length > 0 && <Badge tone="amber" title={subs.map((s) => s.note).join("\n")}>Model substituted</Badge>}
      <span title={Object.entries(data.models).map(([k, m]) => `${k}: ${m.resolved} (${m.note})`).join("\n")} className="hidden md:inline">
        AI spend ${data.spendUsd.toFixed(2)} / ${data.budgetUsd.toFixed(2)}
      </span>
    </div>
  );
}
