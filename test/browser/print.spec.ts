/* Print, which is the case a baseline grid comes from.

   Every other file here measures a page in a browser, where a baseline is a
   number the engine will hand you. A paginated rendering is not a DOM, so until
   the PDF reader existed every claim about how a fit behaves across pages was
   reasoning rather than measurement, and this file is the measurement.

   Chromium only, because Playwright will not render a PDF with anything else.
   That is a limitation of the harness rather than of the finding: page
   fragmentation is css-break-3 and the same spec the column work leans on. */

import { test, expect } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readPdfText, baselinesFromTop } from "../../src/pdf.ts";

const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const PITCH = 8;

interface Reading {
  pages: number;
  onGrid: number;
  total: number;
  firsts: number[];
}

/**
 * Render and measure, with the grid's origin solved across every page at once.
 *
 * Where a page's content starts depends on the `@page` margin, and solving for
 * it rather than being told it is the right shape for the question: if the pages
 * agree about where their grid begins, one origin fits all of them, and if they
 * do not then none does and the low score is the finding.
 */
async function printed(
  page: import("@playwright/test").Page,
  css: string,
  paragraphs = 40
): Promise<Reading> {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @page { size: 600pt 700pt; margin: 36pt }
    html { font-family: serif } body { margin: 0 }
    ${css}
  </style>
  ${Array.from(
    { length: paragraphs },
    (_, i) =>
      `<p>Paragraph ${i + 1}, written at a length that wraps onto two or three ` +
      `lines so the flow carries down the page and breaks several times over.</p>`
  ).join("\n")}`);
  await page.evaluate(() => document.fonts?.ready);

  const bytes = await page.pdf({ preferCSSPageSize: true });
  const rendered = readPdfText(new Uint8Array(bytes), (b) => new Uint8Array(inflateSync(b)));

  const perPage = rendered.map((p) => baselinesFromTop(p));
  const all = perPage.flat();

  /* The best single origin, by the same rule the browser side uses. */
  let origin = 0;
  let best = -1;
  for (const candidate of all) {
    const shifted = ((candidate % PITCH) + PITCH) % PITCH;
    const count = all.filter((value) => {
      const r = (((value - shifted) % PITCH) + PITCH) % PITCH;
      return Math.min(r, PITCH - r) <= 0.5;
    }).length;
    if (count > best) {
      best = count;
      origin = shifted;
    }
  }

  const onRow = (value: number) => {
    const r = (((value - origin) % PITCH) + PITCH) % PITCH;
    return Math.min(r, PITCH - r) <= 0.5;
  };

  return {
    pages: rendered.length,
    onGrid: all.filter(onRow).length,
    total: all.length,
    firsts: perPage.map((tops) => Math.round(((tops[0] ?? 0) - origin) * 100) / 100),
  };
}

test.describe.configure({ mode: "serial" });

test("a fitted page holds across page breaks when the space is padding", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "only Chromium renders a PDF here");

  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });
  const fitted = await page.evaluate(() =>
    (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => {
          unavailable: boolean;
          families: { steps: { leading: number; space: number }[] }[];
        };
      };
    }).quoinFit.fitScale(
      [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24 }] }],
      { pitch: 8 }
    )
  );
  if (fitted.unavailable) {
    test.skip(true, "no text-box-trim");
    return;
  }
  const step = fitted.families[0]!.steps[0]!;
  const trim = "text-box-trim: trim-both; text-box-edge: cap alphabetic";

  /* The control. Leading that is not a whole number of rows and a space that
     closes nothing: if this comes out on the grid, the reading means nothing. */
  const unfitted = await printed(
    page,
    "p { font-size:17px; line-height:25.5px; margin:24px 0 0 }"
  );
  expect(unfitted.total, "nothing was measured").toBeGreaterThan(20);
  expect(
    unfitted.onGrid / unfitted.total,
    `an unfitted document read ${unfitted.onGrid}/${unfitted.total}`
  ).toBeLessThan(0.5);

  /* The finding. A margin at the top of a page fragment is truncated at an
     unforced break, exactly as it is at a column break, so page one starts at
     its space and every page after it starts at the cap alone. */
  const withMargin = await printed(
    page,
    `p { font-size:17px; line-height:${step.leading}px; margin:${step.space}px 0 0; ${trim} }`
  );
  expect(withMargin.pages, "the document did not paginate").toBeGreaterThan(1);
  const firstsAgree = withMargin.firsts.every(
    (f) => Math.abs(f - withMargin.firsts[0]!) <= 0.5
  );
  expect(
    firstsAgree,
    `pages started at ${withMargin.firsts.join(", ")}, so the margin survived after all`
  ).toBe(false);

  /* And the fix, which is the same one columns needed. */
  const withPadding = await printed(
    page,
    `p { font-size:17px; line-height:${step.leading}px; margin:0; padding:${step.space}px 0 0; ${trim} }`
  );
  console.log(
    `\n  unfitted ${unfitted.onGrid}/${unfitted.total}, ` +
      `margin ${withMargin.onGrid}/${withMargin.total} over ${withMargin.pages} pages, ` +
      `padding ${withPadding.onGrid}/${withPadding.total} over ${withPadding.pages}\n`
  );

  expect(withPadding.pages, "the fixed document did not paginate").toBeGreaterThan(1);
  expect(
    withPadding.onGrid,
    `padding read ${withPadding.onGrid}/${withPadding.total} across ` +
      `${withPadding.pages} pages, starting at ${withPadding.firsts.join(", ")}`
  ).toBe(withPadding.total);
  for (const first of withPadding.firsts) {
    expect(Math.abs(first - withPadding.firsts[0]!), "the pages disagree").toBeLessThanOrEqual(0.5);
  }
});

test("the page box does not have to be a whole number of rows", async ({
  page,
  browserName,
}) => {
  /*
     Worth asserting because it is the opposite of what a print designer would
     expect, and because believing otherwise makes people design their page size
     around their grid for no reason.

     Each page restarts its own grid at its own content edge, so nothing carries
     across the break and the height of the box is not part of the arithmetic.
     Two page sizes, one a whole number of rows of content and one deliberately
     not, and both hold.
  */
  test.skip(browserName !== "chromium", "only Chromium renders a PDF here");

  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });
  const fitted = await page.evaluate(() =>
    (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => {
          unavailable: boolean;
          families: { steps: { leading: number; space: number }[] }[];
        };
      };
    }).quoinFit.fitScale(
      [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24 }] }],
      { pitch: 8 }
    )
  );
  if (fitted.unavailable) {
    test.skip(true, "no text-box-trim");
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  const rule =
    `p { font-size:17px; line-height:${step.leading}px; margin:0; ` +
    `padding:${step.space}px 0 0; text-box-trim: trim-both; ` +
    `text-box-edge: cap alphabetic }`;

  /* 624pt tall with 24pt margins is 576pt of content, which is 96 rows exactly.
     800pt with 24pt margins is 752pt, which is 125.33 rows, and that is the
     point. */
  for (const [height, margin, rows] of [
    [624, 24, "96 exactly"],
    [800, 24, "125.33"],
  ] as const) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      @page { size: 600pt ${height}pt; margin: ${margin}pt }
      html { font-family: serif } body { margin: 0 }
      ${rule}
    </style>
    ${Array.from(
      { length: 40 },
      (_, i) =>
        `<p>Paragraph ${i + 1}, written at a length that wraps onto two or three ` +
        `lines so the flow carries down the page and breaks several times over.</p>`
    ).join("\n")}`);
    await page.evaluate(() => document.fonts?.ready);

    const bytes = await page.pdf({ preferCSSPageSize: true });
    const rendered = readPdfText(new Uint8Array(bytes), (b) => new Uint8Array(inflateSync(b)));
    const perPage = rendered.map((p) => baselinesFromTop(p));

    /* Every page's first baseline sits the same distance below the top of its
       page box, which is the whole claim. */
    const firsts = perPage.map((tops) => tops[0] ?? 0);
    expect(rendered.length, `${rows} rows: one page is not a test of pagination`).toBeGreaterThan(1);
    for (const first of firsts) {
      expect(
        Math.abs(first - firsts[0]!),
        `page content ${rows} rows tall: pages start at ${firsts.map((f) => Math.round(f * 100) / 100).join(", ")}`
      ).toBeLessThanOrEqual(0.5);
    }

    /* And within a page the baselines are a whole number of rows apart. */
    for (const tops of perPage) {
      for (let i = 1; i < tops.length; i++) {
        const gap = tops[i]! - tops[i - 1]!;
        const r = ((gap % PITCH) + PITCH) % PITCH;
        expect(
          Math.min(r, PITCH - r),
          `${rows} rows: a ${Math.round(gap * 100) / 100}px gap is not a whole number of rows`
        ).toBeLessThanOrEqual(0.5);
      }
    }
  }
});
