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
