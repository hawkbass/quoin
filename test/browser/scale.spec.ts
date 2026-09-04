/* Does a solved scale actually need no correction?

   Every other file here tests the remedial half: measure a page that is off the
   grid and push it on. This tests the constructive half, and the claim is
   stronger than anything the seater makes.

   If every size-and-leading pair on a page shares one phase modulo the pitch,
   and every vertical distance is a whole number of rows, then one grid origin
   seats the whole page and there is nothing left to correct. No script after
   paint, no exported stylesheet, no per-element rules. Just the right sizes.

   The test builds a page out of a solved scale and asks the seater how much
   work there is. The answer has to be none. */

import { test, expect } from "@playwright/test";
import { load, GRID } from "./harness.ts";

const PITCH = 8;

/*
   A generic keyword, not a named face, and that is the point of this comment.

   The first version of this file solved against Georgia and asserted "Georgia
   is installed everywhere this runs". It is not installed on the Linux CI
   runner, so six tests failed on an assumption about one laptop, in the file
   whose whole subject is that a font you asked for is not a font you got.

   `serif` always resolves. What it resolves to varies by platform, which does
   not matter here: every assertion is about the relationship between the sizes
   the solver returns, not about any particular typeface's metrics.
*/
const FAMILY = "serif";

test("a solved scale puts every size on the same phase", async ({ page }) => {
  await load(page, "prose.html");

  const scale = await page.evaluate(({ pitch, family }) => {
    const solved = window.quoinFit.gridNativeScale(family, {
      pitch,
      targets: [16, 28, 40],
      near: 3,
    });

    /* Recompute each step's phase independently of the solver, so this checks
       the arithmetic rather than agreeing with it. */
    const ctx = document.createElement("canvas").getContext("2d")!;
    const phases = solved.steps.map((step) => {
      ctx.font = `400 ${step.size}px ${family}`;
      const box = ctx.measureText("Hxp");
      const phase =
        (step.leading - (box.fontBoundingBoxAscent + box.fontBoundingBoxDescent)) / 2 +
        box.fontBoundingBoxAscent;
      return Math.round((((phase % pitch) + pitch) % pitch) * 100) / 100;
    });

    return { solved, phases };
  }, { pitch: PITCH, family: FAMILY });

  expect(scale.solved.steps.length, "it found a scale").toBeGreaterThanOrEqual(3);

  /* Every leading is a whole number of rows, or the second line of a block
     lands somewhere the first one did not. */
  for (const step of scale.solved.steps) {
    expect(step.leading % PITCH, `${step.size}px leading is not a whole number of rows`).toBe(0);
  }

  /* And every step shares one phase, which is the whole point. */
  const distinct = [...new Set(scale.phases)];
  expect(
    distinct.length,
    `the steps should share one phase, got ${JSON.stringify(scale.phases)}`
  ).toBe(1);
  expect(distinct[0]).toBeCloseTo(scale.solved.phase, 1);
});

test("steps are distinct and ascending, and a target it cannot meet is reported", async ({
  page,
}) => {
  /*
     Solved sizes sit about eleven pixels apart for a text face on an 8px grid,
     so two targets four pixels apart cannot both be met. The first version of
     the solver met them anyway, with 17px and 17.5px, which satisfies the
     tolerance and is one step and a rounding error.
  */
  await load(page, "prose.html");

  const solved = await page.evaluate(({ pitch, family }) =>
    window.quoinFit.gridNativeScale(family, {
      pitch,
      targets: [16, 20, 28, 40],
      near: 3,
    }),
  { pitch: PITCH, family: FAMILY });

  const sizes = solved.steps.map((s) => s.size);
  for (let i = 1; i < sizes.length; i++) {
    expect(
      sizes[i]! - sizes[i - 1]!,
      `steps ${sizes[i - 1]} and ${sizes[i]} are not far enough apart to be two steps`
    ).toBeGreaterThanOrEqual(2);
  }

  expect(
    solved.missed.length,
    "targets closer together than the spacing cannot all be met, and it should say so"
  ).toBeGreaterThan(0);
  expect(solved.spacing, "and it reports how far apart solved sizes are").toBeGreaterThan(5);
});

test("a page built from a solved scale needs no corrections at all", async ({ page }) => {
  /* The claim, end to end. */
  await load(page, "prose.html");

  const result = await page.evaluate(({ pitch, family }) => {
    const solved = window.quoinFit.gridNativeScale(family, {
      pitch,
      targets: [16, 28, 40],
      near: 3,
    });
    const [body, heading, display] = solved.steps;
    if (!body || !heading || !display) return null;

    /* A page set entirely in that scale, with every vertical distance a whole
       number of rows. Built in a detached root so the host page's own type
       cannot contribute to the measurement. */
    const host = document.createElement("div");
    host.id = "solved";
    host.style.cssText = `padding:${pitch * 4}px 0;font-family:${family},serif;` +
      `font-size:${body.size}px;line-height:${body.leading}px`;
    host.innerHTML = `
      <h2 style="font-size:${display.size}px;line-height:${display.leading}px;margin:0 0 ${pitch * 3}px;font-weight:400">A scale that lands on the line</h2>
      <p style="margin:0 0 ${pitch * 3}px">Every size and leading here shares one phase, so the first baseline of every block sits the same distance inside its own line box.</p>
      <h3 style="font-size:${heading.size}px;line-height:${heading.leading}px;margin:0 0 ${pitch * 2}px;font-weight:400">Nothing has been corrected</h3>
      <p style="margin:0 0 ${pitch * 3}px">There is no seating pass, no exported stylesheet and no script running after paint. The sizes were solved for.</p>
      <p style="margin:0">A grid needs rhythm and phase. Rhythm is arithmetic and CSS can do it. Phase belongs to the typeface, and it is a function of size and leading, both of which are yours to choose.</p>`;
    document.body.replaceChildren(host);

    /* Sweep the origin: on the grid means every baseline shares one offset,
       not that the offset happens to be zero. */
    let best = { origin: 0, onGrid: -1, total: 0, distinct: 0 };
    for (let origin = 0; origin < pitch; origin += 0.25) {
      const report = window.quoin.verifyGrid({ pitch, origin, root: host }).report;
      if (report.onGrid > best.onGrid) {
        best = {
          origin,
          onGrid: report.onGrid,
          total: report.total,
          distinct: report.distinctDrifts,
        };
      }
    }

    /* And how much work the seater finds, which should be none. */
    const seated = window.quoin.seatPage({ pitch, origin: best.origin, root: host });
    const corrections = seated.blocks.filter(
      (b) => b.leadingTo !== b.leadingFrom || b.paddingAdded > 0.01 || b.offset !== 0
    ).length;
    seated.undo();

    return { best, corrections, phase: solved.phase, steps: solved.steps.length };
  }, { pitch: PITCH, family: FAMILY });

  expect(result, "the solver produced a usable scale").not.toBeNull();
  expect(result!.best.total, "the page has blocks to measure").toBeGreaterThan(3);
  expect(
    result!.best.onGrid,
    `every block should seat at one origin: ${result!.best.onGrid}/${result!.best.total} ` +
      `at ${result!.best.origin}px, ${result!.best.distinct} distinct drifts`
  ).toBe(result!.best.total);
  expect(
    result!.corrections,
    "and the seater should find nothing to do"
  ).toBe(0);
});

test("the CSS it emits carries the origin the scale needs", async ({ page }) => {
  await load(page, "prose.html");

  const css = await page.evaluate(({ pitch, family }) => {
    const solved = window.quoinFit.gridNativeScale(family, { pitch, targets: [16, 28, 40] });
    return window.quoinFit.scaleToCss(solved);
  }, { pitch: PITCH, family: FAMILY });

  expect(css).toContain("--grid-origin");
  expect(css).toContain("--pitch: 8px");
  expect(css, "it names the font it was solved against").toContain(FAMILY);
  expect(css, "and why the numbers are not round").toContain("apart");
  expect(css).not.toContain("NaN");
  expect(css).not.toContain("undefined");
});

test("an unavailable font is solved against the fallback, and says so", async ({
  page,
}) => {
  /*
     A scale solved against a font that did not load describes a typeface nobody
     is going to set in, and the obvious way to check does not work: `ctx.font`
     reads back the family you asked for, so a font nobody has installed hands
     its own name straight back while the measurement comes off the fallback.

     That is not hypothetical. Solving for Inter on a page that never loaded it
     produced numbers identical to Times New Roman, down to the last step, and
     the returned shorthand said "Inter" throughout.

     Old comment follows, for the case it described: solving against a font that
     did not load produces a scale for a typeface
     nobody is going to set. The returned family is what the browser resolved,
     so the caller can tell. */
  await load(page, "prose.html");

  const solved = await page.evaluate(({ pitch }) =>
    window.quoinFit.gridNativeScale('"Definitely Not Installed 12345"', {
      pitch,
      targets: [16, 28],
    }),
  { pitch: PITCH });

  expect(solved.resolved, "a font nobody has installed is reported unresolved").toBe(false);
  expect(solved.steps.length, "and it still solves against whatever rendered").toBeGreaterThan(0);

  const css = await page.evaluate((s) => window.quoinFit.scaleToCss(s), solved as never);
  expect(css, "and the stylesheet warns rather than quietly lying").toContain("did not render");
});

test("a generic keyword always resolves, and a name nobody has does not", async ({
  page,
}) => {
  await load(page, "prose.html");

  const result = await page.evaluate(({ pitch }) => ({
    serif: window.quoinFit.gridNativeScale("serif", { pitch, targets: [16, 28] }).resolved,
    mono: window.quoinFit.gridNativeScale("monospace", { pitch, targets: [16, 28] }).resolved,
    quoted: window.quoinFit.gridNativeScale('"sans-serif"', { pitch, targets: [16, 28] }).resolved,
    absent: window.quoinFit.gridNativeScale("Definitely Not Installed 98765", {
      pitch, targets: [16, 28],
    }).resolved,
  }), { pitch: PITCH });

  /* A generic keyword is a promise that something will be found rather than a
     statement about what, so it is never unresolved on any platform. */
  expect(result.serif).toBe(true);
  expect(result.mono).toBe(true);
  expect(result.quoted, "quotes around the family are stripped before probing").toBe(true);
  expect(result.absent, "and a name nobody has is still reported as missing").toBe(false);
});
