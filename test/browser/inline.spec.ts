/* An inline element in a different size or family, and what it does to a fit.

   The fit rests on one equation. Between one block's last baseline and the
   next's first:

       (lines - 1) x leading + space + cap

   `lines` is the only width-dependent term, and it is multiplied by a leading
   that is already a whole number of rows, so modulo the pitch it contributes
   nothing. That is the whole argument for why the sizes are free and the page
   holds at every width.

   It assumes every line box is exactly `leading` tall, and an inline at a
   different size or family makes one of them taller. So the question is whether
   a fitted page with inline code in it comes off the grid, because that is most
   prose on the web.

   Mostly it does not, and the reason is the trim. `text-box-trim: trim-both`
   ends a box at its last baseline, so a line box that grew inside the block is
   cut away at both edges and the next block is unaffected. The damage does not
   propagate, which is the thing that would have mattered.

   What it cannot do is protect the block's own first baseline when the inline
   lands on the first line. That one moves, and this file pins it: a known,
   measured limitation with a one-line fix, rather than a surprise. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const PITCH = 8;

interface Step {
  leading: number;
  space: number;
  size: number;
}

async function fitted(page: import("@playwright/test").Page): Promise<Step | null> {
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });
  const result = await page.evaluate(() =>
    (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => {
          unavailable: boolean;
          families: { steps: Step[] }[];
        };
      };
    }).quoinFit.fitScale(
      [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24 }] }],
      { pitch: 8 }
    )
  );
  return result.unavailable ? null : result.families[0]!.steps[0]!;
}

function markup(step: Step, codeRule: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 460px; margin: 0 auto }
    p { font-size: ${step.size}px; line-height: ${step.leading}px;
        margin: ${step.space}px 0 0;
        text-box-trim: trim-both; text-box-edge: cap alphabetic }
    ${codeRule}
  </style><main>
    <p>A first paragraph of ordinary reading text that runs to several lines at
       this width, with <code>an inline code span</code> in the middle of it.</p>
    <p>A second paragraph below it, also several lines long, and also carrying
       <code>a code span</code> so the effect has somewhere to accumulate.</p>
    <p>A third, so any drift introduced above it has room to show itself.</p>
    <p>And a fourth, for the same reason.</p>
  </main>`;
}

test.describe.configure({ mode: "serial" });

test("an inline does not put the blocks after it off the grid", async ({ page, browserName }) => {
  /*
     The claim that matters. A defect contained to one block is a blemish; one
     that moves everything below it is the thing this library exists to stop.

     The trim is what does it: a box ends at its last baseline, so a line that
     grew inside the block is cut away at the edges and the next block starts
     where the arithmetic said it would.
  */
  const step = await fitted(page);
  if (!step) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const read = async (rule: string) => {
    await page.setContent(markup(step, rule));
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });
    return page.evaluate((pitch) => {
      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      /* Everything except the first block, which is the one carrying the
         inline on its first line. */
      const rest = measured.results.slice(1);
      return {
        onGrid: measured.report.onGrid,
        total: measured.report.total,
        restOnGrid: rest.filter((r) => r.onGrid).length,
        rest: rest.length,
      };
    }, PITCH);
  };

  const plain = await read("code { font-family: inherit; font-size: inherit }");
  expect(plain.total, "nothing was measured").toBeGreaterThan(3);
  expect(plain.onGrid, "the control page is not fitted").toBe(plain.total);

  for (const rule of [
    "code { font-family: monospace; font-size: inherit }",
    "code { font-family: monospace; font-size: 0.82em }",
  ]) {
    const seen = await read(rule);
    expect(
      seen.restOnGrid,
      `${rule} put ${seen.rest - seen.restOnGrid} of the following blocks off the grid`
    ).toBe(seen.rest);
  }
});

test("line-height: 0 on the inline puts the whole page back", async ({ page, browserName }) => {
  /*
     The fix, measured rather than recommended. An inline with no leading
     contributes no box of its own, so the parent's strut governs the line, and
     the glyphs draw where they did.
  */
  const step = await fitted(page);
  if (!step) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const read = async (rule: string) => {
    await page.setContent(markup(step, rule));
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });
    return page.evaluate((pitch) => {
      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      return { onGrid: measured.report.onGrid, total: measured.report.total };
    }, PITCH);
  };

  const fixedUp = await read(
    "code { font-family: monospace; font-size: 0.82em; line-height: 0 }"
  );
  expect(
    fixedUp.onGrid,
    `with line-height: 0 the page reads ${fixedUp.onGrid}/${fixedUp.total}`
  ).toBe(fixedUp.total);
});
