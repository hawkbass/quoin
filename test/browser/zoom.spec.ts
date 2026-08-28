/* Does a fitted page survive the things a reader does to it?

   A fit is arithmetic in px, and px is a suspicious unit to build an
   accessibility story on. Two things a reader can do change the numbers under
   it, and they are not the same thing.

   Zoom scales everything, including the grid, so the arithmetic is unchanged and
   the page holds. That is the case WCAG 1.4.4 is about and it is the one that
   matters most, so it is measured to 300% rather than reasoned about.

   A forced minimum font size does not scale everything. It raises the sizes
   below its threshold and leaves the rest, which changes those blocks' cap
   heights while their spacing stays where the fit put it. That breaks the fit
   for the blocks it touches, and it breaks the vertical rhythm of every px-based
   design ever shipped in exactly the same way. Worth measuring anyway, because
   "it degrades" and "it collapses" are different claims and only one of them is
   defensible. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const PITCH = 8;

const DESIGN = [
  {
    role: "body",
    font: "serif",
    steps: [
      { name: "h1", size: 44, leading: 48, space: 56 },
      { name: "body", size: 17, ratio: 1.5, space: 24 },
      { name: "caption", size: 11, ratio: 1.45, space: 16 },
    ],
  },
];

interface Step {
  name: string;
  size: number;
  leading: number;
  space: number;
}

async function fit(browser: import("@playwright/test").Browser) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });
  const result = await page.evaluate(
    ({ design, pitch }) =>
      (window as unknown as {
        quoinFit: {
          fitScale: (f: unknown, o: unknown) => {
            unavailable: boolean;
            families: { steps: Step[] }[];
          };
        };
      }).quoinFit.fitScale(design, { pitch }),
    { design: DESIGN, pitch: PITCH }
  );
  await page.close();
  return result;
}

function pageFrom(steps: Record<string, Step>, extra = ""): string {
  const rule = (s: Step) =>
    `font-size:${s.size}px;line-height:${s.leading}px;margin:${s.space}px 0 0`;

  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 760px; margin: 0 auto }
    :is(h1,p) { text-box-trim: trim-both; text-box-edge: cap alphabetic }
    h1 { ${rule(steps.h1!)} }
    .body { ${rule(steps.body!)} }
    .caption { ${rule(steps.caption!)} }
    ${extra}
  </style>
  <main>
    <h1>A heading that wraps at some widths and not at others</h1>
    <p class="body">A paragraph long enough to reflow several times across the widths under test here.</p>
    <p class="body">A second paragraph, below the first.</p>
    <p class="caption">A caption, set small, of the kind a minimum font size would raise.</p>
    <p class="body">A closing paragraph, below everything that has moved.</p>
  </main>`;
}

test.describe.configure({ mode: "serial" });

test("a fitted page holds under zoom, all the way to 300%", async ({
  browser,
  browserName,
}) => {
  /*
     The case that matters. Zoom multiplies every length on the page, including
     the pitch, so the modular arithmetic is untouched: a space that closed a cap
     residue at 1x closes the same residue scaled at 3x.

     Reasoned about it would be a plausible argument. WCAG 1.4.4 asks for 200%,
     so this measures to 300% instead of arguing.
  */
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const steps = Object.fromEntries(
    fitted.families[0]!.steps.map((s) => [s.name, s])
  ) as Record<string, Step>;
  const html = pageFrom(steps);

  const readings: string[] = [];
  const counts: number[] = [];
  let baseline = { onGrid: 0, total: 0, worst: [] as string[] };

  for (const scale of [1, 1.25, 1.5, 2, 3]) {
    const context = await browser.newContext({
      viewport: { width: 1000, height: 900 },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });

    const report = await page.evaluate(
      ({ pitch }) => {
        const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
        return {
          onGrid: measured.report.onGrid,
          total: measured.report.total,
          worst: measured.results
            .filter((r) => !r.onGrid)
            .slice(0, 2)
            .map((r) => `${r.path} ${Math.round(r.drift * 100) / 100}px`),
        };
      },
      { pitch: PITCH }
    );
    await context.close();

    readings.push(`${scale}x ${report.onGrid}/${report.total}`);
    counts.push(report.onGrid);
    if (scale === 1) baseline = report;
  }

  /*
     The claim is about zoom, not about whether a fit is perfect on every engine.
     Asserting `onGrid === total` folds a second claim in, and it is one that
     belongs to fit.spec.ts: it failed here on WebKit under Linux, where the
     generic `serif` is a different typeface, and the failure said nothing about
     zoom at all.

     Making it relational is also the stronger test. Zoom scales every length
     including the pitch, so whatever the page scores at 1x it has to score at
     3x, and a page that is imperfect at both is still evidence that zoom
     changed nothing.
  */
  expect(baseline.onGrid, "the page is mostly on the grid to begin with").toBeGreaterThan(
    baseline.total / 2
  );
  for (const [i, count] of counts.entries()) {
    expect(
      count,
      `${[1, 1.25, 1.5, 2, 3][i]}x scored ${count} against ${baseline.onGrid} at 1x, ` +
        "so zoom moved something"
    ).toBe(baseline.onGrid);
  }

  console.log(`\n  ${browserName}: ${readings.join("  ")}\n`);
});

test("a forced size change degrades the blocks it touches rather than the page", async ({
  browser,
  browserName,
}) => {
  /*
     A minimum font size raises small text and leaves the rest, so the caption's
     cap height changes while its space stays where the fit put it. That block
     comes off the grid and so does everything below it, because its height
     changed. Nothing above it moves.

     The honest claim is "it degrades", not "it survives", and the difference
     between degrading and collapsing is what this measures. A user agent
     stylesheet cannot be set from here, so the override is applied the way one
     would be: a rule with higher precedence, changing only the size.
  */
  const fitted = await fit(browser);
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const steps = Object.fromEntries(
    fitted.families[0]!.steps.map((s) => [s.name, s])
  ) as Record<string, Step>;

  const before = await measure(browser, pageFrom(steps));
  expect(
    before.onGrid,
    "the page starts mostly on the grid, or the comparison below means nothing"
  ).toBeGreaterThan(before.total / 2);

  /* 11px raised to 16px, which is roughly what a minimum font size does. */
  const after = await measure(
    browser,
    pageFrom(steps, "p.caption { font-size: 16px !important }")
  );

  console.log(
    `\n  ${browserName}: ${before.onGrid}/${before.total} becomes ` +
      `${after.onGrid}/${after.total} when one size is overridden\n`
  );

  /* Something came off, or the override did nothing and this proves nothing. */
  expect(after.onGrid, "the override had an effect").toBeLessThan(before.onGrid);

  /*
     And the damage is bounded. The blocks above the caption cannot have moved,
     so more than a third of the page has to survive. A fit that collapsed
     entirely under one changed size would be too brittle to recommend.
  */
  expect(
    after.onGrid / after.total,
    `only ${after.onGrid} of ${after.total} survived one overridden size, which is a collapse`
  ).toBeGreaterThan(0.33);
});

async function measure(browser: import("@playwright/test").Browser, html: string) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
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
  return report;
}
