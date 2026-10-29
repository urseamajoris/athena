// A persistent browser for simulated-user QA agents: one Chromium page per persona that survives between
// commands, driven from the shell. The first command starts a small daemon; later commands talk to it.
//
//   node scripts/qa-browser.mjs <persona> start [--viewport=1366x900] [--zoom=1] [--out=docs/qa]
//   node scripts/qa-browser.mjs <persona> open <url>
//   node scripts/qa-browser.mjs <persona> shot <name>            screenshot → <out>/<persona>/<name>.jpg
//   node scripts/qa-browser.mjs <persona> look                   what is on screen: URL, title, headings, buttons, text
//   node scripts/qa-browser.mjs <persona> click <text>           a button or link by its visible name (or any text)
//   node scripts/qa-browser.mjs <persona> fill <label> <value>   a field by its label or placeholder
//   node scripts/qa-browser.mjs <persona> type <text>            type into the focused element
//   node scripts/qa-browser.mjs <persona> press <key>            e.g. Enter, Tab, Escape, Shift+Tab
//   node scripts/qa-browser.mjs <persona> select <label> <option>
//   node scripts/qa-browser.mjs <persona> check <label>          toggle a checkbox or radio by its label
//   node scripts/qa-browser.mjs <persona> scroll <down|up|top|bottom>
//   node scripts/qa-browser.mjs <persona> focus                  which element has keyboard focus
//   node scripts/qa-browser.mjs <persona> wait <ms>
//   node scripts/qa-browser.mjs <persona> back | reload | url
//   node scripts/qa-browser.mjs <persona> problems               console errors and failed requests since last call
//   node scripts/qa-browser.mjs <persona> stop
//
// --zoom=2 with --viewport=1366x900 behaves like 200% browser zoom (a 683×450 CSS-pixel window at 2× density).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [persona, cmd, ...rest] = process.argv.slice(2);
if (!persona || !cmd) {
  console.error("usage: node scripts/qa-browser.mjs <persona> <command> [args]");
  process.exit(2);
}
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const args = rest.filter((a) => !a.startsWith("--"));
const stateDir = path.join(os.tmpdir(), "athena-qa-browser");
fs.mkdirSync(stateDir, { recursive: true });
const portFile = path.join(stateDir, `${persona.replace(/[^\w-]/g, "_")}.port`);

if (cmd === "__daemon") await daemon();
else await client();

async function client() {
  let port = fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, "utf8")) : 0;
  if (port && !(await alive(port))) port = 0;
  if (!port) {
    if (cmd === "stop") return console.log("not running");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), persona, "__daemon", ...rest.filter((a) => a.startsWith("--"))], { detached: true, stdio: "ignore" });
    child.unref();
    for (let i = 0; i < 100 && !port; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (fs.existsSync(portFile)) {
        const p = Number(fs.readFileSync(portFile, "utf8"));
        if (await alive(p)) port = p;
      }
    }
    if (!port) throw new Error("browser did not start");
    if (cmd === "start") return console.log(`browser started for ${persona}`);
  }
  if (cmd === "start") return console.log(`browser already running for ${persona}`);
  const r = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: JSON.stringify({ cmd, args }) });
  const out = await r.text();
  console.log(out);
  if (!r.ok) process.exitCode = 1;
}

async function alive(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/ping`)).ok;
  } catch {
    return false;
  }
}

async function daemon() {
  const { chromium } = require("playwright");
  const [w, h] = (flags.viewport ?? "1366x900").split("x").map(Number);
  const zoom = Number(flags.zoom ?? 1);
  const outDir = path.join(flags.out ?? "docs/qa", persona);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: Math.round(w / zoom), height: Math.round(h / zoom) }, deviceScaleFactor: zoom, isMobile: w < 500, hasTouch: w < 500 });
  const page = await ctx.newPage();
  let problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 300)}`));
  page.on("requestfailed", (r) => !/aborted/i.test(r.failure()?.errorText ?? "") && problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`));

  const settle = async () => {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(700);
  };
  const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byName = (text) => {
    const re = new RegExp(esc(text), "i");
    return [page.getByRole("button", { name: re }), page.getByRole("link", { name: re }), page.getByRole("tab", { name: re }), page.getByRole("menuitem", { name: re }), page.getByRole("radio", { name: re }), page.getByText(re)];
  };
  async function firstVisible(locs) {
    for (const l of locs) {
      const n = await l.count();
      for (let i = 0; i < n; i++) if (await l.nth(i).isVisible()) return l.nth(i);
    }
    return null;
  }
  const field = async (label) => firstVisible([page.getByLabel(label, { exact: false }), page.getByPlaceholder(label, { exact: false }), page.getByRole("textbox", { name: new RegExp(esc(label), "i") })]);

  async function look() {
    return page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && r.bottom > 0 && r.top < innerHeight;
      };
      const t = (el) => (el.innerText || el.getAttribute("aria-label") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const heads = [...document.querySelectorAll("h1,h2,h3")].filter(vis).map((e) => `${e.tagName.toLowerCase()}: ${t(e)}`);
      const ctrls = [...document.querySelectorAll("button,a[href],[role=button],[role=tab],input,textarea,select")].filter(vis).map((e) => {
        const kind = e.tagName === "A" ? "link" : e.tagName === "INPUT" ? `input[${e.type}]` : e.tagName.toLowerCase();
        const label = e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "";
        const dis = e.disabled || e.getAttribute("aria-disabled") === "true" ? " (looks disabled)" : "";
        return `${kind}: ${t(e) || label.replace(/\s+/g, " ").trim()}${dis}`;
      });
      const body = document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 3500);
      return `URL: ${location.href}\nTITLE: ${document.title}\nHEADINGS IN VIEW:\n${heads.join("\n")}\nCONTROLS IN VIEW (${ctrls.length}):\n${[...new Set(ctrls)].slice(0, 60).join("\n")}\nPAGE TEXT (first 3500 chars):\n${body}`;
    });
  }

  const run = {
    async open([url]) { await page.goto(url, { waitUntil: "domcontentloaded" }); await settle(); return `opened ${page.url()}`; },
    async shot([name = `shot-${Date.now()}`]) {
      const file = path.join(outDir, `${name.replace(/[^\w.-]/g, "_")}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 70 });
      return `saved ${file}`;
    },
    look,
    async click([text]) {
      const el = await firstVisible(byName(text));
      if (!el) throw new Error(`nothing visible called "${text}"`);
      await el.click({ timeout: 5000 });
      await settle();
      return `clicked "${text}" → ${page.url()}`;
    },
    async fill([label, value = ""]) {
      const el = await field(label);
      if (!el) throw new Error(`no visible field labelled "${label}"`);
      await el.fill(value);
      return `filled "${label}"`;
    },
    async type([text = ""]) { await page.keyboard.type(text, { delay: 15 }); return "typed"; },
    async press([key]) { await page.keyboard.press(key); await page.waitForTimeout(300); return `pressed ${key}`; },
    async select([label, option]) {
      const el = await firstVisible([page.getByLabel(label, { exact: false }), page.getByRole("combobox", { name: new RegExp(esc(label), "i") })]);
      if (!el) throw new Error(`no visible select labelled "${label}"`);
      await el.selectOption({ label: option }).catch(() => el.selectOption(option));
      await settle();
      return `selected "${option}"`;
    },
    async check([label]) {
      const el = await firstVisible([page.getByRole("checkbox", { name: new RegExp(esc(label), "i") }), page.getByRole("radio", { name: new RegExp(esc(label), "i") }), page.getByLabel(label, { exact: false })]);
      if (!el) throw new Error(`no visible checkbox or radio labelled "${label}"`);
      await el.click();
      await settle();
      return `toggled "${label}"`;
    },
    async scroll([where = "down"]) {
      await page.evaluate((w) => {
        const els = [document.scrollingElement, ...document.querySelectorAll("*")].filter((e) => e && e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
        const target = els.sort((a, b) => b.clientHeight - a.clientHeight).find((e) => e.getBoundingClientRect().height > 200) ?? document.scrollingElement;
        const by = w === "up" ? -0.8 : 0.8;
        if (w === "top") target.scrollTop = 0;
        else if (w === "bottom") target.scrollTop = target.scrollHeight;
        else target.scrollTop += target.clientHeight * by;
        if (target === document.scrollingElement) window.scrollTo(0, target.scrollTop);
      }, where);
      await page.waitForTimeout(400);
      return `scrolled ${where}`;
    },
    async focus() {
      return page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return "focus: page body (nothing focused)";
        const cs = getComputedStyle(e);
        const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? "visible outline" : cs.boxShadow !== "none" ? "box-shadow ring" : "NO visible focus style";
        return `focus: <${e.tagName.toLowerCase()}> "${(e.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").replace(/\s+/g, " ").slice(0, 80)}" (${ring})`;
      });
    },
    async wait([ms = "1000"]) { await page.waitForTimeout(Math.min(60000, Number(ms))); return `waited ${ms} ms`; },
    async back() { await page.goBack(); await settle(); return `back → ${page.url()}`; },
    async reload() { await page.reload(); await settle(); return `reloaded ${page.url()}`; },
    async url() { return page.url(); },
    async problems() { const p = problems; problems = []; return p.length ? p.join("\n") : "no console errors or failed requests"; },
  };

  const server = http.createServer(async (req, res) => {
    if (req.url === "/ping") return res.end("ok");
    let body = "";
    for await (const c of req) body += c;
    const { cmd: c, args: a } = JSON.parse(body || "{}");
    if (c === "stop") {
      res.end("stopped");
      await browser.close();
      fs.rmSync(portFile, { force: true });
      process.exit(0);
    }
    try {
      if (!run[c]) throw new Error(`unknown command "${c}"`);
      res.end(String(await run[c](a ?? [])));
    } catch (e) {
      res.statusCode = 400;
      res.end(`error: ${(e.message || String(e)).split("\n")[0]}`);
    }
  });
  server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
}
