/*
 * Test-only stand-in for `next/headers`. Outside a Next request scope the real `cookies()` / `headers()` throw,
 * so route code such as dispatch() -> requireUser() cannot run in plain Node unit tests. Installed by ./env
 * before any app module loads; tests choose the signed-in user with signInAs() (see ./seed).
 */
import { createRequire } from "node:module";

const jar = new Map<string, string>();
let requestHeaders = new Headers();

const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string | { name: string; value: string }, value?: string) => {
    if (typeof name === "object") jar.set(name.name, name.value);
    else jar.set(name, value ?? "");
    return cookieStore;
  },
  delete: (name: string) => {
    jar.delete(name);
    return cookieStore;
  },
};

export const fakeNextHeaders = {
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
  draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
};

/** Set (or clear, with null) a cookie the next "request" carries. */
export function setTestCookie(name: string, value: string | null) {
  if (value === null) jar.delete(name);
  else jar.set(name, value);
}
export function setTestHeaders(h: HeadersInit) {
  requestHeaders = new Headers(h);
}

export function installNextHeadersStub() {
  const req = createRequire(__filename);
  const resolved = req.resolve("next/headers");
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fakeNextHeaders } as unknown as NodeModule;
}
