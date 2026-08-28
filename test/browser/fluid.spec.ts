/* Fluid type on a baseline grid.

   The README said this was impossible, and said so without testing it. The
   reasoning was sound as far as it went: under the cap basis a block's phase is
   `size x capRatio`, so a size that varies continuously with the viewport has a
   phase that varies continuously too, and is on the grid only at whichever
   widths happen to land.

   What that reasoning missed is that the space does not have to be written down.
   CSS Values 4 has `mod()`, so the same arithmetic the fitter does at build time
   can be done by the browser at layout time:

       space = N x pitch - mod(size x capRatio, pitch)

   Both are supported wherever `text-box-trim` is, which makes sense: a page that
   can use one can use the other.

   Measured, `clamp(28px, 5vw, 56px)` goes from on the grid at no width to on the
   grid at every width. That is fluid typography on a baseline grid, and the only
   thing that cannot be fluid is the leading, which has to be a whole number of
   rows or the second line of every paragraph is off. There is no continuum of
   whole numbers. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");

/* Deliberately dense at the low end, where a fluid size changes fastest per
   pixel of viewport and a spacing rule that is merely close comes apart. */
const WIDTHS = [320, 360, 400, 440, 520, 600, 700, 840, 1000, 1200, 1440];
const PITCH = 8;

const CONTENT = `
  <h1 class="display">A fluid heading that grows with the viewport and wraps differently at each end</h1>
  <p class="body">A paragraph long enough to reflow several times across the widths under test here, so the number of lines above every later block changes as the viewport does.</p>
  <p class="body">A second paragraph, below the first.</p>
  <p class="body">A third, below that, so a drift that accumulates has room to show.</p>`;

function pageFrom(rules: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    :is(h1,p) { text-box-trim: trim-both; text-box-edge: cap alphabetic }
    :root { --pitch: ${PITCH}px }
    ${rules}
  </style><main>${CONTENT}</main>`;
}

async function measureAcross(
  browser: import("@playwright/test").Browser,
  html: string
): Promise<{ width: number; onGrid: number; total: number }[]> {
  const readings = [];
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });
    const report = await page.evaluate(
      ({ pitch }) => {
        const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
        return { onGrid: measured.report.onGrid, total: measured.report.total };
      },
      { pitch: PITCH }
    );
    await page.close();
    readings.push({ width, ...report });
  }
  return readings;
}

test.describe.configure({ mode: "serial" });

test("mod() is available wherever the trim is", async ({ page, browserName }) => {
  /*
     The whole method rests on both being present together. If an engine ever
     ships one without the other, fluid fitting has to grow a fallback and this
     is where that shows up.
  */
  const support = await page.evaluate(() => ({
    mod: CSS.supports("margin-top", "mod(3px, 2px)"),
    trim: CSS.supports("text-box-trim", "trim-both"),
  }));

  if (!support.trim) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  expect(
    support.mod,
    `${browserName} supports text-box-trim and not mod(), so a fluid fit needs a fallback here`
  ).toBe(true);
});

test("a fluid size with fixed spacing is off the grid at every width", async ({
  browser,
  browserName,
}) => {
  /*
     The control, and it runs first. If this ever passes, the test below proves
     nothing, because the page was on the grid before anything was done to it.
  */
  const probe = await browser.newPage();
  await probe.setContent("<p>x</p>");
  const supported = await probe.evaluate(() =>
    CSS.supports("text-box-trim", "trim-both")
  );
  await probe.close();
  if (!supported) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const readings = await measureAcross(
    browser,
    pageFrom(`
      h1 { font-size: clamp(28px, 5vw, 56px); line-height: 64px; margin: 48px 0 0 }
      p  { font-size: 17px; line-height: 24px; margin: 24px 0 0 }`)
  );

  const best = Math.max(...readings.map((r) => r.onGrid / r.total));
  expect(
    best,
    `the unfitted page reached ${Math.round(best * 100)}% somewhere, so the fluid ` +
      "size was not actually a problem and the test below is measuring nothing"
  ).toBeLessThan(0.5);
});

test("the same fluid size stays on the grid at every width when the space follows it", async ({
  browser,
  browserName,
}) => {
  const probe = await browser.newPage();
  await probe.setContent("<p>x</p>");
  const supported = await probe.evaluate(
    () =>
      CSS.supports("text-box-trim", "trim-both") && CSS.supports("margin-top", "mod(3px, 2px)")
  );
  await probe.close();
  if (!supported) {
    test.skip(true, `${browserName} has no text-box-trim or no mod()`);
    return;
  }

  /* The cap ratio for the generic serif in these engines. Read rather than
     assumed, because a wrong ratio would fail this test for the wrong reason. */
  const ratioPage = await browser.newPage();
  await ratioPage.setContent("<p>x</p>");
  await ratioPage.addScriptTag({ content: BUNDLE });
  const ratio = await ratioPage.evaluate(
    () => window.quoin.capHeightFromFontTable("1000px serif")! / 1000
  );
  await ratioPage.close();

  const readings = await measureAcross(
    browser,
    pageFrom(`
      h1 {
        --size: clamp(28px, 5vw, 56px);
        --cap: calc(var(--size) * ${ratio});
        font-size: var(--size);
        line-height: 64px;
        margin: calc(6 * var(--pitch) - mod(var(--cap), var(--pitch))) 0 0;
      }
      p {
        --cap: calc(17px * ${ratio});
        font-size: 17px;
        line-height: 24px;
        margin: calc(3 * var(--pitch) - mod(var(--cap), var(--pitch))) 0 0;
      }`)
  );

  console.log(
    `\n  ${browserName}: ` +
      readings.map((r) => `${r.width}px ${r.onGrid}/${r.total}`).join("  ") +
      "\n"
  );

  for (const reading of readings) {
    expect(
      reading.onGrid,
      `at ${reading.width}px: ${reading.onGrid}/${reading.total}`
    ).toBe(reading.total);
  }
});

test("the fitter emits that rule rather than making somebody derive it", async ({
  browser,
  browserName,
}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });

  const emitted = await page.evaluate(() => {
    const api = (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => { unavailable: boolean };
        fittedScaleToCss: (f: unknown) => string;
      };
    }).quoinFit;

    const fitted = api.fitScale(
      [
        {
          role: "display",
          font: "serif",
          steps: [
            {
              name: "display",
              size: 40,
              leading: 64,
              space: 48,
              fluid: { min: 28, max: 56, preferred: "5vw" },
            },
            { name: "body", size: 17, ratio: 1.5, space: 24 },
          ],
        },
      ],
      { pitch: 8 }
    );

    return { css: api.fittedScaleToCss(fitted), unavailable: fitted.unavailable };
  });
  await page.close();

  if (emitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  expect(emitted.css, "the size is a clamp").toContain(
    "--size-display: clamp(28px, 5vw, 56px)"
  );
  expect(emitted.css, "the cap is an expression, not a number").toMatch(
    /--cap-display: calc\(var\(--size-display\) \* [\d.]+\)/
  );
  expect(emitted.css, "and the space is computed from it").toMatch(
    /--space-display: calc\(\d+ \* var\(--pitch\) - mod\(var\(--cap-display\), var\(--pitch\)\)\)/
  );

  /* The fixed step alongside it stays a plain number, because it needs no
     arithmetic at runtime and a calc there would be noise. */
  expect(emitted.css).toMatch(/--space-body: [\d.]+px/);

  expect(emitted.css, "and it says what cannot be fluid").toMatch(/leading cannot be fluid/);
});

test("a page built from the fitter's own fluid CSS holds at every width", async ({
  browser,
  browserName,
}) => {
  /*
     End to end, through the emitted stylesheet rather than through a rule
     written by hand in this file. The equivalent test for `exportCss` did not
     exist for four months, during which it produced CSS that matched nothing.
  */
  const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await setup.setContent("<p>probe</p>");
  await setup.addScriptTag({ content: FIT_BUNDLE });

  const emitted = await setup.evaluate(() => {
    const api = (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => { unavailable: boolean };
        fittedScaleToCss: (f: unknown) => string;
      };
    }).quoinFit;
    const fitted = api.fitScale(
      [
        {
          role: "t",
          font: "serif",
          steps: [
            {
              name: "display",
              size: 40,
              leading: 64,
              space: 48,
              fluid: { min: 28, max: 56, preferred: "5vw" },
            },
            { name: "body", size: 17, ratio: 1.5, space: 24 },
          ],
        },
      ],
      { pitch: 8 }
    );
    return { css: api.fittedScaleToCss(fitted), unavailable: fitted.unavailable };
  });
  await setup.close();

  if (emitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const html = `<!doctype html><meta charset="utf-8">
    <style>${emitted.css}</style>
    <style>
      html { font-family: serif } body { margin: 0 }
      main { width: 92%; max-width: 760px; margin: 0 auto }
      .display { font-size: var(--size-display); line-height: var(--leading-display); margin: var(--space-display) 0 0 }
      .body { font-size: var(--size-body); line-height: var(--leading-body); margin: var(--space-body) 0 0 }
    </style><main>${CONTENT}</main>`;

  const readings = await measureAcross(browser, html);
  for (const reading of readings) {
    expect(
      reading.onGrid,
      `emitted CSS at ${reading.width}px: ${reading.onGrid}/${reading.total}`
    ).toBe(reading.total);
  }
});
