/* The fitting arithmetic, against hand-computed cases.

   This is a modular equation and it deserves to be checked as one. Until the
   solve was split out of the browser it could only be exercised through nine
   viewport widths in a real engine, which proves it works and does not say why,
   and would not have caught an off-by-one in the rounding that happened to
   cancel.

   The claim under test:

       space + cap = 0   (mod pitch)

   and that nothing else in a design has to move to satisfy it. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  spaceFor,
  leadingFor,
  fitWith,
  fittedScaleToCss,
  type CapSource,
  type FamilyRequest,
} from "../../src/fit-core.ts";

/** A cap source with figures chosen by hand, so the arithmetic is the variable. */
function capsOf(table: Record<number, number>): CapSource {
  return {
    capHeight: (_font, size) => table[size] ?? null,
    resolved: () => true,
  };
}

/* ------------------------------------------------------------------ *
   The space, which is the whole method
 * ------------------------------------------------------------------ */

test("the space closes the cap residue, so space plus cap is a whole row", () => {
  /* 11.25 is the cap height of 17px serif in Chromium, and it is 3.25 past a
     row. The space has to make up 4.75 to reach the next one. */
  const space = spaceFor(11.25, 24, 8);
  assert.equal(space, 20.75);
  assert.equal((space + 11.25) % 8, 0);
});

test("it takes the multiple nearest what was asked for, not the smallest", () => {
  /* A page whose paragraphs sit five pixels apart satisfies the arithmetic and
     is useless, so the nearest is the one that gets picked. */
  /* Nearest, in both directions. A cap of 11.25 sits 3.25 past a row, so the
     candidates are 4.75, 12.75, 20.75 and so on: asking for 8 gets 4.75 because
     that is 3.25 away and 12.75 is 4.75 away. */
  assert.equal(spaceFor(11.25, 8, 8), 4.75);
  assert.equal(spaceFor(11.25, 24, 8), 20.75);
  assert.equal(spaceFor(11.25, 48, 8), 44.75);
});

test("a cap height already on a row asks nothing of the space", () => {
  assert.equal(spaceFor(16, 24, 8), 24);
  assert.equal(spaceFor(24, 32, 8), 32);
});

test("the space is never zero or negative, whatever is asked for", () => {
  /* Zero space would stack two baselines on the same row, and a negative margin
     is a correction wearing a different hat. */
  for (const cap of [0.1, 3.25, 7.9, 11.25, 30.484]) {
    for (const wanted of [0, 1, 2, 4]) {
      const space = spaceFor(cap, wanted, 8);
      assert.ok(space > 0, `cap ${cap}, wanted ${wanted}, got ${space}`);
    }
  }
});

test("it holds for every cap residue across a whole row, at three pitches", () => {
  /* Swept rather than sampled: the property is meant to be universal, and a
     handful of examples is how a modular bug survives. */
  for (const pitch of [4, 8, 12]) {
    for (let cap = 0.05; cap < pitch * 3; cap += 0.05) {
      const space = spaceFor(cap, pitch * 3, pitch);
      const closes = (space + cap) % pitch;
      assert.ok(
        Math.min(closes, pitch - closes) < 1e-9,
        `pitch ${pitch}, cap ${cap.toFixed(2)}: space ${space} leaves ${closes}`
      );
    }
  }
});

/* ------------------------------------------------------------------ *
   The leading, which is the one thing that moves
 * ------------------------------------------------------------------ */

test("a ratio becomes the nearest whole number of rows", () => {
  /* 1.5 on 17px is 25.5, which is nearer 24 than 32. */
  const { leading, wanted } = leadingFor({ size: 17, ratio: 1.5 }, 8);
  assert.equal(wanted, 25.5);
  assert.equal(leading, 24);
});

test("a leading in px is snapped the same way", () => {
  assert.equal(leadingFor({ size: 21, leading: 30.45 }, 8).leading, 32);
  assert.equal(leadingFor({ size: 27, leading: 32.4 }, 8).leading, 32);
});

test("a design with no leading at all gets 1.5, and says so", () => {
  const { leading, wanted } = leadingFor({ size: 16 }, 8);
  assert.equal(wanted, 24);
  assert.equal(leading, 24);
});

test("the leading is never zero, however small the size", () => {
  /* A 3px caption rounds to nothing at an 8px pitch, and a line-height of zero
     stacks every line on one baseline. */
  assert.equal(leadingFor({ size: 3, ratio: 1 }, 8).leading, 8);
  assert.equal(leadingFor({ size: 1, ratio: 1 }, 8).leading, 8);
});

/* ------------------------------------------------------------------ *
   Fitting a design
 * ------------------------------------------------------------------ */

const DESIGN: FamilyRequest[] = [
  {
    role: "body",
    font: "Test",
    steps: [
      { name: "body", size: 17, ratio: 1.5, space: 24 },
      { name: "h1", size: 44, leading: 48, space: 56 },
    ],
  },
];

const CAPS = capsOf({ 17: 11.25, 44: 29.141 });

test("every size comes back exactly as it went in", () => {
  const fitted = fitWith(DESIGN, CAPS, { pitch: 8 });
  assert.deepEqual(
    fitted.families[0]!.steps.map((s) => s.size),
    [17, 44]
  );
});

test("the cost is the leading movement and nothing else", () => {
  const fitted = fitWith(DESIGN, CAPS, { pitch: 8 });
  const [body, h1] = fitted.families[0]!.steps;

  /* 25.5 to 24 is 1.5; 48 was already a whole number of rows. */
  assert.equal(body!.leadingMoved, -1.5);
  assert.equal(h1!.leadingMoved, 0);
  assert.equal(fitted.cost, 1.5);
});

test("the origin is zero, because the first block's space closes its own cap", () => {
  /* Not a default. Every block carries a space before it, including the first,
     so the first baseline lands on a row measured from the top of the document. */
  const fitted = fitWith(DESIGN, CAPS, { pitch: 8 });
  assert.equal(fitted.origin, 0);
  const [body] = fitted.families[0]!.steps;
  assert.equal((body!.space + body!.cap) % 8, 0);
});

test("a design already on the grid moves nothing at all", () => {
  const fitted = fitWith(
    [{ role: "body", font: "Test", steps: [{ name: "p", size: 16, leading: 24, space: 24 }] }],
    capsOf({ 16: 16 }),
    { pitch: 8 }
  );
  assert.equal(fitted.cost, 0);
  assert.equal(fitted.families[0]!.steps[0]!.space, 24);
  assert.equal(fitted.families[0]!.steps[0]!.leading, 24);
});

test("a size with no cap height is left out rather than guessed at", () => {
  /* A font that predates OS/2 version 2 declares no cap height. Synthesising one
     from the ascender would put every baseline on the wrong row while looking
     like it had worked. */
  const fitted = fitWith(DESIGN, capsOf({ 17: 11.25 }), { pitch: 8 });
  assert.equal(fitted.families[0]!.steps.length, 1);
  assert.equal(fitted.families[0]!.steps[0]!.size, 17);
  assert.equal(fitted.unavailable, false, "one size worked, so the fit is usable");
});

test("no cap heights at all is reported as unavailable", () => {
  const fitted = fitWith(DESIGN, capsOf({}), { pitch: 8 });
  assert.equal(fitted.unavailable, true);
  assert.equal(fitted.families[0]!.steps.length, 0);
});

test("an empty design is not unavailable, it is empty", () => {
  /* The difference matters: unavailable means the engine could not answer, and
     empty means nothing was asked. Conflating them tells a caller to go and
     install a different browser when they passed no families. */
  const fitted = fitWith([], capsOf({}), { pitch: 8 });
  assert.equal(fitted.unavailable, false);
  assert.equal(fitted.families.length, 0);
});

test("steps without names are named after their role", () => {
  const fitted = fitWith(
    [{ role: "display", font: "Test", steps: [{ size: 44, ratio: 1.1 }, { size: 17, ratio: 1.5 }] }],
    CAPS,
    { pitch: 8 }
  );
  assert.deepEqual(
    fitted.families[0]!.steps.map((s) => s.name),
    ["display-1", "display-2"]
  );
});

test("the pitch is honoured, and a bad one is refused", () => {
  const fitted = fitWith(DESIGN, CAPS, { pitch: 4 });
  for (const step of fitted.families[0]!.steps) {
    assert.equal(step.leading % 4, 0);
    const closes = (step.space + step.cap) % 4;
    assert.ok(Math.min(closes, 4 - closes) < 1e-9);
  }

  /* `gridConfig` refuses a pitch of zero, which would report every baseline
     perfect, and fitting has to inherit that rather than divide by it. */
  assert.throws(() => fitWith(DESIGN, CAPS, { pitch: 0 }), /pitch/i);
});

/* ------------------------------------------------------------------ *
   The CSS
 * ------------------------------------------------------------------ */

test("the emitted CSS carries the trim, because the arithmetic assumes it", () => {
  const css = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  assert.match(css, /text-box-trim: trim-both/);
  assert.match(css, /text-box-edge: cap alphabetic/);
  assert.match(css, /Required/);
});

test("it says which leadings moved, and does not say it when none did", () => {
  const moved = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  assert.match(moved, /body 25\.5 to 24/);

  const still = fittedScaleToCss(
    fitWith(
      [{ role: "body", font: "Test", steps: [{ name: "p", size: 16, leading: 24 }] }],
      capsOf({ 16: 16 }),
      { pitch: 8 }
    )
  );
  assert.doesNotMatch(still, /Leadings that moved/);
});

test("it warns about a family that did not render", () => {
  const css = fittedScaleToCss(
    fitWith(DESIGN, { capHeight: (_f, s) => CAPS.capHeight("", s), resolved: () => false }, {
      pitch: 8,
    })
  );
  assert.match(css, /WARNING/);
  assert.match(css, /did not render/);
});

test("it tells you what to do when nothing could be fitted", () => {
  const css = fittedScaleToCss(fitWith(DESIGN, capsOf({}), { pitch: 8 }));
  assert.match(css, /Nothing was fitted/);
  assert.match(css, /text-box-trim|OS\/2/);
});

test("the custom properties carry every step", () => {
  const css = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  for (const name of ["body", "h1"]) {
    assert.match(css, new RegExp(`--size-${name}:`));
    assert.match(css, new RegExp(`--leading-${name}:`));
    assert.match(css, new RegExp(`--space-${name}:`));
  }
});

test("space is documented as going before the block, because that is load-bearing", () => {
  /* Set as margin-bottom it corrects against the wrong font size, and the page
     is off the grid in a way that looks like the tool failed. */
  const css = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  assert.match(css, /margin-top, never margin-bottom/);
});
