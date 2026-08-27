/* What the walk sees, and what it admits it cannot see.

   A measuring tool that skips a region and does not say so reports a number
   that is worse than no number. The torture fixture exists to make that
   concrete: before this suite, the walk found 332 blocks on it, seated all 332,
   and called the page 100% correct while two paragraphs inside an open shadow
   root sat off the grid, unmeasured and unmentioned. */

import { test, expect } from "@playwright/test";
import { load, GRID } from "./harness.ts";

test("it descends into open shadow roots", async ({ page }) => {
  await load(page, "torture.html");

  const result = await page.evaluate(() => {
    const withShadow = window.quoin.walk(document.body, { crossShadow: true });
    const without = window.quoin.walk(document.body, { crossShadow: false });

    const host = document.getElementById("shadow-host")!;
    const shadowParagraphs = host.shadowRoot!.querySelectorAll("p").length;

    return {
      withShadow: withShadow.blocks.length,
      without: without.blocks.length,
      shadowParagraphs,
      foundInShadow: withShadow.blocks.filter((el) => window.quoin.inShadowRoot(el)).length,
      /* Turning it off has to be reported, not merely obeyed. */
      countedWhenOff: without.closedShadowRoots,
    };
  });

  expect(result.shadowParagraphs, "the fixture has shadow content").toBe(2);
  expect(result.foundInShadow, "and the walk found it").toBe(2);
  expect(result.withShadow - result.without, "which is the whole difference").toBe(2);
  expect(result.countedWhenOff, "skipping it is reported").toBeGreaterThan(0);
});

test("shadow content is counted in the report rather than quietly dropped", async ({
  page,
}) => {
  await load(page, "torture.html");

  const result = await page.evaluate(({ grid }) => {
    const crossing = window.quoin.verifyGrid({ ...grid, crossShadow: true });
    const not = window.quoin.verifyGrid({ ...grid, crossShadow: false });
    return {
      crossingTotal: crossing.report.total,
      notTotal: not.report.total,
      notReported: not.closedShadowRoots,
      inShadowFlagged: crossing.results.filter((r) => r.inShadow).length,
    };
  }, { grid: GRID });

  expect(result.crossingTotal, "crossing finds more").toBeGreaterThan(result.notTotal);
  expect(result.inShadowFlagged, "and flags which").toBe(2);
  expect(result.notReported, "not crossing says so").toBeGreaterThan(0);
});

test("frames are counted, not walked", async ({ page }) => {
  /* A frame's content is a different document with its own layout origin, so a
     grid measured out here does not describe it. Point the tool at the frame's
     own URL instead. */
  await load(page, "torture.html");

  const result = await page.evaluate(({ grid }) => {
    const walked = window.quoin.walk(document.body, {});
    const verified = window.quoin.verifyGrid(grid);
    return {
      frames: walked.frames,
      reportedFrames: verified.frames,
      /* Nothing from inside the frame leaked into the results. */
      leaked: verified.results.filter((r) => r.sample.includes("Text in an iframe")).length,
    };
  }, { grid: GRID });

  expect(result.frames, "the fixture has a frame").toBeGreaterThan(0);
  expect(result.reportedFrames).toBe(result.frames);
  expect(result.leaked, "no frame content in the results").toBe(0);
});

test("a shadow-root block is seated but reported as uncarryable by CSS", async ({
  page,
}) => {
  /*
     The honest answer to a hard case. A document stylesheet does not reach
     inside a shadow root: `::part()` exposes only what the component chose to
     expose, and the piercing combinator was removed from the platform years
     ago. So the seater moves them at runtime and the export says it cannot.
  */
  await load(page, "torture.html");

  const result = await page.evaluate(({ grid }) => {
    const seated = window.quoin.seatPage(grid);
    const shadowBlocks = seated.blocks.filter((b) => b.inShadow);
    return {
      shadowBlocks: shadowBlocks.length,
      allSeated: shadowBlocks.every((b) => b.seated),
      allWithoutSelector: shadowBlocks.every((b) => b.selector === null),
      inShadowCount: seated.inShadow,
      unexportable: seated.unexportable,
      css: window.quoin.exportCss(seated).slice(0, 400),
    };
  }, { grid: GRID });

  expect(result.shadowBlocks, "found the shadow blocks").toBe(2);
  expect(result.allSeated, "seated them at runtime").toBe(true);
  expect(result.allWithoutSelector, "and built no selector for them").toBe(true);
  expect(result.inShadowCount, "reported as a category of their own").toBe(2);
  expect(result.unexportable, "and included in the unexportable count").toBeGreaterThanOrEqual(2);
  expect(result.css, "and named in the stylesheet").toContain("no unique selector");
});

test("the torture page does not produce NaN, undefined, or a page error", async ({
  page,
}) => {
  /* Display contents, multi-column, drop capitals, tables, right-to-left,
     vertical writing, a scroll container, content-visibility, fourteen levels
     of nesting and three hundred generated paragraphs. None of it should throw
     and none of it should reach the stylesheet as a broken value. */
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await load(page, "torture.html");

  const result = await page.evaluate(({ grid }) => {
    const before = window.quoin.verifyGrid(grid).report;
    const seated = window.quoin.seatPage(grid);
    const after = window.quoin.verifyGrid(grid).report;
    const css = window.quoin.exportCss(seated);
    return {
      before: before.onGrid,
      total: before.total,
      after: after.onGrid,
      exhausted: seated.exhausted,
      passes: seated.passes,
      hasNaN: css.includes("NaN"),
      hasUndefined: css.includes("undefined"),
      hasNullSelector: css.includes("null {"),
    };
  }, { grid: GRID });

  expect(errors, "no page errors").toEqual([]);
  expect(result.total, "it found the bulk paragraphs").toBeGreaterThan(300);
  expect(result.after, "and seated nearly all of them").toBeGreaterThan(result.total * 0.95);
  expect(result.exhausted, "and converged inside the pass limit").toBe(false);
  expect(result.hasNaN).toBe(false);
  expect(result.hasUndefined).toBe(false);
  expect(result.hasNullSelector).toBe(false);
});

test("a vertical writing mode is skipped rather than measured sideways", async ({
  page,
}) => {
  await load(page, "torture.html");

  const found = await page.evaluate(({ grid }) => {
    const { results } = window.quoin.verifyGrid(grid);
    return results.filter((r) => r.sample.includes("縦書き")).length;
  }, { grid: GRID });

  expect(found, "the vertical paragraph was not measured against a horizontal grid").toBe(0);
});

test("a page with no text at all reports zero rather than dividing by it", async ({
  page,
}) => {
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    const report = window.quoin.verifyGrid({ ...grid, root: empty }).report;
    const seated = window.quoin.seatPage({ ...grid, root: empty });
    const css = window.quoin.exportCss(seated);
    empty.remove();
    return {
      total: report.total,
      onGrid: report.onGrid,
      worst: report.worst,
      distinctDrifts: report.distinctDrifts,
      systematic: report.systematic,
      blocks: seated.blocks.length,
      passes: seated.passes,
      css,
    };
  }, { grid: GRID });

  expect(result.total).toBe(0);
  expect(result.onGrid).toBe(0);
  expect(result.worst).toBe(0);
  expect(result.distinctDrifts).toBe(0);
  expect(result.systematic).toBe(false);
  expect(result.blocks).toBe(0);
  expect(result.passes, "it stopped after one look").toBe(1);
  expect(result.css).toContain("already on the grid");
});

test("a detached element is walked without throwing", async ({ page }) => {
  /* Somebody will pass one. `getComputedStyle` on a detached node returns an
     empty declaration in every engine, which is a shape the walk has to
     survive rather than a case it can rule out. */
  await load(page, "prose.html");

  const result = await page.evaluate(() => {
    const detached = document.createElement("div");
    detached.innerHTML = "<p>Not in the document.</p>";
    try {
      return { blocks: window.quoin.walk(detached, {}).blocks.length, threw: false };
    } catch (error) {
      return { blocks: -1, threw: true, message: String(error) };
    }
  });

  expect(result.threw, "walking a detached tree did not throw").toBe(false);
});

test("inline boxes are not counted or seated: their line belongs to the parent", async ({
  page,
}) => {
  /*
     An inline box sits on the line box its parent laid out, so it has no
     baseline of its own. Counting one counts the parent's line twice, and
     seating one pushes those words off the line the rest of the sentence is
     on. That happened on this project's own homepage: a version number in a
     span, moved seven pixels down by the tool, in the header.
  */
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const host = document.querySelector("p") as HTMLElement;
    host.innerHTML =
      'Words before <strong>a bold run</strong> and <span class="probe">a span</span> after.';

    const blocks = window.quoin.textBlocks(document.body, []);
    const sawInline = blocks.some((el) => ["STRONG", "SPAN"].includes(el.tagName));

    const seated = window.quoin.seatPage(grid);
    const css = window.quoin.exportCss(seated);
    const probe = document.querySelector(".probe") as HTMLElement;
    const moved = getComputedStyle(probe).position !== "static";
    seated.undo();

    return {
      sawInline,
      moved,
      cssTouchesSpan: /span\.probe|strong/.test(css),
    };
  }, { grid: GRID });

  expect(result.sawInline, "the walk skipped the inline runs").toBe(false);
  expect(result.moved, "and the seater did not move them").toBe(false);
  expect(result.cssTouchesSpan, "and the stylesheet does not mention them").toBe(false);
});
