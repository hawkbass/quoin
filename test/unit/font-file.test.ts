/* Reading metrics out of a font file.

   This exists so that fitting a design does not need a browser, which is what
   makes it usable in a build step. The whole justification is that the cap
   height in the OS/2 table is the cap height the engine uses, and
   `test/browser/file-vs-browser.spec.ts` checks that against real engines: 45
   measurements across 9 fonts, worst disagreement 0.008px.

   These are the tests that do not need an engine. A font parser fails in two
   ways, and both are quiet: it reads a plausible number from the wrong offset,
   and it reads a table that is not there. Every case here is one of those. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { readFontMetrics, capHeightAt, FontFileError } from "../../src/font-file.ts";

const FONTS = "test/browser/fixtures/fonts";
const have = existsSync(FONTS);
const font = (name: string) => readFileSync(join(FONTS, name));

/* ------------------------------------------------------------------ *
   Fonts whose numbers are known
 * ------------------------------------------------------------------ */

test("it reads units per em and cap height from a real font", { skip: !have }, () => {
  /* Lato declares 1433 on a 2000 em, which is 0.7165, and both Chromium and
     WebKit drew exactly that. */
  const metrics = readFontMetrics(font("Lato.ttf"));

  assert.equal(metrics.unitsPerEm, 2000);
  assert.equal(metrics.capHeight, 1433);
  assert.equal(metrics.os2Version, 4);
  assert.equal(metrics.outlines, "truetype");
  assert.equal(capHeightAt(metrics, 100), 71.65);
});

test("cap height scales linearly with the size, because the engines do", {
  skip: !have,
}, () => {
  const metrics = readFontMetrics(font("EBGaramond.ttf"));
  assert.equal(capHeightAt(metrics, 100), 65);
  assert.equal(capHeightAt(metrics, 32), 20.8);
  assert.equal(capHeightAt(metrics, 17), 11.05);
});

test("a variable font is flagged, because its metrics move with its axes", {
  skip: !have,
}, () => {
  const metrics = readFontMetrics(font("EBGaramond.ttf"));
  assert.equal(metrics.variable, true);

  const still = readFontMetrics(font("Lato.ttf"));
  assert.equal(still.variable, false);
});

/* ------------------------------------------------------------------ *
   Fonts that do not declare one
 * ------------------------------------------------------------------ */

test("an OS/2 version 1 table has no cap height, and none is invented", {
  skip: !have,
}, () => {
  /*
     sxHeight and sCapHeight only exist from version 2. Reading them out of a
     version 1 table returns whatever bytes happen to follow, which is exactly
     the kind of number that looks plausible and is not.
  */
  const metrics = readFontMetrics(font("AwkwardAbsent.ttf"));
  assert.equal(metrics.os2Version, 1);
  assert.equal(metrics.capHeight, null);
  assert.equal(metrics.capHeightImplausible, false);
  assert.equal(capHeightAt(metrics, 32), null);
});

test("a declared cap height of zero is not a cap height", { skip: !have }, () => {
  /* Zero is what a font writes to mean "not computed", and a cap height of zero
     would put every baseline on the row above. */
  const metrics = readFontMetrics(font("AwkwardZeroed.ttf"));
  assert.equal(metrics.os2Version, 4);
  assert.equal(metrics.capHeight, null);
});

test("a cap height taller than the em is refused, and says why", { skip: !have }, () => {
  /*
     The finding this guard came from. AwkwardHuge declares 1.4 em, which cannot
     be a cap height, and both Chromium and WebKit ignore it and measure the
     glyphs instead: they drew 0.7. Trusting the file there produced a fit wrong
     by thirty pixels at a display size.

     What it deliberately does not catch is a declaration that is false but
     credible. AwkwardLies claims 0.6 em where its capitals are really 0.7, and
     the engines drew 0.6, because the table is the authority whenever the table
     is believable. That is the whole reason reading files works.
  */
  const huge = readFontMetrics(font("AwkwardHuge.ttf"));
  assert.equal(huge.capHeight, null);
  assert.equal(huge.capHeightImplausible, true);

  const lies = readFontMetrics(font("AwkwardLies.ttf"));
  assert.equal(lies.capHeight, 600, "a credible lie is passed through, as the engines do");
  assert.equal(lies.capHeightImplausible, false);
});

/* ------------------------------------------------------------------ *
   Files that are not fonts, or not this kind
 * ------------------------------------------------------------------ */

test("a WOFF2 is refused rather than half-parsed", () => {
  /* 'wOF2'. It transforms glyf and loca rather than merely compressing them, so
     a parser that guessed would be wrong quietly. */
  const bytes = new Uint8Array(64);
  new DataView(bytes.buffer).setUint32(0, 0x774f4632);

  assert.throws(() => readFontMetrics(bytes), (error: unknown) => {
    assert.ok(error instanceof FontFileError);
    assert.match((error as Error).message, /WOFF2/);
    assert.match((error as Error).message, /TTF or OTF/);
    return true;
  });
});

test("a font collection is refused, because it is several fonts", () => {
  const bytes = new Uint8Array(64);
  new DataView(bytes.buffer).setUint32(0, 0x74746366);

  assert.throws(() => readFontMetrics(bytes), /collection/);
});

test("something that is not a font at all is refused by signature", () => {
  const bytes = new TextEncoder().encode("<!doctype html><html>not a font at all</html>");
  assert.throws(() => readFontMetrics(bytes), /not a font this can read/);
});

test("a file too short to hold a header is refused before it is indexed", () => {
  assert.throws(() => readFontMetrics(new Uint8Array(4)), /fewer than 12 bytes/);
});

test("a truncated table directory does not read past the end", { skip: !have }, () => {
  /* Reading past the end of a buffer is how a parser returns a plausible number
     from nowhere. */
  const whole = font("Lato.ttf");
  const cut = whole.subarray(0, 200);
  assert.throws(() => readFontMetrics(cut), FontFileError);
});

test("a table pointing past the end of the file is refused", { skip: !have }, () => {
  const whole = Uint8Array.from(font("Lato.ttf"));
  const view = new DataView(whole.buffer, whole.byteOffset, whole.byteLength);

  /* The `head` table specifically, rather than whichever entry happens to come
     first: the directory is sorted by tag and the first one is usually
     something this never reads, so corrupting it proves nothing. */
  const count = view.getUint16(4);
  let headAt = -1;
  for (let i = 0; i < count; i++) {
    const base = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3)
    );
    if (tag === "head") headAt = base;
  }
  assert.ok(headAt >= 0, "the fixture has a head table to corrupt");

  view.setUint32(headAt + 8, whole.byteLength - 2);
  assert.throws(() => readFontMetrics(whole), /past the end/);
});

/* ------------------------------------------------------------------ *
   Everything in the corpus, at once
 * ------------------------------------------------------------------ */

test("every font in the corpus parses or explains itself", { skip: !have }, () => {
  const files = readdirSync(FONTS).filter((f) => /\.(ttf|otf|woff)$/i.test(f));
  assert.ok(files.length > 5, `expected a corpus, found ${files.length} files`);

  let withCap = 0;

  for (const file of files) {
    let metrics;
    try {
      metrics = readFontMetrics(font(file));
    } catch (error) {
      assert.ok(
        error instanceof FontFileError,
        `${file} threw something other than a FontFileError: ${error}`
      );
      continue;
    }

    assert.ok(metrics.unitsPerEm > 0, `${file} has no units per em`);
    if (metrics.capHeight !== null) {
      withCap++;
      assert.ok(
        metrics.capHeight <= metrics.unitsPerEm,
        `${file} declares a cap height of ${metrics.capHeight} on a ${metrics.unitsPerEm} em`
      );
      assert.ok(metrics.capHeight > 0, `${file} declares a cap height of zero`);
    }
  }

  assert.ok(
    withCap > files.length / 2,
    `only ${withCap} of ${files.length} fonts declared a usable cap height`
  );
});
