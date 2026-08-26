/* Does the walk find the right things, and does it refuse to measure the things
   it cannot measure? */

import { test, expect } from "@playwright/test";
import { load, GRID } from "./harness.ts";

test("it finds only elements that directly own rendered words", async ({ page }) => {
  await load(page, "prose.html");

  const found = await page.evaluate(() => {
    const blocks = window.quoin.textBlocks(document.body, []);
    return {
      count: blocks.length,
      tags: blocks.map((el) => el.tagName.toLowerCase()),
      /* A wrapper that only contains other elements would be measured twice:
         once for itself, once for the child whose text it inherited. */
      anyWrappers: blocks.some(
        (el) =>
          ![...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
          )
      ),
    };
  });

  expect(found.count, "found the paragraphs and headings").toBeGreaterThan(6);
  expect(found.anyWrappers, "no wrappers counted").toBe(false);
  expect(found.tags).toContain("h1");
  expect(found.tags).toContain("p");
});

test("ignored selectors take their whole subtree with them", async ({ page }) => {
  await load(page, "prose.html");

  const counts = await page.evaluate(() => ({
    all: window.quoin.textBlocks(document.body, []).length,
    ignoring: window.quoin.textBlocks(document.body, [".display"]).length,
  }));

  expect(counts.ignoring).toBe(counts.all - 1);
});

test("an unparseable ignore selector does not take the walk down with it", async ({
  page,
}) => {
  /* Skipping nothing is the safe reading of a broken selector. Throwing means
     one typo in a config file reports the whole page as unmeasurable. */
  await load(page, "prose.html");

  const result = await page.evaluate(() => {
    try {
      return {
        count: window.quoin.textBlocks(document.body, ["!!!not a selector"]).length,
        threw: false,
      };
    } catch (error) {
      return { count: 0, threw: true, message: String(error) };
    }
  });

  expect(result.threw).toBe(false);
  expect(result.count).toBeGreaterThan(6);
});

test("drift is measured in document space, not viewport space", async ({ page }) => {
  /* Scroll position is not a property of the page's typography, and a report
     that changes when the reader scrolls is not a report. */
  await load(page, "prose.html");

  const result = await page.evaluate(async ({ grid }) => {
    const top = window.quoin.verifyGrid(grid).report;
    window.scrollTo(0, 400);
    await new Promise((r) => requestAnimationFrame(r));
    const scrolled = window.quoin.verifyGrid(grid).report;
    window.scrollTo(0, 0);
    return { top, scrolled };
  }, { grid: GRID });

  expect(result.scrolled.onGrid).toBe(result.top.onGrid);
  expect(result.scrolled.worst).toBeCloseTo(result.top.worst, 5);
});

test("nodes under a transform are excluded and counted, not silently mixed in", async ({
  page,
}) => {
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const before = window.quoin.verifyGrid(grid);

    /* Scale a wrapper, which puts everything inside it into a different
       coordinate space from `line-height`. */
    const host = document.createElement("div");
    host.style.transform = "scale(1.5)";
    host.innerHTML = "<p>Scaled text, in a different coordinate space.</p>";
    document.body.appendChild(host);

    const after = window.quoin.verifyGrid(grid);
    const included = window.quoin.verifyGrid({ ...grid, includeTransformed: true });

    return {
      beforeTotal: before.report.total,
      afterTotal: after.report.total,
      afterSkipped: after.skippedTransformed,
      includedTotal: included.report.total,
      includedFlagged: included.results.filter((r) => r.transformed).length,
    };
  }, { grid: GRID });

  expect(result.afterTotal, "the scaled node was not counted").toBe(result.beforeTotal);
  expect(result.afterSkipped, "it was counted as skipped").toBeGreaterThan(0);
  expect(result.includedTotal, "opting in counts it").toBeGreaterThan(result.beforeTotal);
  expect(result.includedFlagged, "and flags it").toBeGreaterThan(0);
});

/* Sweep the origin to find where a page's baselines actually sit, then step off
   it by a fixed amount. What the report says about that step is the thing under
   test. */
const sweepAndNudge = () => {
  let best = { origin: 0, onGrid: -1 };
  for (let origin = 0; origin < 8; origin += 0.25) {
    const report = window.quoin.verifyGrid({ pitch: 8, origin }).report;
    if (report.onGrid > best.onGrid) best = { origin, onGrid: report.onGrid };
  }
  return {
    best,
    aligned: window.quoin.verifyGrid({ pitch: 8, origin: best.origin }).report,
    nudged: window.quoin.verifyGrid({ pitch: 8, origin: best.origin + 2 }).report,
  };
};

test("one phase: a uniform offset reads as systematic", async ({ page }) => {
  /* The one-line-fix case. One font, one size, one leading, so every first
     baseline sits at the same offset inside its own line box and a single
     origin serves the whole page. */
  await load(page, "one-phase.html");

  const result = await page.evaluate(sweepAndNudge);

  expect(result.aligned.onGrid, "the origin sweep found the phase").toBeGreaterThan(3);
  expect(result.nudged.offGrid, "nudging took nodes off the grid").toBeGreaterThan(1);
  expect(
    result.nudged.distinctDrifts,
    "one phase should produce one drift value"
  ).toBe(1);
  expect(result.nudged.systematic, "and should read as systematic").toBe(true);
});

test("two phases: the same nudge does not read as systematic", async ({ page }) => {
  /*
     The contrast, and the reason the field exists.

     seated.html is identical to one-phase.html except that it has a heading at
     a different size. Two sizes is two ascents is two phases, and no single
     origin serves both. In a screenshot the two pages look equally crooked;
     one wants a changed origin and the other wants a changed type scale, and
     `distinctDrifts` is what tells them apart.

     The first version of this test pointed the systematic assertion at THIS
     fixture and failed in all three engines, which was the fixture being right
     and the test being wrong. */
  await load(page, "seated.html");

  const result = await page.evaluate(sweepAndNudge);

  expect(
    result.nudged.distinctDrifts,
    "a heading at a second size is a second phase"
  ).toBeGreaterThan(1);
  expect(result.nudged.systematic, "so it is not one shared offset").toBe(false);
});

test("the resolved font is reported, not the one that was asked for", async ({ page }) => {
  await load(page, "prose.html");

  const fonts = await page.evaluate(({ grid }) => {
    const { results } = window.quoin.verifyGrid(grid);
    return [...new Set(results.map((r) => r.resolvedFont))];
  }, { grid: GRID });

  expect(fonts.length, "something was resolved").toBeGreaterThan(0);
  for (const font of fonts) {
    expect(font, `"${font}" should carry a px size`).toMatch(/\d+(\.\d+)?px/);
  }
});
