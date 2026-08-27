/* The committed baseline, and the comparison that gates a pull request.

   This is the part of the tool that says "you broke it", so the thing worth
   testing is not that it can spot a large drop. It is the boundaries: what it
   calls unchanged, what it refuses to call an improvement, and what it does
   when the page itself changed shape underneath the reading. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeBaseline,
  compareToBaseline,
  comparisonToMarkdown,
  type BaselineEntry,
} from "../../src/baseline.ts";

const entry = (over: Partial<BaselineEntry> = {}): BaselineEntry => ({
  url: "/index.html",
  width: 1280,
  pitch: 8,
  onGrid: 100,
  total: 120,
  distinctDrifts: 4,
  ...over,
});

const baselineOf = (...entries: BaselineEntry[]) =>
  makeBaseline(entries, "1.3.0", "2026-08-27");

/* ------------------------------------------------------------------ *
   The file itself
 * ------------------------------------------------------------------ */

test("entries are sorted, so the committed file has a stable diff", () => {
  const baseline = makeBaseline(
    [
      entry({ url: "/pricing", width: 900 }),
      entry({ url: "/about", width: 1280 }),
      entry({ url: "/about", width: 375 }),
    ],
    "1.3.0",
    "2026-08-27"
  );

  assert.deepEqual(
    baseline.entries.map((e) => e.url + "@" + e.width),
    ["/about@1280", "/about@375", "/pricing@900"]
  );
});

test("measuring the same pages in a different order is not a change", () => {
  const a = baselineOf(entry({ url: "/a" }), entry({ url: "/b" }));
  const b = baselineOf(entry({ url: "/b" }), entry({ url: "/a" }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("the file records which quoin took the reading", () => {
  /* A number taken by a different version is a different number, and a file
     that does not say which version wrote it cannot be re-read later. */
  const baseline = baselineOf(entry());
  assert.equal(baseline.quoin, "1.3.0");
  assert.equal(baseline.version, 1);
});

/* ------------------------------------------------------------------ *
   Tolerance, at the boundary
 * ------------------------------------------------------------------ */

test("a drop inside the tolerance is unchanged, not a regression", () => {
  /* Sub-pixel layout moves a single block on and off the grid between runs for
     reasons unrelated to the change under review. A gate that fires on that is
     a gate people switch off within a week. */
  const result = compareToBaseline(baselineOf(entry({ onGrid: 100 })), [
    entry({ onGrid: 99 }),
  ]);
  assert.equal(result.comparisons[0]!.verdict, "unchanged");
  assert.equal(result.clean, true);
});

test("one block past the tolerance is a regression", () => {
  const result = compareToBaseline(baselineOf(entry({ onGrid: 100 })), [
    entry({ onGrid: 98 }),
  ]);
  assert.equal(result.comparisons[0]!.verdict, "regressed");
  assert.equal(result.comparisons[0]!.delta, -2);
  assert.equal(result.clean, false);
  assert.equal(result.regressed.length, 1);
});

test("the tolerance is honoured when it is not the default", () => {
  const fresh = [entry({ onGrid: 95 })];
  const baseline = baselineOf(entry({ onGrid: 100 }));

  assert.equal(compareToBaseline(baseline, fresh, 5).comparisons[0]!.verdict, "unchanged");
  assert.equal(compareToBaseline(baseline, fresh, 4).comparisons[0]!.verdict, "regressed");
});

test("a gain inside the tolerance is not announced as an improvement", () => {
  const result = compareToBaseline(baselineOf(entry({ onGrid: 100 })), [
    entry({ onGrid: 101 }),
  ]);
  assert.equal(result.comparisons[0]!.verdict, "unchanged");
  assert.equal(result.improved.length, 0);
});

test("an improvement never fails the gate", () => {
  const result = compareToBaseline(baselineOf(entry({ onGrid: 40 })), [
    entry({ onGrid: 118 }),
  ]);
  assert.equal(result.comparisons[0]!.verdict, "improved");
  assert.equal(result.clean, true);
});

/* ------------------------------------------------------------------ *
   The page changing shape underneath the reading
 * ------------------------------------------------------------------ */

test("a page that gained blocks reports the denominator rather than hiding it", () => {
  /*
     The trap this exists to avoid: 100/120 becomes 100/150 because somebody
     added copy. Nothing about the grid changed, the percentage fell from 83 to
     67, and a tool that gated on percentage would block the pull request.
  */
  const result = compareToBaseline(baselineOf(entry({ onGrid: 100, total: 120 })), [
    entry({ onGrid: 100, total: 150 }),
  ]);

  const only = result.comparisons[0]!;
  assert.equal(only.verdict, "unchanged");
  assert.equal(only.delta, 0);
  assert.match(only.summary, /\+30 blocks on the page/);
});

test("blocks lost to deleted copy are not counted as blocks fixed", () => {
  /* Deleting a section that was off the grid raises the percentage and is not
     an improvement. The count says so, and the summary shows the shrink. */
  const result = compareToBaseline(baselineOf(entry({ onGrid: 100, total: 200 })), [
    entry({ onGrid: 100, total: 110 }),
  ]);
  assert.equal(result.comparisons[0]!.verdict, "unchanged");
  assert.match(result.comparisons[0]!.summary, /-90 blocks on the page/);
});

/* ------------------------------------------------------------------ *
   Entries appearing and disappearing
 * ------------------------------------------------------------------ */

test("a page with no baseline is recorded, not judged", () => {
  const result = compareToBaseline(baselineOf(entry({ url: "/old" })), [
    entry({ url: "/brand-new", onGrid: 3, total: 300 }),
  ]);

  const fresh = result.comparisons.find((c) => c.url === "/brand-new")!;
  assert.equal(fresh.verdict, "new");
  assert.equal(fresh.before, null);
  /* 3/300 is dreadful and it still must not fail the build: there is nothing
     to compare it against, and a new page failing on arrival means nobody adds
     the tool to a repository that already has pages. */
  assert.equal(result.regressed.length, 0);
});

test("a page that stopped being measured is reported, not silently dropped", () => {
  /* A URL quietly falling out of the run looks exactly like a page that
     stopped failing, which is the one way this tool could lie. */
  const result = compareToBaseline(
    baselineOf(entry({ url: "/kept" }), entry({ url: "/gone" })),
    [entry({ url: "/kept" })]
  );

  const gone = result.comparisons.find((c) => c.url === "/gone")!;
  assert.equal(gone.verdict, "removed");
  assert.equal(gone.after, null);
  assert.match(gone.summary, /Not measured this run/);
});

test("the same url at two widths is two readings", () => {
  /* Corrections are absolute pixel values for one layout, so a page can be on
     the grid at one width and off it at another. Keying on url alone would
     collapse them and report only whichever came last. */
  const result = compareToBaseline(
    baselineOf(entry({ width: 1280, onGrid: 100 }), entry({ width: 375, onGrid: 100 })),
    [entry({ width: 1280, onGrid: 100 }), entry({ width: 375, onGrid: 20 })]
  );

  assert.equal(result.comparisons.length, 2);
  assert.equal(result.regressed.length, 1);
  assert.equal(result.regressed[0]!.width, 375);
});

/* ------------------------------------------------------------------ *
   Rhythm
 * ------------------------------------------------------------------ */

test("rhythm is compared when both readings have it", () => {
  const result = compareToBaseline(
    baselineOf(entry({ onRhythm: 80, rhythmTotal: 120 })),
    [entry({ onRhythm: 60, rhythmTotal: 120 })]
  );
  assert.equal(result.comparisons[0]!.rhythmDelta, -20);
  assert.match(result.comparisons[0]!.summary, /rhythm -20/);
});

test("rhythm going backwards is a regression on its own", () => {
  /*
     The case that makes rhythm a gate rather than a note.

     A hairline border moves every block below it by one pixel, so the page
     splits into two phases a pixel apart. On an 8px grid with half a pixel of
     tolerance, an origin sitting between those two halves is within tolerance
     of both, and the phase count does not move at all. Gating on phase alone
     waves through the commonest defect there is.
  */
  const result = compareToBaseline(
    baselineOf(entry({ onGrid: 100, onRhythm: 100, rhythmTotal: 120 })),
    [entry({ onGrid: 100, onRhythm: 60, rhythmTotal: 120 })]
  );

  assert.equal(result.comparisons[0]!.verdict, "regressed");
  assert.equal(result.clean, false);
  assert.equal(result.comparisons[0]!.rhythmOnly, true, "and it says which one moved");
});

test("a rhythm wobble inside the tolerance is still not a regression", () => {
  const result = compareToBaseline(
    baselineOf(entry({ onRhythm: 100, rhythmTotal: 120 })),
    [entry({ onRhythm: 99, rhythmTotal: 120 })]
  );
  assert.equal(result.comparisons[0]!.verdict, "unchanged");
  assert.equal(result.clean, true);
});

test("phase falling is not labelled rhythm-only", () => {
  /* Both moved, so the flag that exists to explain a puzzling comment must not
     fire: there is nothing puzzling about it. */
  const result = compareToBaseline(
    baselineOf(entry({ onGrid: 100, onRhythm: 100, rhythmTotal: 120 })),
    [entry({ onGrid: 40, onRhythm: 60, rhythmTotal: 120 })]
  );
  assert.equal(result.comparisons[0]!.verdict, "regressed");
  assert.equal(result.comparisons[0]!.rhythmOnly, false);
});

test("rhythm improving on its own is an improvement", () => {
  const result = compareToBaseline(
    baselineOf(entry({ onRhythm: 40, rhythmTotal: 120 })),
    [entry({ onRhythm: 118, rhythmTotal: 120 })]
  );
  assert.equal(result.comparisons[0]!.verdict, "improved");
  assert.equal(result.clean, true);
});

test("rhythm falling outweighs phase rising, because a reflow undoes the phase", () => {
  /*
     Phase up sixty, rhythm down forty. This is not a net win: the phase gain
     came from corrections sitting above a box that is not a whole number of
     rows, and the next reflow moves that box and takes the corrections with it.
  */
  const result = compareToBaseline(
    baselineOf(entry({ onGrid: 40, onRhythm: 100, rhythmTotal: 120 })),
    [entry({ onGrid: 100, onRhythm: 60, rhythmTotal: 120 })]
  );
  assert.equal(result.comparisons[0]!.verdict, "regressed");
});

test("worst first counts whichever of the two fell further", () => {
  const baseline = baselineOf(
    entry({ url: "/phase", onGrid: 100, onRhythm: 100, rhythmTotal: 120 }),
    entry({ url: "/rhythm", onGrid: 100, onRhythm: 100, rhythmTotal: 120 })
  );
  const result = compareToBaseline(baseline, [
    entry({ url: "/phase", onGrid: 90, onRhythm: 100, rhythmTotal: 120 }),
    entry({ url: "/rhythm", onGrid: 100, onRhythm: 20, rhythmTotal: 120 }),
  ]);

  assert.deepEqual(
    result.comparisons.map((c) => c.url),
    ["/rhythm", "/phase"]
  );
});

test("rhythm is not invented when the baseline predates it", () => {
  /* An older baseline has no rhythm figures. Treating a missing number as zero
     would report the whole page as newly on rhythm. */
  const result = compareToBaseline(baselineOf(entry()), [
    entry({ onRhythm: 60, rhythmTotal: 120 }),
  ]);
  assert.equal(result.comparisons[0]!.rhythmDelta, null);
  assert.doesNotMatch(result.comparisons[0]!.summary, /rhythm/);
});

/* ------------------------------------------------------------------ *
   The comment
 * ------------------------------------------------------------------ */

test("the comment leads with the regression when there is one", () => {
  const baseline = baselineOf(entry({ onGrid: 100 }));
  const markdown = comparisonToMarkdown(
    compareToBaseline(baseline, [entry({ onGrid: 20 })]),
    baseline
  );

  assert.match(markdown, /1 page came off the baseline grid/);
  assert.match(markdown, /-80/);
  assert.match(markdown, /quoin 1\.3\.0/);
});

test("the comment says so plainly when nothing moved", () => {
  const baseline = baselineOf(entry());
  const markdown = comparisonToMarkdown(compareToBaseline(baseline, [entry()]), baseline);
  assert.match(markdown, /No change against the baseline/);
  assert.doesNotMatch(markdown, /came off/);
});

test("the comment counts pages, and agrees with itself about the plural", () => {
  const baseline = baselineOf(entry({ url: "/a" }), entry({ url: "/b" }));
  const markdown = comparisonToMarkdown(
    compareToBaseline(baseline, [
      entry({ url: "/a", onGrid: 10 }),
      entry({ url: "/b", onGrid: 10 }),
    ]),
    baseline
  );
  assert.match(markdown, /2 pages came off/);
});

test("every reading gets a row, whatever its verdict", () => {
  const baseline = baselineOf(entry({ url: "/a" }), entry({ url: "/gone" }));
  const result = compareToBaseline(baseline, [
    entry({ url: "/a", onGrid: 10 }),
    entry({ url: "/new" }),
  ]);
  const markdown = comparisonToMarkdown(result, baseline);

  for (const url of ["/a", "/gone", "/new"]) {
    assert.ok(markdown.includes("`" + url + "`"), url + " has a row");
  }
});

test("worst first, so the row that matters is the one you read", () => {
  const baseline = baselineOf(
    entry({ url: "/small" }),
    entry({ url: "/big" }),
    entry({ url: "/fine" })
  );
  const result = compareToBaseline(baseline, [
    entry({ url: "/small", onGrid: 90 }),
    entry({ url: "/big", onGrid: 5 }),
    entry({ url: "/fine" }),
  ]);

  assert.deepEqual(
    result.comparisons.map((c) => c.url),
    ["/big", "/small", "/fine"]
  );
});
