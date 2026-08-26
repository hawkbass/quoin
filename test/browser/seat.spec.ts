/* Does the seater actually put the page on the grid, and does it tell the
   truth about what it could not do? */

import { test, expect } from "@playwright/test";
import { load, GRID, IGNORE } from "./harness.ts";

test("prose.html: seating raises the on-grid count", async ({ page }) => {
  await load(page, "prose.html");

  const result = await page.evaluate(
    ({ grid, ignore }) => {
      const before = window.quoin.verifyGrid({ ...grid, ignore }).report;
      const seated = window.quoin.seatPage({ ...grid, ignore });
      const after = window.quoin.verifyGrid({ ...grid, ignore }).report;
      return { before, after, passes: seated.passes, missed: seated.missed };
    },
    { grid: GRID, ignore: IGNORE }
  );

  const beforePct = (result.before.onGrid / result.before.total) * 100;
  const afterPct = (result.after.onGrid / result.after.total) * 100;

  console.log(
    `  ${result.before.onGrid}/${result.before.total} (${beforePct.toFixed(1)}%) -> ` +
      `${result.after.onGrid}/${result.after.total} (${afterPct.toFixed(1)}%) ` +
      `in ${result.passes} sweeps, ${result.missed} missed`
  );

  expect(afterPct, "should end up mostly on the grid").toBeGreaterThan(90);
  expect(afterPct, "should improve").toBeGreaterThan(beforePct);
});

test("seating is reversible, down to the inline style attribute", async ({ page }) => {
  /* The first thing anyone does is toggle it to see whether it was worth it. */
  await load(page, "prose.html");

  const result = await page.evaluate(
    ({ grid }) => {
      const styleBefore = [...document.querySelectorAll("body *")].map(
        (el) => el.getAttribute("style") ?? ""
      );
      const before = window.quoin.verifyGrid(grid).report;

      const seated = window.quoin.seatPage(grid);
      const during = window.quoin.verifyGrid(grid).report;

      seated.undo();
      const after = window.quoin.verifyGrid(grid).report;
      const styleAfter = [...document.querySelectorAll("body *")].map(
        (el) => el.getAttribute("style") ?? ""
      );

      return {
        before,
        during,
        after,
        stylesMatch: JSON.stringify(styleBefore) === JSON.stringify(styleAfter),
        stampsLeft: document.querySelectorAll("[data-quoin-seat]").length,
      };
    },
    { grid: GRID }
  );

  expect(result.during.onGrid, "seating did something to undo").toBeGreaterThan(
    result.before.onGrid
  );
  expect(result.after.onGrid, "back to where it started").toBe(result.before.onGrid);
  expect(result.after.total, "same nodes counted").toBe(result.before.total);
  expect(result.stampsLeft, "no stamps left behind").toBe(0);
  expect(result.stylesMatch, "no inline styles left behind").toBe(true);
});

test("a second seat on an already-seated page changes almost nothing", async ({ page }) => {
  /* Idempotence, roughly: the sweep converges, so running it again should find
     the page already correct rather than pushing every block down another row.
     A corrector that grows the page a little on every call is one that has
     mistaken its own output for a new problem. */
  await load(page, "prose.html");

  const result = await page.evaluate(
    ({ grid, ignore }) => {
      const first = window.quoin.seatPage({ ...grid, ignore });
      const afterFirst = window.quoin.verifyGrid({ ...grid, ignore }).report;
      const heightAfterFirst = document.body.scrollHeight;

      const second = window.quoin.seatPage({ ...grid, ignore });
      const afterSecond = window.quoin.verifyGrid({ ...grid, ignore }).report;
      const heightAfterSecond = document.body.scrollHeight;

      return {
        afterFirst,
        afterSecond,
        heightAfterFirst,
        heightAfterSecond,
        firstPasses: first.passes,
        secondPasses: second.passes,
      };
    },
    { grid: GRID, ignore: IGNORE }
  );

  expect(result.afterSecond.onGrid, "still seated").toBeGreaterThanOrEqual(
    result.afterFirst.onGrid - 1
  );
  expect(
    Math.abs(result.heightAfterSecond - result.heightAfterFirst),
    "the page did not grow on the second run"
  ).toBeLessThanOrEqual(2);
});

test("levers.html: it reports which lever moved each block, and which moved none", async ({
  page,
}) => {
  /* Every block in this fixture defeats `padding-top` in a different way. The
     point is not that all of them get seated, since some genuinely cannot be, but
     that the tool says which. A corrector that counts a block it could not
     move as fixed is reporting on itself rather than on the page. */
  await load(page, "levers.html");

  const result = await page.evaluate(
    ({ grid }) => {
      const seated = window.quoin.seatPage(grid);
      const levers: Record<string, number> = {};
      for (const block of seated.blocks) {
        levers[block.lever] = (levers[block.lever] ?? 0) + 1;
      }
      return {
        levers,
        blocks: seated.blocks.map((b) => ({
          sample: b.sample.slice(0, 40),
          lever: b.lever,
          seated: b.seated,
          driftBefore: b.driftBefore,
          driftAfter: b.driftAfter,
        })),
        after: window.quoin.verifyGrid(grid).report,
      };
    },
    { grid: GRID }
  );

  for (const block of result.blocks) {
    console.log(
      `  ${block.lever.padEnd(8)} ${block.seated ? "seated" : "MISSED"}  ` +
        `${String(block.driftBefore).padStart(6)} -> ${String(block.driftAfter).padStart(6)}  ` +
        `${block.sample}`
    );
  }

  /* Both levers should have been needed on this page: if `padding` alone
     handled everything, the fixture has stopped reproducing the cases it
     exists for. */
  expect(result.levers.padding ?? 0, "padding moved something").toBeGreaterThan(0);
  expect(
    (result.levers.offset ?? 0) + (result.levers.none ?? 0),
    "at least one block defeated padding"
  ).toBeGreaterThan(0);

  /* Every block reported as seated really is. */
  for (const block of result.blocks) {
    if (block.seated) {
      expect(
        Math.abs(block.driftAfter),
        `"${block.sample}" claims to be seated at drift ${block.driftAfter}`
      ).toBeLessThanOrEqual(GRID.tolerance);
    }
  }
});

test("ignored selectors are left completely alone", async ({ page }) => {
  /* A grid you cannot opt out of gets switched off entirely, and then you have
     no grid at all. Display type is a shape rather than a line of reading. */
  await load(page, "prose.html");

  const untouched = await page.evaluate(
    ({ grid, ignore }) => {
      const display = document.querySelector(".display") as HTMLElement;
      const before = {
        style: display.getAttribute("style") ?? "",
        top: display.getBoundingClientRect().top,
      };
      window.quoin.seatPage({ ...grid, ignore });
      return {
        styleUnchanged: (display.getAttribute("style") ?? "") === before.style,
        stamped: display.hasAttribute("data-quoin-seat"),
      };
    },
    { grid: GRID, ignore: IGNORE }
  );

  expect(untouched.styleUnchanged, "the ignored element was not restyled").toBe(true);
  expect(untouched.stamped, "the ignored element was not even stamped").toBe(false);
});

test("first-line mode leaves the leading alone", async ({ page }) => {
  await load(page, "prose.html");

  const result = await page.evaluate(
    ({ grid, ignore }) => {
      const seated = window.quoin.seatPage({ ...grid, ignore, mode: "first-line" });
      const changed = seated.blocks.filter((b) => b.leadingTo !== b.leadingFrom);
      return { changed: changed.length, total: seated.blocks.length };
    },
    { grid: GRID, ignore: IGNORE }
  );

  expect(result.total, "it still walked the page").toBeGreaterThan(3);
  expect(result.changed, "no line-height was touched").toBe(0);
});

test("a bad pitch is refused rather than silently reporting perfection", async ({ page }) => {
  await load(page, "seated.html");

  const errors = await page.evaluate(() => {
    const caught: string[] = [];
    for (const bad of [{ pitch: 0 }, { pitch: -8 }, { pitch: 8, tolerance: 4 }]) {
      try {
        window.quoin.verifyGrid(bad);
        caught.push("NO THROW");
      } catch (error) {
        caught.push(error instanceof RangeError ? "RangeError" : String(error));
      }
    }
    return caught;
  });

  expect(errors).toEqual(["RangeError", "RangeError", "RangeError"]);
});
