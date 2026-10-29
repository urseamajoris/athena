import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { contrast, parseHex, requiredPairs, tokensFrom } from "./contrast";

const css = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const themes = {
  dark: tokensFrom(css, /^\s*:root,\s*:root\[data-theme="dark"\]\s*$/),
  light: tokensFrom(css, /^\s*:root\[data-theme="light"\]\s*$/),
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

test("dark is the default theme (bare :root carries the dark tokens)", () => {
  assert.equal(themes.dark["bg-0"].toLowerCase(), "#0a0a0b");
  assert.equal(themes.dark["accent"].toLowerCase(), "#7c9cff");
});
