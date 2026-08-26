/* The arithmetic, against hand-computed cases.

   The README used to say "the maths is verified against hand-computed cases",
   and there was no test file in the repository. This is that file, written
   afterwards, which is the wrong order and worth saying out loud. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GRID,
  checkBaseline,
  gridConfig,
  seatingPadding,
  seatingShift,
  snapLineHeight,
  summarise,
  type GridResult,
} from "../../src/grid.ts";

const GRID = { pitch: 8, tolerance: 0.5, origin: 0 };

/* ------------------------------------------------------------------ *
   checkBaseline
 * ------------------------------------------------------------------ */

test("a baseline exactly on a grid line has no drift", () => {
  const result = checkBaseline(24, GRID);
  assert.equal(result.nearest, 24);
  assert.equal(result.drift, 0);
  assert.equal(result.onGrid, true);
});

test("drift is signed: below the line is positive, above is negative", () => {
  /* Signed on purpose. A page where everything is 3px low has one systematic
     error and one fix. A page where drift alternates has a different problem,
     and collapsing the sign hides which one you have. */
  assert.equal(checkBaseline(27, GRID).drift, 3);
  assert.equal(checkBaseline(21, GRID).drift, -3);
});

test("it snaps to the NEAREST line, not the one below", () => {
  assert.equal(checkBaseline(31, GRID).nearest, 32);
  assert.equal(checkBaseline(33, GRID).nearest, 32);
  /* Exactly halfway rounds up, because Math.round does. */
  assert.equal(checkBaseline(28, GRID).nearest, 32);
});

test("tolerance is inclusive at its own boundary", () => {
  assert.equal(checkBaseline(24.5, GRID).onGrid, true);
  assert.equal(checkBaseline(23.5, GRID).onGrid, true);
  assert.equal(checkBaseline(24.51, GRID).onGrid, false);
});

test("origin shifts the whole grid", () => {
  const offset = { ...GRID, origin: 3 };
  assert.equal(checkBaseline(27, offset).drift, 0);
  assert.equal(checkBaseline(24, offset).drift, -3);
});

test("a negative baseline still lands on the grid", () => {
  /* An element scrolled above the document origin is unusual but not
     impossible, and the modulo has to keep working when it happens. */
  assert.equal(checkBaseline(-16, GRID).nearest, -16);
  assert.equal(checkBaseline(-17, GRID).drift, -1);
});

/* ------------------------------------------------------------------ *
   gridConfig
 * ------------------------------------------------------------------ */

test("a pitch of zero is refused rather than dividing by it", () => {
  /* Dividing by zero reports every baseline as perfect, which is the worst
     possible failure for a measuring tool: silent and flattering. */
  assert.throws(() => gridConfig({ pitch: 0 }), RangeError);
  assert.throws(() => gridConfig({ pitch: -8 }), RangeError);
  assert.throws(() => gridConfig({ pitch: Number.NaN }), RangeError);
  assert.throws(() => gridConfig({ pitch: Number.POSITIVE_INFINITY }), RangeError);
});

test("a tolerance of half the pitch or more is refused", () => {
  /* At half the pitch every possible baseline is within tolerance of some grid
     line, so the report reads 100% and means nothing. */
  assert.throws(() => gridConfig({ pitch: 8, tolerance: 4 }), RangeError);
  assert.throws(() => gridConfig({ pitch: 8, tolerance: 5 }), RangeError);
  assert.doesNotThrow(() => gridConfig({ pitch: 8, tolerance: 3.99 }));
});

test("a negative tolerance and a non-finite origin are refused", () => {
  assert.throws(() => gridConfig({ tolerance: -1 }), RangeError);
  assert.throws(() => gridConfig({ origin: Number.NaN }), RangeError);
});

test("an empty config is the default grid", () => {
  assert.deepEqual(gridConfig(), DEFAULT_GRID);
});

test("a zero tolerance is allowed: it means exact", () => {
  const strict = gridConfig({ tolerance: 0 });
  assert.equal(checkBaseline(24, strict).onGrid, true);
  assert.equal(checkBaseline(24.01, strict).onGrid, false);
});

/* ------------------------------------------------------------------ *
   snapLineHeight
 * ------------------------------------------------------------------ */

test("leading snaps UP to the next whole row, never down", () => {
  /* Shrinking leading to reach the grid tightens the setting, which is a
     typographic decision the caller did not ask for. */
  assert.equal(snapLineHeight(25, GRID), 32);
  assert.equal(snapLineHeight(31.9, GRID), 32);
  assert.equal(snapLineHeight(17, GRID), 24);
});

test("leading already on the grid is left exactly alone", () => {
  assert.equal(snapLineHeight(24, GRID), 24);
  assert.equal(snapLineHeight(8, GRID), 8);
});

test("leading smaller than one row becomes one row", () => {
  assert.equal(snapLineHeight(3, GRID), 8);
  assert.equal(snapLineHeight(0.1, GRID), 8);
});

test("nonsense leading falls back to one row rather than NaN", () => {
  /* A font that has not loaded can report something unusable, and a NaN
     line-height written into a style attribute is invisible until the page
     collapses. */
  assert.equal(snapLineHeight(Number.NaN, GRID), 8);
  assert.equal(snapLineHeight(0, GRID), 8);
  assert.equal(snapLineHeight(-12, GRID), 8);
});

/* ------------------------------------------------------------------ *
   seatingShift
 * ------------------------------------------------------------------ */

test("seating always moves text DOWN to the next line", () => {
  /* Pulling text up to the previous grid line can collide it with whatever
     sits above, and a corrector that overlaps two paragraphs to satisfy its
     own metric has optimised for the metric. */
  assert.equal(seatingShift(-3, GRID), 3, "sitting high: push down onto the line");
  assert.equal(seatingShift(3, GRID), 5, "sitting low: push on to the NEXT line");
});

test("a shift never moves text upward", () => {
  for (let drift = -7.9; drift < 8; drift += 0.1) {
    assert.ok(
      seatingShift(drift, GRID) >= 0,
      `drift ${drift.toFixed(1)} produced an upward shift`
    );
  }
});

test("a shift never exceeds one pitch", () => {
  for (let drift = -7.9; drift < 8; drift += 0.1) {
    assert.ok(
      seatingShift(drift, GRID) <= GRID.pitch,
      `drift ${drift.toFixed(1)} produced a shift larger than the pitch`
    );
  }
});

test("text already within tolerance is not shifted at all", () => {
  assert.equal(seatingShift(0, GRID), 0);
  assert.equal(seatingShift(0.4, GRID), 0);
  assert.equal(seatingShift(-0.5, GRID), 0);
});

test("shifting by the computed amount lands the baseline on the grid", () => {
  /* The property the whole corrector rests on, checked exhaustively rather
     than at three convenient points. */
  for (let baseline = 0; baseline < 64; baseline += 0.1) {
    const { drift } = checkBaseline(baseline, GRID);
    const shifted = baseline + seatingShift(drift, GRID);
    assert.ok(
      checkBaseline(shifted, GRID).onGrid,
      `baseline ${baseline.toFixed(1)} did not seat: landed at ${shifted.toFixed(3)}`
    );
  }
});

/* ------------------------------------------------------------------ *
   seatingPadding
 * ------------------------------------------------------------------ */

test("padding top and bottom sum to exactly one pitch", () => {
  /* So the box grows by a whole number of grid rows and everything below it
     stays seated. Swept rather than spot-checked, because the first version of
     this test happened to pick a block that was already on the grid, where the
     correct answer is no padding at all, and asserted the wrong thing. */
  for (let blockTop = 0; blockTop < 16; blockTop += 0.25) {
    const { top, bottom } = seatingPadding(21.4, blockTop, GRID);
    if (top === 0 && bottom === 0) continue; // already seated
    assert.equal(
      Math.round((top + bottom) * 1e6) / 1e6,
      GRID.pitch,
      `blockTop ${blockTop} produced ${top} + ${bottom}`
    );
  }
});

test("a block already seated gets no padding at all", () => {
  /* Adding a full row of bottom padding to a correct block would move
     everything below it for no reason. */
  const { top, bottom } = seatingPadding(24, 0, GRID);
  assert.equal(top, 0);
  assert.equal(bottom, 0);
});

test("padding seats the baseline it was computed for", () => {
  for (let blockTop = 0; blockTop < 32; blockTop += 0.25) {
    const within = 21.4;
    const { top } = seatingPadding(within, blockTop, GRID);
    assert.ok(
      checkBaseline(blockTop + top + within, GRID).onGrid,
      `blockTop ${blockTop} did not seat`
    );
  }
});

/* ------------------------------------------------------------------ *
   summarise
 * ------------------------------------------------------------------ */

const result = (drift: number, onGrid = Math.abs(drift) <= 0.5): GridResult => ({
  baseline: 100 + drift,
  nearest: 100,
  drift,
  onGrid,
});

test("an empty page summarises to zero rather than NaN", () => {
  const report = summarise([]);
  assert.equal(report.total, 0);
  assert.equal(report.onGrid, 0);
  assert.equal(report.worst, 0);
  assert.equal(report.systematic, false);
  assert.equal(report.distinctDrifts, 0);
});

test("one shared offset across every off-grid node is systematic", () => {
  /* The field to read first: one shared offset is a wrong origin or a single
     un-snapped line-height, and it is a one-line fix. */
  const report = summarise([result(3), result(3), result(3), result(0)]);
  assert.equal(report.systematic, true);
  assert.equal(report.distinctDrifts, 1);
  assert.equal(report.offGrid, 3);
  assert.equal(report.onGrid, 1);
});

test("scattered drift is not systematic", () => {
  const report = summarise([result(3), result(-2), result(1.5)]);
  assert.equal(report.systematic, false);
  assert.equal(report.distinctDrifts, 3);
});

test("a single off-grid node is not called systematic", () => {
  /* One reading is not a pattern. */
  assert.equal(summarise([result(3), result(0)]).systematic, false);
});

test("floating-point noise does not invent distinct drift values", () => {
  /* 3.0000000000000004 and 3 are one problem, and a report that calls them two
     sends you looking for a second cause that is not there. */
  const report = summarise([result(0.1 + 0.2 + 2.7), result(3), result(3)]);
  assert.equal(report.distinctDrifts, 1);
  assert.equal(report.systematic, true);
});

test("worst drift is the largest ABSOLUTE drift", () => {
  const report = summarise([result(3), result(-9), result(1)]);
  assert.equal(report.worst, 9);
});

test("a page entirely on grid reports no drift values", () => {
  const report = summarise([result(0), result(0.2), result(-0.4)]);
  assert.equal(report.onGrid, 3);
  assert.equal(report.offGrid, 0);
  assert.equal(report.distinctDrifts, 0);
  assert.equal(report.systematic, false);
});
