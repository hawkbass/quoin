/* Solving for the grid origin.

   An origin of zero asks whether baselines sit on multiples of the pitch from
   the top of the document, and almost no real page answers yes: a header with a
   border, a body padding of 20, anything at all above the first paragraph moves
   every baseline by the same amount. That page is on a grid. Measuring it
   against zero reports nothing on the grid at all, which is not a stricter
   reading, it is a wrong one.

   The risk in fixing that is the opposite error, a solver that finds an origin
   flattering enough to hide real drift. Both directions are tested here. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bestOrigin, checkBaseline, DEFAULT_GRID } from "../../src/grid.ts";

const GRID = { pitch: 8, tolerance: 0.5, origin: 0 };

/** What `verifyGrid` would count, given an origin. The solver's claim has to
    agree with the thing that does the actual counting, or one of them is
    lying. */
const countAt = (baselines: number[], origin: number) =>
  baselines.filter((b) => checkBaseline(b, { ...GRID, origin }).onGrid).length;

/* ------------------------------------------------------------------ *
   The case it exists for
 * ------------------------------------------------------------------ */

test("a page shifted off zero by a constant is found, not condemned", () => {
  /* Every baseline three pixels down from a row: one header border, and the
     whole page follows it. Against zero this reads as nothing on the grid. */
  const baselines = [3, 11, 19, 27, 35, 43];

  assert.equal(countAt(baselines, 0), 0);

  const solved = bestOrigin(baselines, GRID);
  assert.equal(solved.origin, 3);
  assert.equal(solved.onGrid, 6);
  assert.equal(countAt(baselines, solved.origin), 6);
});

test("a page already on zero is left on zero", () => {
  const baselines = [0, 8, 16, 24, 32];
  const solved = bestOrigin(baselines, GRID);
  assert.equal(countAt(baselines, solved.origin), 5);
  assert.equal(solved.origin, 0);
});

test("the origin wraps, so a residue just under the pitch is not two clusters", () => {
  /* 7.9 and 0.1 are 0.2px apart across the wrap point, not 7.8px apart. A
     solver that sorted residues without closing the circle would split them. */
  const baselines = [7.9, 15.9, 24.1, 32.1, 39.9, 48.1];
  const solved = bestOrigin(baselines, GRID);

  assert.equal(solved.onGrid, 6);
  assert.equal(countAt(baselines, solved.origin), 6);
});

/* ------------------------------------------------------------------ *
   What it must refuse to do
 * ------------------------------------------------------------------ */

test("two phases cannot both be served, and it does not pretend otherwise", () => {
  /*
     The whole argument of the tool: a page with two type sizes has two
     ascents, so two phases, and no single origin seats both. Four baselines at
     phase 2 and three at phase 5, on an 8px grid with half a pixel of
     tolerance. The best any origin can do is four.
  */
  const baselines = [2, 10, 18, 26, 5, 13, 21];

  const solved = bestOrigin(baselines, GRID);
  assert.equal(solved.onGrid, 4);
  assert.equal(solved.origin, 2);

  /* And no origin anywhere does better. Swept by hand at a fine step, because
     a solver checked only against itself proves nothing. */
  let best = 0;
  for (let origin = 0; origin < 8; origin += 0.05) {
    best = Math.max(best, countAt(baselines, origin));
  }
  assert.equal(best, 4);
});

test("scattered drift stays scattered", () => {
  /* Seven baselines at seven different phases. The best origin seats one, and
     an honest answer is one. */
  const baselines = [0, 1.1, 2.3, 3.4, 4.6, 5.7, 6.9];
  const solved = bestOrigin(baselines, GRID);

  assert.equal(solved.onGrid, 1);
  assert.equal(countAt(baselines, solved.origin), 1);
});

test("it maximises the count rather than settling for the first cluster", () => {
  /* Two clusters, the larger one second. A solver that stopped at the first
     window it liked would return three. */
  const baselines = [1, 9, 17, 6, 14, 22, 30, 38, 46];
  const solved = bestOrigin(baselines, GRID);

  assert.equal(solved.onGrid, 6);
  assert.equal(solved.origin, 6);
});

/* ------------------------------------------------------------------ *
   Agreement with the counter, at the edges
 * ------------------------------------------------------------------ */

test("the solver's count is exactly what checkBaseline then counts", () => {
  /*
     These are two separate pieces of arithmetic and they have to agree. If the
     window is centred wrongly by half a tolerance, the solver reports a number
     the report cannot reproduce, and the tool disagrees with itself.
  */
  const cases: number[][] = [
    [3, 11, 19],
    [0.5, 8.5, 16.4, 24.6],
    [7.75, 15.75, 0.25, 8.25],
    [2, 2, 2, 2, 5],
    [1.9, 2.4, 2.9],
    [100.125, 108.125, 116.125],
  ];

  for (const baselines of cases) {
    const solved = bestOrigin(baselines, GRID);
    assert.equal(
      countAt(baselines, solved.origin),
      solved.onGrid,
      `disagreed on ${JSON.stringify(baselines)} at origin ${solved.origin}`
    );
  }
});

test("a span exactly two tolerances wide is seated, and a hair wider is not", () => {
  /* The boundary the window is defined by. Tolerance is 0.5, so 1.0px of
     spread fits and 1.02 does not. */
  assert.equal(bestOrigin([2, 3], GRID).onGrid, 2);
  assert.equal(bestOrigin([2, 3.02], GRID).onGrid, 1);
});

/* ------------------------------------------------------------------ *
   Degenerate input
 * ------------------------------------------------------------------ */

test("no baselines returns the origin it was given rather than inventing one", () => {
  const solved = bestOrigin([], { ...GRID, origin: 5 });
  assert.equal(solved.origin, 5);
  assert.equal(solved.onGrid, 0);
});

test("one baseline is always seatable, and the origin is its own phase", () => {
  const solved = bestOrigin([13], GRID);
  assert.equal(solved.onGrid, 1);
  assert.equal(checkBaseline(13, { ...GRID, origin: solved.origin }).onGrid, true);
});

test("negative baselines, from content scrolled above the origin", () => {
  const baselines = [-13, -5, 3, 11];
  const solved = bestOrigin(baselines, GRID);
  assert.equal(solved.onGrid, 4);
  assert.equal(countAt(baselines, solved.origin), 4);
});

test("it honours a pitch and tolerance that are not the defaults", () => {
  const grid = { pitch: 4, tolerance: 0.25, origin: 0 };
  const baselines = [1, 5, 9, 13];
  const solved = bestOrigin(baselines, grid);

  assert.equal(solved.onGrid, 4);
  assert.equal(solved.origin, 1);
  assert.equal(
    baselines.filter((b) => checkBaseline(b, { ...grid, origin: solved.origin }).onGrid)
      .length,
    4
  );
});

test("the default grid is accepted without a config", () => {
  const solved = bestOrigin([DEFAULT_GRID.pitch * 3 + 2]);
  assert.equal(solved.onGrid, 1);
});

/* ------------------------------------------------------------------ *
   Scale
 * ------------------------------------------------------------------ */

test("a thousand baselines are solved, and solved correctly", () => {
  /* Real pages have thousands of blocks, and the two-pointer exists so this
     does not become quadratic. Correctness first: 900 on one phase, 100 on
     another, and the answer is 900. */
  const baselines: number[] = [];
  for (let i = 0; i < 900; i++) baselines.push(i * 8 + 4.25);
  for (let i = 0; i < 100; i++) baselines.push(i * 8 + 1);

  const solved = bestOrigin(baselines, GRID);
  assert.equal(solved.onGrid, 900);
  assert.equal(countAt(baselines, solved.origin), 900);
});
