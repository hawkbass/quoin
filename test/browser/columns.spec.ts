/* Columns, which is the case a baseline grid is famous for.

   Everything else in this library is one column deep. A print baseline grid sits
   inside a column grid, and the thing it is celebrated for is that a line in the
   left column and a line in the right column sit on the same rule. Quoin had
   never looked at it.

   It does not hold by default, and the reason is specific. The space that closes
   a block's cap residue is a `margin-top`, and a margin at the top of a column
   fragment is truncated: the second column starts its first paragraph without
   the space that was doing the work. A page reading 12 of 12 in one column reads
   6 of 12 in two.

   Padding is not truncated. In Chromium that fixes it completely, at one, two
   and three columns. In WebKit nothing tested fixes it, because it fragments
   differently, so multi-column is an engine limitation there rather than a
   choice this library is making. Both halves are asserted, because "it works"
   and "it works in one engine" are different claims. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const PITCH = 8;

interface Step {
  name: string;
  size: number;
  leading: number;
  space: number;
}

async function fit(
  browser: import("@playwright/test").Browser,
  spaceProperty: "margin" | "padding"
) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.setContent("<p>probe</p>");
  await page.addScriptTag({ content: FIT_BUNDLE });
  const result = await page.evaluate(
    ({ pitch, spaceProperty }) =>
      (window as unknown as {
        quoinFit: {
          fitScale: (f: unknown, o: unknown) => {
            unavailable: boolean;
            spaceProperty: string;
            families: { steps: Step[] }[];
          };
        };
      }).quoinFit.fitScale(
        [
          {
            role: "body",
            font: "serif",
            steps: [{ name: "body", size: 17, ratio: 1.5, space: 24 }],
          },
        ],
        { pitch, spaceProperty }
      ),
    { pitch: PITCH, spaceProperty }
  );
  await page.close();
  return result;
}

function pageWith(step: Step, property: "margin" | "padding", columns: number): string {
  const spacing =
    property === "margin"
      ? `margin:${step.space}px 0 0`
      : `margin:0;padding:${step.space}px 0 0`;

  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 1000px; margin: 0 auto;
           ${columns > 1 ? `column-count: ${columns}; column-gap: 40px` : ""} }
    p { font-size: ${step.size}px; line-height: ${step.leading}px; ${spacing};
        text-box-trim: trim-both; text-box-edge: cap alphabetic }
  </style><main>
  ${Array.from(
    { length: 12 },
    (_, i) =>
      `<p>Paragraph ${i + 1}, written at enough length that it wraps onto several ` +
      `lines inside a narrow column and fewer in a wide one, which is the whole ` +
      `point of putting it in columns.</p>`
  ).join("\n")}
  </main>`;
}

async function measure(
  browser: import("@playwright/test").Browser,
  html: string
): Promise<{ onGrid: number; total: number }> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
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

test.describe.configure({ mode: "serial" });

test("a margin at the top of a column fragment is truncated, and it costs half the page", async ({
  browser,
  browserName,
}) => {
  /* The finding. One column is fine; two is not, and the difference is entirely
     the space that closes each block's cap residue going missing at the break. */
  const fitted = await fit(browser, "margin");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  const one = await measure(browser, pageWith(step, "margin", 1));
  const two = await measure(browser, pageWith(step, "margin", 2));

  expect(one.onGrid, "one column is on the grid").toBe(one.total);
  expect(
    two.onGrid,
    `two columns read ${two.onGrid}/${two.total}, so the margin was not truncated after all`
  ).toBeLessThan(two.total);
});

test("padding survives the break, and in Chromium that is the whole fix", async ({
  browser,
  browserName,
}) => {
  const fitted = await fit(browser, "padding");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  expect(fitted.spaceProperty).toBe("padding");
  const step = fitted.families[0]!.steps[0]!;

  const readings: string[] = [];
  const results = [];
  for (const columns of [1, 2, 3]) {
    const report = await measure(browser, pageWith(step, "padding", columns));
    readings.push(`${columns} col ${report.onGrid}/${report.total}`);
    results.push({ columns, ...report });
  }

  console.log(`\n  ${browserName}, padding: ${readings.join("  ")}\n`);

  if (browserName === "chromium") {
    for (const result of results) {
      expect(
        result.onGrid,
        `${result.columns} columns: ${result.onGrid}/${result.total}`
      ).toBe(result.total);
    }
  } else {
    /*
       WebKit is not asserted to pass, because it does not, and pretending
       otherwise would be a green test standing in front of a real limitation.
       What is asserted is that it is no worse than the margin it replaces, so
       recommending padding costs nothing anywhere.
    */
    const withMargin = await measure(browser, pageWith(step, "margin", 2));
    expect(
      results[1]!.onGrid,
      `padding scored ${results[1]!.onGrid} against ${withMargin.onGrid} for margin, ` +
        "so padding is worse here and should not be recommended"
    ).toBeGreaterThanOrEqual(withMargin.onGrid);
  }
});

test("the emitted CSS uses whichever property was chosen", async ({ page, browserName }) => {
  await page.goto("/prose.html");
  await page.addScriptTag({ content: FIT_BUNDLE });

  const emitted = await page.evaluate(() => {
    const api = (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => { unavailable: boolean };
        fittedScaleToCss: (f: unknown) => string;
      };
    }).quoinFit;

    const design = [
      { role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5 }] },
    ];
    return {
      margin: api.fittedScaleToCss(api.fitScale(design, { pitch: 8 })),
      padding: api.fittedScaleToCss(
        api.fitScale(design, { pitch: 8, spaceProperty: "padding" })
      ),
      unavailable: api.fitScale(design, { pitch: 8 }).unavailable,
    };
  });

  if (emitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  expect(emitted.margin).toMatch(/margin-top/);
  expect(emitted.margin, "and it points at the column case").toMatch(/column/);
  expect(emitted.padding).toMatch(/padding-top/);
  expect(emitted.padding, "the padding form does not tell you to switch").not.toMatch(
    /Use padding-top instead/
  );
});
