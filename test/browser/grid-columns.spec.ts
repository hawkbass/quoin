/* The other axis.

   A baseline grid is a vertical rhythm inside a column grid, and every other
   file here measures the vertical half. This measures the horizontal one, which
   is the half a designer usually means by "the grid".

   The defect it looks for has the same shape as the vertical one. A leading of
   25.5px cannot land on an 8px row, and a module of 341.33px cannot land on
   anything: divide 1104px three ways with 40px gutters and the second column
   starts at 469.33. No care taken with the markup moves it, because the
   arithmetic was decided by the container width. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = readFileSync(resolve("dist/quoin.columns.js"), "utf8");

interface Report {
  container: { left: number; width: number; blocks: number };
  columns: number;
  gutter: number;
  module: number;
  moduleWhole: boolean;
  total: number;
  aligned: number;
  issues: { path: string; left: number; right: number; off: number; which: string }[];
  widthsThatDivide: number[];
  solved: boolean;
}

/** A page of blocks laid out on an explicit column grid. */
function gridPage(options: {
  width: number;
  columns: number;
  gutter: number;
  /** Which columns each block spans, as [start, span] pairs. */
  spans: [number, number][];
  extra?: string;
}): string {
  const { width, columns, gutter, spans } = options;
  const module = (width - (columns - 1) * gutter) / columns;

  const blocks = spans
    .map(([start, span], i) => {
      const left = start * (module + gutter);
      const blockWidth = span * module + (span - 1) * gutter;
      return (
        `<p style="position:absolute; top:${i * 40}px; left:${left}px; ` +
        `width:${blockWidth}px">Block ${i + 1}</p>`
      );
    })
    .join("\n");

  return `<!doctype html><meta charset="utf-8"><style>
    html { font-family: serif } body { margin: 0 }
    main { position: relative; width: ${width}px; margin: 0; height: ${spans.length * 40 + 60}px }
    p { margin: 0; font-size: 16px; line-height: 24px }
    ${options.extra ?? ""}
  </style><main>${blocks}</main>`;
}

async function report(
  page: import("@playwright/test").Page,
  html: string,
  options: Record<string, unknown> = {}
): Promise<Report> {
  await page.setContent(html);
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: BUNDLE });
  return page.evaluate(
    (o) =>
      (globalThis as unknown as {
        quoinColumns: { verifyColumns: (x: unknown) => Report };
      }).quoinColumns.verifyColumns(o),
    options
  );
}

test.describe.configure({ mode: "serial" });

test("a page built on a column grid is read as that grid", async ({ page }) => {
  /* 1080px, 4 columns, 24px gutter: the module is (1080 - 72) / 4 = 252,
     which is whole, so everything should land. */
  const result = await report(
    page,
    gridPage({
      width: 1080,
      columns: 4,
      gutter: 24,
      spans: [
        [0, 4], [0, 2], [2, 2], [0, 1], [1, 1], [2, 1], [3, 1], [0, 3], [1, 3],
      ],
    })
  );

  expect(result.container.width, "the container was misread").toBe(1080);
  expect(result.gutter, "the gutter was not found").toBe(24);
  expect(result.columns, `read as ${result.columns} columns`).toBe(4);
  expect(result.module).toBe(252);
  expect(result.moduleWhole).toBe(true);
  expect(result.aligned, `${result.aligned}/${result.total} aligned`).toBe(result.total);
  expect(result.widthsThatDivide, "nothing to fix, so nothing suggested").toEqual([]);
});

test("more divisions are not a better answer just because they catch more edges", async ({
  page,
}) => {
  /*
     The defect the first version of this had. Sixteen divisions catch more edges
     than four for the same reason a wider net catches more fish, so counting
     hits alone always picks the most columns, and a three-column page read as
     fifteen columns of 36.27px.

     What is scored now is how far the hits exceed what that many divisions would
     catch from edges scattered at random.
  */
  const result = await report(
    page,
    gridPage({
      width: 1080,
      columns: 4,
      gutter: 24,
      spans: [[0, 4], [0, 2], [2, 2], [0, 1], [3, 1]],
    })
  );
  expect(
    result.columns,
    `a four-column page was read as ${result.columns} columns`
  ).toBeLessThanOrEqual(4);
});

test("a fractional module is named, and the widths that fix it actually divide", async ({
  page,
}) => {
  /* 1104px into 3 with 40px gutters is 341.33, which is quoin.dev's own grid. */
  const result = await report(
    page,
    gridPage({
      width: 1104,
      columns: 3,
      gutter: 40,
      spans: [[0, 3], [0, 1], [1, 1], [2, 1], [0, 2]],
    }),
    { columns: 3, gutter: 40 }
  );

  expect(result.module).toBe(341.33);
  expect(result.moduleWhole).toBe(false);
  expect(result.widthsThatDivide.length, "no fix was offered").toBeGreaterThan(0);

  /* The suggestions have to be true, which is the only thing that makes them
     worth printing. */
  for (const width of result.widthsThatDivide) {
    const module = (width - (result.columns - 1) * result.gutter) / result.columns;
    expect(
      Number.isInteger(module),
      `${width}px was offered as a width that divides, and gives ${module}`
    ).toBe(true);
  }
});

test("a block parked off the page is not a block that is off the grid", async ({ page }) => {
  /*
     A skip link at -10000px was the worst issue on quoin.dev by four thousand
     pixels, which is a report about the tool rather than about the page.
  */
  const withSkip = await report(
    page,
    gridPage({
      width: 1080,
      columns: 4,
      gutter: 24,
      spans: [[0, 4], [0, 2], [2, 2]],
      extra: ".skip { position: absolute; left: -10000px; top: 0; width: 200px }",
    }).replace("<main>", '<main><a class="skip" href="#x">Skip to content</a>')
  );

  expect(
    withSkip.issues.some((issue) => issue.left < -1000),
    "an off-page block was reported as off the grid"
  ).toBe(false);
  expect(withSkip.aligned, "the real blocks stopped aligning").toBe(withSkip.total);
});

test("a page with no column structure is not given one", async ({ page }) => {
  /*
     The control. If a scatter of arbitrary edges reads as a grid, the check
     cannot tell a grid from the absence of one, and every number above it is
     decoration.
  */
  const blocks = [7, 53, 111, 189, 263, 341, 437, 509, 601, 683, 769, 851]
    .map(
      (left, i) =>
        `<p style="position:absolute; top:${i * 40}px; left:${left}px; ` +
        `width:${137 + ((i * 29) % 91)}px">Block ${i + 1}</p>`
    )
    .join("\n");

  const result = await report(
    page,
    `<!doctype html><meta charset="utf-8"><style>
      html { font-family: serif } body { margin: 0 }
      main { position: relative; width: 1080px; height: 600px }
      p { margin: 0; font-size: 16px; line-height: 24px }
    </style><main>${blocks}</main>`
  );

  expect(
    result.aligned / result.total,
    `a scatter read as ${result.aligned}/${result.total} aligned, which is a grid it does not have`
  ).toBeLessThan(0.5);
});

test("the columns and gutter can be stated rather than solved", async ({ page }) => {
  const html = gridPage({
    width: 1104,
    columns: 3,
    gutter: 40,
    spans: [[0, 3], [0, 1], [1, 1], [2, 1]],
  });

  const solved = await report(page, html);
  const stated = await report(page, html, { columns: 3, gutter: 40 });

  expect(solved.solved).toBe(true);
  expect(stated.solved).toBe(false);
  expect(stated.columns).toBe(3);
  expect(stated.gutter).toBe(40);
});
