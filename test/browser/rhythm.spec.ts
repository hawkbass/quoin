/* Rhythm: is every box a whole number of grid rows tall?

   Phase is where a baseline sits inside its line box, and it is what the rest of
   this suite is about. Rhythm is what decides whether a correction survives
   anything changing, because a box that is not a whole number of rows shifts
   everything after it, and it shifts it by a different amount at every viewport.

   This is the half that explains the limitation on quoin.dev: seated at one
   width the site measured 100%, and at another 79%, and the difference was
   boxes whose heights were not whole rows. */

import { test, expect } from "@playwright/test";
import { load, GRID } from "./harness.ts";

test("a page built on the grid has nothing to report", async ({ page }) => {
  /* one-phase.html is the fixture where every leading and every margin is a
     whole number of rows. If this ever fails, the diagnostic has started
     inventing problems. */
  await load(page, "one-phase.html");

  const report = await page.evaluate(({ grid }) => window.quoin.verifyRhythm(grid), {
    grid: GRID,
  });

  expect(report.total, "it measured the boxes").toBeGreaterThan(3);
  expect(
    report.onRhythm,
    `every box should be a whole number of rows: ${JSON.stringify(report.issues.slice(0, 3))}`
  ).toBe(report.total);
  expect(report.accumulated).toBe(0);
});

test("it names leading as the cause when the leading is a ratio", async ({ page }) => {
  /* prose.html sets `line-height: 1.618` on 17.6px text, which resolves to
     28.4768px. That is the single most common way a page loses its rhythm and
     it is invisible in the stylesheet, because 1.618 looks like a decision
     rather than a number. */
  await load(page, "prose.html");

  const report = await page.evaluate(({ grid }) => window.quoin.verifyRhythm(grid), {
    grid: GRID,
  });

  expect(report.byCause.leading, "the ratios are found").toBeGreaterThan(3);
  expect(report.accumulated, "and they add up to real drift").toBeGreaterThan(10);

  const leading = report.issues.find((i) => i.cause === "leading");
  expect(leading, "there is a leading issue to inspect").toBeTruthy();
  expect(leading!.detail, "it says what the leading resolved to").toMatch(/line-height [\d.]+px/);
  expect(leading!.fix, "and gives a number to set").toMatch(/Set line-height to \d+px/);
});

test("it names a hairline border, which is the invisible one", async ({ page }) => {
  /* A 1px rule is a pixel in the flow, it is invisible in a design tool, and it
     was one of three causes of ninety distinct drift values on craighawkes.dev.
     The fix is to take it out of the box's own padding rather than remove it. */
  await load(page, "prose.html");

  const found = await page.evaluate(({ grid }) => {
    const el = document.createElement("div");
    el.id = "hairline";
    /* 24px of content plus 8px of padding is four rows. The border is the
       whole defect. */
    el.style.cssText =
      "border-top:1px solid #000;padding:4px 0;line-height:24px;font-size:16px";
    el.textContent = "One hairline.";
    document.body.appendChild(el);

    const report = window.quoin.verifyRhythm(grid);
    const issue = report.issues.find((i) => i.path.includes("hairline"));
    el.remove();
    return issue ?? null;
  }, { grid: GRID });

  expect(found, "the bordered box was flagged").toBeTruthy();
  expect(found!.cause).toBe("border");
  expect(found!.over).toBe(1);
  expect(found!.detail).toContain("border");
  expect(found!.fix, "the fix keeps the rule and adjusts the padding").toContain("padding");
});

test("a box that inherited its fraction is not counted as introducing it", async ({
  page,
}) => {
  /*
     A wrapper whose height is fractional because its child's is has introduced
     nothing, and counting both reports the same pixel twice. On Linear a naive
     sum came to 3617px across 1453 boxes, most of it containers inheriting the
     same 7.28px from the one inside them, nine levels deep.
  */
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const outer = document.createElement("div");
    outer.id = "outer";
    const inner = document.createElement("div");
    inner.id = "inner";
    /* The inner box owns the fraction: a 25px line on an 8px grid. */
    inner.style.cssText = "line-height:25px;font-size:16px";
    inner.textContent = "The fraction starts here.";
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const report = window.quoin.verifyRhythm(grid);
    const innerIssue = report.issues.find((i) => i.path.includes("inner"));
    const outerIssue = report.issues.find((i) => i.path.includes("outer"));
    outer.remove();

    return {
      innerCause: innerIssue?.cause ?? null,
      outerCause: outerIssue?.cause ?? null,
      inherited: report.inherited,
    };
  }, { grid: GRID });

  expect(result.innerCause, "the box that owns it is named as leading").toBe("leading");
  expect(result.outerCause, "and the wrapper is named as inheriting").toBe("contents");
  expect(result.inherited, "which is counted separately").toBeGreaterThan(0);
});

test("issues are ranked by how many blocks they move, not by how many pixels", async ({
  page,
}) => {
  /*
     Three pixels at the top of a page moves everything. Seven at the bottom
     moves nothing. A report sorted by size puts the harmless one first.
  */
  await load(page, "torture.html");

  const report = await page.evaluate(({ grid }) => window.quoin.verifyRhythm(grid), {
    grid: GRID,
  });

  const owned = report.issues.filter(
    (i) => i.cause !== "contents" && i.cause !== "unknown"
  );
  expect(owned.length, "the torture page has plenty").toBeGreaterThan(5);

  for (let i = 1; i < owned.length; i++) {
    expect(
      owned[i - 1]!.below,
      `issue ${i} moves more blocks than the one before it`
    ).toBeGreaterThanOrEqual(owned[i]!.below);
  }

  /* And every actionable issue sorts above every inherited one. */
  const firstInherited = report.issues.findIndex(
    (i) => i.cause === "contents" || i.cause === "unknown"
  );
  const lastOwned = report.issues.reduce(
    (last, issue, at) =>
      issue.cause !== "contents" && issue.cause !== "unknown" ? at : last,
    -1
  );
  if (firstInherited >= 0 && lastOwned >= 0) {
    expect(firstInherited, "actionable issues come first").toBeGreaterThan(lastOwned);
  }
});

test("a replaced element is told to get a height, not to fix its leading", async ({
  page,
}) => {
  await load(page, "prose.html");

  const found = await page.evaluate(({ grid }) => {
    const img = document.createElement("canvas");
    img.id = "oddcanvas";
    img.width = 40;
    img.height = 37;
    img.style.cssText = "display:block";
    document.body.appendChild(img);
    const report = window.quoin.verifyRhythm(grid);
    const issue = report.issues.find((i) => i.path.includes("oddcanvas"));
    img.remove();
    return issue ?? null;
  }, { grid: GRID });

  expect(found, "the canvas was flagged").toBeTruthy();
  expect(found!.cause).toBe("replaced");
  expect(found!.fix, "and told to take a height rather than a line-height").toContain("height");
  expect(found!.fix).not.toContain("line-height");
});

test("out of flow elements are not measured, because they move nothing", async ({
  page,
}) => {
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const before = window.quoin.verifyRhythm(grid).total;

    const floating = document.createElement("div");
    floating.style.cssText = "position:fixed;top:0;left:0;height:37px;line-height:25px";
    floating.textContent = "Out of flow and deliberately crooked.";
    document.body.appendChild(floating);

    const after = window.quoin.verifyRhythm(grid);
    floating.remove();
    return { before, afterTotal: after.total };
  }, { grid: GRID });

  expect(result.afterTotal, "a fixed box is not part of the flow").toBe(result.before);
});
