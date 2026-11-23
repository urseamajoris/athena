// The report as a printable web page: the Markdown report converted to escaped HTML (unit-tested in
// report-html.test.ts). Phones cannot open .md files, but every browser can show this page, print it and save it
// as PDF. Pure: no database access here.
import { createHash } from "node:crypto";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Bold, italic, code and DOI/PMID links. Everything is escaped first; code spans are left unformatted. */
export function inlineHtml(text: string): string {
  return text
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return `<code>${esc(part.slice(1, -1))}</code>`;
      return esc(part)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // _italic_ only between spaces or punctuation, so identifiers such as c_fda84bbb stay as they are.
        .replace(/(^|[\s(])_([^_]+?)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>")
        .replace(/\bDOI (10\.\d{4,9}\/[^\s<]+?)(?=[\s.,;)]*(?:\s|$))/g, (_m, doi: string) => `DOI <a href="https://doi.org/${doi}">${doi}</a>`)
        .replace(/\bPMID (\d{1,9})\b/g, (_m, id: string) => `PMID <a href="https://pubmed.ncbi.nlm.nih.gov/${id}/">${id}</a>`);
    })
    .join("");
}

/** Table cells split on unescaped pipes ("\|" inside a cell is a literal pipe). */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

/**
 * The subset of Markdown the report uses: #/##/### headings, paragraphs, "- " lists with indented sub-items and
 * "> " quotes, numbered lines, and pipe tables.
 */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split("\n");
  let para: string[] = [];
  let list: "ul" | "ol" | null = null;
  let sub = false;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineHtml).join(" ")}</p>`);
    para = [];
  };
  const closeSub = () => {
    if (sub) out.push("</ul>");
    sub = false;
  };
  const closeList = () => {
    closeSub();
    if (list) out.push(`</li></${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const item = /^- (.*)$/.exec(line);
    const numbered = /^(\d+)\. (.*)$/.exec(line);
    const subItem = /^ {2,4}- (.*)$/.exec(line);
    const quote = /^ {0,4}> ?(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const n = heading[1].length;
      out.push(`<h${n}>${inlineHtml(heading[2])}</h${n}>`);
    } else if (line.startsWith("|")) {
      flushPara();
      closeList();
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      i--;
      const body = rows.slice(1).filter((r) => !/^\|[\s|:-]+\|?$/.test(r));
      out.push(
        `<div class="table"><table><thead><tr>${cells(rows[0]).map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${cells(r).map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
    } else if (item || numbered) {
      flushPara();
      const kind = item ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(kind === "ol" ? `<ol start="${numbered![1]}"><li>` : "<ul><li>");
        list = kind;
      } else {
        closeSub();
        out.push("</li><li>");
      }
      out.push(inlineHtml(item ? item[1] : numbered![2]));
    } else if (list && subItem) {
      if (!sub) out.push("<ul>");
      sub = true;
      out.push(`<li>${inlineHtml(subItem[1])}</li>`);
    } else if (quote && (list || line.startsWith(">"))) {
      closeSub();
      out.push(`<blockquote>${inlineHtml(quote[1])}</blockquote>`);
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join("\n");
}

const PRINT_SCRIPT = `document.getElementById("print").addEventListener("click",function(){window.print()});`;
/** The page runs only its own print button: no other script, no images, no requests. */
export const REPORT_CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash("sha256").update(PRINT_SCRIPT).digest("base64")}'; base-uri 'none'; form-action 'none'`;

const STYLE = `
:root{color-scheme:light;--fg:#18181b;--fg2:#52525b;--line:#d4d4d8;--soft:#f4f4f5;--accent:#1d4ed8}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
.bar{position:sticky;top:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--soft);font-size:14px}
.bar p{margin:0;color:var(--fg2)}
.bar button{min-height:44px;padding:0 16px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
main{max-width:46rem;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 .5rem}
h2{font-size:1.25rem;margin:2rem 0 .5rem;padding-top:.5rem;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:1.5rem 0 .25rem}
p,ul,ol{margin:.5rem 0}
ul,ol{padding-left:1.4rem}
li{margin:.2rem 0}
blockquote{margin:.25rem 0 .5rem;padding:.25rem .75rem;border-left:3px solid var(--line);color:var(--fg2)}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:0 3px;border-radius:3px;word-break:break-all}
a{color:var(--accent)}
.table{overflow-x:auto;margin:.75rem 0}
table{border-collapse:collapse;font-size:13px;min-width:100%}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{background:var(--soft)}
@media print{.bar{display:none}main{max-width:none;padding:0}body{font-size:11pt}h2{break-after:avoid}tr,blockquote{break-inside:avoid}a{color:inherit;text-decoration:none}.table{overflow:visible}}
`;

/** A complete, self-contained HTML document for the report (opened in the browser or saved as a file). */
export function reportHtmlPage(markdown: string): string {
  const title = /^# (.*)$/m.exec(markdown)?.[1] ?? "Literature review";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(REPORT_CSP)}">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="bar"><p>Printable report. To keep a PDF, print it and choose “Save as PDF”.</p><button id="print" type="button">Print or save as PDF</button></div>
<main>
${markdownToHtml(markdown)}
</main>
<script>${PRINT_SCRIPT}</script>
</body>
</html>
`;
}
