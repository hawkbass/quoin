/* Borders and padding, which sit between the box and the baseline.

   The fitter closed the cap height and nothing else, so it was solving for a
   block with no border and no padding. Anything else moved the first baseline
   by an amount it never accounted for.

   It was found on quoin.dev. Its table cells set `line-height: 31px` against a
   1px border, deliberately, with a comment saying `31 + 1px border = 32`. The
   fitter read that page and told it to use 32, which would have made the box 33
   and broken the rhythm the author had built by hand. The tool was wrong and
   the site was right, which is a bad way round.

   Two terms, and they are not symmetrical:

     lead-in   border-top plus padding-top, between the top of the box and the
               first line. It belongs to this block, so this block's own space
               closes it.

     tail      border-bottom plus padding-bottom. Under `text-box-trim` a box
               ends at its last baseline, so these sit below it and push the
               NEXT block down. That makes the tail the one term belonging to a
               block other than the one being fitted, and a per-step design
               cannot know what follows. So it is rounded up to a whole row and
               made to contribute nothing, rather than absorbed into somebody
               else's space.

   Which keeps the property the whole method rests on: every term belongs to one
   block alone, so no block has to agree with any other. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const PITCH = 8;

interface Shape {
  label: string;
  css: string;
  leading?: number;
}

const SHAPES: Shape[] = [
  { label: "no border, no padding", css: "" },
  { label: "1px border-top", css: "border-top: 1px solid #999" },
  { label: "1px border-bottom", css: "border-bottom: 1px solid #999" },
  {
    label: "1px top and bottom",
    css: "border-top: 1px solid #999; border-bottom: 1px solid #999",
  },
  { label: "5px padding-top", css: "padding-top: 5px" },
  {
    label: "3px padding and 2px border on top",
    css: "border-top: 2px solid #999; padding-top: 3px",
  },
  { label: "6px padding-bottom", css: "padding-bottom: 6px" },
  /* The shape that found this one. */
  { label: "a table cell, 31px against a border", css: "border-bottom: 1px solid #999", leading: 31 },
];

interface FitReading {
  space: number;
  leading: number;
  leadIn: number;
  paddingBottom: number;
  paddingBottomWas: number;
}

function page(shape: Shape, applied: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 90%; max-width: 800px; margin: 0 auto }
    p { font-size: 17px; line-height: ${shape.leading ?? 24}px; margin: 24px 0 0;
        text-box-trim: trim-both; text-box-edge: cap alphabetic; ${shape.css} }
    ${applied}
  </style><main>
    <p>The first paragraph, long enough to wrap onto two lines at this width so the leading is doing something.</p>
    <p>A second paragraph below it, also long enough to wrap onto more than one line.</p>
    <p>And a third, so accumulated drift has somewhere to show itself.</p>
  </main>`;
}

/** Read the design off the page, borders included, and fit it. */
async function fitOf(
  context: import("@playwright/test").Page,
  shape: Shape
): Promise<FitReading> {
  await context.setContent(page(shape, ""));
  await context.evaluate(() => document.fonts?.ready);
  await context.addScriptTag({ content: FIT_BUNDLE });
  return context.evaluate((pitch) => {
    const api = (window as unknown as {
      quoinFit: {
        inferDesign: (o: unknown) => { families: unknown[] };
        fitScale: (f: unknown, o: unknown) => {
          families: { steps: FitReading[] }[];
        };
      };
    }).quoinFit;
    const design = api.inferDesign({ pitch, minimum: 1 });
    return api.fitScale(design.families, { pitch }).families[0]!.steps[0]!;
  }, PITCH);
}

async function trimless(context: import("@playwright/test").Page): Promise<boolean> {
  await context.setContent("<p>probe</p>");
  return context.evaluate(() => !CSS.supports("text-box-trim", "trim-both"));
}

test.describe.configure({ mode: "serial" });

test("a fitted block stays on the grid whatever border or padding it carries", async ({
  browser,
  browserName,
}) => {
  const context = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  if (await trimless(context)) {
    await context.close();
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const readings: string[] = [];

  for (const shape of SHAPES) {
    const fit = await fitOf(context, shape);

    /* Apply exactly what the fitter said, and measure. */
    const applied =
      `p { line-height: ${fit.leading}px !important;` +
      `  margin-top: ${fit.space}px !important;` +
      `  padding-bottom: ${fit.paddingBottom}px !important }`;

    await context.setContent(page(shape, applied));
    await context.evaluate(() => document.fonts?.ready);
    await context.addScriptTag({ content: BUNDLE });
    const report = await context.evaluate((pitch) => {
      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      return { onGrid: measured.report.onGrid, total: measured.report.total };
    }, PITCH);

    readings.push(`${shape.label} ${report.onGrid}/${report.total}`);
    expect(report.total, `${shape.label}: nothing was measured`).toBeGreaterThan(2);
    expect(
      report.onGrid,
      `${shape.label}: ${report.onGrid}/${report.total} with space ${fit.space}, ` +
        `lead-in ${fit.leadIn}, padding-bottom ${fit.paddingBottom}`
    ).toBe(report.total);
  }

  console.log(`\n  ${browserName}: ${readings.join("; ")}\n`);
  await context.close();
});

test("the fitter reads the box off the page rather than assuming it away", async ({
  browser,
  browserName,
}) => {
  /* The control for the test above, and the thing that actually broke.

     If the border is never read, every shape gets the same space. The shapes
     whose border happens to be a whole row still pass, the suite is green, and
     the defect is untouched. So this checks the figures moved, not only that
     the page came out on the grid. */
  const context = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  if (await trimless(context)) {
    await context.close();
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  const plain = await fitOf(context, SHAPES[0]!);
  const borderTop = await fitOf(context, SHAPES[1]!);
  const borderBottom = await fitOf(context, SHAPES[2]!);
  await context.close();

  expect(plain.leadIn, "a block with no border has no lead-in").toBe(0);
  expect(plain.paddingBottom, "and nothing under its last baseline").toBe(0);

  expect(borderTop.leadIn, "the border-top was not read").toBe(1);
  expect(
    borderTop.space,
    "the space did not move for a border it is supposed to close"
  ).not.toBe(plain.space);

  /* A border below the last baseline is the other case, and the padding answers
     it rather than the space. */
  expect(borderBottom.leadIn).toBe(0);
  expect(borderBottom.space, "a border-bottom is not the space's problem").toBe(plain.space);
  expect(borderBottom.paddingBottom, "1px of border wants 7px of padding under it").toBe(7);
});

test("reading a design off a collapsed table says the box figures cannot be trusted", async ({
  browser,
  browserName,
}) => {
  /*
     The same defect as the rhythm one, in the other half of the tool.

     `inferDesign` reads a block's border and padding off the page so the fitter
     can close them. Under a collapsed border those declared figures do not add
     up to the box, so the space solved from them is out by whatever the engine
     kept for the neighbouring cell. The sizes and leadings are unaffected, so
     the step is still worth having; the box terms are not, and it now says so.
  */
  const context = await browser.newPage({ viewport: { width: 900, height: 800 } });

  const table = (collapse: string) => `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; font-family: serif }
    table { width: 100%; border-collapse: ${collapse};
            ${collapse === "separate" ? "border-spacing: 0;" : ""} }
    th, td { font-size: 17px; line-height: 24px; padding: 3.5px 8px 3.5px 0;
             border-bottom: 1px solid #999 }
  </style><table><tbody>
    ${Array.from({ length: 6 }, (_, i) => `<tr><th>Row ${i + 1}</th><td>${i + 1}</td></tr>`).join("")}
  </tbody></table>`;

  const warningsFor = async (collapse: string) => {
    await context.setContent(table(collapse));
    await context.evaluate(() => document.fonts?.ready);
    await context.addScriptTag({ content: FIT_BUNDLE });
    return context.evaluate(
      (pitch) =>
        (globalThis as unknown as {
          quoinFit: { inferDesign: (o: unknown) => { warnings: string[]; blocks: number } };
        }).quoinFit.inferDesign({ pitch, minimum: 2 }),
      PITCH
    );
  };

  const separate = await warningsFor("separate");
  const collapsed = await warningsFor("collapse");
  await context.close();

  /* The control: the same table with borders that add up says nothing, so this
     is not a warning that fires on every table. */
  expect(separate.blocks, "nothing was read off the control page").toBeGreaterThan(4);
  expect(
    separate.warnings,
    `a table with separate borders warned: ${separate.warnings.join(" ")}`
  ).toEqual([]);

  expect(collapsed.warnings.length, `${browserName} produced no warning`).toBe(1);
  expect(collapsed.warnings[0], collapsed.warnings[0]).toMatch(/collapsed borders/);
  expect(collapsed.warnings[0], "it does not say what to do").toMatch(
    /border-collapse: separate/
  );
});
