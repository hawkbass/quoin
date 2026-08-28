/* The PostCSS plugin, run through real PostCSS.

   A plugin tested against a mock node is a plugin that does not work. Everything
   here goes through `postcss().process()`, which is the only interface a build
   has, and asserts on the CSS that comes out the other side.

   The interesting half is what it refuses to do. Rewriting every rule's margin
   is how a study in this repository produced numbers that were nonsense in both
   directions: a real site's vertical spacing lives on its containers, not on its
   paragraphs. So the plugin changes the two things that cannot be wrong
   afterwards, and offers the third. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postcss from "postcss";

import { quoinPostcss } from "../../src/postcss.ts";
import { buildFont, capAt } from "./make-font.ts";

/*
   A font built here rather than one downloaded.

   The corpus is not in CI, so a test that reaches for Lato skips in the one
   place skipping matters. The parser went its whole life untested in a CI run
   for exactly that reason, and these plugins are the part somebody's build
   depends on.

   0.7165 per em is Lato's own ratio, so the numbers below are the numbers a real
   text face produces.
*/
const RATIO = 0.7165;
const UNITS = 2000;
const FONT_DIR = mkdtempSync(join(tmpdir(), "quoin-font-"));
const LATO = join(FONT_DIR, "Built.ttf");
writeFileSync(LATO, buildFont({ unitsPerEm: UNITS, capHeight: Math.round(UNITS * RATIO) }));
const have = true;

/* 17px at that ratio. */
const CAP_17 = capAt(17, { unitsPerEm: UNITS, capHeight: Math.round(UNITS * RATIO) });

async function run(css: string, options: Record<string, unknown> = {}) {
  const result = await postcss([
    quoinPostcss({ fonts: { Built: LATO }, defaultFont: "Built", ...options } as never),
  ]).process(css, { from: undefined });
  return result.css;
}

/* ------------------------------------------------------------------ *
   What it changes
 * ------------------------------------------------------------------ */

test("it snaps a ratio leading to a whole number of rows", { skip: !have }, async () => {
  /* 1.5 on 17px is 25.5, which is nearer 24 than 32. A leading off the grid puts
     every line after the first off it too, so this is the one thing that has to
     change. */
  const css = await run("p { font-size: 17px; line-height: 1.5 }");
  assert.match(css, /line-height:\s*24px/);
});

test("it snaps a px leading too", { skip: !have }, async () => {
  const css = await run("h1 { font-size: 44px; line-height: 47px }");
  assert.match(css, /line-height:\s*48px/);
});

test("it never touches the size", { skip: !have }, async () => {
  const css = await run("p { font-size: 17px; line-height: 1.5 }");
  assert.match(css, /font-size:\s*17px/);
  assert.doesNotMatch(css, /font-size:\s*1[68]px/);
});

test("the trim goes on with the space and never without it", { skip: !have }, async () => {
  /*
     This asserted that the trim was added, full stop, and it was, and that was
     the defect. The trim is not a neutral addition: an untrimmed box begins half
     a leading above its first ascent and a trimmed one begins at the cap, so
     adding it moves the block's first baseline. The space is what puts it back
     on a row, and written apart the first of them is a page whose blocks have
     moved and whose spacing has not.

     Run against the stylesheet this site is built from, the old behaviour took
     the page from 38% on the grid to 32%, and its rhythm from 350 of 374 to 299.
     The test passed throughout, because it was checking that a string appeared.
  */
  const withSpace = await run("p { font-size: 17px; line-height: 1.5; margin-top: 24px }");
  assert.match(withSpace, /text-box-trim:\s*trim-both/);
  assert.match(withSpace, /text-box-edge:\s*cap alphabetic/);
  assert.match(withSpace, /margin-top:\s*[\d.]+px/);

  const without = await run("p { font-size: 17px; line-height: 1.5 }");
  assert.doesNotMatch(
    without,
    /text-box-trim/,
    "the trim was added to a rule the space could not be written into"
  );
  assert.match(without, /--quoin-space/, "and the space should still be offered");
});

test("the space it computes closes that size's cap residue", { skip: !have }, async () => {
  const css = await run("p { font-size: 17px; line-height: 1.5 }");

  const match = /--quoin-space:\s*([\d.]+)px/.exec(css);
  assert.ok(match, `no space was offered: ${css}`);

  const space = Number.parseFloat(match![1]!);
  const closes = (space + CAP_17) % 8;
  assert.ok(
    Math.min(closes, 8 - closes) < 0.01,
    `space ${space} plus cap ${CAP_17} is not a whole number of rows`
  );
});

/* ------------------------------------------------------------------ *
   What it refuses to change
 * ------------------------------------------------------------------ */

test("a rule with no margin-top is offered a space, not given one", {
  skip: !have,
}, async () => {
  /*
     The refusal that matters. Writing `margin-top` onto every rule that sets a
     size is how you demolish somebody's layout while reporting success, and a
     real site's vertical spacing lives on its containers.
  */
  const css = await run("p { font-size: 17px; line-height: 1.5 }");
  assert.match(css, /--quoin-space:/);
  assert.doesNotMatch(css, /(^|[^-])margin-top:/m);
});

test("a rule that already declares margin-top gets it rewritten", {
  skip: !have,
}, async () => {
  /* The author has already decided the spacing lives here, so it is theirs to
     have corrected rather than somebody else's to have invented. */
  const css = await run("p { font-size: 17px; line-height: 1.5; margin-top: 24px }");

  const match = /margin-top:\s*([\d.]+)px/.exec(css);
  assert.ok(match, `margin-top was not rewritten: ${css}`);

  const space = Number.parseFloat(match![1]!);
  assert.notEqual(space, 24, "it is not the number that was there");
  const closes = (space + CAP_17) % 8;
  assert.ok(Math.min(closes, 8 - closes) < 0.01, `${space} does not close the cap`);
  assert.doesNotMatch(css, /--quoin-space:/, "and it is not offered twice");
});

test("rewriteSpace false leaves every margin alone", { skip: !have }, async () => {
  const css = await run("p { font-size: 17px; line-height: 1.5; margin-top: 24px }", {
    rewriteSpace: false,
  });
  assert.match(css, /margin-top:\s*24px/);
  assert.match(css, /--quoin-space:/);
});

test("an explicit skip is honoured", { skip: !have }, async () => {
  const css = await run("p { --quoin: skip; font-size: 17px; line-height: 1.5 }");
  assert.match(css, /line-height:\s*1\.5/, "the leading is untouched");
  assert.doesNotMatch(css, /text-box-trim/);
});

test("a rule with no line-height is left alone", { skip: !have }, async () => {
  /* There is nothing to snap and no way to know what the leading resolves to
     without a browser, so the rule is not this plugin's business. */
  const css = await run("p { font-size: 17px }");
  assert.doesNotMatch(css, /text-box-trim/);
  assert.doesNotMatch(css, /--quoin-space/);
});

test("a leading of normal is skipped and said out loud", { skip: !have }, async () => {
  /* `normal` resolves per font and per engine, which is exactly the number a
     build cannot know. */
  const skipped: string[] = [];
  await postcss([
    quoinPostcss({
      fonts: { Built: LATO },
      defaultFont: "Built",
      onSkip: (selector, reason) => skipped.push(`${selector}: ${reason}`),
    }),
  ]).process("p { font-size: 17px; line-height: normal }", { from: undefined });

  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!, /line-height normal/);
  assert.match(skipped[0]!, /browser/);
});

test("a size in a unit it cannot resolve is skipped and said out loud", {
  skip: !have,
}, async () => {
  const skipped: string[] = [];
  await postcss([
    quoinPostcss({
      fonts: { Built: LATO },
      defaultFont: "Built",
      onSkip: (selector, reason) => skipped.push(reason),
    }),
  ]).process("p { font-size: 1.0625rem; line-height: 1.5 }", { from: undefined });

  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!, /not a px length/);
});

test("a family with no font file is skipped and named", { skip: !have }, async () => {
  const skipped: string[] = [];
  await postcss([
    quoinPostcss({
      fonts: { Built: LATO },
      onSkip: (selector, reason) => skipped.push(reason),
    }),
  ]).process('p { font-family: "Nothing Here"; font-size: 17px; line-height: 1.5 }', {
    from: undefined,
  });

  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!, /no font file given for "nothing here"/);
});

test("a rule with no family and no default is skipped rather than guessed at", async () => {
  const skipped: string[] = [];
  await postcss([
    quoinPostcss({ fonts: {}, onSkip: (s, reason) => skipped.push(reason) }),
  ]).process("p { font-size: 17px; line-height: 1.5 }", { from: undefined });

  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!, /no font-family here and no defaultFont/);
});

/* ------------------------------------------------------------------ *
   Reading the family
 * ------------------------------------------------------------------ */

test("the family is matched on the first name in the stack", { skip: !have }, async () => {
  /* A stack is what a rule declares and the first name is what the browser
     resolves, which is where the cap height comes from. */
  const css = await run(
    "p { font-family: Built, Helvetica, sans-serif; font-size: 17px; " +
      "line-height: 1.5; margin-top: 24px }"
  );
  assert.match(css, /text-box-trim/);
});

test("quoted and differently-cased families still match", { skip: !have }, async () => {
  for (const family of ['"Built"', "'built'", "BUILT"]) {
    const css = await run(
      `p { font-family: ${family}; font-size: 17px; line-height: 1.5; margin-top: 24px }`
    );
    assert.match(css, /text-box-trim/, `${family} did not match`);
  }
});

/* ------------------------------------------------------------------ *
   The pitch
 * ------------------------------------------------------------------ */

test("a different pitch changes both the leading and the space", {
  skip: !have,
}, async () => {
  const css = await run("p { font-size: 17px; line-height: 1.5; margin-top: 24px }", {
    pitch: 4,
  });

  const leading = /line-height:\s*([\d.]+)px/.exec(css);
  assert.ok(leading);
  assert.equal(Number.parseFloat(leading![1]!) % 4, 0);

  const space = /margin-top:\s*([\d.]+)px/.exec(css);
  assert.ok(space);
  const closes = (Number.parseFloat(space![1]!) + CAP_17) % 4;
  assert.ok(Math.min(closes, 4 - closes) < 0.01);
});

test("a whole stylesheet keeps its shape", { skip: !have }, async () => {
  /* Nothing outside the rules it fits should move, including at-rules and
     declarations it has no opinion about. */
  const input = [
    "@media (min-width: 700px) {",
    "  p { font-size: 17px; line-height: 1.5; color: red; margin-top: 24px }",
    "}",
    ".untouched { color: blue }",
    "h1 { font-size: 44px; line-height: 1.1; margin-top: 48px }",
  ].join("\n");

  const css = await run(input);

  assert.match(css, /@media \(min-width: 700px\)/);
  assert.match(css, /color:\s*red/);
  assert.match(css, /\.untouched\s*\{\s*color:\s*blue\s*\}/);
  assert.equal((css.match(/text-box-trim/g) ?? []).length, 2, "both fitted rules got it");
});

/* ------------------------------------------------------------------ *
   Everything the fitter emits has to be CSS
 * ------------------------------------------------------------------ */

test("every stylesheet the fitter can emit parses", { skip: !have }, async () => {
  /*
     A malformed comment in emitted CSS is a build-breaking bug, and a string
     assertion will not see it: `toContain("margin-top")` passes happily on a
     stylesheet whose comment never closes.

     One did. Adding the note about columns to the margin form left the comment
     terminator before it rather than after, so every rule below became comment
     text and Vite failed with "Unknown word". Parsing the output is the only
     assertion that catches that shape of mistake, so it is made over every
     combination of the options that change what comes out.

     Writing this comment reproduced the bug, incidentally: the terminator was
     quoted in it as an example and ended the comment four lines early.
  */
  const { fitWith, fittedScaleToCss } = await import("../../src/fit-core.ts");

  const source = {
    capHeight: (_font: string, size: number) => size * RATIO,
    resolved: () => true,
  };

  const designs = [
    [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5 }] }],
    /* A leading that has to move, so the "leadings that moved" block is in it. */
    [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, leading: 25.5 }] }],
    /* A fluid step, which emits calc() and mod(). */
    [
      {
        role: "d",
        font: "serif",
        steps: [
          {
            name: "display",
            size: 40,
            leading: 64,
            space: 48,
            fluid: { min: 28, max: 56, preferred: "5vw" },
          },
        ],
      },
    ],
    /* A step carrying a selector, which emits rules rather than tokens. */
    [
      {
        role: "body",
        font: "serif",
        steps: [{ name: "p", size: 17, ratio: 1.5, selector: "p.body" }],
      },
    ],
  ];

  for (const design of designs) {
    for (const spaceProperty of ["margin", "padding"] as const) {
      for (const edge of ["cap alphabetic", "ex alphabetic"]) {
        const css = fittedScaleToCss(
          fitWith(design as never, source, { pitch: 8, spaceProperty, edge })
        );

        /* Balanced comments, checked separately because PostCSS is forgiving
           about some things and an unterminated comment swallows the rest of the
           file rather than throwing. */
        const opens = css.split("/" + "*").length - 1;
        const closes = css.split("*" + "/").length - 1;
        assert.equal(
          opens,
          closes,
          `unbalanced comments with ${spaceProperty} and ${edge}:\n${css}`
        );

        await assert.doesNotReject(
          () => postcss([]).process(css, { from: undefined }),
          `did not parse with ${spaceProperty} and ${edge}:\n${css}`
        );
      }
    }
  }
});

test("what the fitter emits survives the plugin that fits it", { skip: !have }, async () => {
  /* A project can reasonably do both, and the emitted tokens going through the
     plugin must not produce something neither of them meant. */
  const { fitWith, fittedScaleToCss } = await import("../../src/fit-core.ts");
  const css = fittedScaleToCss(
    fitWith(
      [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5 }] }] as never,
      { capHeight: (_f: string, s: number) => s * RATIO, resolved: () => true },
      { pitch: 8 }
    )
  );

  const out = await run(css);
  assert.match(out, /--size-p:\s*17px/, "the tokens survived");
  assert.doesNotMatch(out, /--quoin-space:\s*NaN/);
});
