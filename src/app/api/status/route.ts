import { NextResponse } from "next/server";
import { config, paidCalls } from "@/lib/config";
import { checkModels, modelResolutions } from "@/lib/ai/models";
import { totalSpend } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export async function GET() {
  await checkModels();
  return NextResponse.json({
    production: config.production,
    paidCalls,
    mockMode: config.mockMode,
    mockAi: config.mockAi,
    models: modelResolutions(),
    spendUsd: totalSpend(),
    budgetUsd: config.budgetUsd,
    keys: { xai: !!config.xaiApiKey, openalex: !!config.openalexApiKey, contactEmail: !!config.contactEmail },
    maxResultsPerQuery: config.maxResultsPerQuery,
    simulatedFailures: config.simulateFailure,
  });
}
