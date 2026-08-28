/* Columns, which is the case a baseline grid is famous for.

   Everything else in this library is one column deep. A print baseline grid sits
   inside a column grid, and the thing it is celebrated for is that a line in the
   left column and a line in the right column sit on the same rule.

   Two separate things go wrong, and the first version of this file confused
   them, because it set twelve paragraphs in two columns and read whatever came
   out. Where the browser chooses to balance the break is a function of the font,
   so the same page measured 6 of 12 on one machine and 12 of 12 on another, and
   the test asserted the first as a fact. Both mechanisms are now constructed
   rather than waited for.

   One: css-break-3 truncates a margin at the top of a fragment when the break is
   unforced. `break-inside: avoid` makes every break land at a paragraph
   boundary, so the condition holds in any engine with any font. Padding is not
   truncated, which is the fix.

   Two: a paragraph split across the boundary starts its continuation off the
   grid in WebKit. Padding does not help, because padding is not the problem; not
   splitting the paragraph is.

   Together, padding for the space and `break-inside: avoid` on the blocks, two,
   three and four columns read 12 of 12 in both engines at every width tested. */

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

interface Recipe {
  /** `margin` or `padding` carries the space. */
  property: "margin" | "padding";
  /** Whether a paragraph may be split across the column boundary. */
  avoidSplit: boolean;
}

function pageWith(step: Step, recipe: Recipe, columns: number, paragraphs = 14): string {
  const spacing =
    recipe.property === "margin"
      ? `margin:${step.space}px 0 0`
      : `margin:0;padding:${step.space}px 0 0`;

  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 1000px; margin: 0 auto;
           ${columns > 1 ? `column-count: ${columns}; column-gap: 40px` : ""} }
    p { font-size: ${step.size}px; line-height: ${step.leading}px; ${spacing};
        ${recipe.avoidSplit ? "break-inside: avoid;" : ""}
        text-box-trim: trim-both; text-box-edge: cap alphabetic }
  </style><main>
  ${Array.from(
    { length: paragraphs },
    (_, i) =>
      `<p>Paragraph ${i + 1}, written at enough length that it wraps onto several ` +
      `lines inside a narrow column and fewer in a wide one, which is the whole ` +
      `point of putting it in columns.</p>`
  ).join("\n")}
  </main>`;
}

interface Reading {
  onGrid: number;
  total: number;
  /** Paragraphs starting at the top of a column that is not the first. */
  atColumnTop: number;
  /** Paragraphs the browser split across a boundary. */
  split: number;
}

async function measure(
  browser: import("@playwright/test").Browser,
  html: string,
  width = 1100
): Promise<Reading> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: BUNDLE });
  const report = await page.evaluate(
    ({ pitch }) => {
      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      const blocks = [...document.querySelectorAll("p")];
      const lefts = blocks.map((el) => Math.round(el.getBoundingClientRect().left));
      const firstColumn = Math.min(...lefts);
      const top = Math.min(...blocks.map((el) => el.getBoundingClientRect().top));
      return {
        onGrid: measured.report.onGrid,
        total: measured.report.total,
        atColumnTop: blocks.filter((el, i) => {
          const box = el.getBoundingClientRect();
          return lefts[i] !== firstColumn && box.top - top < 2;
        }).length,
        split: blocks.filter((el) => el.getClientRects().length > 1).length,
      };
    },
    { pitch: PITCH }
  );
  await page.close();
  return report;
}

test.describe.configure({ mode: "serial" });

/* ------------------------------------------------------------------ *
   One: the margin is truncated at an unforced break
 * ------------------------------------------------------------------ */

test("a truncated margin is what takes a column off the grid, wherever it happens", async ({
  browser,
  browserName,
}) => {
  /*
     This asserts the mechanism rather than a score, because the score is not
     the same everywhere and the mechanism is.

     Twice this test was rewritten after CI disagreed with the machine it was
     written on. First it depended on where the browser balanced the break,
     which is a function of the font. Then, with that pinned, WebKit on Linux
     read 14 of 14 with a margin where WebKit on Windows read 6 of 14.

     Measuring the truncation directly rather than scoring the page explains
     both. Every column starts at the same y, the content top of the multicol
     box, so the first block in a column has either its full space above it or
     it does not. Read that way, both engines truncate, always. What differs is
     what they line up with the column top: Chromium the block's border box,
     WebKit its first line box, which under `text-box-trim` sit 3.73px apart.

     So the truncation is invariant and the damage is not. The gap it leaves is
     the space minus that overhang, and whether that is a whole number of rows
     depends on the font's cap height. Sometimes it lands in phase and the page
     scores perfectly with the bug still present, which is exactly what Linux
     was showing. A score was never going to be a stable thing to assert.

     That is also the real argument for padding. It is not that it fixes one
     engine; it is that it takes a font-dependent coin flip out of the page.
  */
  const fitted = await fit(browser, "margin");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;
  const recipe: Recipe = { property: "margin", avoidSplit: true };

  const one = await measure(browser, pageWith(step, recipe, 1));
  expect(one.onGrid, "one column is on the grid").toBe(one.total);

  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.setContent(pageWith(step, recipe, 2));
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: BUNDLE });

  const seen = await page.evaluate(
    ({ pitch, space }) => {
      const container = document.querySelector("main")!;
      const containerTop = container.getBoundingClientRect().top;
      const blocks = [...document.querySelectorAll("p")];
      const lefts = blocks.map((el) => Math.round(el.getBoundingClientRect().left));
      const columns = [...new Set(lefts)].sort((a, b) => a - b);

      /* For each column, the first block in it, and whether its space survived. */
      const firsts = columns.map((left) => {
        const index = lefts.indexOf(left);
        const box = blocks[index]!.getBoundingClientRect();
        const offset = box.top - containerTop;
        return {
          left,
          offset: Math.round(offset * 100) / 100,
          /* Preserved means the whole space is there. Truncated means it is
             substantially gone, which is flush in Chromium and the trim
             overhang in WebKit; the test does not care which, only that the
             space did not survive. Anything between the two is a reading
             neither word describes, and it fails rather than being rounded
             into whichever is convenient. */
          preserved: Math.abs(offset - space) < 0.5,
          truncated: offset < space / 2,
        };
      });

      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      return {
        columns: columns.length,
        firsts,
        split: blocks.filter((el) => el.getClientRects().length > 1).length,
        onGrid: measured.report.onGrid,
        total: measured.report.total,
      };
    },
    { pitch: PITCH, space: step.space }
  );
  await page.close();

  /* The conditions the reading depends on. */
  expect(seen.columns, "the page did not lay out in two columns").toBe(2);
  expect(seen.split, "break-inside: avoid should have stopped every split").toBe(0);
  for (const first of seen.firsts) {
    expect(
      first.truncated || first.preserved,
      `a column's first block sat ${first.offset}px down, which is neither flush ` +
        `nor its ${step.space}px space, so this reading means nothing`
    ).toBe(true);
  }

  const [first, ...rest] = seen.firsts;
  console.log(
    `\n  ${browserName}: column 1 at ${first!.offset}px, later columns at ` +
      `${rest.map((c) => c.offset).join(", ")}px, space is ${step.space}px, ` +
      `page reads ${seen.onGrid}/${seen.total}\n`
  );

  /* The claim, and it holds on every engine and platform tested: the first
     column keeps its space because the top of the flow is not a fragment
     break, and every column after it loses it because that is what css-break-3
     says happens at an unforced one. */
  expect(first!.preserved, `column 1 sat ${first!.offset}px down, not its ${step.space}px`).toBe(
    true
  );
  for (const column of rest) {
    expect(
      column.truncated,
      `a later column kept ${column.offset}px of its ${step.space}px space, ` +
        "so the margin was not truncated after all"
    ).toBe(true);
  }

  /* Deliberately not asserted: what that costs. The gap left behind is the
     space minus the engine's overhang, and whether that is a whole number of
     rows is a property of the font. Asserting a score here is what made this
     test disagree with itself across two machines. */
});

/* ------------------------------------------------------------------ *
   Two: a split paragraph, which is the part padding cannot fix
 * ------------------------------------------------------------------ */

test("a paragraph split across the boundary is WebKit's remaining problem", async ({
  browser,
  browserName,
}) => {
  const fitted = await fit(browser, "padding");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  /* One paragraph long enough to be split, and one after it, so the only
     fragmentation in the page is the split itself. */
  const long =
    `<p class="long">` +
    Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a single long paragraph.`).join(" ") +
    `</p><p>A short paragraph after it.</p>`;

  const html = `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 1000px; margin: 0 auto; column-count: 2; column-gap: 40px }
    p { font-size: ${step.size}px; line-height: ${step.leading}px;
        margin: 0; padding: ${step.space}px 0 0;
        text-box-trim: trim-both; text-box-edge: cap alphabetic }
  </style><main>${long}</main>`;

  const report = await measure(browser, html);
  expect(report.split, "the long paragraph should have been split").toBeGreaterThan(0);

  if (browserName === "chromium") {
    expect(report.onGrid, "Chromium keeps a split paragraph on the grid").toBe(report.total);
  } else {
    /* Asserted as the limitation it is, so that the day WebKit fixes it this
       test says so rather than quietly continuing to pass. */
    expect(
      report.onGrid,
      "WebKit now keeps a split paragraph on the grid; the recipe can drop break-inside"
    ).toBeLessThan(report.total);
  }
});

/* ------------------------------------------------------------------ *
   Together: the recipe, swept
 * ------------------------------------------------------------------ */

test("padding and break-inside: avoid hold at every width and column count", async ({
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
  const recipe: Recipe = { property: "padding", avoidSplit: true };

  const readings: string[] = [];
  for (const width of [760, 900, 1100, 1400]) {
    for (const columns of [2, 3, 4]) {
      const report = await measure(browser, pageWith(step, recipe, columns), width);
      readings.push(`${width}/${columns} ${report.onGrid}/${report.total}`);
      expect(
        report.onGrid,
        `${width}px at ${columns} columns: ${report.onGrid}/${report.total}`
      ).toBe(report.total);
    }
  }
  console.log(`\n  ${browserName}: ${readings.join("  ")}\n`);
});

test("padding alone is enough in Chromium, and is never worse than margin", async ({
  browser,
  browserName,
}) => {
  /* Recorded separately because it is the difference between the two engines,
     and because a recipe that says "add break-inside: avoid" should be honest
     about which half of it each engine needs. */
  const fitted = await fit(browser, "padding");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  const padding = await measure(browser, pageWith(step, { property: "padding", avoidSplit: false }, 2));
  const margin = await measure(browser, pageWith(step, { property: "margin", avoidSplit: false }, 2));

  expect(
    padding.onGrid,
    `padding scored ${padding.onGrid} against ${margin.onGrid} for margin`
  ).toBeGreaterThanOrEqual(margin.onGrid);

  if (browserName === "chromium") {
    expect(padding.onGrid, "padding alone is the whole fix in Chromium").toBe(padding.total);
  }
});

/* ------------------------------------------------------------------ *
   The emitted stylesheet
 * ------------------------------------------------------------------ */

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
  expect(
    emitted.padding,
    "the padding form carries the other half of the recipe"
  ).toMatch(/break-inside/);
});

/* ------------------------------------------------------------------ *
   What does not break it
 * ------------------------------------------------------------------ */

test("the browser's own baseline alignment does not knock a fit off", async ({
  browser,
  browserName,
}) => {
  /*
     Columns turned out to be a real blind spot, so the other places the browser
     does baseline work of its own were checked too. None of them is a problem,
     and a negative result is worth keeping: it is the difference between "we
     never looked" and "we looked and it holds".

     Flex and grid with `align-items: baseline` shift items to line their
     baselines up, a table row aligns its cells, and a list marker sits on the
     first line's baseline. All of them move things, and none of them moves
     things off a grid the blocks were already on.
  */
  const fitted = await fit(browser, "margin");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  /* A second size, so baseline alignment has something to align. */
  const big = { ...step, size: 28, leading: 32, space: step.space };

  const shell = (body: string) => `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 900px; margin: 0 auto }
    .a { font-size:${step.size}px; line-height:${step.leading}px; margin:${step.space}px 0 0 }
    .b { font-size:${big.size}px; line-height:${big.leading}px; margin:${big.space}px 0 0 }
    :is(p,div,td,th,li) { text-box-trim: trim-both; text-box-edge: cap alphabetic }
  </style><main>${body}</main>`;

  const cases: [string, string][] = [
    [
      "flex with align-items baseline",
      `<div style="display:flex;gap:24px;align-items:baseline">
         <p class="a">Seventeen in a flex row.</p><p class="b">Twenty-eight beside it.</p>
       </div><p class="a">A paragraph below the row.</p>`,
    ],
    [
      "grid with align-items baseline",
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:baseline">
         <p class="a">Seventeen in a grid cell.</p><p class="b">Twenty-eight beside it.</p>
       </div><p class="a">A paragraph below the grid.</p>`,
    ],
    [
      "a table row",
      `<table style="border-collapse:collapse;width:100%"><tr>
         <td class="a">Seventeen in a cell.</td><td class="b">Twenty-eight in the next.</td>
       </tr></table><p class="a">A paragraph below the table.</p>`,
    ],
    [
      "a list",
      `<ul style="margin:0;padding:0 0 0 24px">
         <li class="a">An item at seventeen.</li><li class="a">A second item.</li>
       </ul><p class="a">A paragraph below the list.</p>`,
    ],
  ];

  for (const [label, body] of cases) {
    const report = await measure(browser, shell(body));
    expect(report.total, `${label} rendered`).toBeGreaterThan(2);
    expect(report.onGrid, `${label}: ${report.onGrid}/${report.total}`).toBe(report.total);
  }
});
