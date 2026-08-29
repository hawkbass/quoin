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
  pitchCost,
  surveyPitches,
  fitVertical,
  fittedVerticalToCss,
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
  /* Set after the block it corrects against the wrong font size, and the page is
     off the grid in a way that looks like the tool failed. */
  const css = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  assert.match(css, /margin-top/);
  assert.match(css, /before rather than after/);
});

test("the margin form points at columns and the padding form does not", () => {
  /* A margin at the top of a column fragment is truncated, which takes a fitted
     page from 12 of 12 to 6 of 12 across two columns. Somebody reading the
     stylesheet should find that out there rather than from their own page. */
  const margin = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  assert.match(margin, /column/);

  const padding = fittedScaleToCss(
    fitWith(DESIGN, CAPS, { pitch: 8, spaceProperty: "padding" })
  );
  assert.match(padding, /padding-top/);
  assert.doesNotMatch(padding, /Use padding-top instead/);
});

/* ------------------------------------------------------------------ *
   Columns
 * ------------------------------------------------------------------ */

test("columns is off unless it is asked for", () => {
  /* It changes how a page prints whether or not it has columns, so inferring it
     would be this library altering pagination behind somebody's back. */
  assert.equal(fitWith(DESIGN, CAPS, { pitch: 8 }).columns, false);
  assert.equal(fitWith(DESIGN, CAPS, { pitch: 8, columns: true }).columns, true);
});

test("columns puts break-inside on the rules, and only on the rules", () => {
  /* Only a design with selectors has rules to put it on. A design from JSON has
     custom properties and nothing to attach a fragmentation rule to, and saying
     so in the comment is the honest output rather than a rule for nobody. */
  const withSelectors: FamilyRequest[] = [
    {
      role: "body",
      font: "Test",
      steps: [{ name: "body", size: 17, ratio: 1.5, space: 24, selector: "p" }],
    },
  ];

  const on = fittedScaleToCss(
    fitWith(withSelectors, CAPS, { pitch: 8, spaceProperty: "padding", columns: true })
  );
  assert.match(on, /p \{[^}]*break-inside: avoid/s);

  const off = fittedScaleToCss(
    fitWith(withSelectors, CAPS, { pitch: 8, spaceProperty: "padding" })
  );
  assert.doesNotMatch(off, /^\s*break-inside: avoid;$/m);
});

test("the note says what was emitted rather than what to go and add", () => {
  const asked = fittedScaleToCss(
    fitWith(DESIGN, CAPS, { pitch: 8, spaceProperty: "padding", columns: true })
  );
  assert.match(asked, /other half of columns/);

  const notAsked = fittedScaleToCss(
    fitWith(DESIGN, CAPS, { pitch: 8, spaceProperty: "padding" })
  );
  assert.match(notAsked, /For columns, add break-inside/);
});

test("every emitted stylesheet still parses with break-inside in it", () => {
  /* The column note broke the parser once by putting the comment terminator in
     the wrong place, so anything added to that block is parsed here rather than
     matched as a string. */
  for (const columns of [false, true]) {
    for (const spaceProperty of ["margin", "padding"] as const) {
      const css = fittedScaleToCss(
        fitWith(
          [
            {
              role: "body",
              font: "Test",
              steps: [{ name: "body", size: 17, ratio: 1.5, space: 24, selector: "p" }],
            },
          ],
          CAPS,
          { pitch: 8, spaceProperty, columns }
        )
      );
      /* Comments balanced, braces balanced: the two ways that block has failed. */
      const opens = (css.match(/\/\*/g) ?? []).length;
      const closes = (css.match(/\*\//g) ?? []).length;
      assert.equal(opens, closes, `columns ${columns}, ${spaceProperty}: ${opens} vs ${closes}`);

      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      let depth = 0;
      for (const char of stripped) {
        if (char === "{") depth++;
        if (char === "}") depth--;
        assert.ok(depth >= 0, `columns ${columns}, ${spaceProperty}: unbalanced braces`);
      }
      assert.equal(depth, 0, `columns ${columns}, ${spaceProperty}: unbalanced braces`);
    }
  }
});

/* ------------------------------------------------------------------ *
   Borders and padding, which are between the box and the baseline
 * ------------------------------------------------------------------ */

test("the space closes the lead-in as well as the cap", () => {
  /* A border-top and a padding-top sit between the top of the box and the first
     line, so they move the first baseline by exactly their sum. The space has
     to close all three or the block starts off the grid.

     Cap 11.25 is 3.25 past a row, and with 1px of border above it the lead is
     4.25 past. Asking for 24 then lands on 27.75 rather than the 20.75 it lands
     on without the border, because the nearest multiple moved: 27.75 is 3.75
     away from what was asked for and 19.75 is 4.25 away. */
  const withBorder = fitWith(
    [{ role: "body", font: "Test", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, borderTop: 1 }] }],
    CAPS,
    { pitch: 8 }
  ).families[0]!.steps[0]!;

  assert.equal(withBorder.leadIn, 1);
  assert.equal((withBorder.space + withBorder.cap + withBorder.leadIn) % 8, 0);
  assert.equal(withBorder.space, 27.75);
});

test("border-top and padding-top are the same term, because they are", () => {
  const shapes = [
    { borderTop: 5 },
    { paddingTop: 5 },
    { borderTop: 2, paddingTop: 3 },
    { borderTop: 1, paddingTop: 4 },
  ];
  const spaces = shapes.map(
    (shape) =>
      fitWith(
        [{ role: "body", font: "Test", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, ...shape }] }],
        CAPS,
        { pitch: 8 }
      ).families[0]!.steps[0]!.space
  );
  assert.deepEqual(spaces, [spaces[0], spaces[0], spaces[0], spaces[0]]);
});

test("a lead-in that is a whole number of rows changes nothing", () => {
  /* Which is why 8px of padding was harmless on a page where 5px was not: it
     moves everything by exactly one row, and a row is nothing. */
  const plain = fitWith(DESIGN, CAPS, { pitch: 8 }).families[0]!.steps[0]!;
  const padded = fitWith(
    [{ role: "body", font: "Test", steps: [{ name: "body", size: 17, ratio: 1.5, space: 24, paddingTop: 8 }] }],
    CAPS,
    { pitch: 8 }
  ).families[0]!.steps[0]!;
  assert.equal(padded.space, plain.space);
});

test("the tail is rounded up to a whole row rather than absorbed", () => {
  /*
     Under the trim a box ends at its last baseline, so a border-bottom and a
     padding-bottom sit below it and push the next block down. That makes them
     the only term here belonging to a block other than the one being fitted,
     and a per-step design cannot know what comes next. So they are made to
     contribute nothing instead of being absorbed into somebody else's space.
  */
  const step = fitWith(
    [{ role: "body", font: "Test", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, borderBottom: 1 }] }],
    CAPS,
    { pitch: 8 }
  ).families[0]!.steps[0]!;

  assert.equal(step.paddingBottomWas, 0);
  assert.equal(step.paddingBottom, 7, "1px of border wants 7px of padding under it");
  assert.equal((step.paddingBottom + 1) % 8, 0);
  assert.equal(step.space, 20.75, "and the space is untouched, because the tail is not its problem");
});

test("a tail already on a row is left exactly as it is", () => {
  for (const shape of [{}, { paddingBottom: 8 }, { borderBottom: 2, paddingBottom: 6 }, { paddingBottom: 16 }]) {
    const step = fitWith(
      [{ role: "body", font: "Test", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, ...shape }] }],
      CAPS,
      { pitch: 8 }
    ).families[0]!.steps[0]!;
    assert.equal(
      step.paddingBottom,
      step.paddingBottomWas,
      `${JSON.stringify(shape)} was moved when it did not need to be`
    );
  }
});

test("a design with no box at all is byte-for-byte what it was", () => {
  /* The guard on the whole change: a page with no borders or padding on its
     text must fit exactly as it did before any of this existed. */
  const step = fitWith(DESIGN, CAPS, { pitch: 8 }).families[0]!.steps[0]!;
  assert.equal(step.leadIn, 0);
  assert.equal(step.paddingBottom, 0);
  assert.equal(step.space, 20.75);
});

test("the CSS carries a padding-bottom only when the tail had to move", () => {
  const withSelector = (extra: object) => [
    {
      role: "body",
      font: "Test",
      steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, selector: "p", ...extra }],
    },
  ];

  const moved = fittedScaleToCss(fitWith(withSelector({ borderBottom: 1 }), CAPS, { pitch: 8 }));
  assert.match(moved, /padding-bottom: 7px/);
  assert.match(moved, /whole row/);

  const still = fittedScaleToCss(fitWith(withSelector({}), CAPS, { pitch: 8 }));
  assert.doesNotMatch(still, /padding-bottom/);
});

test("a step with no selector still carries its tail, as a token", () => {
  /* Rules are only emitted for steps with a verified selector, and most steps
     read off a page do not get one. Putting the tail only in the rule meant the
     correction existed for three steps out of seventeen and vanished for the
     rest without saying so. */
  const css = fittedScaleToCss(
    fitWith(
      [{ role: "body", font: "Test", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, borderBottom: 1 }] }],
      CAPS,
      { pitch: 8 }
    )
  );
  assert.match(css, /--pad-bottom-p: 7px/);
  assert.match(css, /whole row/);
});

test("the space says what it closes, not just that it closes a cap", () => {
  /* A block whose border is most of the correction with a comment blaming the
     cap height sends somebody looking in the wrong place. */
  const withBox = fittedScaleToCss(
    fitWith(
      [{ role: "body", font: "Test", steps: [{ name: "p", size: 17, ratio: 1.5, space: 24, borderTop: 1, paddingTop: 4 }] }],
      CAPS,
      { pitch: 8 }
    )
  );
  assert.match(withBox, /cap residue and 5px above it/);

  const plain = fittedScaleToCss(fitWith(DESIGN, CAPS, { pitch: 8 }));
  assert.match(plain, /closes a [\d.]+px cap residue \*\//);
});

/* ------------------------------------------------------------------ *
   Which pitch
 * ------------------------------------------------------------------ */

test("a pitch costs only the leading it moves", () => {
  /* No cap heights, no font, no browser. The space is not a cost: it is chosen
     rather than moved, and it closes the cap height whatever the pitch is. */
  const cost = pitchCost([{ size: 16, leading: 25.5 }, { size: 24, leading: 32 }], 8);
  assert.equal(cost.cost, 1.5, "25.5 to 24 is 1.5, and 32 was already a whole row");
  assert.equal(cost.worst, 1.5);
  assert.equal(cost.exact, 1);
  assert.equal(cost.steps, 2);
});

test("a design already on the grid costs nothing at that pitch", () => {
  const steps = [{ size: 16, leading: 24 }, { size: 24, leading: 32 }, { size: 40, leading: 48 }];
  assert.equal(pitchCost(steps, 8).cost, 0);
  assert.equal(pitchCost(steps, 8).exact, 3);
});

test("the cheapest pitch is not always the finest, which is the point", () => {
  /*
     If it were, this would not be worth computing: a finer grid has a smaller
     worst case, so it ought to win every time. Where the leadings happen to fall
     matters more than how far they can be from a row, and that is not something
     to reason about from a distance.
  */
  const steps = [
    { size: 16, ratio: 1.5 }, { size: 20, ratio: 1.5 }, { size: 25, ratio: 1.4 },
    { size: 31, ratio: 1.3 }, { size: 39, ratio: 1.2 }, { size: 49, ratio: 1.1 },
  ];
  const four = pitchCost(steps, 4).cost;
  const six = pitchCost(steps, 6).cost;
  assert.ok(
    six < four,
    `a 6px pitch costs ${six} and a 4px pitch ${four}, so finer is cheaper after all`
  );
});

test("the survey reports every pitch and names the cheapest", () => {
  const steps = [{ size: 16, leading: 24 }, { size: 21, leading: 31 }];
  const survey = surveyPitches(steps, { pitches: [4, 6, 8, 12] });

  assert.equal(survey.costs.length, 4);
  assert.deepEqual(survey.costs.map((c) => c.pitch), [4, 6, 8, 12]);

  const cheapest = Math.min(...survey.costs.map((c) => c.cost));
  assert.equal(survey.cheapest.cost, cheapest);
});

test("a tie for cheapest goes to the first tried, which is the finest", () => {
  /* Not arbitrary: the list is ascending, and where two pitches cost the same
     the coarser one is the better answer, which `coarsestAffordable` is for. */
  const steps = [{ size: 16, leading: 24 }];
  const survey = surveyPitches(steps, { pitches: [4, 8, 12] });
  assert.equal(survey.cheapest.cost, 0);
  assert.equal(survey.cheapest.pitch, 4);
});

test("the coarsest affordable pitch is the question worth asking", () => {
  /*
     Cost alone recommends the finest grid every time, and it is right and
     useless: a 1px grid costs nothing because it constrains nothing. A grid is
     worth having because it is coarse.
  */
  const steps = [
    { size: 16, leading: 24 }, { size: 20, leading: 30 }, { size: 25, leading: 35 },
    { size: 31, leading: 40 }, { size: 39, leading: 47 }, { size: 49, leading: 54 },
  ];
  const survey = surveyPitches(steps, { budget: 6 });

  assert.ok(survey.coarsestAffordable, "nothing came in under 6px");
  assert.ok(
    survey.coarsestAffordable!.cost <= 6,
    `it offered ${survey.coarsestAffordable!.pitch}px at ${survey.coarsestAffordable!.cost}px`
  );

  /* And it is genuinely the coarsest: nothing above it is affordable. */
  for (const entry of survey.costs) {
    if (entry.pitch > survey.coarsestAffordable!.pitch) {
      assert.ok(
        entry.cost > 6,
        `${entry.pitch}px costs ${entry.cost}px and is coarser, so it should have been chosen`
      );
    }
  }
});

test("a budget nothing meets is said rather than fudged", () => {
  const survey = surveyPitches([{ size: 17, leading: 25.5 }], { budget: 0.1 });
  assert.equal(survey.coarsestAffordable, null);
  assert.ok(survey.cheapest.cost > 0.1);
});

test("no budget means no recommendation, because there is no answer without one", () => {
  const survey = surveyPitches([{ size: 17, leading: 25.5 }]);
  assert.equal(survey.coarsestAffordable, null);
});

test("a pitch of zero is refused rather than dividing by it", () => {
  for (const bad of [0, -8, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => pitchCost([{ size: 16 }], bad), /pitch/i);
  }
});

test("a step with no leading at all is costed against the default ratio", () => {
  /* 1.5 is what `leadingFor` assumes, and costing it differently here would
     make the survey disagree with the fit it is meant to inform. */
  const cost = pitchCost([{ size: 16 }], 8);
  const { leading, wanted } = leadingFor({ size: 16 }, 8);
  assert.equal(wanted, 24);
  assert.equal(leading, 24);
  assert.equal(cost.cost, 0);
});

/* ------------------------------------------------------------------ *
   Vertical writing
 * ------------------------------------------------------------------ */

test("a vertical fit needs no font, because there is no cap height in it", () => {
  /*
     The whole difference. Horizontally the first baseline is half the leading
     plus the ascent, and the ascent is the typeface's. Vertically the dominant
     baseline is the central one, measured in both engines at exactly half the
     leading, for CJK and Latin alike. So `fitVertical` takes steps and nothing
     else: no cap source, no font file, no browser.
  */
  const fitted = fitVertical([{ name: "body", size: 20, leading: 27 }], { pitch: 8 });
  assert.equal(fitted.steps.length, 1);
  assert.equal(fitted.steps[0]!.size, 20, "the size is never changed here either");
  assert.equal(fitted.steps[0]!.leading % 8, 0);
});

test("every leading comes out the same parity in rows", () => {
  /*
     Between one block's last baseline and the next block's first lies
     leadingA/2 + space + leadingB/2. Two even leadings give two whole rows; two
     odd ones give two half-rows that sum to a whole one; one of each leaves half
     a row over and the page comes apart. Measured: all even holds, all odd
     holds, mixed reads 17 of 23.
  */
  const fitted = fitVertical(
    [
      { name: "a", size: 13, leading: 17 },
      { name: "b", size: 20, leading: 30 },
      { name: "c", size: 32, leading: 46 },
    ],
    { pitch: 8 }
  );

  const parities = new Set(fitted.steps.map((s) => s.rows % 2));
  assert.equal(parities.size, 1, `rows came out ${fitted.steps.map((s) => s.rows).join(", ")}`);
  assert.equal(fitted.parity, fitted.steps[0]!.rows % 2 === 0 ? "even" : "odd");
});

test("odd is chosen when odd is nearer, which took measuring to believe", () => {
  /* The first prediction said odd parity would fail and it does not: two odd
     leadings leave two half-rows, and two half-rows are a row. So the solver is
     allowed to pick it, and picks it when it costs less. */
  const nearOdd = fitVertical(
    [
      { name: "a", size: 15, leading: 24 },
      { name: "b", size: 26, leading: 40 },
      { name: "c", size: 36, leading: 56 },
    ],
    { pitch: 8 }
  );
  assert.equal(nearOdd.parity, "odd");
  assert.equal(nearOdd.cost, 0, "a design already on odd rows should not move");
});

test("even is chosen when even is nearer", () => {
  const nearEven = fitVertical(
    [
      { name: "a", size: 13, leading: 16 },
      { name: "b", size: 20, leading: 32 },
      { name: "c", size: 32, leading: 48 },
    ],
    { pitch: 8 }
  );
  assert.equal(nearEven.parity, "even");
  assert.equal(nearEven.cost, 0);
});

test("the parity can be stated, and then it is honoured whatever it costs", () => {
  const forced = fitVertical([{ name: "a", size: 20, leading: 32 }], {
    pitch: 8,
    parity: "odd",
  });
  assert.equal(forced.parity, "odd");
  assert.equal(forced.steps[0]!.rows % 2, 1);
});

test("the nearest row of the right parity, not the nearest row then nudged", () => {
  /*
     33px wants 4 rows at an 8px pitch. Forced odd, the answer is 5 rows and not
     3: nudging up from the nearest is a different algorithm that lands two rows
     away as often as one, and on a leading that is the difference between 40 and
     24.
  */
  const forced = fitVertical([{ name: "a", size: 22, leading: 33 }], {
    pitch: 8,
    parity: "odd",
  });
  assert.equal(forced.steps[0]!.leading, 40);
});

test("a space is a whole number of rows and never nothing", () => {
  const fitted = fitVertical(
    [{ name: "a", size: 20, leading: 32, space: 20 }, { name: "b", size: 20, leading: 32, space: 1 }],
    { pitch: 8 }
  );
  assert.equal(fitted.steps[0]!.space % 8, 0);
  assert.equal(fitted.steps[1]!.space % 8, 0);
  assert.ok(fitted.steps[1]!.space > 0, "a space of zero stacks two baselines on one rule");
});

test("the CSS names no font and carries no trim", () => {
  /* Because there is nothing for either to do. Emitting `text-box-trim` here
     would be copying the horizontal answer to a question that is not asked. */
  const css = fittedVerticalToCss(
    fitVertical([{ name: "body", size: 20, leading: 32, space: 24 }], { pitch: 8 })
  );
  /* A declaration, not a mention: the comment above the tokens names both
     properties in order to say they are absent, and a test that cannot tell the
     difference would force the explanation out of the file. */
  assert.doesNotMatch(css, /^\s*text-box-trim\s*:/m);
  assert.doesNotMatch(css, /^\s*text-box-edge\s*:/m);
  assert.match(css, /--leading-body: 32px/);
  assert.match(css, /margin-inline-start/, "the block axis runs across the page");
  assert.match(css, /central/, "and it says why there is no residue");
});
