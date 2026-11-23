// Column widths of the summary/ranking table. Pure, so the layout rule is unit-tested.

/** Fixed column widths: with table-layout fixed, a row's height depends only on its own content, which keeps
 *  the virtualizer's measurements stable (auto layout re-flows every column as rows scroll in and out). */
export const COL_W: Record<string, string> = { expand: "48px", select: "48px", rank: "64px", score: "128px", authors: "160px", year: "72px", journal: "180px", studyType: "180px", article: "170px", setting: "220px", keyFinding: "32%", citationCount: "72px", access: "80px", source: "112px" };

/** Title has no width of its own (it takes what is left), but never less than this, so titles stay readable. */
export const TITLE_MIN = 280;

/** The table's minimum width for these columns: wide enough that Title keeps TITLE_MIN after the fixed columns and
 *  the percentage ones (a share of the whole table). A narrower box scrolls the table sideways instead of squeezing
 *  Title to one word per line. */
export function tableMinWidth(columnIds: string[]): number {
  let px = columnIds.includes("title") ? TITLE_MIN : 0;
  let share = 0;
  for (const id of columnIds) {
    const w = COL_W[id];
    if (!w) continue;
    if (w.endsWith("%")) share += parseFloat(w) / 100;
    else px += parseFloat(w);
  }
  return Math.ceil(px / Math.max(0.2, 1 - share));
}

/** The width Title gets in a table of this width (what the browser's fixed layout gives the one column without a width). */
export function titleWidth(columnIds: string[], tableWidth: number): number {
  let used = 0;
  for (const id of columnIds) {
    const w = COL_W[id];
    if (!w) continue;
    used += w.endsWith("%") ? (parseFloat(w) / 100) * tableWidth : parseFloat(w);
  }
  return tableWidth - used;
}
