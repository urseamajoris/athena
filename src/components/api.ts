"use client";
import useSWR, { type SWRConfiguration } from "swr";

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
  return useSWR<T>(path, fetcher as (u: string) => Promise<T>, { revalidateOnFocus: false, ...cfg });
}

export const projectPath = (id: string, sub = "") => `/api/projects/${id}${sub ? `/${sub}` : ""}`;
