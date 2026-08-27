/* Does the export notice when the page's own CSS beats it?

   The seater has always re-measured its own corrections. The export did not,
   and it took a real page to find out: Material Design 3 seated 123 of 123 with
   the script and 18 of 123 with the exported stylesheet, because nine
   `line-height` declarations lost the cascade to Angular's four-component
   scoped selectors, and a block whose leading stays 2px short moves everything
   below it up by 2px.

   `specificity.html` is that page in miniature, so the case is covered by CI
   rather than by remembering to run a manual script against somebody else's
   deploy. */

import { test, expect } from "@playwright/test";
import { load, GRID } from "./harness.ts";

test("it detects declarations the page overrules", async ({ page }) => {
  await load(page, "specificity.html");

  const result = await page.evaluate(({ grid }) => {
    const seated = window.quoin.seatPage(grid);
    const plain = window.quoin.exportCss(seated);
    seated.undo();
    const check = window.quoin.checkExport(seated, plain);
    return {
      lost: check.lost.length,
      unmatched: check.unmatched,
      clean: check.clean,
      properties: check.lost.map((l) => (l as { property: string }).property),
    };
  }, { grid: GRID });

  /* If this ever reads zero, either the fixture stopped reproducing the case or
     the check stopped checking. Both are worth failing on. */
  expect(result.lost, "the fixture defeats the plain export").toBeGreaterThan(0);
  expect(result.clean).toBe(false);
  expect(result.properties, "and it is the leading that loses").toContain("line-height");
});

test("escalation rescues what can be rescued, and reports what cannot", async ({
  page,
}) => {
  await load(page, "specificity.html");

  const result = await page.evaluate(({ grid }) => {
    const before = window.quoin.verifyGrid(grid).report;
    const seated = window.quoin.seatPage(grid);
    const withScript = window.quoin.verifyGrid(grid).report;

    /* Undoes the seating itself, so what follows measures the stylesheet on a
       page carrying none of the tool's own styles. */
    const verified = window.quoin.exportCssVerified(seated);
    const restored = window.quoin.verifyGrid(grid).report;

    const style = document.createElement("style");
    style.textContent = verified.css;
    document.head.appendChild(style);
    const withCss = window.quoin.verifyGrid(grid).report;

    return {
      before: before.onGrid,
      total: before.total,
      withScript: withScript.onGrid,
      restored: restored.onGrid,
      withCss: withCss.onGrid,
      escalated: verified.escalated,
      stillLost: verified.check.lost.length,
      importantCount: (verified.css.match(/!important/g) ?? []).length,
      lostProperties: verified.check.lost.map(
        (l) => (l as { property: string; sample: string }).sample
      ),
    };
  }, { grid: GRID });

  expect(result.restored, "undo was exact").toBe(result.before);
  expect(result.escalated, "something needed escalating").toBeGreaterThan(0);

  /*
     The count and the effect have to agree.

     The first version of this escalation reported nine and emitted zero,
     because a NUL byte had got into the template literal building its lookup
     key. It counted what it intended rather than what it did, which is the
     failure the whole library argues against. So the test asserts on the
     artefact.
  */
  expect(
    result.importantCount,
    "escalating N declarations should put !important in the stylesheet"
  ).toBeGreaterThanOrEqual(result.escalated);

  /* The `.locked` paragraph is `!important` in the page's own CSS, so nothing
     appended later outranks it at equal specificity. It has to be reported as
     lost rather than counted as fixed. */
  expect(result.stillLost, "the already-important rule is still lost").toBeGreaterThan(0);
  expect(
    /* The sample is truncated to 40 characters, so match inside that. */
    result.lostProperties.some((s) => s.includes("line-height is already")),
    `and it is the right one: ${JSON.stringify(result.lostProperties)}`
  ).toBe(true);

  /* Everything else should now hold without the script. */
  expect(result.withCss, "the stylesheet reproduces most of the seating").toBeGreaterThan(
    result.before
  );
  expect(
    result.withCss,
    `stylesheet ${result.withCss}/${result.total} against script ${result.withScript}`
  ).toBeGreaterThanOrEqual(result.withScript - result.stillLost - 1);
});

test("a page needing no escalation gets a stylesheet with no !important in it", async ({
  page,
}) => {
  /* `!important` is a blunt instrument and it is applied here with a scalpel.
     Where nothing lost, the output should be what `exportCss` produces, and the
     way to know that is to check there is none in it. */
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const seated = window.quoin.seatPage(grid);
    const verified = window.quoin.exportCssVerified(seated);
    return {
      escalated: verified.escalated,
      clean: verified.check.clean,
      importantCount: (verified.css.match(/!important/g) ?? []).length,
    };
  }, { grid: GRID });

  expect(result.clean, "nothing lost on this page").toBe(true);
  expect(result.escalated).toBe(0);
  expect(result.importantCount, "so nothing was escalated").toBe(0);
});

test("exportCssVerified leaves the page unseated, and says so by doing it", async ({
  page,
}) => {
  /* It has to undo, because a stylesheet cannot be honestly tested against a
     page that is already carrying the corrections it encodes. The contract is
     documented; this is the test that it is kept. */
  await load(page, "prose.html");

  const result = await page.evaluate(({ grid }) => {
    const before = window.quoin.verifyGrid(grid).report.onGrid;
    const seated = window.quoin.seatPage(grid);
    window.quoin.exportCssVerified(seated);
    return {
      before,
      after: window.quoin.verifyGrid(grid).report.onGrid,
      stampsLeft: document.querySelectorAll("[data-quoin-seat]").length,
      probesLeft: document.querySelectorAll("[data-quoin-check]").length,
    };
  }, { grid: GRID });

  expect(result.after, "the page is back where it started").toBe(result.before);
  expect(result.stampsLeft, "no stamps left behind").toBe(0);
  expect(result.probesLeft, "no probe stylesheet left behind").toBe(0);
});
