/* Measuring a page that uses text-box-trim.

   `text-box-trim` reached Baseline in August 2026, which means pages built the
   modern way are arriving now, and until this file existed Quoin measured every
   one of them wrongly in two separate places.

   `verifyGrid` put the first baseline at half-leading plus ascent, which is the
   right sum for an ordinary block and 17.8px too low for a trimmed 32px serif
   one. That is more than two rows of an 8px grid, in the same direction, on
   every block on the page: a page built correctly would have been reported as
   almost entirely off the grid, and the page would have been right.

   `verifyRhythm` expected every box to be a whole number of rows. A trimmed box
   is deliberately not one, because it ends at its own baseline rather than at
   the bottom of a line box, so its height is `(lines - 1) x leading + capHeight`
   by design. The tool would have flagged every block on the page and told the
   author to fix a leading that was already correct.

   Both are the same mistake, which is measuring the new thing with the old
   model, and both are the kind that gets worse rather than better as adoption
   grows. */

import { test, expect } from "@playwright/test";
import { load, GRID } from "./harness.ts";

const TRIM = "text-box-trim:trim-both;text-box-edge:cap alphabetic";

async function trimSupported(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => CSS.supports("text-box-trim", "trim-both"));
}

test("the baseline of a trimmed block is measured where it actually is", async ({
  page,
}) => {
  /*
     Measured against the box itself rather than against the library's own
     arithmetic. The bottom edge of a trimmed block IS its last baseline, so a
     single-line block's baseline is its bottom edge, and that is a fact about
     the page rather than a fact about Quoin.
  */
  await load(page, "prose.html");

  if (!(await trimSupported(page))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const measured = await page.evaluate(({ grid }) => {
    const el = document.createElement("p");
    el.style.cssText = `font-size:32px;line-height:56px;margin:0;${
      "text-box-trim:trim-both;text-box-edge:cap alphabetic"
    }`;
    el.textContent = "Handgloves";
    document.body.replaceChildren(el);

    const rect = el.getBoundingClientRect();
    const report = window.quoin.verifyGrid({ ...grid, origin: "auto" });
    const result = report.results[0];

    return {
      measuredBaseline: result?.baseline ?? null,
      boxBottom: rect.bottom + window.scrollY,
      boxTop: rect.top + window.scrollY,
    };
  }, { grid: GRID });

  expect(measured.measuredBaseline).not.toBeNull();
  expect(
    Math.abs(measured.measuredBaseline! - measured.boxBottom),
    `Quoin put the baseline at ${measured.measuredBaseline}; the trimmed box ends at ${measured.boxBottom}`
  ).toBeLessThan(0.1);
});

test("an untrimmed block is still measured the old way", async ({ page }) => {
  /* The other half. Without this the test above passes on a build that has
     simply moved every baseline to the bottom of its box. */
  await load(page, "prose.html");

  const measured = await page.evaluate(({ grid }) => {
    const el = document.createElement("p");
    el.style.cssText = "font-size:32px;line-height:56px;margin:0";
    el.textContent = "Handgloves";
    document.body.replaceChildren(el);

    const rect = el.getBoundingClientRect();
    const report = window.quoin.verifyGrid({ ...grid, origin: "auto" });
    const result = report.results[0];
    const style = getComputedStyle(el);
    const metrics = window.quoin.measureFont(
      `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`,
      32
    );

    return {
      measuredBaseline: result?.baseline ?? null,
      boxTop: rect.top + window.scrollY,
      expectedWithin: window.quoin.baselineWithinLineBox(
        metrics as unknown as { ascent: number; descent: number },
        56
      ),
    };
  }, { grid: GRID });

  expect(measured.measuredBaseline).not.toBeNull();
  expect(
    Math.abs(measured.measuredBaseline! - (measured.boxTop + measured.expectedWithin)),
    "an ordinary block still sits at half-leading plus ascent"
  ).toBeLessThan(0.1);
});

test("a trimmed page built on the grid measures as being on it", async ({ page }) => {
  /*
     The whole point. Build a page whose leading is a whole number of rows and
     whose spacing closes the cap height's residue, and the measurement should
     agree that it is on the grid. Before this work it reported nought.
  */
  await load(page, "prose.html");

  if (!(await trimSupported(page))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const measured = await page.evaluate(({ grid, trim }) => {
    const cap = window.quoin.capHeightFromFontTable("16px serif")!;
    const residue = ((cap % grid.pitch) + grid.pitch) % grid.pitch;
    /* 24px of space, adjusted so space + cap is a whole number of rows. */
    const space = 24 + (grid.pitch - residue) - grid.pitch + grid.pitch;

    const root = document.createElement("div");
    root.style.cssText = "font-family:serif;margin:0;padding:0";
    for (let i = 0; i < 6; i++) {
      const el = document.createElement("p");
      el.style.cssText =
        `font-size:16px;line-height:24px;margin:${space}px 0 0;${trim}`;
      el.textContent = "Handgloves and quartz, paragraph " + (i + 1) + ".";
      root.appendChild(el);
    }
    document.body.replaceChildren(root);

    const report = window.quoin.verifyGrid({ ...grid, origin: "auto", root });
    return { onGrid: report.report.onGrid, total: report.report.total };
  }, { grid: GRID, trim: TRIM });

  expect(measured.total).toBeGreaterThan(4);
  expect(
    measured.onGrid,
    `${measured.onGrid}/${measured.total} on the grid`
  ).toBe(measured.total);
});

test("a trimmed block is not accused of losing its rhythm", async ({ page }) => {
  /*
     A trimmed box is deliberately not a whole number of rows: it ends at its
     own baseline. Reporting that as a defect, and blaming a leading that is
     already a whole number of rows, is the tool telling somebody to undo the
     thing it recommends.
  */
  await load(page, "prose.html");

  if (!(await trimSupported(page))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const report = await page.evaluate(({ grid, trim }) => {
    const root = document.createElement("div");
    root.style.cssText = "font-family:serif;margin:0;padding:0";
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("p");
      el.className = "trimmed";
      el.style.cssText = `font-size:16px;line-height:24px;margin:0;${trim}`;
      el.textContent = "Handgloves and quartz, paragraph " + (i + 1) + ".";
      root.appendChild(el);
    }
    document.body.replaceChildren(root);

    const rhythm = window.quoin.verifyRhythm({ ...grid, root });
    return {
      total: rhythm.total,
      onRhythm: rhythm.onRhythm,
      blamedLeading: rhythm.byCause.leading ?? 0,
      issues: rhythm.issues.slice(0, 2).map((i) => ({ cause: i.cause, detail: i.detail })),
    };
  }, { grid: GRID, trim: TRIM });

  expect(report.total).toBeGreaterThan(4);
  expect(
    report.blamedLeading,
    `the leading is 24px on an 8px grid and was blamed anyway: ${JSON.stringify(report.issues)}`
  ).toBe(0);
});

test("a trimmed block with a fractional leading is still caught", async ({ page }) => {
  /*
     The guard against the fix being a blanket exemption. Allowing a trimmed box
     to carry its cap height must not also excuse a leading that is off the
     grid, because that is a real defect and it is the commonest one in the
     corpus.
  */
  await load(page, "prose.html");

  if (!(await trimSupported(page))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const report = await page.evaluate(({ grid, trim }) => {
    const root = document.createElement("div");
    root.style.cssText = "font-family:serif;margin:0;padding:0";
    for (let i = 0; i < 4; i++) {
      const el = document.createElement("p");
      /* 25px on an 8px grid, wrapped so the fraction accumulates. */
      el.style.cssText =
        `font-size:16px;line-height:25px;margin:0;max-width:200px;${trim}`;
      el.textContent =
        "Handgloves and quartz and enough words to wrap this onto more than one line.";
      root.appendChild(el);
    }
    document.body.replaceChildren(root);

    const rhythm = window.quoin.verifyRhythm({ ...grid, root });
    return { blamedLeading: rhythm.byCause.leading ?? 0, onRhythm: rhythm.onRhythm };
  }, { grid: GRID, trim: TRIM });

  expect(
    report.blamedLeading,
    "a 25px leading is off the grid whether the box is trimmed or not"
  ).toBeGreaterThan(0);
});
