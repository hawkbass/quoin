/* Accepting a design from whoever is holding one.

   `fitScale` takes families with fonts and steps, which is the shape the
   arithmetic wants and not the shape anybody arrives with. A Figma export has
   `fontSize` and `lineHeight` in px strings; a token file is flat; an agent
   reading a screenshot has a list of measurements and no idea what this library
   calls things.

   Two halves to test, and the second matters more. Accepting the spellings that
   turn up, and refusing the rest in a way somebody can act on: an agent cannot
   ask a follow-up question, so an error that does not name the entry and say what
   was expected costs a round trip and sometimes a confidently wrong answer. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { normaliseDesign, DesignError } from "../../src/design-input.ts";

/* ------------------------------------------------------------------ *
   The spellings that turn up
 * ------------------------------------------------------------------ */

test("the canonical shape passes through unchanged", () => {
  const { families, notes } = normaliseDesign({
    families: [
      { role: "body", font: "Lato", steps: [{ name: "p", size: 17, leading: 24, space: 24 }] },
    ],
  });

  assert.equal(families.length, 1);
  assert.deepEqual(families[0]!.steps[0], { size: 17, name: "p", leading: 24, space: 24 });
  assert.deepEqual(notes, [], "nothing had to be interpreted");
});

test("a Figma-shaped export is understood", () => {
  const { families } = normaliseDesign({
    families: [
      {
        role: "heading",
        fontFamily: "Lato",
        sizes: [{ label: "Display/Large", fontSize: "44px", lineHeight: 1.1, marginTop: "48px" }],
      },
    ],
  });

  const step = families[0]!.steps[0]!;
  assert.equal(families[0]!.font, "Lato");
  assert.equal(step.name, "Display/Large");
  assert.equal(step.size, 44);
  assert.equal(step.ratio, 1.1);
  assert.equal(step.space, 48);
});

test("points become pixels, and it says so", () => {
  /* Design tools that came from print still export points. Converting silently
     is how a 27pt heading gets fitted as 27px. */
  const { families, notes } = normaliseDesign({
    font: "Lato",
    steps: [{ size: "27pt" }],
  });

  assert.equal(families[0]!.steps[0]!.size, 36);
  assert.ok(notes.some((n) => /27pt.*36px/.test(n)), `notes were ${JSON.stringify(notes)}`);
});

test("a unitless line-height is a ratio, and a number of pixels is not", () => {
  /*
     CSS spells a ratio unitless and most tools export it that way, so `1.5` and
     `24` mean different things in the same field. The boundary is where they
     stop overlapping: nothing sets a ratio above 4, and nothing sets a leading
     below 4px.
  */
  const ratio = normaliseDesign({ font: "L", steps: [{ size: 17, lineHeight: 1.5 }] });
  assert.equal(ratio.families[0]!.steps[0]!.ratio, 1.5);
  assert.equal(ratio.families[0]!.steps[0]!.leading, undefined);

  const pixels = normaliseDesign({ font: "L", steps: [{ size: 17, lineHeight: 24 }] });
  assert.equal(pixels.families[0]!.steps[0]!.leading, 24);
  assert.equal(pixels.families[0]!.steps[0]!.ratio, undefined);

  const stated = normaliseDesign({ font: "L", steps: [{ size: 17, lineHeight: "24px" }] });
  assert.equal(stated.families[0]!.steps[0]!.leading, 24);
});

test("a bare number is a step, because a flat token file is nothing else", () => {
  const { families } = normaliseDesign({ font: "L", steps: [13.5, 17, "44px"] });
  assert.deepEqual(
    families[0]!.steps.map((s) => s.size),
    [13.5, 17, 44]
  );
});

test("one family at the top level is a design", () => {
  const { families, notes } = normaliseDesign({
    font: "Lato",
    role: "body",
    steps: [{ size: 17 }],
  });

  assert.equal(families.length, 1);
  assert.equal(families[0]!.role, "body");
  assert.ok(notes.some((n) => /single family/.test(n)));
});

test("a font file path is carried through, because it decides whether a browser is needed", () => {
  const { families } = normaliseDesign({
    families: [{ font: "Lato", file: "./Lato.ttf", steps: [{ size: 17 }] }],
  });
  assert.equal(families[0]!.file, "./Lato.ttf");
});

test("a family with no role is given one rather than refused", () => {
  const { families } = normaliseDesign({
    families: [{ font: "A", steps: [{ size: 16 }] }, { font: "B", steps: [{ size: 16 }] }],
  });
  assert.deepEqual(
    families.map((f) => f.role),
    ["family-1", "family-2"]
  );
});

test("every alias for each field is accepted", () => {
  for (const font of ["font", "fontFamily", "font-family", "family", "stack"]) {
    for (const steps of ["steps", "sizes", "scale", "tokens"]) {
      const { families } = normaliseDesign({ [font]: "L", [steps]: [{ size: 16 }] });
      assert.equal(families[0]!.font, "L", `${font} + ${steps}`);
      assert.equal(families[0]!.steps[0]!.size, 16, `${font} + ${steps}`);
    }
  }
});

/* ------------------------------------------------------------------ *
   What it refuses, and how
 * ------------------------------------------------------------------ */

test("a relative length is refused rather than assumed to be sixteen", () => {
  /*
     A rem is 16px only if nothing has changed the root size. A design saying
     1.0625rem against an 18px root means 19.125px, and guessing produces a fit
     that looks right and is not, which is the one outcome worth avoiding.
  */
  assert.throws(
    () => normaliseDesign({ font: "L", steps: [{ size: "1.0625rem" }] }),
    (error: unknown) => {
      assert.ok(error instanceof DesignError);
      assert.equal((error as DesignError).at, "design.steps[0].size");
      assert.match((error as Error).message, /relative/);
      assert.match((error as Error).message, /root size/);
      return true;
    }
  );

  assert.throws(() => normaliseDesign({ font: "L", steps: [{ size: "2em" }] }), /relative/);
  assert.throws(() => normaliseDesign({ font: "L", steps: [{ size: "50%" }] }), /percentage/);
});

test("a missing font says which family and what to call it", () => {
  assert.throws(
    () => normaliseDesign({ families: [{ steps: [{ size: 16 }] }] }),
    (error: unknown) => {
      assert.equal((error as DesignError).at, "design.families[0]");
      assert.match((error as Error).message, /no font/);
      assert.match((error as Error).message, /"font"/);
      return true;
    }
  );
});

test("steps with no font explain why the font is needed at all", () => {
  /* Not obvious from outside: the cap height that decides the spacing belongs to
     the typeface, so a design without one cannot be fitted at any size. */
  assert.throws(
    () => normaliseDesign({ steps: [{ size: 16 }] }),
    /cap height that decides the spacing belongs to the typeface/
  );
});

test("a missing size names the entry and the fields it would accept", () => {
  assert.throws(
    () => normaliseDesign({ font: "L", steps: [{ leading: 24 }] }),
    (error: unknown) => {
      assert.equal((error as DesignError).at, "design.steps[0]");
      assert.match((error as Error).message, /no size/);
      assert.match((error as Error).message, /fontSize/);
      return true;
    }
  );
});

test("an empty families array is refused, and says it is empty", () => {
  assert.throws(() => normaliseDesign({ families: [] }), /is empty/);
  assert.throws(() => normaliseDesign({ font: "L", steps: [] }), /is empty/);
});

test("something that is not a design at all is refused with the shape it wanted", () => {
  for (const bad of [null, 42, "a design", [1, 2, 3], {}]) {
    assert.throws(
      () => normaliseDesign(bad),
      /expected/,
      `${JSON.stringify(bad)} should have been refused`
    );
  }
});

test("a size of zero or below is not a size", () => {
  assert.throws(() => normaliseDesign({ font: "L", steps: [{ size: 0 }] }), /is not a size/);
  assert.throws(() => normaliseDesign({ font: "L", steps: [{ size: -17 }] }), /is not a size/);
});

test("a length that is not a length names what it could not read", () => {
  assert.throws(
    () => normaliseDesign({ font: "L", steps: [{ size: "large" }] }),
    /cannot read "large" as a length/
  );
  assert.throws(
    () => normaliseDesign({ font: "L", steps: [{ size: Number.NaN }] }),
    /not a number/
  );
});

test("every error carries a path, because an agent cannot ask where", () => {
  const cases: unknown[] = [
    { families: [{ font: "A", steps: [{ size: 16 }] }, { font: "B", steps: [{ leading: 24 }] }] },
    { families: [{ font: "A", steps: [{ size: "3rem" }] }] },
    { font: "A", steps: [{ size: 16 }, { size: "nope" }] },
  ];

  for (const bad of cases) {
    try {
      normaliseDesign(bad);
      assert.fail(`${JSON.stringify(bad)} should have thrown`);
    } catch (error) {
      assert.ok(error instanceof DesignError, "threw a DesignError");
      assert.match(
        (error as DesignError).at,
        /^design(\.|\[)/,
        `path "${(error as DesignError).at}" does not locate the problem`
      );
    }
  }
});
