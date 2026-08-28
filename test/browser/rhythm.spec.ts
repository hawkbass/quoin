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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

test("rhythm accepts the origin the CLI actually passes it", async ({ page }) => {
  /*
     `quoin rhythm <url>` died on its own default, in a shipped release.

     `--origin` takes a number or `auto`, and `auto` is the default, which the
     README says and the CLI does. `verifyRhythm` never reads the origin at all,
     because a box is a whole number of rows tall or it is not and where the
     grid starts has nothing to do with it. But it handed the whole options
     object to `gridConfig` to validate, and that refuses anything which is not
     a finite number, so the command threw an uncaught RangeError before it
     measured anything.

     Nothing caught it because every test here passes a pitch and no origin, and
     the CLI tests never ran `rhythm` without one. The default path was the one
     path nobody exercised.

     Both spellings are checked, and the readings have to agree: if the origin
     ever started mattering to rhythm, passing a different one would change the
     answer and this would say so.
  */
  await load(page, "prose.html");

  const readings = await page.evaluate(() => {
    const run = (options: unknown) => {
      try {
        const report = window.quoin.verifyRhythm(options as never);
        return { threw: null as string | null, onRhythm: report.onRhythm, total: report.total };
      } catch (error) {
        return { threw: String(error), onRhythm: -1, total: -1 };
      }
    };
    return {
      auto: run({ pitch: 8, origin: "auto" }),
      zero: run({ pitch: 8, origin: 0 }),
      shifted: run({ pitch: 8, origin: 3 }),
      omitted: run({ pitch: 8 }),
    };
  });

  for (const [label, reading] of Object.entries(readings)) {
    expect(reading.threw, `origin ${label} threw: ${reading.threw}`).toBeNull();
  }

  /* The control: this file is measuring something, not an empty page. */
  expect(readings.omitted.total, "no boxes were measured").toBeGreaterThan(0);

  expect(
    readings.auto.onRhythm,
    "an origin changed the rhythm reading, so rhythm now depends on it"
  ).toBe(readings.omitted.onRhythm);
  expect(readings.zero.onRhythm).toBe(readings.omitted.onRhythm);
  expect(readings.shifted.onRhythm).toBe(readings.omitted.onRhythm);
});

test("the border advice can always be followed", async ({ page }) => {
  /*
     The tool told a box with no padding to set `padding 0px instead of 0px`.

     The suggestion subtracted the border from the padding and clamped the
     result at zero, without checking there was any padding to subtract from.
     On quoin.dev that was most of what it said about its own page: every table
     header and every unpadded wrapper got a sentence that contradicted itself.

     Three shapes are checked, because the fix has three branches and only one
     of them existed before: padding that can absorb the border, padding too
     small to absorb it, and no padding at all.
  */
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; font: 16px/24px serif }
    div { border-top: 1px solid #000; border-bottom: 2px solid #000 }
    .roomy { padding: 16px 0 }
    .tight { padding: 1px 0 }
    .bare  { padding: 0 }
  </style>
  <div class="roomy">Padding with room to spare.</div>
  <div class="tight">Padding, but not enough of it.</div>
  <div class="bare">No padding at all.</div>`);
  await page.addScriptTag({ content: readFileSync(resolve("dist/quoin.global.js"), "utf8") });

  const issues = await page.evaluate(() => {
    const report = window.quoin.verifyRhythm({ pitch: 8, limit: 50 });
    return report.issues
      .filter((issue) => issue.cause === "border")
      .map((issue) => ({ path: issue.path, fix: issue.fix }));
  });

  expect(issues.length, "no border issues were produced, so nothing was tested").toBe(3);

  for (const issue of issues) {
    /* The defect, stated as the thing it produced. */
    expect(issue.fix, `${issue.path}: ${issue.fix}`).not.toMatch(
      /(\b[\d.]+)px instead of \1px/
    );
    /* And every branch has to name a number to act on. */
    expect(issue.fix, `${issue.path} gave no figure`).toMatch(/[\d.]+px/);
  }

  /* The branch that did not exist: no padding means make it up, not spend it. */
  const bare = issues.find((issue) => issue.path.includes("bare"));
  expect(bare, "the unpadded box was not reported").toBeTruthy();
  expect(bare!.fix, bare!.fix).toMatch(/no padding to take it out of/);
});
