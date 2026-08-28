/* A Figma file, as a design the fitter takes.

   The design comes before the CSS, and fitting it up front is the whole point:
   corrections applied afterwards are a repair, and a design fitted first needs
   none. Until this existed the only ways to hand the fitter a design were to
   write the JSON yourself or to point it at a site that already existed, and
   neither is what somebody has when they are working from a drawing. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { figmaToDesign, FigmaError } from "../../src/figma.ts";

interface NodeSpec {
  name: string;
  font?: string;
  size?: number;
  leading?: number;
  unit?: string;
  y?: number;
  height?: number;
  visible?: boolean;
}

function text(spec: NodeSpec) {
  return {
    id: `1:${spec.name}`,
    name: spec.name,
    type: "TEXT",
    ...(spec.visible === false ? { visible: false } : {}),
    style: {
      ...(spec.font === undefined ? {} : { fontFamily: spec.font }),
      ...(spec.size === undefined ? {} : { fontSize: spec.size }),
      ...(spec.leading === undefined ? {} : { lineHeightPx: spec.leading }),
      lineHeightUnit: spec.unit ?? "PIXELS",
    },
    ...(spec.y === undefined
      ? {}
      : {
          absoluteBoundingBox: {
            x: 0,
            y: spec.y,
            width: 600,
            height: spec.height ?? 24,
          },
        }),
  };
}

function file(nodes: unknown[]) {
  return {
    name: "Test",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [{ id: "0:1", type: "CANVAS", children: nodes }],
    },
  };
}

/* ------------------------------------------------------------------ *
   Reading the file
 * ------------------------------------------------------------------ */

test("text nodes become families and steps", () => {
  const design = figmaToDesign(
    file([
      text({ name: "Body", font: "Söhne", size: 17, leading: 27.2 }),
      text({ name: "Body", font: "Söhne", size: 17, leading: 27.2 }),
      text({ name: "Heading", font: "Söhne Breit", size: 34, leading: 40.8 }),
    ])
  );

  assert.equal(design.nodes, 3);
  assert.equal(design.families.length, 2);
  /* Commonest family first, so the one carrying the reading is first. */
  assert.equal(design.families[0]!.font, "Söhne");
  assert.equal(design.families[0]!.steps[0]!.size, 17);
  assert.equal(design.families[0]!.steps[0]!.leading, 27.2);
  assert.equal(design.families[1]!.font, "Söhne Breit");
});

test("the three shapes somebody actually has are all accepted", () => {
  const nodes = [text({ name: "Body", font: "Söhne", size: 17, leading: 27.2 })];

  const whole = figmaToDesign(file(nodes));
  const document = figmaToDesign(file(nodes).document);
  const fromNodes = figmaToDesign({
    nodes: { "1:1": { document: { type: "FRAME", children: nodes } } },
  });

  assert.equal(whole.nodes, 1);
  assert.equal(document.nodes, 1);
  assert.equal(fromNodes.nodes, 1);
});

test("steps are named for the layer name the designer used", () => {
  /* Because that is what they will look for in the output. */
  const design = figmaToDesign(
    file([
      text({ name: "Section heading", font: "Söhne", size: 34, leading: 40 }),
      text({ name: "Section heading", font: "Söhne", size: 34, leading: 40 }),
    ])
  );
  assert.equal(design.families[0]!.steps[0]!.name, "section-heading");
});

test("a size used once is still a size", () => {
  /*
     Unlike the page reader, which wants two before it believes a combination.
     On a page a one-off is usually a widget; in a design file it is a style
     somebody drew on purpose, and a display size appears exactly once because
     there is one hero. An early default of two dropped the display and the
     standfirst from a five-style design and called it two families of one.
  */
  const design = figmaToDesign(
    file([
      text({ name: "Display", font: "Söhne", size: 64, leading: 70.4 }),
      text({ name: "Body", font: "Söhne", size: 17, leading: 27.2 }),
      text({ name: "Body", font: "Söhne", size: 17, leading: 27.2 }),
    ])
  );
  assert.equal(design.covered, 3, "every node should be covered");
  assert.equal(design.families[0]!.steps.length, 2);
  assert.deepEqual(
    design.families[0]!.steps.map((s) => s.size),
    [17, 64]
  );
});

/* ------------------------------------------------------------------ *
   Leading
 * ------------------------------------------------------------------ */

test("automatic leading is not read as a decision", () => {
  /*
     Figma reports a resolved `lineHeightPx` whatever the unit, and when the
     unit is INTRINSIC that figure is whatever the font's metrics came to rather
     than anything the designer chose. Fitting to it would fit the page to an
     accident of the typeface.
  */
  const auto = figmaToDesign(
    file([text({ name: "Auto", font: "Söhne", size: 13, leading: 15.6, unit: "INTRINSIC" })])
  );
  assert.equal(auto.families[0]!.steps[0]!.leading, undefined);

  const stated = figmaToDesign(
    file([text({ name: "Set", font: "Söhne", size: 13, leading: 15.6, unit: "PIXELS" })])
  );
  assert.equal(stated.families[0]!.steps[0]!.leading, 15.6);
});

/* ------------------------------------------------------------------ *
   Space, from the geometry
 * ------------------------------------------------------------------ */

test("the space comes out of the bounding boxes", () => {
  /* A designer's spacing is in the layout rather than in the type styles. */
  const design = figmaToDesign(
    file([
      text({ name: "Body", font: "S", size: 17, leading: 24, y: 0, height: 48 }),
      text({ name: "Body", font: "S", size: 17, leading: 24, y: 80, height: 48 }),
      text({ name: "Body", font: "S", size: 17, leading: 24, y: 160, height: 48 }),
    ])
  );
  /* 80 - 48 = 32 between each. */
  assert.equal(design.families[0]!.steps[0]!.space, 32);
});

test("a tie between gaps goes to the smaller one", () => {
  /*
     A step used twice has two gaps above it and no majority, and taking
     whichever the sort put first read a 76px section break as the rhythm for a
     caption and asked for a 79px space. The repeated gap is the rhythm; the odd
     large one is a section boundary.
  */
  const design = figmaToDesign(
    file([
      text({ name: "Head", font: "S", size: 34, leading: 40, y: 0, height: 40 }),
      /* 76 below the heading. */
      text({ name: "Note", font: "S", size: 13, leading: 16, y: 116, height: 16 }),
      /* 24 below the note. */
      text({ name: "Note", font: "S", size: 13, leading: 16, y: 156, height: 16 }),
    ])
  );
  const note = design.families[0]!.steps.find((s) => s.size === 13);
  assert.equal(note!.space, 24);
});

test("an overlap and a chasm are both left out of the spacing", () => {
  /* A negative gap is a layered design rather than a flow, and a very large one
     is a new section rather than a rhythm. */
  const design = figmaToDesign(
    file([
      text({ name: "A", font: "S", size: 17, leading: 24, y: 0, height: 48 }),
      text({ name: "A", font: "S", size: 17, leading: 24, y: 20, height: 48 }),
      text({ name: "A", font: "S", size: 17, leading: 24, y: 2000, height: 48 }),
    ])
  );
  assert.equal(design.families[0]!.steps[0]!.space, undefined);
});

test("nodes are read in the order they sit, not the order they were drawn", () => {
  /* Figma's document order is the layer order. */
  const design = figmaToDesign(
    file([
      text({ name: "B", font: "S", size: 17, leading: 24, y: 160, height: 48 }),
      text({ name: "B", font: "S", size: 17, leading: 24, y: 0, height: 48 }),
      text({ name: "B", font: "S", size: 17, leading: 24, y: 80, height: 48 }),
    ])
  );
  assert.equal(design.families[0]!.steps[0]!.space, 32);
});

/* ------------------------------------------------------------------ *
   What it refuses, and what it says about it
 * ------------------------------------------------------------------ */

test("a hidden layer is a decision that was already taken", () => {
  const design = figmaToDesign(
    file([
      text({ name: "Body", font: "S", size: 17, leading: 24 }),
      text({ name: "Rejected", font: "S", size: 99, leading: 100, visible: false }),
    ])
  );
  assert.equal(design.nodes, 1);
  assert.equal(
    design.families[0]!.steps.some((s) => s.size === 99),
    false
  );

  const withHidden = figmaToDesign(
    file([
      text({ name: "Body", font: "S", size: 17, leading: 24 }),
      text({ name: "Rejected", font: "S", size: 99, leading: 100, visible: false }),
    ]),
    { includeHidden: true }
  );
  assert.equal(withHidden.nodes, 2);
});

test("a node it cannot read is named rather than skipped in silence", () => {
  /* A design half-converted quietly is worse than one that refuses, because the
     fit that comes out of it looks like an answer. */
  const design = figmaToDesign(
    file([
      text({ name: "Body", font: "S", size: 17, leading: 24 }),
      text({ name: "Broken", font: "S" }),
      text({ name: "Nameless", size: 17, leading: 24 }),
    ])
  );
  assert.equal(design.warnings.length, 2);
  assert.match(design.warnings.join(" "), /Broken/);
  assert.match(design.warnings.join(" "), /Nameless/);
  assert.equal(design.nodes, 1);
});

test("a file with no text says so rather than returning an empty design", () => {
  assert.throws(
    () => figmaToDesign(file([{ id: "1:1", type: "RECTANGLE", name: "Box" }])),
    (error: unknown) => error instanceof FigmaError && error.code === "noText"
  );
});

test("something that is not a Figma file is refused", () => {
  for (const input of [null, "a string", 42]) {
    assert.throws(
      () => figmaToDesign(input),
      (error: unknown) => error instanceof FigmaError && error.code === "notFigma"
    );
  }
});

/* ------------------------------------------------------------------ *
   The output is a design the fitter takes
 * ------------------------------------------------------------------ */

test("what comes out is what fitWith takes in", () => {
  /* The point of the whole file. A converter whose output the fitter rejects is
     two formats and a translation problem rather than one pipeline. */
  const design = figmaToDesign(
    file([
      text({ name: "Body", font: "Söhne", size: 17, leading: 27.2, y: 0, height: 48 }),
      text({ name: "Body", font: "Söhne", size: 17, leading: 27.2, y: 80, height: 48 }),
    ])
  );

  for (const family of design.families) {
    assert.equal(typeof family.role, "string");
    assert.equal(typeof family.font, "string");
    assert.ok(Array.isArray(family.steps));
    for (const step of family.steps) {
      assert.equal(typeof step.size, "number");
      assert.ok(step.size > 0);
      if (step.leading !== undefined) assert.ok(step.leading > 0);
      if (step.space !== undefined) assert.ok(step.space >= 0);
    }
  }
});
