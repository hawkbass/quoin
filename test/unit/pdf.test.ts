/* Reading baselines out of a PDF.

   Print is the case a baseline grid comes from and the one this library could
   say nothing about, because a paginated rendering is not a DOM and every claim
   about how a fit behaves across pages was reasoning rather than measurement.

   The fixtures are built here rather than taken from a browser. A parser tested
   only against what Chromium emits has learned Chromium's habits, and the cases
   worth testing are the ones it never produces. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import { readPdfText, baselinesFromTop, PdfError } from "../../src/pdf.ts";
import { buildPdf } from "./make-pdf.ts";

const inflate = (bytes: Uint8Array) => new Uint8Array(inflateSync(bytes));

/* ------------------------------------------------------------------ *
   Positions
 * ------------------------------------------------------------------ */

test("it reads the position of every text run", () => {
  const pdf = buildPdf([
    { x: 50, y: 250 },
    { x: 50, y: 226 },
    { x: 50, y: 202 },
  ]);
  const pages = readPdfText(pdf, inflate);

  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.width, 400);
  assert.equal(pages[0]!.height, 300);
  assert.deepEqual(
    pages[0]!.runs.map((r) => [r.x, r.y]),
    [
      [50, 250],
      [50, 226],
      [50, 202],
    ]
  );
});

test("a deflated stream reads the same as a plain one", () => {
  /* Which is the whole reason inflate is a parameter. */
  const runs = [
    { x: 40, y: 260 },
    { x: 40, y: 236 },
  ];
  const plain = readPdfText(buildPdf(runs), inflate);
  const packed = readPdfText(buildPdf(runs, { compress: true }), inflate);
  assert.deepEqual(packed[0]!.runs, plain[0]!.runs);
});

test("an indirect /Length is followed rather than guessed at", () => {
  /*
     `/Length` can be a reference to another object, which is legal and which
     Chromium does not do. The reader used to find the end of a stream by
     searching for `endstream` and stripping the newline before it, and deflated
     bytes contain both, so one byte either way was the difference between a
     stream that inflates and one that throws.
  */
  const runs = [{ x: 30, y: 270 }, { x: 30, y: 246 }];
  const direct = readPdfText(buildPdf(runs, { compress: true }), inflate);
  const indirect = readPdfText(
    buildPdf(runs, { compress: true, indirectLength: true }),
    inflate
  );
  assert.deepEqual(indirect[0]!.runs, direct[0]!.runs);
});

test("a page with several content streams is read as one page", () => {
  const runs = [
    { x: 20, y: 280 },
    { x: 20, y: 256 },
    { x: 20, y: 232 },
    { x: 20, y: 208 },
  ];
  const pages = readPdfText(buildPdf(runs, { splitContent: true }), inflate);
  assert.equal(pages.length, 1, "two streams are not two pages");
  assert.equal(pages[0]!.runs.length, 4);
});

test("a page tree with a level in it is walked", () => {
  const pages = readPdfText(
    buildPdf([{ x: 10, y: 290 }], { nested: true }),
    inflate
  );
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.runs[0]!.y, 290);
});

test("Td moves relative to the line, and lands where Tm would have", () => {
  /* Chromium writes a matrix per line. Other producers move relatively, and a
     reader that only understands one of them reads half the files it is given. */
  const absolute = readPdfText(
    buildPdf([{ x: 50, y: 250 }, { x: 50, y: 226 }]),
    inflate
  );
  const relative = readPdfText(
    buildPdf([{ x: 50, y: 250 }, { x: 50, y: 226, relative: true }]),
    inflate
  );
  assert.deepEqual(
    relative[0]!.runs.map((r) => [r.x, r.y]),
    absolute[0]!.runs.map((r) => [r.x, r.y])
  );
});

/* ------------------------------------------------------------------ *
   From the top, in px
 * ------------------------------------------------------------------ */

test("baselines come back measured down from the top of the page, in px", () => {
  /* PDF puts its origin at the bottom left and measures in points. A grid is
     written in px and counted from the top, so one conversion, in one place. */
  const pages = readPdfText(
    buildPdf([{ x: 50, y: 250 }, { x: 50, y: 226 }], { height: 300 }),
    inflate
  );
  const tops = baselinesFromTop(pages[0]!);

  /* 300 - 250 = 50pt = 66.667px, and the next is 24pt = 32px below it. */
  assert.equal(Math.round(tops[0]! * 100) / 100, 66.67);
  assert.equal(Math.round((tops[1]! - tops[0]!) * 100) / 100, 32);
});

test("one baseline per line, not one per run", () => {
  /*
     A line is often several show operators: a change of font, a kerned pair, a
     run of digits. They sit at the same baseline, and counting each separately
     weights a line by how many pieces the engine cut it into. Two layouts of the
     same text then report different totals with every baseline in the same
     place, which is what made an early reading of a printed page show 81
     baselines against 111 for the same forty paragraphs.
  */
  const pages = readPdfText(
    buildPdf([
      { x: 20, y: 250 },
      { x: 60, y: 250 },
      { x: 120, y: 250 },
      { x: 20, y: 226 },
    ]),
    inflate
  );
  assert.equal(pages[0]!.runs.length, 4, "four runs were written");
  assert.equal(baselinesFromTop(pages[0]!).length, 2, "on two lines");
});

test("baselines come back in order down the page", () => {
  const pages = readPdfText(
    buildPdf([{ x: 10, y: 100 }, { x: 10, y: 250 }, { x: 10, y: 180 }]),
    inflate
  );
  const tops = baselinesFromTop(pages[0]!);
  assert.deepEqual([...tops].sort((a, b) => a - b), tops);
});

/* ------------------------------------------------------------------ *
   Refusing
 * ------------------------------------------------------------------ */

test("something that is not a PDF is refused rather than parsed", () => {
  assert.throws(
    () => readPdfText(new TextEncoder().encode("<!doctype html><p>hello"), inflate),
    (error: unknown) => error instanceof PdfError && error.code === "notPdf"
  );
});

test("a stream that will not inflate is an error, not a short page", () => {
  /* Reporting the rest of the document as the whole of it would be a quiet lie,
     and a page grid that silently drops a page is worse than one that stops. */
  const pdf = buildPdf([{ x: 10, y: 100 }], { compress: true });
  assert.throws(
    () =>
      readPdfText(pdf, () => {
        throw new Error("no");
      }),
    (error: unknown) => error instanceof PdfError && error.code === "badStream"
  );
});

test("a PDF with no pages says so", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\ntrailer << >>\n%%EOF\n");
  assert.throws(
    () => readPdfText(bytes, inflate),
    (error: unknown) => error instanceof PdfError && error.code === "noPages"
  );
});
