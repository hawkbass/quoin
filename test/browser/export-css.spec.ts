/* Does the exported stylesheet actually seat the page?

   This is the test the library did not have, and its absence hid a real defect
   for months. The export used to key every rule on `[data-quoin-seat="7"]`, an
   attribute the script stamps on at runtime. The documentation said: export the
   stylesheet, paste it in, delete the script. Do that and nothing on the page
   carries the attribute, so every rule matches nothing and the page is exactly
   as crooked as it started.

   The test that existed asserted the output string contained `padding-top`. It
   did. It passed.

   So this one throws the seating away before checking: seat, export, undo, then
   apply the stylesheet on its own to the untouched page and re-measure. If the
   CSS does not reproduce the seating without the JavaScript, the export does
   not do the thing it exists to do. */

import { test, expect } from "@playwright/test";
import { load, GRID, IGNORE } from "./harness.ts";

for (const fixture of ["prose.html", "levers.html"]) {
  test(`${fixture}: the exported CSS seats the page with the script gone`, async ({ page }) => {
    await load(page, fixture);

    const result = await page.evaluate(
      ({ grid, ignore }) => {
        const before = window.quoin.verifyGrid({ ...grid, ignore }).report;

        const seated = window.quoin.seatPage({ ...grid, ignore });
        const withScript = window.quoin.verifyGrid({ ...grid, ignore }).report;
        const css = window.quoin.exportCss(seated);

        /* Everything the script did, undone. Attributes included. */
        seated.undo();
        const restored = window.quoin.verifyGrid({ ...grid, ignore }).report;

        /* Now the stylesheet on its own, against the page as authored. */
        const style = document.createElement("style");
        style.id = "quoin-export-under-test";
        style.textContent = css;
        document.head.appendChild(style);

        const withCss = window.quoin.verifyGrid({ ...grid, ignore }).report;

        return {
          before,
          withScript,
          restored,
          withCss,
          css,
          unexportable: seated.unexportable,
          missed: seated.missed,
          stampsLeft: document.querySelectorAll("[data-quoin-seat]").length,
        };
      },
      { grid: GRID, ignore: IGNORE }
    );

    /* The undo has to be complete, or the "with CSS" reading is measuring the
       stylesheet plus whatever the script left behind. */
    expect(result.stampsLeft, "undo removed every stamp").toBe(0);
    expect(result.restored.onGrid, "undo restored the original page").toBe(
      result.before.onGrid
    );

    expect(result.withScript.onGrid, "the script seated something").toBeGreaterThan(
      result.before.onGrid
    );

    /* The claim under test. */
    expect(
      result.withCss.onGrid,
      `the exported CSS should seat the page on its own.\n` +
        `before ${result.before.onGrid}/${result.before.total}, ` +
        `script ${result.withScript.onGrid}, css ${result.withCss.onGrid}\n\n` +
        result.css.slice(0, 1200)
    ).toBeGreaterThan(result.before.onGrid);

    /* And it should get within one block of what the script managed. The gap
       that is allowed for is `unexportable`: blocks the seater moved but could
       not build a unique selector for, which are reported rather than
       pretended away. */
    expect(
      result.withCss.onGrid,
      `CSS should match the script to within its reported ${result.unexportable} unexportable blocks`
    ).toBeGreaterThanOrEqual(result.withScript.onGrid - result.unexportable - 1);
  });
}

test("the export names what it could not carry rather than dropping it silently", async ({
  page,
}) => {
  await load(page, "levers.html");

  const { css, missed, unexportable } = await page.evaluate(
    ({ grid }) => {
      const seated = window.quoin.seatPage(grid);
      return {
        css: window.quoin.exportCss(seated),
        missed: seated.missed,
        unexportable: seated.unexportable,
      };
    },
    { grid: GRID }
  );

  /* A corrector that quietly counts a block it could not move as fixed is
     reporting on itself rather than on the page. */
  if (missed > 0) {
    expect(css, "missed blocks are named in the stylesheet").toContain("could not be moved");
  }
  if (unexportable > 0) {
    expect(css, "unexportable blocks are named in the stylesheet").toContain(
      "no unique selector"
    );
  }
  expect(css).toContain("Grid: 8px");
  expect(css, "no NaN leaked into a declaration").not.toContain("NaN");
  expect(css, "no undefined leaked into a declaration").not.toContain("undefined");
});

test("every selector in the export parses and matches exactly one element", async ({
  page,
}) => {
  await load(page, "prose.html");

  const bad = await page.evaluate(
    ({ grid }) => {
      const seated = window.quoin.seatPage(grid);
      const css = window.quoin.exportCss(seated);
      seated.undo();

      /* One line, ending in `{`, not a comment. Anchored on both ends because
         the first version of this pattern used `[^{]*`, which happily spanned
         a closing brace and two comment lines and then reported the resulting
         soup as an invalid selector. A test failing on its own parser rather
         than on the thing under test. */
      const selectors = [...css.matchAll(/^([^\s{}/][^{}\n]*?)\s*\{[ \t]*$/gm)].map((m) =>
        (m[1] as string).trim()
      );

      return selectors
        .map((selector) => {
          try {
            const found = document.querySelectorAll(selector);
            return found.length === 1 ? null : { selector, matched: found.length };
          } catch (error) {
            return { selector, matched: -1, error: String(error) };
          }
        })
        .filter(Boolean);
    },
    { grid: GRID }
  );

  expect(bad, `selectors that did not match exactly one element: ${JSON.stringify(bad)}`).toEqual(
    []
  );
});
