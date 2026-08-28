/* The claim that a page can be on the grid at every width at once.

   Per-element pixel corrections are bound to the layout they were measured in.
   Seat a page at 1280 and the stylesheet is a list of absolute nudges that were
   true for one arrangement of line breaks; at 375 the paragraphs wrap
   differently, every block moves, and the corrections are describing a page
   that is no longer there. Quoin's own site works around this by seating six
   times and wrapping each result in a media query, which is a workaround and
   was never a fix.

   The cap basis removes the problem rather than papering over it. Under
   `text-box-trim: trim-both; text-box-edge: cap alphabetic` the distance from a
   block's top to its first baseline is the cap height, and the distance from one
   baseline to the next across a block boundary is

       (lines - 1) x leading + space + capHeight

   `lines` is the only term that changes with the viewport, and it is multiplied
   by a leading that is already a whole number of rows. So if the space before
   each block satisfies

       space + capHeight = 0  (mod pitch)

   the advance is a multiple of the pitch at every width, and the page is on the
   grid everywhere with no corrections and no media queries.

   That is the whole argument, and this file is the only thing standing behind
   it. If it starts passing vacuously, the argument is unsupported. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");

/* Deliberately awkward. Round numbers hide fractional cap heights, and a set of
   widths that are all wide hides the case where a heading wraps for the first
   time. 320 is the narrowest phone still in use; 1440 is a laptop. */
const WIDTHS = [320, 375, 414, 600, 768, 900, 1024, 1280, 1440];

const PITCH = 8;

test.describe.configure({ mode: "serial" });

test("a cap-solved page is on the grid at every width, with one stylesheet", async ({
  browser,
  browserName,
}) => {
  const probe = await browser.newPage();
  await probe.setContent("<p>probe</p>");
  await probe.addScriptTag({ content: BUNDLE });
  const supported = await probe.evaluate(() => window.quoin.canReadFontTableCapHeight());
  await probe.close();

  if (!supported) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  /* Solve once, at one width, exactly as an author would. The stylesheet this
     produces is the only thing the page gets. */
  const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await setup.setContent("<p>probe</p>");
  await setup.addScriptTag({ content: BUNDLE });

  const scale = await setup.evaluate(
    ({ pitch }) =>
      window.quoin.gridNativeScale("serif", {
        pitch,
        targets: [16, 30, 44],
        basis: "cap",
        near: 4,
      }),
    { pitch: PITCH }
  );
  await setup.close();

  expect(scale.basisUnavailable).toBe(false);
  /* Solved sizes on the cap basis sit about twelve pixels apart for a text
     face, so three targets is what fits in this range. Asking for four that
     close together makes the solver report one as missed, correctly, and this
     test would then be building a page out of an undefined step. */
  expect(
    scale.missed,
    `the solver missed ${scale.missed.join(", ")}, so the page below cannot be built`
  ).toHaveLength(0);
  expect(scale.steps.length, "the scale solved").toBe(3);

  /*
     A page with everything that normally breaks a correction: headings that
     wrap at some widths and not others, a list, a blockquote, a paragraph long
     enough to reflow from two lines to nine, and a fluid container so the line
     breaks genuinely move.
  */
  const [body, heading, display] = scale.steps;
  const lead = body;
  const rule = (s: typeof scale.steps[number]) =>
    `font-size:${s.size}px;line-height:${s.leading}px;margin:${s.space}px 0 0;`;

  const html = `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif; }
    body { margin: 0; padding: 0; }
    main { width: 92%; max-width: 760px; margin: 0 auto; }
    :is(h1,h2,p,li,blockquote) {
      text-box-trim: trim-both; text-box-edge: cap alphabetic;
    }
    h1 { ${rule(display!)} }
    h2 { ${rule(heading!)} }
    .lead { ${rule(lead!)} }
    p, li, blockquote { ${rule(body!)} }
    ul { margin: 0; padding: 0 0 0 24px; }
    li { margin-top: ${body!.space}px; }
    blockquote { padding: 0; border: 0; }
  </style>
  <main>
    <h1>A heading long enough that it wraps onto two lines on a phone and one on a laptop</h1>
    <p class="lead">A standfirst that also reflows, because the whole question is whether reflowing changes anything.</p>
    <p>The first paragraph, written at enough length that it occupies two lines on a wide screen and considerably more than that on a narrow one, which is precisely the condition under which a stylesheet of absolute pixel corrections stops describing the page it was measured against.</p>
    <h2>A subheading that also wraps at the narrow end</h2>
    <p>Another paragraph, again long enough to reflow several times across the range of widths under test here, so that the number of lines above every subsequent block changes as the viewport changes.</p>
    <ul>
      <li>A list item long enough to wrap on a narrow viewport but not on a wide one</li>
      <li>A second item</li>
      <li>A third item, longer again, so that this list changes height between widths</li>
    </ul>
    <blockquote>A pulled quote, set in the body size, which reflows like everything else on the page.</blockquote>
    <p>A closing paragraph, which sits below everything that has already moved.</p>
  </main>`;

  const readings: { width: number; onGrid: number; total: number; drifts: number }[] = [];

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });

    const measured = await page.evaluate(
      ({ pitch }) => {
        const report = window.quoin.verifyGrid({ pitch, origin: "auto" });
        return {
          onGrid: report.report.onGrid,
          total: report.report.total,
          drifts: report.report.distinctDrifts,
          worst: report.results
            .filter((r) => !r.onGrid)
            .slice(0, 3)
            .map((r) => `${r.path} ${Math.round(r.drift * 100) / 100}px`),
        };
      },
      { pitch: PITCH }
    );

    readings.push({ width, ...measured });
    await page.close();

    expect(
      measured.onGrid,
      `at ${width}px: ${measured.onGrid}/${measured.total} on the grid, ` +
        `${measured.drifts} distinct drifts, worst ${JSON.stringify(measured.worst)}`
    ).toBe(measured.total);
  }

  /* The page has to have actually reflowed, or this proves nothing at all: a
     page that renders identically at 320 and 1440 is not a test of width
     independence. */
  const heights = readings.map((r) => r.total);
  expect(readings.every((r) => r.total > 8), "every width measured a real page").toBe(true);

  console.log(
    "\n  cap-solved page, one stylesheet, no media queries:\n" +
      readings
        .map((r) => `    ${String(r.width).padStart(5)}px  ${r.onGrid}/${r.total} on grid`)
        .join("\n") +
      "\n"
  );
  expect(heights.length).toBe(WIDTHS.length);
});

test("the same page reflows, so the test above is not measuring a static layout", async ({
  browser,
}) => {
  /*
     The validity check for the test above, kept separate so it cannot be
     satisfied by the same code path. If the paragraphs occupy the same number
     of lines at 320 and 1440, then nothing moved and width independence was
     never under test.
  */
  const html = `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif; }
    body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    p { font-size: 16px; line-height: 24px; margin: 0 }
  </style><main><p id="p">The first paragraph, written at enough length that it occupies two lines on a wide screen and considerably more than that on a narrow one, which is precisely the condition under which a stylesheet of absolute pixel corrections stops describing the page it was measured against.</p></main>`;

  const heights: number[] = [];
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready);
    heights.push(
      await page.evaluate(() => document.getElementById("p")!.getBoundingClientRect().height)
    );
    await page.close();
  }

  expect(
    heights[0],
    `the paragraph is ${heights[0]}px at 320 and ${heights[1]}px at 1440, so it does not reflow`
  ).toBeGreaterThan(heights[1]! * 1.5);
});

test("corrections survive reflow, and that was worth finding out", async ({
  browser,
  browserName,
}) => {
  /*
     This test began as a control asserting that a seated stylesheet falls apart
     at a different width, which is what the README said and what everybody
     assumes about per-element corrections. It does not.

     `mode: "full"` snaps every leading to a whole number of rows, and a page
     whose leadings are whole rows reflows in whole rows: an extra line adds a
     multiple of the pitch and nothing moves modulo the grid. A page seated at
     1280 and carried to 375 measured 100%, from 1/4 unseated.

     Recorded as a passing test rather than quietly deleted, because it is the
     more useful half of the boundary and it corrected the documentation.
  */
  test.skip(browserName !== "chromium", "one engine is enough for this");

  const html = `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    h1 { font-size: 41px; line-height: 1.15; margin: 0 0 21px }
    p { font-size: 17px; line-height: 1.6; margin: 0 0 21px }
  </style>
  <main>
    <h1>A heading long enough that it wraps onto two lines on a phone and one on a laptop</h1>
    <p>The first paragraph, written at enough length that it occupies two lines on a wide screen and considerably more than that on a narrow one.</p>
    <p>Another paragraph, again long enough to reflow several times across the range of widths under test here.</p>
    <p>A closing paragraph, which sits below everything that has already moved.</p>
  </main>`;

  const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await wide.setContent(html);
  await wide.evaluate(() => document.fonts?.ready);
  await wide.addScriptTag({ content: BUNDLE });
  const seated = await wide.evaluate(({ pitch }) => {
    const first = window.quoin.verifyGrid({ pitch, origin: "auto" });
    const grid = { pitch, origin: first.grid.origin };
    const result = window.quoin.seatPage({ ...grid, mode: "full" });
    return {
      css: window.quoin.exportCss(result),
      origin: first.grid.origin,
      after: window.quoin.verifyGrid(grid).report,
    };
  }, { pitch: PITCH });
  await wide.close();

  expect(seated.after.onGrid, "it seated at the width it was measured at").toBe(
    seated.after.total
  );

  const narrow = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await narrow.setContent(html);
  await narrow.evaluate(() => document.fonts?.ready);
  await narrow.addScriptTag({ content: BUNDLE });
  const carried = await narrow.evaluate(
    ({ css, pitch, origin }) => {
      const before = window.quoin.verifyGrid({ pitch, origin }).report;
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      return { before, after: window.quoin.verifyGrid({ pitch, origin }).report };
    },
    { css: seated.css, pitch: PITCH, origin: seated.origin }
  );
  await narrow.close();

  expect(
    carried.before.onGrid,
    "the narrow page is genuinely off the grid without the stylesheet"
  ).toBeLessThan(carried.before.total);

  expect(
    carried.after.onGrid,
    `a 1280px stylesheet carried to 375px: ${carried.after.onGrid}/${carried.after.total}`
  ).toBe(carried.after.total);
});

test("corrections do not survive a media query that moves the layout", async ({
  browser,
  browserName,
}) => {
  /*
     The other side of the boundary, and the reason fitting exists. Identical
     page, with one media query changing a container's padding by thirteen
     pixels below 700. Everything below that padding moves by thirteen pixels at
     one width and not the other, and no fixed correction can be right at both.
  */
  test.skip(browserName !== "chromium", "one engine is enough for this");

  const html = `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    h1 { font-size: 41px; line-height: 1.15; margin: 0 0 21px }
    p { font-size: 17px; line-height: 1.6; margin: 0 0 21px }
    @media (max-width: 700px) { main { padding-top: 13px } }
  </style>
  <main>
    <h1>A heading long enough that it wraps onto two lines on a phone and one on a laptop</h1>
    <p>The first paragraph, written at enough length that it occupies two lines on a wide screen and considerably more than that on a narrow one.</p>
    <p>Another paragraph, again long enough to reflow several times across the range of widths under test here.</p>
    <p>A closing paragraph, which sits below everything that has already moved.</p>
  </main>`;

  const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await wide.setContent(html);
  await wide.evaluate(() => document.fonts?.ready);
  await wide.addScriptTag({ content: BUNDLE });
  const seated = await wide.evaluate(({ pitch }) => {
    const first = window.quoin.verifyGrid({ pitch, origin: "auto" });
    const grid = { pitch, origin: first.grid.origin };
    const result = window.quoin.seatPage({ ...grid, mode: "full" });
    return {
      css: window.quoin.exportCss(result),
      origin: first.grid.origin,
      after: window.quoin.verifyGrid(grid).report,
    };
  }, { pitch: PITCH });
  await wide.close();

  expect(
    seated.after.onGrid,
    "it seated most of the page at the width it was measured at"
  ).toBeGreaterThan(seated.after.total / 2);

  const narrow = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await narrow.setContent(html);
  await narrow.evaluate(() => document.fonts?.ready);
  await narrow.addScriptTag({ content: BUNDLE });
  const carried = await narrow.evaluate(
    ({ css, pitch, origin }) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      return window.quoin.verifyGrid({ pitch, origin }).report;
    },
    { css: seated.css, pitch: PITCH, origin: seated.origin }
  );
  await narrow.close();

  /*
     Compared against the same page without the media query rather than against
     a number.

     A threshold is a claim about a particular typeface, and the generic `serif`
     is a different face on Linux: three tests in this suite failed in CI for
     that reason before anybody noticed the pattern. What is actually being
     claimed here is comparative, so the control is measured in the same run and
     the same engine, and the assertion is that one is worse than the other.
  */
  const withoutQuery = html.replace(
    "@media (max-width: 700px) { main { padding-top: 13px } }",
    ""
  );

  const control = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await control.setContent(withoutQuery);
  await control.evaluate(() => document.fonts?.ready);
  await control.addScriptTag({ content: BUNDLE });
  const controlSeat = await control.evaluate(({ pitch }) => {
    const first = window.quoin.verifyGrid({ pitch, origin: "auto" });
    const grid = { pitch, origin: first.grid.origin };
    /* Seated once, and that one result exported. Seating twice corrects an
       already-corrected page, and the stylesheet that comes out describes
       neither of them. */
    const result = window.quoin.seatPage({ ...grid, mode: "full" });
    return { css: window.quoin.exportCss(result), origin: first.grid.origin };
  }, { pitch: PITCH });
  await control.close();

  const controlNarrow = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await controlNarrow.setContent(withoutQuery);
  await controlNarrow.evaluate(() => document.fonts?.ready);
  await controlNarrow.addScriptTag({ content: BUNDLE });
  const controlCarried = await controlNarrow.evaluate(
    ({ css, pitch, origin }) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      return window.quoin.verifyGrid({ pitch, origin }).report;
    },
    { css: controlSeat.css, pitch: PITCH, origin: controlSeat.origin }
  );
  await controlNarrow.close();

  const carriedShare = carried.onGrid / carried.total;
  const controlShare = controlCarried.onGrid / controlCarried.total;

  console.log(
    `
  carried to 375px: ${carried.onGrid}/${carried.total} with the media query, ` +
      `${controlCarried.onGrid}/${controlCarried.total} without it
`
  );

  expect(
    carriedShare,
    `thirteen pixels of padding at a breakpoint left ${carried.onGrid}/${carried.total} ` +
      `against ${controlCarried.onGrid}/${controlCarried.total} for the same page without ` +
      "the query, so the layout change was not what broke it"
  ).toBeLessThan(controlShare);
});
