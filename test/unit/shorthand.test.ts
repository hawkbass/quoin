/* Reading a font size out of a CSS font shorthand.

   This has its own file because getting it wrong is silent. `parseFloat` on a
   shorthand returns the first number it finds, and in `700 18px Satoshi` that
   number is the weight, so the first version of this library reported a font
   size of 700 for every bold run on every page, and NaN for every italic one,
   which fell through to a hardcoded 16. Nothing failed. The numbers were just
   wrong. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { fontSizeFromShorthand } from "../../src/metrics.ts";

test("the plain case", () => {
  assert.equal(fontSizeFromShorthand("18px Satoshi"), 18);
  assert.equal(fontSizeFromShorthand("16px serif"), 16);
});

test("a weight in front does not become the size", () => {
  assert.equal(fontSizeFromShorthand("700 18px Satoshi"), 18);
  assert.equal(fontSizeFromShorthand("400 16px Georgia, serif"), 16);
  assert.equal(fontSizeFromShorthand("900 12px Arial"), 12);
});

test("style, variant and weight together do not become the size", () => {
  assert.equal(fontSizeFromShorthand("italic 700 24px Georgia"), 24);
  assert.equal(fontSizeFromShorthand("italic small-caps bold 13px Arial"), 13);
  assert.equal(fontSizeFromShorthand("normal normal 400 16px Arial"), 16);
});

test("a line-height after the size does not become the size", () => {
  assert.equal(fontSizeFromShorthand("18px/28px Satoshi"), 18);
  assert.equal(fontSizeFromShorthand("700 18px/1.6 Satoshi"), 18);
  assert.equal(fontSizeFromShorthand("italic 400 13px / 20px Georgia"), 13);
});

test("fractional sizes survive", () => {
  /* A fluid type scale produces these constantly, and they are exactly the
     sizes whose fractional ascents put a page off the grid. */
  assert.equal(fontSizeFromShorthand("17.6px Satoshi"), 17.6);
  assert.equal(fontSizeFromShorthand("700 13.008px Inter"), 13.008);
  assert.equal(fontSizeFromShorthand(".5px Arial"), 0.5);
});

test("absolute units convert to px", () => {
  assert.equal(fontSizeFromShorthand("12pt Georgia"), 16);
  assert.equal(fontSizeFromShorthand("1in Georgia"), 96);
  assert.equal(fontSizeFromShorthand("1pc Georgia"), 16);
  assert.equal(Math.round(fontSizeFromShorthand("10mm Georgia") as number), 38);
});

test("relative units are refused rather than guessed at", () => {
  /* `1.2em` is a real number in some other frame of reference, and guessing at
     it would be worse than saying so. The caller has the computed size. */
  assert.equal(fontSizeFromShorthand("1.2em Georgia"), null);
  assert.equal(fontSizeFromShorthand("120% Georgia"), null);
  assert.equal(fontSizeFromShorthand("2rem Georgia"), null);
});

test("a family whose name contains a number is not mistaken for a size", () => {
  assert.equal(fontSizeFromShorthand("18px Roboto2"), 18);
  assert.equal(fontSizeFromShorthand("14px \"Helvetica 65 Medium\""), 14);
});

test("a shorthand with no size at all returns null, not a fallback", () => {
  /* Returning 16 here would be a measurement of a font nobody asked about,
     indistinguishable from a real one. */
  assert.equal(fontSizeFromShorthand(""), null);
  assert.equal(fontSizeFromShorthand("bold Georgia"), null);
  assert.equal(fontSizeFromShorthand("   "), null);
});

test("the exact shorthands the three engines actually hand back", () => {
  /* Taken from a live cross-engine run: the same request serialises three
     different ways, and all three have to read. */
  assert.equal(fontSizeFromShorthand('18px satoshi, "satoshi Fallback"'), 18);
  assert.equal(fontSizeFromShorthand('18px "satoshi", "satoshi Fallback"'), 18);
  assert.equal(fontSizeFromShorthand("18px satoshi, satoshi Fallback"), 18);
  assert.equal(fontSizeFromShorthand("18px Georgia, serif"), 18);
});

test("what fontShorthand() itself produces reads correctly", () => {
  /* `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}` is the shape this
     library builds internally, and it is the shape `parseFloat` failed on. */
  for (const [style, weight, size, family] of [
    ["normal", "400", "16px", "Georgia, serif"],
    ["normal", "700", "18px", "Satoshi, sans-serif"],
    ["italic", "300", "13.5px", '"JetBrains Mono", monospace'],
    ["oblique", "800", "48px", "system-ui"],
  ] as const) {
    const shorthand = `${style} ${weight} ${size} ${family}`;
    assert.equal(
      fontSizeFromShorthand(shorthand),
      Number.parseFloat(size),
      `failed on ${shorthand}`
    );
  }
});
