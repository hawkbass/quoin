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
     The contrast, and the reason the field exists. One shared offset is a wrong
     origin and a one-line fix. Two is a type scale and a spacing scale
     disagreeing, which is a design problem wearing a CSS costume. They look
     identical in a screenshot and want completely different responses.

     The second phase is BUILT here rather than borrowed from a fixture, and
     that is the point of this comment. The first version pointed at a fixture
     with a heading at twice the body size and asserted that two sizes give two
     phases. It passed on this machine and failed on the CI runner, because
     whether two sizes land on different sub-grid offsets depends on the
     resolved font's ascent and descent ratios, and the runner resolves
     `monospace` to a different font. The test was asserting a property of one
     platform's default typeface and calling it a property of type scales.

     Half a pitch is a different phase in any font on any platform, because it
     does not depend on the font at all. */
  await load(page, "one-phase.html");

  const result = await page.evaluate(({ pitch }) => {
    const first = document.querySelector("p") as HTMLElement;
    const clone = first.cloneNode(true) as HTMLElement;
    clone.textContent = "A paragraph pushed half a grid row out of phase.";
    clone.style.paddingTop = `${pitch / 2}px`;
    first.parentNode!.insertBefore(clone, first.nextSibling);

    let best = { origin: 0, onGrid: -1 };
    for (let origin = 0; origin < pitch; origin += 0.25) {
      const report = window.quoin.verifyGrid({ pitch, origin }).report;
      if (report.onGrid > best.onGrid) best = { origin, onGrid: report.onGrid };
    }
    return {
      aligned: window.quoin.verifyGrid({ pitch, origin: best.origin }).report,
      nudged: window.quoin.verifyGrid({ pitch, origin: best.origin + 2 }).report,
    };
  }, { pitch: GRID.pitch });

  expect(
    result.nudged.distinctDrifts,
    "a block half a row out of phase is a second phase, in any font"
  ).toBeGreaterThan(1);
  expect(result.nudged.systematic, "so it is not one shared offset").toBe(false);

  /* And no origin serves both, which is what having two phases means. */
  expect(
    result.aligned.offGrid,
    "no single origin seats a page with two phases"
  ).toBeGreaterThan(0);
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

/* ------------------------------------------------------------------ *
   Solving for the origin
 * ------------------------------------------------------------------ */

test("a page offset by a constant is found rather than reported as nothing", async ({
  page,
}) => {
  /*
     one-phase.html has a single phase, so one origin serves all of it. Push the
     whole page down by three pixels and an origin of zero reports nothing on
     the grid, because zero asks whether baselines sit on multiples of the pitch
     from the top of the document and every one of them now does not. The page
     is still on an 8px grid. Its origin is three.
  */
  await load(page, "one-phase.html");

  const measured = await page.evaluate(({ grid }) => {
    document.body.style.paddingTop = "3px";
    const fixed = window.quoin.verifyGrid(grid);
    const solved = window.quoin.verifyGrid({ ...grid, origin: "auto" });
    return {
      fixed: fixed.report,
      solved: solved.report,
      origin: solved.grid.origin,
      solvedFlag: solved.originSolved,
      fixedFlag: fixed.originSolved,
    };
  }, { grid: GRID });

  expect(measured.fixed.onGrid, "against zero, nothing is on the grid").toBe(0);
  expect(measured.solved.onGrid, "against its own origin, all of it is").toBe(
    measured.solved.total
  );
  expect(measured.solvedFlag, "and it says the origin was solved").toBe(true);
  expect(measured.fixedFlag, "which a fixed origin does not claim").toBe(false);
});

test("solving never reports fewer blocks than a fixed origin would", async ({ page }) => {
  /*
     The property that makes the number trustworthy. `auto` maximises, so it can
     never be beaten by any particular origin, including the one it replaced.
     Checked against a sweep rather than against itself.
  */
  await load(page, "prose.html");

  const worst = await page.evaluate(({ grid }) => {
    const solved = window.quoin.verifyGrid({ ...grid, origin: "auto" });
    let best = 0;
    for (let origin = 0; origin < grid.pitch; origin += 0.25) {
      best = Math.max(best, window.quoin.verifyGrid({ ...grid, origin }).report.onGrid);
    }
    return { solved: solved.report.onGrid, best, total: solved.report.total };
  }, { grid: GRID });

  expect(worst.total).toBeGreaterThan(3);
  expect(worst.solved).toBeGreaterThanOrEqual(worst.best);
});

test("solving does not manufacture a grid on a page that has none", async ({ page }) => {
  /*
     The opposite failure, and the one that would make the tool useless: an
     origin flattering enough to hide real drift. Scatter the leading so every
     block sits at its own phase, and no origin can seat them.
  */
  await load(page, "prose.html");

  const scattered = await page.evaluate(({ grid }) => {
    document.querySelectorAll("p").forEach((p, i) => {
      (p as HTMLElement).style.lineHeight = `${20 + i * 1.3}px`;
    });
    const solved = window.quoin.verifyGrid({ ...grid, origin: "auto" });
    return solved.report;
  }, { grid: GRID });

  expect(scattered.total).toBeGreaterThan(4);
  expect(
    scattered.onGrid / scattered.total,
    "most of a scattered page stays off the grid"
  ).toBeLessThan(0.5);
});

test("an empty page does not crash the solver or invent an origin", async ({ page }) => {
  await load(page, "prose.html");

  const empty = await page.evaluate(({ grid }) => {
    document.body.textContent = "";
    const solved = window.quoin.verifyGrid({ ...grid, origin: "auto" });
    return { total: solved.report.total, origin: solved.grid.origin, flag: solved.originSolved };
  }, { grid: GRID });

  expect(empty.total).toBe(0);
  expect(empty.origin, "the origin it was given, not a guess").toBe(0);
  expect(empty.flag, "nothing was solved").toBe(false);
});
