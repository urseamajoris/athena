import "server-only";
import { config } from "../config";
import { httpFetch } from "./http";

/* Unpaywall (https://unpaywall.org/products/api): email= required, 100k calls/day. */
export interface UnpaywallInfo {
  isOa: boolean;
  oaStatus: string | null;
  url: string | null;
  pdfUrl: string | null;
  license: string | null;
  hostType: string | null;
}

export async function unpaywall(doi: string, log?: (l: string) => void): Promise<UnpaywallInfo | null> {
  const r = await httpFetch("unpaywall", `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(config.contactEmail)}`, { log, okStatuses: [404] });
  if (r.status !== 200) return null;
  const j = JSON.parse(r.text);
  const loc = j.best_oa_location;
  return {
    isOa: !!j.is_oa,
    oaStatus: j.oa_status ?? null,
    url: loc?.url ?? null,
    pdfUrl: loc?.url_for_pdf ?? null,
    license: loc?.license ?? null,
    hostType: loc?.host_type ?? null,
  };
}
