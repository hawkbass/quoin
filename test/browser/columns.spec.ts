/* Columns, which is the case a baseline grid is famous for.

   Everything else in this library is one column deep. A print baseline grid sits
   inside a column grid, and the thing it is celebrated for is that a line in the
   left column and a line in the right column sit on the same rule.

   Two separate things go wrong, and the first version of this file confused
   them, because it set twelve paragraphs in two columns and read whatever came
   out. Both are now constructed rather than waited for.

   One: css-break-3 truncates a margin at the top of a fragment when the break is
   unforced. Padding is not truncated, which is the fix.

   Two: a paragraph split across the boundary starts its continuation out of
   phase, in both engines. Padding does not help, because padding is not the
   problem; not splitting the paragraph is.

   Together, padding for the space and `break-inside: avoid` on the blocks, two,
   three and four columns are perfect in both engines at every width tested.

   Three claims in this file were wrong before they were right, and all three
   failed the same way: a score stood in for a mechanism.

   The first depended on where the browser balanced the break, which is a
   function of the font, so the same page read 6 of 12 on one machine and 12 of
   12 on another. The second survived that and still disagreed across platforms,
   because the truncation is invariant but the damage it does is not: the gap it
   leaves is the space minus the engine's overhang, and whether that is a whole
   number of rows depends on the font. The third said padding alone was enough in
   Chromium, which came from `verifyGrid` reading one first baseline per block.
   A split block has one, so the continuation was never in the count at all.

   That last one was a defect in the library rather than in the test, and it is
   fixed: the verifier reads every fragment now. Which is the argument for
   testing against a real engine rather than a model of one. */

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

test("a paragraph split across the boundary lands out of phase in both engines", async ({
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

  /*
     Read as a residue rather than a score, and at several widths.

     Within one paragraph consecutive baselines are exactly one leading apart,
     and a leading is a whole number of rows, so every line of that paragraph
     has the same offset modulo the pitch however it is fragmented. An engine
     that places the continuation on the grid keeps that true. One that puts it
     at the top of the column does not, except when the shift happens to be a
     whole number of rows, which is the same coin flip that has already been
     paid for twice in this file. Four widths rather than one, so a single
     lucky landing does not decide it.
  */
  const page = await browser.newPage();
  const widths = [760, 900, 1100, 1400];
  const matched: number[] = [];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready);
    const reading = await page.evaluate(
      ({ pitch }) => {
        const el = document.querySelector(".long")!;
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = [...range.getClientRects()].map((r) => r.top);
        const residues = tops.map((t) => {
          const r = ((t % pitch) + pitch) % pitch;
          return Math.min(r, pitch - r);
        });
        return {
          fragments: el.getClientRects().length,
          lines: tops.length,
          /* Do all lines share one residue, to within the usual tolerance? */
          consistent: residues.every((r) => Math.abs(r - residues[0]!) < 0.5),
        };
      },
      { pitch: PITCH }
    );
    expect(reading.fragments, `at ${width}px the paragraph was not split`).toBeGreaterThan(1);
    if (reading.consistent) matched.push(width);
  }
  await page.close();

  console.log(
    `\n  ${browserName}: the split paragraph stayed in phase at ` +
      `${matched.length}/${widths.length} widths\n`
  );

  /*
     Both engines, not one. This first said it was WebKit's problem, on the
     strength of a Chromium page that scored perfectly. It scored perfectly
     because `verifyGrid` read one first baseline per block and a split block
     has one, so the continuation was never in the reading at all. Measured
     per line, Chromium is out by 1px and WebKit by 1.5px, and neither is on
     the grid.

     Asserted as the limitation it is, so the day either engine fixes it this
     test says so rather than quietly continuing to pass.
  */
  expect(
    matched.length,
    `${browserName} now keeps a split paragraph in phase at every width; the ` +
      "recipe can drop break-inside"
  ).toBeLessThan(widths.length);
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

test("padding alone is not enough, in either engine", async ({
  browser,
  browserName,
}) => {
  /*
     Padding alone is not the whole fix, in either engine, and two earlier
     versions of this test said otherwise for two different bad reasons.

     The first compared padding's score against margin's and asserted padding
     was never worse. On Linux the truncated margin lands in phase and scores
     perfectly with the bug still in it, so padding lost to a lucky margin.
     That was measuring the font, not the property.

     The second said padding alone was the whole fix in Chromium, which came
     from a verifier that could not see a fragment continuation: the split
     paragraph it was failing on was simply not in the count. With the verifier
     reading every fragment, Chromium goes from perfect at all twelve layouts
     to perfect at six.

     So this is swept and every claim is about one configuration rather than a
     comparison between two. Whether the browser splits anything at a given
     width is its own decision, and at 1100px in two columns Chromium splits
     nothing, so measuring only there compares two identical pages.
  */
  const fitted = await fit(browser, "padding");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  const readings: { width: number; columns: number; alone: Reading; both: Reading }[] = [];
  for (const width of [760, 900, 1100, 1400]) {
    for (const columns of [2, 3, 4]) {
      readings.push({
        width,
        columns,
        alone: await measure(
          browser,
          pageWith(step, { property: "padding", avoidSplit: false }, columns),
          width
        ),
        both: await measure(
          browser,
          pageWith(step, { property: "padding", avoidSplit: true }, columns),
          width
        ),
      });
    }
  }

  const split = readings.filter((r) => r.alone.split > 0);
  console.log(
    `\n  ${browserName}: ${split.length} of ${readings.length} layouts split a ` +
      `paragraph, and those read ` +
      `${split.map((r) => `${r.alone.onGrid}/${r.alone.total}`).join(", ")}\n`
  );

  /* Both halves is the recipe, and it holds in every layout. */
  for (const reading of readings) {
    const where = `${reading.width}px in ${reading.columns} columns`;
    expect(reading.both.split, `${where} still split something`).toBe(0);
    expect(
      reading.both.onGrid,
      `the recipe read ${reading.both.onGrid}/${reading.both.total} at ${where}`
    ).toBe(reading.both.total);
  }

  /* And wherever a split actually happened, padding alone left it off. */
  expect(
    split.length,
    "no layout split a paragraph, so there was nothing here to compare"
  ).toBeGreaterThan(0);
  for (const reading of split) {
    expect(
      reading.alone.onGrid,
      `padding alone read ${reading.alone.onGrid}/${reading.alone.total} at ` +
        `${reading.width}px in ${reading.columns} columns with ` +
        `${reading.alone.split} split, so the split cost nothing`
    ).toBeLessThan(reading.alone.total);
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

/* ------------------------------------------------------------------ *
   The verifier itself
 * ------------------------------------------------------------------ */

test("the verifier counts every fragment of a split block", async ({ browser, browserName }) => {
  /*
     The defect this file uncovered, gated so it cannot come back quietly.

     `getBoundingClientRect` returns the union of a block's fragments, so
     reading a block's position from it gives the first fragment and nothing
     else. A paragraph split across a column boundary could be half off the
     grid and score 2 of 2, which is worse than a wrong answer: it is a wrong
     answer that agrees with itself.

     Two things are asserted. That a split block contributes more than one row
     to the report, which is the fix. And that an unfragmented page reports
     exactly one row per block, which is the half that would otherwise let a
     fix double-count every paragraph on every ordinary page and call it
     progress.
  */
  const fitted = await fit(browser, "padding");
  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }
  const step = fitted.families[0]!.steps[0]!;

  const body =
    `<p class="long">` +
    Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a single long paragraph.`).join(" ") +
    `</p><p>A short paragraph after it.</p>`;

  const html = (columns: number) => `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { width: 92%; max-width: 1000px; margin: 0 auto;
           ${columns > 1 ? "column-count: 2; column-gap: 40px" : ""} }
    p { font-size: ${step.size}px; line-height: ${step.leading}px;
        margin: 0; padding: ${step.space}px 0 0;
        text-box-trim: trim-both; text-box-edge: cap alphabetic }
  </style><main>${body}</main>`;

  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const read = async (columns: number) => {
    await page.setContent(html(columns));
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });
    return page.evaluate(({ pitch }) => {
      const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
      return {
        rows: measured.report.total,
        onGrid: measured.report.onGrid,
        fragmentRows: measured.results.filter((r) => r.path.includes("fragment")).length,
        blocks: document.querySelectorAll("p").length,
        actualFragments: [...document.querySelectorAll("p")].reduce(
          (sum, el) => sum + el.getClientRects().length,
          0
        ),
      };
    }, { pitch: PITCH });
  };

  /* The control: nothing is fragmented, so one row per block and no more. */
  const single = await read(1);
  expect(single.actualFragments, "the control page fragmented something").toBe(single.blocks);
  expect(single.rows, "an unfragmented page reports one row per block").toBe(single.blocks);
  expect(single.fragmentRows, "and labels none of them a fragment").toBe(0);

  /* The case: the long paragraph is split, and both halves are in the count. */
  const split = await read(2);
  await page.close();

  expect(split.actualFragments, "nothing was split, so there is nothing to check").toBeGreaterThan(
    split.blocks
  );
  expect(
    split.rows,
    `${split.actualFragments} fragments were laid out and ${split.rows} rows reported`
  ).toBe(split.actualFragments);
  expect(split.fragmentRows, "the extra rows say which fragment they are").toBeGreaterThan(0);

  /* And the continuation is off the grid, which is the whole reason it matters
     that it gets counted. */
  expect(
    split.onGrid,
    `every fragment was on the grid, so counting them changed nothing`
  ).toBeLessThan(split.rows);
});
