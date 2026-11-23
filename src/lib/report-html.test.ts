import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineHtml, markdownToHtml, reportHtmlPage, REPORT_CSP } from "./report-html";

test("report HTML escapes everything that came from papers or the AI", () => {
  const html = markdownToHtml(`# Review of <script>alert(1)</script>\n\n- **<img src=x onerror=alert(1)>** "quoted" & 'single'`);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&quot;quoted&quot; &amp; &#39;single&#39;"));
});

test("inline formatting: bold, italic between spaces only, code left as typed, DOI and PMID links", () => {
  assert.equal(inlineHtml("**bold** and _italic_."), "<strong>bold</strong> and <em>italic</em>.");
  assert.equal(inlineHtml("[Lotfi et al. 2026, c_fda84bbbedb940fe]"), "[Lotfi et al. 2026, c_fda84bbbedb940fe]");
  assert.equal(inlineHtml("`a **b** <c>`"), "<code>a **b** &lt;c&gt;</code>");
  assert.equal(inlineHtml("DOI 10.1000/xyz.1 · PMID 123."), 'DOI <a href="https://doi.org/10.1000/xyz.1">10.1000/xyz.1</a> · PMID <a href="https://pubmed.ncbi.nlm.nih.gov/123/">123</a>.');
});

test("lists with sub-items and quotes, numbered lines, tables with escaped pipes", () => {
  const html = markdownToHtml(["- one", "  - nested", '  > "a quote"', "- two", "", "1. **Topic**", "   - Synonyms: a, b", "", "| A | B |", "|---|---|", "| `x \\| y` | 2 |"].join("\n"));
  assert.match(html, /<ul><li>\none\n<ul>\n<li>nested<\/li>\n<\/ul>\n<blockquote>&quot;a quote&quot;<\/blockquote>\n<\/li><li>\ntwo\n<\/li><\/ul>/);
  assert.match(html, /<ol start="1"><li>\n<strong>Topic<\/strong>\n<ul>\n<li>Synonyms: a, b<\/li>\n<\/ul>\n<\/li><\/ol>/);
  assert.match(html, /<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td><code>x \| y<\/code><\/td><td>2<\/td><\/tr><\/tbody>/);
});

test("the page is self-contained, titled from the report, and only runs its own print button", () => {
  const page = reportHtmlPage("# Literature review: sleep & grades\n\nText.");
  assert.match(page, /<title>Literature review: sleep &amp; grades<\/title>/);
  assert.match(page, /Print or save as PDF/);
  assert.match(REPORT_CSP, /default-src 'none'/);
  assert.match(REPORT_CSP, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!/src=|href="http/.test(page.replace(/<main>[\s\S]*<\/main>/, "")), "no external resources");
});
