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
import { buildFont } from "./make-font.ts";

const FONTS = "test/browser/fixtures/fonts";
/*
   The directory is committed and its contents are not: the fonts are thirty
   megabytes of somebody else's work, downloaded by `npm run fonts`. Guarding on
   the directory existing is guarding on the wrong thing, which is how nine of
   these failed in CI rather than skipping.
*/
const have = existsSync(join(FONTS, "Lato.ttf"));
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

/* ------------------------------------------------------------------ *
   Fonts built here, so the parser is tested where the corpus is not
 * ------------------------------------------------------------------ */

/*
   Every test above this point skips when the font corpus is absent, which is
   every CI run: the fonts are thirty megabytes of somebody else's work,
   downloaded by `npm run fonts`, and the fast unit job does not download them.
   That left the parser `fitFromFiles` completely depends on with no coverage at
   all in the place coverage matters most.

   So these build fonts byte by byte. It is a narrower test than a real file, and
   it is the one that runs everywhere: a table directory, a head and an OS/2, put
   together by hand so the offsets under test are offsets this file chose.
*/

test("a font built here parses to exactly what was put in it", () => {
  const metrics = readFontMetrics(buildFont({ unitsPerEm: 1000, capHeight: 700, xHeight: 500 }));

  assert.equal(metrics.unitsPerEm, 1000);
  assert.equal(metrics.capHeight, 700);
  assert.equal(metrics.xHeight, 500);
  assert.equal(metrics.os2Version, 4);
  assert.equal(metrics.variable, false);
  assert.equal(metrics.outlines, "truetype");
  assert.equal(capHeightAt(metrics, 100), 70);
});

test("an OTTO signature is read as CFF outlines", () => {
  const metrics = readFontMetrics(buildFont({ signature: 0x4f54544f }));
  assert.equal(metrics.outlines, "cff");
});

test("an fvar table makes it variable", () => {
  const metrics = readFontMetrics(buildFont({ extraTables: ["fvar"] }));
  assert.equal(metrics.variable, true);
});

test("version 1 has no cap height however long the table is", () => {
  /* The length check alone is not enough, because a version 1 table can be
     padded to the length of a version 2 one. Both conditions, or neither. */
  const metrics = readFontMetrics(buildFont({ os2Version: 1, capHeight: 700, os2Length: 96 }));
  assert.equal(metrics.os2Version, 1);
  assert.equal(metrics.capHeight, null);
  assert.equal(metrics.capHeightImplausible, false);
});

test("a version 2 table too short to hold the field is refused too", () => {
  const metrics = readFontMetrics(buildFont({ os2Version: 2, os2Length: 80 }));
  assert.equal(metrics.capHeight, null);
});

test("a cap height taller than the em is refused, at any em size", () => {
  for (const [unitsPerEm, capHeight] of [
    [1000, 1001],
    [1000, 1400],
    [2048, 2049],
  ] as [number, number][]) {
    const metrics = readFontMetrics(buildFont({ unitsPerEm, capHeight }));
    assert.equal(metrics.capHeight, null, `${capHeight} on ${unitsPerEm}`);
    assert.equal(metrics.capHeightImplausible, true, `${capHeight} on ${unitsPerEm}`);
  }
});

test("a cap height exactly the em is allowed, because it is possible", () => {
  /* Unusual and not impossible: an all-caps display face can have capitals that
     fill the em. Refusing it would decline to fit a font the engines accept. */
  const metrics = readFontMetrics(buildFont({ unitsPerEm: 1000, capHeight: 1000 }));
  assert.equal(metrics.capHeight, 1000);
  assert.equal(metrics.capHeightImplausible, false);
});

test("a negative or zero cap height is not one, and is not called implausible", () => {
  /* Zero means "not computed", which is a different thing from a lie, and the
     distinction is what the caller's error message hangs on. */
  for (const capHeight of [0, -700]) {
    const metrics = readFontMetrics(buildFont({ capHeight }));
    assert.equal(metrics.capHeight, null, `cap ${capHeight}`);
    assert.equal(metrics.capHeightImplausible, false, `cap ${capHeight}`);
  }
});

test("units per em of zero is refused rather than divided by", () => {
  assert.throws(() => readFontMetrics(buildFont({ unitsPerEm: 0 })), /units per em is zero/);
});

test("a font with no head table cannot be measured", () => {
  const whole = buildFont();
  const view = new DataView(whole.buffer);
  /* Rename `head` to something nothing reads. */
  for (let i = 0; i < view.getUint16(4); i++) {
    const base = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(base), view.getUint8(base + 1),
      view.getUint8(base + 2), view.getUint8(base + 3)
    );
    if (tag === "head") {
      for (const [at, c] of [..."xxxx"].entries()) view.setUint8(base + at, c.charCodeAt(0));
    }
  }
  assert.throws(() => readFontMetrics(whole), /no head table/);
});

test("a font with no OS/2 table parses, and declares nothing", () => {
  /* Not an error: plenty of old fonts have no OS/2 at all, and the right answer
     is that this one cannot be fitted rather than that the file is broken. */
  const whole = buildFont();
  const view = new DataView(whole.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const base = 12 + i * 16;
    if (String.fromCharCode(view.getUint8(base)) === "O") {
      for (const [at, c] of [..."zzzz"].entries()) view.setUint8(base + at, c.charCodeAt(0));
    }
  }

  const metrics = readFontMetrics(whole);
  assert.equal(metrics.os2Version, null);
  assert.equal(metrics.capHeight, null);
  assert.ok(metrics.unitsPerEm > 0);
});
