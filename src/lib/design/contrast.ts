// WCAG 2.x contrast helpers, shared by the token test and the visual audit.

export function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Extract `--name: #hex` declarations from the first CSS block whose selector matches. */
export function tokensFrom(css: string, selector: RegExp): Record<string, string> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (!selector.test(m[1].split(";").pop()!)) continue;
    const out: Record<string, string> = {};
    for (const d of m[2].matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,6})\s*;/gi)) out[d[1]] = d[2];
    return out;
  }
  throw new Error(`No CSS block for ${selector}`);
}

/** `pct`% of `fg` laid over `bg`, as a colour. Close to CSS `color-mix(in oklab, fg pct%, transparent)` on that
 *  surface for the small percentages the tints use (mixed here in sRGB, which is a little darker: the safe side
 *  on light surfaces, and within a few hundredths of a ratio on dark ones). */
export function tint(fg: string, bg: string, pct: number): [number, number, number] {
  const a = parseHex(fg);
  const b = parseHex(bg);
  return [0, 1, 2].map((i) => Math.round(a[i] * (pct / 100) + b[i] * (1 - pct / 100))) as [number, number, number];
}

/** The tinted surfaces of globals.css (@theme): [token whose tint it is, percentage, the surfaces it is laid on]. */
export const TINTS: [name: string, token: string, pct: number, on: string[]][] = [
  // "You are here" in the stage rail (on the rail, bg-1) and in the phone header.
  ["accent-soft", "accent", 10, ["bg-1"]],
  // State banners sit on the page (bg-0) or inside a card (bg-1).
  ["ok-soft", "ok", 9, ["bg-0", "bg-1"]],
  ["warn-soft", "warn", 10, ["bg-0", "bg-1"]],
  ["err-soft", "err", 8, ["bg-0", "bg-1"]],
  ["run-soft", "run", 9, ["bg-0", "bg-1"]],
];

/**
 * Text and icons on the tinted surfaces: body text (fg-0, fg-1) and the hint colour (fg-2) at 4.5:1, and the
 * tint's own colour (the status icon, or the accent bar) at 3:1.
 */
export function tintedPairs(tokens: Record<string, string>): { label: string; ratio: number; min: number }[] {
  const out: { label: string; ratio: number; min: number }[] = [];
  for (const [name, token, pct, surfaces] of TINTS) {
    for (const bg of surfaces) {
      const surface = tint(tokens[token], tokens[bg], pct);
      for (const fg of ["fg-0", "fg-1", "fg-2"]) out.push({ label: `--${fg} on ${name} over --${bg}`, ratio: contrast(parseHex(tokens[fg]), surface), min: 4.5 });
      out.push({ label: `--${token} on ${name} over --${bg}`, ratio: contrast(parseHex(tokens[token]), surface), min: 3 });
    }
  }
  return out;
}

/** The pairs the design actually uses: [foreground, background, minimum ratio]. */
export const TEXT_SURFACES = ["bg-0", "bg-1", "bg-2", "bg-3"] as const;
export const TEXT_TOKENS = ["fg-0", "fg-1", "fg-2", "ok", "warn", "err", "run", "accent"] as const;
export const CONTROL_TOKENS = ["line-control", "focus", "accent"] as const;

export function requiredPairs(): [string, string, number][] {
  const pairs: [string, string, number][] = [];
  for (const fg of TEXT_TOKENS) for (const bg of TEXT_SURFACES) pairs.push([fg, bg, 4.5]);
  pairs.push(["accent-fg", "accent", 4.5], ["accent-fg", "accent-hover", 4.5]);
  for (const ui of CONTROL_TOKENS) for (const bg of TEXT_SURFACES) pairs.push([ui, bg, 3]);
  return pairs;
}
