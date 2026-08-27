/* Fitting a design to a grid without changing the design.

   This is the part of the library that makes the rest of it unnecessary, and it
   took three wrong models to arrive at.

   ## What the corrections could never do

   Everything else here measures a rendered page and pushes each block into
   place. That produces a list of absolute pixel nudges which describe one
   arrangement of line breaks, and measured across widths the failure is precise
   rather than general: a page seated at 1280 and carried to 375 held at 100%
   when only the line breaks had moved, and collapsed to 0% when a media query
   changed a container's padding by thirteen pixels. Corrections survive reflow
   and do not survive a layout change, which is exactly the case every real site
   has.

   ## What the scale solver could not do either

   `gridNativeScale` solves sizes whose phase agrees, so one grid origin serves
   the page. It works, and it charges for it: solved sizes sit about eleven
   pixels apart for a text face on an 8px grid, so a design asking for 17 and 21
   can have one of them. Fitting three families to one shared phase was worse
   again, because each family has its own cap height per em and the compromise
   compounds. A first version of this file moved a 17px body to 20.5 and a 15px
   mono to 10.5, which is not fitting a design to a grid, it is replacing it.

   ## What is actually required

   Work out the distance between two consecutive baselines across a block
   boundary, with the boxes trimmed:

       baseline(B) - baseline(A) = (lines(A) - 1) x leading(A) + space(B) + cap(B)

   `lines(A)` is the only term that changes with the viewport, and it is
   multiplied by a leading that is already a whole number of rows, so it
   contributes nothing modulo the pitch. What is left is

       space(B) + cap(B) = 0  (mod pitch)

   and every term in it belongs to block B alone. There is no constraint
   relating one size to another, which means the shared phase was never
   necessary and the sizes are free.

   So a design keeps its sizes exactly. The leading is snapped to a whole number
   of rows, which is the one compromise, and it is the compromise a typographer
   already makes: ticking "align to baseline grid" in InDesign changes the
   leading and nothing else. The space before each block is then solved to close
   that block's own cap residue.

   Measured on a page with sizes 44, 27, 17 and 13.5, none of them solved for
   anything: on the grid at nine widths from 320 to 1440, with one stylesheet,
   no media queries, no corrections, and no size moved by so much as a tenth of
   a pixel.

   ## What it is for

   A person has a design and wants the CSS that puts it on a grid. They get
   their own sizes back, a leading that may have moved, and the spacing that
   makes it hold.

   An agent has the same problem from a Figma file or a screenshot and no person
   in the loop. Everything here is data in and data out, including what changed
   and by how much, so the agent can decide whether a leading moving from 25.5
   to 24 is acceptable and say so rather than guess. */

import { gridConfig, type GridConfig } from "./grid.ts";
import {
  capHeightFromFontTable,
  canReadFontTableCapHeight,
  fontIsAvailable,
  measureFont,
} from "./metrics.ts";

/** One size in a design, as the design states it. */
export interface DesignStep {
  /** What the design calls it: `body`, `lg`, `heading-2`. */
  name?: string;
  /** The size, in px. Never changed. */
  size: number;
  /** The leading, in px. Snapped to a whole number of rows. */
  leading?: number;
  /** The leading as a multiple of the size, if that is how the design says it. */
  ratio?: number;
  /** The space the design wants before a block of this size, in px. */
  space?: number;
}

export interface FamilyRequest {
  /** What this family is for: `display`, `body`, `mono`. */
  role: string;
  /** The CSS family, exactly as it will be set on the page. */
  font: string;
  steps: DesignStep[];
}

export interface FittedStep {
  name: string;
  /** The design's size, unchanged. */
  size: number;
  /** The leading, snapped to a whole number of rows. */
  leading: number;
  /** What the design asked for, and whether that had to move. */
  leadingWas: number;
  leadingMoved: number;
  /** Rows the leading spans. */
  rows: number;
  /** The space to set before a block of this size, in px. */
  space: number;
  spaceWas: number;
  spaceMoved: number;
  /** This size's cap height, and how far past a row it falls. */
  cap: number;
  residue: number;
}

export interface FittedFamily {
  role: string;
  font: string;
  /**
   * False when the family did not render, so these figures describe a fallback.
   *
   * Checked on the first name in the stack rather than on the whole stack: a
   * probe for "Georgia, serif" asks whether a font called `Georgia, serif`
   * exists, which nothing is, and reports every design as unresolved.
   */
  resolved: boolean;
  steps: FittedStep[];
}

export interface FittedScale {
  grid: GridConfig;
  /**
   * Where the grid starts, in px.
   *
   * Zero, and that is a result rather than a default. Every block carries a
   * space before it that closes its own cap residue, including the first one on
   * the page, so the first baseline lands on a row measured from the top of the
   * document and every baseline after it follows.
   */
  origin: number;
  families: FittedFamily[];
  /**
   * How far the design had to move, in px, summed over every leading.
   *
   * Sizes never move, so this is entirely leading. Zero means the design was
   * already on whole rows and nothing was compromised at all.
   */
  cost: number;
  /** True when this engine cannot read a font table's cap height. */
  unavailable: boolean;
}

/** The first family in a stack, unquoted. */
function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? stack).replace(/^["']|["']$/g, "").trim();
}

const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|math|emoji)$/i;

/**
 * Fit a design to a grid, keeping every size exactly as the design states it.
 *
 * Runs in the browser, because the only trustworthy source of font metrics is
 * the font the browser actually resolved. Metrics read from a font file
 * describe the font that was asked for rather than the one that loaded, and
 * those come apart precisely when it matters, which is when a webfont failed.
 */
export function fitScale(
  families: readonly FamilyRequest[],
  options: Partial<GridConfig> = {}
): FittedScale {
  const grid = gridConfig(options);
  const pitch = grid.pitch;

  if (!canReadFontTableCapHeight()) {
    return {
      grid,
      origin: 0,
      families: families.map((f) => ({
        role: f.role,
        font: f.font,
        resolved: false,
        steps: [],
      })),
      cost: 0,
      unavailable: true,
    };
  }

  let cost = 0;

  const fitted = families.map((family): FittedFamily => {
    const first = firstFamily(family.font);
    const resolved = GENERIC.test(first) ? true : fontIsAvailable(first);

    const steps = family.steps.map((step, index): FittedStep => {
      /*
         The cap height at this exact size. Read through the trim probe rather
         than scaled from a measurement at 400px: the probe is what the engine
         will actually do to the box, and a value scaled from elsewhere would be
         a prediction of it.
      */
      const cap = capHeightFromFontTable(`${step.size}px ${family.font}`) ?? 0;

      /*
         The leading, snapped up or down to the nearest whole number of rows.
         This is the only thing in a design that has to move, and it is the same
         thing InDesign moves when a paragraph is set to align to the grid.
      */
      const wantedLeading =
        step.leading ??
        (step.ratio ? step.size * step.ratio : step.size * 1.5);
      const rows = Math.max(1, Math.round(wantedLeading / pitch));
      const leading = rows * pitch;

      /*
         The space before, chosen so that space + cap is a whole number of rows.
         Nearest to what the design wanted rather than smallest: a page whose
         paragraphs sit five pixels apart satisfies the arithmetic and is
         useless.
      */
      const residue = ((cap % pitch) + pitch) % pitch;
      const wantedSpace = step.space ?? leading;
      const multiples = Math.max(1, Math.round((wantedSpace + residue) / pitch));
      const space = Math.round((multiples * pitch - residue) * 1000) / 1000;

      const leadingMoved = Math.round((leading - wantedLeading) * 1000) / 1000;
      cost += Math.abs(leadingMoved);

      return {
        name: step.name ?? `${family.role}-${index + 1}`,
        size: step.size,
        leading,
        leadingWas: Math.round(wantedLeading * 1000) / 1000,
        leadingMoved,
        rows,
        space,
        spaceWas: Math.round(wantedSpace * 1000) / 1000,
        spaceMoved: Math.round((space - wantedSpace) * 1000) / 1000,
        cap: Math.round(cap * 1000) / 1000,
        residue: Math.round(residue * 1000) / 1000,
      };
    });

    return { role: family.role, font: family.font, resolved, steps };
  });

  return {
    grid,
    origin: 0,
    families: fitted,
    cost: Math.round(cost * 1000) / 1000,
    unavailable: false,
  };
}

/**
 * A fitted design as CSS.
 *
 * Custom properties per step, the trim that the arithmetic assumes, and nothing
 * else. There are no media queries in it and nothing to regenerate when the
 * copy changes, because none of it describes an arrangement of line breaks.
 */
export function fittedScaleToCss(fitted: FittedScale): string {
  if (fitted.unavailable) {
    return [
      "/* Nothing was fitted.",
      " *",
      " * Fitting reads each size's cap height through a text-box-trim probe, and",
      " * this engine does not support it. Chrome 133, Safari 18.2 or Firefox 154.",
      " */",
    ].join("\n");
  }

  const lines: string[] = [
    `/* Fitted by quoin to a ${fitted.grid.pitch}px baseline grid.`,
    " *",
    " * Every size below is the size the design asked for. Nothing was moved to",
    " * make the arithmetic work, because nothing needed to be: the only",
    " * requirement is that each block's space closes its own cap height, and",
    " * that is what --space-* does.",
    " *",
    " * This holds at every width. The only width-dependent term is how many",
    " * lines a block wraps to, and that is multiplied by a leading which is",
    " * already a whole number of rows, so it contributes nothing to the grid.",
  ];

  const moved = fitted.families.flatMap((f) =>
    f.steps.filter((s) => s.leadingMoved !== 0).map((s) => `${s.name} ${s.leadingWas} to ${s.leading}`)
  );
  if (moved.length) {
    lines.push(
      " *",
      " * Leadings that moved, which is the one thing fitting changes:",
      ...moved.map((m) => ` *   ${m}`)
    );
  }

  const unresolved = fitted.families.filter((f) => !f.resolved);
  if (unresolved.length) {
    lines.push(
      " *",
      ` * WARNING: ${unresolved.map((f) => f.font).join("; ")} did not render, so`,
      " * those figures describe a fallback. Load the fonts and fit again.",
    );
  }

  lines.push(" */", ":root {", `  --pitch: ${fitted.grid.pitch}px;`);

  for (const family of fitted.families) {
    lines.push("", `  /* ${family.role}: ${family.font} */`);
    for (const step of family.steps) {
      lines.push(
        `  --size-${step.name}: ${step.size}px;`,
        `  --leading-${step.name}: ${step.leading}px;` +
          (step.leadingMoved === 0 ? "" : `  /* was ${step.leadingWas} */`),
        `  --space-${step.name}: ${step.space}px;  /* closes a ${step.residue}px cap residue */`
      );
    }
  }

  lines.push(
    "}",
    "",
    "/* Required. Every figure above assumes the box is trimmed to its cap",
    " * height at the top and its baseline at the bottom. */",
    ":is(p, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, figcaption, td, th) {",
    "  text-box-trim: trim-both;",
    "  text-box-edge: cap alphabetic;",
    "}",
    "",
    "/* Set --space-* as margin-top, never margin-bottom: the space closes the",
    " * cap height of the block it comes before, not the one it follows. */"
  );

  return lines.join("\n");
}
