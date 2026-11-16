import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TINTS, contrast, parseHex, requiredPairs, tintedPairs, tokensFrom } from "./contrast";

const css = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const themes = {
  light: tokensFrom(css, /^\s*:root,\s*:root\[data-theme="light"\]\s*$/),
  dark: tokensFrom(css, /^\s*:root\[data-theme="dark"\]\s*$/),
};

test("contrast maths matches known WCAG values", () => {
  assert.equal(contrast(parseHex("#000"), parseHex("#fff")).toFixed(1), "21.0");
  assert.equal(contrast(parseHex("#777777"), parseHex("#ffffff")).toFixed(2), "4.48");
});

test("both themes define the same tokens", () => {
  assert.deepEqual(Object.keys(themes.light).sort(), Object.keys(themes.dark).sort());
});

for (const [name, tokens] of Object.entries(themes)) {
  test(`${name} theme: every foreground/background pair meets WCAG 2.2 AA`, () => {
    const failures: string[] = [];
    for (const [fg, bg, min] of requiredPairs()) {
      assert.ok(tokens[fg] && tokens[bg], `missing --${fg} or --${bg}`);
      const r = contrast(parseHex(tokens[fg]), parseHex(tokens[bg]));
      if (r < min) failures.push(`--${fg} on --${bg}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(failures, []);
  });
}

for (const [name, tokens] of Object.entries(themes)) {
  test(`${name} theme: text and icons on the tinted surfaces (banners, "you are here") meet AA`, () => {
    assert.deepEqual(tintedPairs(tokens).filter((p) => p.ratio < p.min).map((p) => `${p.label}: ${p.ratio.toFixed(2)} < ${p.min}`), []);
  });
}

test("the tints checked are the ones globals.css defines, with the same percentages", () => {
  for (const [name, token, pct] of TINTS) {
    const m = css.match(new RegExp(`--color-${name}: color-mix\\(in oklab, var\\(--(\\w+)\\) (\\d+)%, transparent\\)`));
    assert.ok(m, `--color-${name} is defined`);
    assert.equal(m[1], token);
    assert.equal(Number(m[2]), pct);
  }
});

test("light is the default theme (bare :root carries the light tokens)", () => {
  assert.equal(css.match(/:root,\s*:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*(\w+)/)?.[1], "light");
  assert.equal(contrast(parseHex(themes.light["fg-0"]), parseHex(themes.light["bg-0"])) > 12, true);
});

test("the accent is not a status colour: it stays apart from ok, warn, err and run in both themes", () => {
  for (const tokens of Object.values(themes)) {
    for (const status of ["ok", "warn", "err", "run"]) assert.notEqual(tokens.accent.toLowerCase(), tokens[status].toLowerCase());
  }
});
