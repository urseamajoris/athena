/** An integer with thousands separators ("1,234"). Not Intl: the first Intl call loads locale data, which
 *  takes tens of milliseconds on a slow phone, and the server and browser always agree on this output. */
export function fmtInt(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "just now", "5 minutes ago", "in 2 hours", "3 days ago". */
export function relTime(iso: string, now = Date.now()) {
  const mins = Math.round((Date.parse(iso) - now) / 60000);
  const say = (n: number, unit: string) => {
    const a = Math.abs(n);
    const s = `${a} ${unit}${a === 1 ? "" : "s"}`;
    return n < 0 ? `${s} ago` : `in ${s}`;
  };
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return say(mins, "minute");
  const h = Math.round(mins / 60);
  if (Math.abs(h) < 24) return say(h, "hour");
  return say(Math.round(h / 24), "day");
}
