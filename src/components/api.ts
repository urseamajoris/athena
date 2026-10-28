"use client";
import { useEffect } from "react";
import useSWR, { useSWRConfig, type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(message: string, public status: number, public kind?: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const d = data as { error?: string; kind?: string } | null;
    throw new ApiError(d?.error ?? `Request failed (${res.status})`, res.status, d?.kind);
  }
  return data as T;
}

export const fetcher = (url: string) => api(url);

export function useApi<T>(path: string | null, cfg?: SWRConfiguration) {
  // Data the server put in this page (SWRConfig fallback) is current as of this response, so it is not fetched
  // again on mount (on the table page that was ~500 kB of JSON parsed and compared for nothing). It is copied into
  // the cache instead, so refresh() and job updates, which revalidate cached keys, still find it. Anything
  // cached earlier, or mounted later, revalidates as usual.
  const { fallback, cache, mutate } = useSWRConfig();
  const seed = path && cache.get(path)?.data === undefined ? (fallback as Record<string, unknown> | undefined)?.[path] : undefined;
  const swr = useSWR<T>(path, fetcher as (u: string) => Promise<T>, { revalidateOnFocus: false, ...(seed !== undefined ? { revalidateOnMount: false } : {}), ...cfg });
  useEffect(() => {
    if (path && seed !== undefined) mutate(path, seed, { revalidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return swr;
}

export const projectPath = (id: string, sub = "") => `/api/projects/${id}${sub ? `/${sub}` : ""}`;
