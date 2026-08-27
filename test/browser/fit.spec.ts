/* Fitting a design to a grid without changing the design.

   The claim is specific and worth stating before the tests that check it: given
   a design's own sizes, `fitScale` returns those exact sizes, a leading snapped
   to whole rows, and a space that closes each size's cap residue, and a page
   built from that output is on the grid at every viewport width with no
   corrections and no media queries.

   The important half of these tests is the negative one. It would be easy to
   write a suite that only ever builds pages out of the fitter's own numbers and
   confirms they work, which proves the arithmetic is self-consistent and
   nothing else. So there are controls: the same page with the spacing left as
   the design wrote it, and the same page without the trim, both of which have
   to fail. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");

const WIDTHS = [320, 375, 414, 600, 768, 900, 1024, 1280, 1440];
const PITCH = 8;

/* Deliberately not round, and deliberately what a design would actually say:
   a ratio for the leading rather than a pixel value, and sizes nobody would
   arrive at by solving anything. */
const DESIGN = [
  {
    role: "display",
    font: "serif",
    steps: [
      { name: "h1", size: 44, ratio: 1.1, space: 48 },
      { name: "h2", size: 27, ratio: 1.2, space: 32 },
    ],
  },
  {
    role: "body",
    font: "serif",
    steps: [
      { name: "body", size: 17, ratio: 1.5, space: 24 },
      { name: "small", size: 13.5, ratio: 1.45, space: 16 },
    ],
  },
];

interface FittedStep {
  name: string;
  size: number;
  leading: number;
  leadingWas: number;
  leadingMoved: number;
  space: number;
  cap: number;
  residue: number;
}

const CONTENT = `
 <h1>A heading long enough that it wraps onto two lines on a phone and one on a laptop</h1>
 <p class="body">The first paragraph, written at enough length that it occupies two lines on a wide screen and considerably more than that on a narrow one, which is exactly the condition under which a stylesheet of absolute corrections stops describing the page it was measured against.</p>
 <h2>A subheading that also wraps at the narrow end of the range</h2>
 <p class="body">Another paragraph, again long enough to reflow several times across the widths under test here, so the number of lines above every later block changes as the viewport changes.</p>
 <ul>
   <li class="body">A list item long enough to wrap on a narrow viewport but not on a wide one</li>
   <li class="body">A second item</li>
 </ul>
 <blockquote class="body">A pulled quote, which reflows like everything else.</blockquote>
 <p class="small">A caption, set smaller, which also reflows.</p>
 <p class="body">A closing paragraph, below everything that has already moved.</p>`;

function pageFrom(
  steps: Record<string, FittedStep>,
  options: { trim?: boolean; honourSpacing?: boolean } = {}
): string {
  const trim = options.trim ?? true;
  const honour = options.honourSpacing ?? true;
  const rule = (selector: string, step: FittedStep) =>
    `${selector} { font-size:${step.size}px; line-height:${step.leading}px; ` +
    `margin:${honour ? step.space : step.leading}px 0 0 }`;

  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    ul { margin: 0; padding: 0 0 0 24px }
    blockquote { margin-left: 0; padding: 0; border: 0 }
    ${trim ? ":is(h1,h2,p,li,blockquote) { text-box-trim: trim-both; text-box-edge: cap alphabetic }" : ""}
    ${rule("h1", steps.h1!)}
    ${rule("h2", steps.h2!)}
    ${rule(".body", steps.body!)}
    ${rule(".small", steps.small!)}
  </style><main>${CONTENT}</main>`;
}

async function fit(browser: import("@playwright/test").Browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });
  const result = await page.evaluate(
    ({ design, pitch }) =>
      (window as unknown as {
        quoinFit: {
          fitScale: (f: unknown, o: unknown) => {
            unavailable: boolean;
            cost: number;
            origin: number;
            families: { role: string; resolved: boolean; steps: FittedStep[] }[];
          };
          fittedScaleToCss: (f: unknown) => string;
        };
      }).quoinFit.fitScale(design, { pitch }),
    { design: DESIGN, pitch: PITCH }
  );
  await page.close();
  return result;
}

async function measure(
  browser: import("@playwright/test").Browser,
  html: string,
  width: number
) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: BUNDLE });
  const report = await page.evaluate(
    ({ pitch }) => {
      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      return {
        onGrid: measured.report.onGrid,
        total: measured.report.total,
        drifts: measured.report.distinctDrifts,
        worst: measured.results
          .filter((r) => !r.onGrid)
          .slice(0, 3)
          .map((r) => `${r.path} ${Math.round(r.drift * 100) / 100}px`),
      };
    },
    { pitch: PITCH }
  );
  await page.close();
  return report;
}

test.describe.configure({ mode: "serial" });

test("it returns the design's own sizes, unchanged", async ({ browser, browserName }) => {
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const asked = DESIGN.flatMap((f) => f.steps.map((s) => s.size));
  const got = fitted.families.flatMap((f) => f.steps.map((s) => s.size));

  expect(got, "every size comes back exactly as it went in").toEqual(asked);
});

test("it moves the leading, says so, and moves nothing else", async ({
  browser,
  browserName,
}) => {
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const steps = fitted.families.flatMap((f) => f.steps);

  for (const step of steps) {
    expect(step.leading % PITCH, `${step.name} leading ${step.leading}`).toBe(0);
    expect(
      Math.round((step.leading - step.leadingWas) * 1000) / 1000,
      `${step.name} reports what it moved`
    ).toBe(step.leadingMoved);
    /* Snapping means nearest, so nothing should have travelled more than half a
       row to get there. */
    expect(Math.abs(step.leadingMoved), `${step.name} moved ${step.leadingMoved}`).toBeLessThanOrEqual(
      PITCH / 2
    );
  }

  /* The reported cost is exactly the leading movement and nothing else, because
     nothing else is allowed to move. */
  const total = steps.reduce((sum, s) => sum + Math.abs(s.leadingMoved), 0);
  expect(Math.round(total * 1000) / 1000).toBe(fitted.cost);
});

test("each space closes its own cap residue", async ({ browser, browserName }) => {
  /* The arithmetic the whole thing rests on, checked directly rather than
     inferred from a page that happens to work. */
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  for (const step of fitted.families.flatMap((f) => f.steps)) {
    const closes = (step.space + step.cap) % PITCH;
    expect(
      Math.min(closes, PITCH - closes),
      `${step.name}: space ${step.space} plus cap ${step.cap} is not a whole number of rows`
    ).toBeLessThan(0.01);
  }
});

test("a page built from the fit is on the grid at every width", async ({
  browser,
  browserName,
}) => {
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const steps = Object.fromEntries(
    fitted.families.flatMap((f) => f.steps).map((s) => [s.name, s])
  ) as Record<string, FittedStep>;

  const html = pageFrom(steps);
  const readings: string[] = [];

  for (const width of WIDTHS) {
    const report = await measure(browser, html, width);
    readings.push(`${width}px ${report.onGrid}/${report.total}`);
    expect(
      report.onGrid,
      `at ${width}px: ${report.onGrid}/${report.total}, ${report.drifts} distinct drifts, ` +
        `worst ${JSON.stringify(report.worst)}`
    ).toBe(report.total);
    expect(report.total, `at ${width}px the page rendered`).toBeGreaterThan(7);
  }

  console.log(`\n  ${browserName}: ${readings.join("  ")}\n`);
});

test("the same page fails when the spacing is the design's rather than the fit's", async ({
  browser,
  browserName,
}) => {
  /*
     The control that makes the result above mean something. Identical page,
     identical trim, identical sizes and leadings, with the space left at what
     the design originally wrote. If this also passed, the fitter would be
     computing a number that changes nothing.
  */
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const steps = Object.fromEntries(
    fitted.families.flatMap((f) => f.steps).map((s) => [s.name, s])
  ) as Record<string, FittedStep>;

  const report = await measure(browser, pageFrom(steps, { honourSpacing: false }), 1024);

  expect(
    report.onGrid / report.total,
    `without the fitted spacing the page still measured ${report.onGrid}/${report.total}, ` +
      "so the spacing is not what puts it on the grid"
  ).toBeLessThan(0.75);
});

test("the same page fails without the trim", async ({ browser, browserName }) => {
  /*
     The second control. Every figure the fitter produces assumes the box is
     trimmed to its cap height, and the emitted CSS says the trim is required.
     This is what "required" means.
  */
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const steps = Object.fromEntries(
    fitted.families.flatMap((f) => f.steps).map((s) => [s.name, s])
  ) as Record<string, FittedStep>;

  const report = await measure(browser, pageFrom(steps, { trim: false }), 1024);

  expect(
    report.onGrid / report.total,
    `without the trim the page measured ${report.onGrid}/${report.total}, ` +
      "so the trim is not actually required and the CSS should stop saying it is"
  ).toBeLessThan(0.75);
});

test("a font that did not render is reported rather than silently fitted", async ({
  browser,
  browserName,
}) => {
  const page = await browser.newPage();
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });

  const result = await page.evaluate(
    ({ pitch }) =>
      (window as unknown as {
        quoinFit: {
          fitScale: (f: unknown, o: unknown) => {
            unavailable: boolean;
            families: { role: string; resolved: boolean }[];
          };
        };
      }).quoinFit.fitScale(
        [
          { role: "real", font: "serif", steps: [{ size: 16, ratio: 1.5 }] },
          {
            role: "imaginary",
            font: "Nothing Called This Exists, serif",
            steps: [{ size: 16, ratio: 1.5 }],
          },
        ],
        { pitch }
      ),
    { pitch: PITCH }
  );
  await page.close();

  if (result.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  expect(result.families[0]!.resolved, "a generic keyword always resolves").toBe(true);
  expect(
    result.families[1]!.resolved,
    "a family nobody has did not render, and the fit describes a fallback"
  ).toBe(false);
});

test("a stack resolves on its first name, not on the whole stack", async ({
  browser,
  browserName,
}) => {
  /*
     `fontIsAvailable("Georgia, serif")` asks whether a family literally called
     `Georgia, serif` exists, which nothing is, so every realistic design came
     back marked as not having rendered. A warning that fires on every correct
     input is a warning people learn to ignore.
  */
  const page = await browser.newPage();
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });

  const result = await page.evaluate(
    ({ pitch }) =>
      (window as unknown as {
        quoinFit: {
          fitScale: (f: unknown, o: unknown) => {
            unavailable: boolean;
            families: { resolved: boolean }[];
          };
        };
      }).quoinFit.fitScale(
        [{ role: "body", font: "monospace, serif", steps: [{ size: 16, ratio: 1.5 }] }],
        { pitch }
      ),
    { pitch: PITCH }
  );
  await page.close();

  if (result.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  expect(result.families[0]!.resolved).toBe(true);
});

test("the CSS it emits is the thing that works, not just the numbers", async ({
  browser,
  browserName,
}) => {
  /*
     Everything above builds a page out of the fitted figures. That checks the
     arithmetic and not the deliverable: the deliverable is a stylesheet, and a
     stylesheet can be wrong in ways a number cannot. This injects the emitted
     CSS verbatim, wires the custom properties up the way its own comment says
     to, and measures the result.

     The equivalent test for `exportCss` did not exist for four months, during
     which that function produced a stylesheet which matched nothing at all.
  */
  const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await setup.setContent("<p>probe</p>");
  await setup.addScriptTag({ content: FIT_BUNDLE });
  const emitted = await setup.evaluate(
    ({ design, pitch }) => {
      const api = (window as unknown as {
        quoinFit: {
          fitScale: (f: unknown, o: unknown) => { unavailable: boolean };
          fittedScaleToCss: (f: unknown) => string;
        };
      }).quoinFit;
      const fitted = api.fitScale(design, { pitch });
      return { css: api.fittedScaleToCss(fitted), unavailable: fitted.unavailable };
    },
    { design: DESIGN, pitch: PITCH }
  );
  await setup.close();

  if (emitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  /* The trim rule comes out of the emitted CSS itself, so only the wiring is
     written here, which is the part the comment in that CSS tells an author to
     write. */
  const wiring = `
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    ul { margin: 0; padding: 0 0 0 24px }
    blockquote { margin-left: 0; padding: 0; border: 0 }
    h1 { font-size: var(--size-h1); line-height: var(--leading-h1); margin: var(--space-h1) 0 0 }
    h2 { font-size: var(--size-h2); line-height: var(--leading-h2); margin: var(--space-h2) 0 0 }
    .body { font-size: var(--size-body); line-height: var(--leading-body); margin: var(--space-body) 0 0 }
    .small { font-size: var(--size-small); line-height: var(--leading-small); margin: var(--space-small) 0 0 }`;

  const html =
    `<!doctype html><meta charset="utf-8"><style>${emitted.css}</style>` +
    `<style>${wiring}</style><main>${CONTENT}</main>`;

  for (const width of [320, 768, 1440]) {
    const report = await measure(browser, html, width);
    expect(
      report.onGrid,
      `emitted CSS at ${width}px: ${report.onGrid}/${report.total}, worst ${JSON.stringify(report.worst)}`
    ).toBe(report.total);
  }
});
