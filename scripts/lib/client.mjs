// A tiny HTTP client with its own cookie jar: one instance = one signed-in browser.
export class Client {
  constructor(base, label = "client") {
    this.base = base;
    this.label = label;
    this.cookie = "";
  }
  async raw(path, { method, body, headers = {} } = {}) {
    const r = await fetch(`${this.base}${path}`, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(";");
      const [name, value] = pair.split("=");
      if (name === "athena_session") this.cookie = value ? `athena_session=${value}` : "";
    }
    return r;
  }
  async json(path, opts) {
    const r = await this.raw(path, opts);
    const t = await r.text();
    let d;
    try { d = JSON.parse(t); } catch { d = t; }
    if (!r.ok) throw Object.assign(new Error(`${opts?.method ?? (opts?.body !== undefined ? "POST" : "GET")} ${path} → ${r.status}: ${typeof d === "string" ? d.slice(0, 200) : d?.error}`), { status: r.status });
    return d;
  }
  async signup(email, password = "test-password-123") {
    await this.json("/api/auth/signup", { body: { email, password } });
    return this;
  }
  async login(email, password) {
    await this.json("/api/auth/login", { body: { email, password } });
    return this;
  }
}
