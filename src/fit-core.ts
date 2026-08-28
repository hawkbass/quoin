/* The fitting arithmetic, with nothing in it that needs a browser.

   Split out from `fit.ts` so the same solve can be driven two ways: in a page,
   where cap heights come from a `text-box-trim` probe on the font the browser
   actually resolved, and in Node, where they come from the OS/2 table of a font
   file. Those two agree, which is the finding that makes the second one
   permissible: across 130 fonts the browsers matched the file to a worst case of
   0.022px.

   Splitting it also means the arithmetic is testable without a browser, which it
   was not before. The claim this whole library now rests on is a modular
   equation, and a modular equation deserves to be checked against hand-computed
   cases in a unit test rather than only through nine viewport widths. */

import { gridConfig, type GridConfig } from "./grid.ts";

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
  /**
   * A selector that matches exactly the blocks this step was read from.
   *
   * Set by `inferDesign` when it can find one and verify it, so the emitted CSS
   * can be rules somebody applies rather than tokens somebody wires up. Null
   * when no simple selector matches the group exactly, because a selector that
   * is nearly right silently styles the wrong blocks.
   */
  selector?: string | null;
  /**
   * A size that varies with the viewport, as `clamp()` arguments.
   *
   * `size` stays the nominal figure, used for the leading and for reporting.
   * When this is present the emitted CSS sets the size fluidly and makes the
   * space follow it, so the block stays on the grid at every width rather than
   * only at the two ends.
   *
   * The leading cannot be fluid, and that is not a limitation of this tool. A
   * leading has to be a whole number of rows or the second line of every
   * paragraph is off the grid, and there is no continuum of whole numbers.
   */
  fluid?: { min: number; max: number; preferred: string };
}

export interface FamilyRequest {
  /** What this family is for: `display`, `body`, `mono`. */
  role: string;
  /** The CSS family, exactly as it will be set on the page. */
  font: string;
  steps: DesignStep[];
  /**
   * The font file this family is set in, when there is one.
   *
   * Carried through so a design read from JSON can be fitted without a browser.
   * Ignored by the in-page fitter, which measures what actually rendered.
   */
  file?: string;
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
  /** The selector this step was read from, when there was one. */
  selector?: string | null;
  /**
   * Cap height per em for this family, when the size is fluid.
   *
   * A fluid size has no single cap height, so the CSS carries the ratio and
   * computes the space from it with `mod()`. Absent for a fixed size, where the
   * space is a number and needs no arithmetic at runtime.
   */
  capRatio?: number;
  fluid?: { min: number; max: number; preferred: string };
}

export interface FittedFamily {
  role: string;
  font: string;
  /** False when the family did not render, so these describe a fallback. */
  resolved: boolean;
  steps: FittedStep[];
}

export interface FittedScale {
  grid: GridConfig;
  /**
   * The `text-box-edge` every figure was measured against.
   *
   * `cap alphabetic` by default, which is a Latin assumption and the right
   * default for Latin text. A Japanese page grids to the ideographic em instead,
   * and the emitted CSS has to carry whichever was used or the boxes are not the
   * boxes the spacing was solved for.
   */
  edge: string;
  /**
   * Which property carries the space: `margin` or `padding`.
   *
   * `margin` by default, because it is what a stylesheet usually already uses
   * and changing it alters nothing about the box.
   *
   * `padding` is what survives a column break. css-break-3 truncates a margin
   * at the top of a fragment when the break is unforced, so a fitted page that
   * reads 12 of 12 in one column reads 6 of 12 in two; padding is not
   * truncated, and with it the page reads 12 of 12 across two, three and four.
   *
   * WebKit needs one thing more, because a paragraph that is itself split
   * across the boundary starts its continuation off the grid. `break-inside:
   * avoid` on the blocks prevents the split and takes both engines to 12 of 12
   * at every width and column count tested.
   *
   * On a block with a background or a border the two are not interchangeable,
   * which is why this is a decision rather than a default.
   */
  spaceProperty: "margin" | "padding";
  /**
   * Whether the emitted rules carry `break-inside: avoid`.
   *
   * Off by default, because it is a fragmentation decision rather than a
   * typographic one and it changes how the page prints whether or not it has
   * columns. On, together with `spaceProperty: "padding"`, it is the whole
   * recipe: two, three and four columns read 12 of 12 in both engines at every
   * width tested.
   *
   * It is stated rather than inferred. Emitting it because a page might have
   * columns would be this library changing pagination behind somebody's back.
   */
  columns: boolean;
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
  /** True when no source of cap heights was available. */
  unavailable: boolean;
}

/**
 * Where the cap heights come from.
 *
 * Returns null when this family's cap height cannot be established, which is a
 * different thing from zero and has to stay different: a font with no declared
 * cap height cannot be fitted, and guessing one from the ascender would put
 * every baseline on the wrong row while looking like it had worked.
 */
export interface CapSource {
  /** The cap height for a family at a size, in px, or null. */
  capHeight(font: string, size: number): number | null;
  /** Whether the family rendered, for the warning in the output. */
  resolved(font: string): boolean;
}

/**
 * The space before a block that puts the next baseline on a row.
 *
 * Derived once, here, because it is the whole method. With the boxes trimmed,
 * the distance between two consecutive baselines across a block boundary is
 *
 *     (lines(A) - 1) x leading(A) + space(B) + cap(B)
 *
 * `lines(A)` is the only term that changes with the viewport, and it is
 * multiplied by a leading that is a whole number of rows, so modulo the pitch
 * what remains is `space(B) + cap(B)`. Every term in that belongs to block B by
 * itself, which is why sizes do not have to agree with each other.
 *
 * Nearest to what was wanted rather than smallest: a page whose paragraphs sit
 * five pixels apart satisfies the arithmetic and is useless.
 */
export function spaceFor(cap: number, wanted: number, pitch: number): number {
  const residue = ((cap % pitch) + pitch) % pitch;
  const multiples = Math.max(1, Math.round((wanted + residue) / pitch));
  return Math.round((multiples * pitch - residue) * 1000) / 1000;
}

/** The leading a design asked for, snapped to a whole number of rows. */
export function leadingFor(step: DesignStep, pitch: number): { leading: number; wanted: number } {
  const wanted = step.leading ?? (step.ratio ? step.size * step.ratio : step.size * 1.5);
  const rows = Math.max(1, Math.round(wanted / pitch));
  return { leading: rows * pitch, wanted };
}

/**
 * Fit a design to a grid, keeping every size exactly as the design states it.
 *
 * The one thing that changes is the leading, snapped to the nearest whole number
 * of rows, and it is reported to a thousandth of a pixel so the decision to
 * accept it belongs to whoever has to live with it. That is also the compromise
 * a typographer already makes: ticking "align to baseline grid" in InDesign
 * changes the leading and nothing else.
 */
export function fitWith(
  families: readonly FamilyRequest[],
  source: CapSource,
  options: Partial<GridConfig> & {
    edge?: string;
    spaceProperty?: "margin" | "padding";
    columns?: boolean;
  } = {}
): FittedScale {
  const grid = gridConfig(options);
  const pitch = grid.pitch;
  const edge = options.edge ?? "cap alphabetic";
  const spaceProperty = options.spaceProperty ?? "margin";
  const columns = options.columns ?? false;

  let cost = 0;
  let anyCap = false;

  const fitted = families.map((family): FittedFamily => {
    const steps: FittedStep[] = [];

    family.steps.forEach((step, index) => {
      const cap = source.capHeight(family.font, step.size);
      if (cap === null || cap <= 0) return;
      anyCap = true;

      const { leading, wanted } = leadingFor(step, pitch);
      const wantedSpace = step.space ?? leading;
      const space = spaceFor(cap, wantedSpace, pitch);
      const leadingMoved = Math.round((leading - wanted) * 1000) / 1000;
      cost += Math.abs(leadingMoved);

      steps.push({
        name: step.name ?? `${family.role}-${index + 1}`,
        size: step.size,
        leading,
        leadingWas: Math.round(wanted * 1000) / 1000,
        leadingMoved,
        rows: leading / pitch,
        space,
        spaceWas: Math.round(wantedSpace * 1000) / 1000,
        spaceMoved: Math.round((space - wantedSpace) * 1000) / 1000,
        cap: Math.round(cap * 1000) / 1000,
        residue: Math.round((((cap % pitch) + pitch) % pitch) * 1000) / 1000,
        /* Cap height is linear in the size, so the ratio taken at the nominal
           size holds across the whole fluid range. */
        ...(step.fluid
          ? { fluid: step.fluid, capRatio: Math.round((cap / step.size) * 100000) / 100000 }
          : {}),
        ...(step.selector ? { selector: step.selector } : {}),
      });
    });

    return {
      role: family.role,
      font: family.font,
      resolved: source.resolved(family.font),
      steps,
    };
  });

  return {
    grid,
    edge,
    spaceProperty,
    columns,
    origin: 0,
    families: fitted,
    cost: Math.round(cost * 1000) / 1000,
    unavailable: !anyCap && families.some((f) => f.steps.length > 0),
  };
}

/**
 * A fitted design as CSS.
 *
 * Custom properties per step, the trim the arithmetic assumes, and nothing else.
 * There are no media queries in it and nothing to regenerate when the copy
 * changes, because none of it describes an arrangement of line breaks.
 */
export function fittedScaleToCss(fitted: FittedScale): string {
  if (fitted.unavailable) {
    return [
      "/* Nothing was fitted.",
      " *",
      " * Fitting needs each size's cap height. In a browser that means",
      " * text-box-trim, which is Chrome 133, Safari 18.2 or Firefox 154. From a",
      " * font file it means an OS/2 table at version 2 or later, which older",
      " * fonts do not have.",
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

  if (fitted.edge !== "cap alphabetic") {
    lines.push(
      " *",
      ` * Measured against text-box-edge: ${fitted.edge}, not the default cap`,
      " * alphabetic. Cap height is a Latin idea and this design is not being set",
      " * in Latin, so the boxes below are the ones that edge produces."
    );
  }

  const moved = fitted.families.flatMap((f) =>
    f.steps
      .filter((s) => s.leadingMoved !== 0)
      .map((s) => `${s.name} ${s.leadingWas} to ${s.leading}`)
  );
  if (moved.length) {
    lines.push(
      " *",
      " * Leadings that moved, which is the one thing fitting changes:",
      ...moved.map((m) => ` *   ${m}`)
    );
  }

  const fluid = fitted.families.flatMap((f) => f.steps.filter((s) => s.fluid));
  if (fluid.length) {
    lines.push(
      " *",
      " * Some sizes are fluid. Their space is computed from the size with mod()",
      " * rather than written down, so they stay on the grid across the whole",
      " * range instead of only at its two ends. The leading cannot be fluid: it",
      " * has to be a whole number of rows or the second line of every paragraph",
      " * is off the grid, and there is no continuum of whole numbers."
    );
  }

  const unresolved = fitted.families.filter((f) => !f.resolved);
  if (unresolved.length) {
    lines.push(
      " *",
      ` * WARNING: ${unresolved.map((f) => f.font).join("; ")} did not render, so`,
      " * those figures describe a fallback. Load the fonts and fit again."
    );
  }

  lines.push(" */", ":root {", `  --pitch: ${fitted.grid.pitch}px;`);

  for (const family of fitted.families) {
    if (!family.steps.length) continue;
    lines.push("", `  /* ${family.role}: ${family.font} */`);
    for (const step of family.steps) {
      if (step.fluid) {
        /*
           A fluid size has no single cap height, so the space cannot be a
           number. It is computed from the size at runtime instead:

               space = N x pitch - mod(size x capRatio, pitch)

           which is the same arithmetic as the fixed case with the cap height
           left as an expression. `mod()` is CSS Values 4 and is supported
           wherever `text-box-trim` is, so a page that can use one can use both.
        */
        const rows = Math.max(1, Math.round(step.space / fitted.grid.pitch));
        lines.push(
          `  --size-${step.name}: clamp(${step.fluid.min}px, ${step.fluid.preferred}, ${step.fluid.max}px);`,
          `  --leading-${step.name}: ${step.leading}px;` +
            (step.leadingMoved === 0 ? "" : `  /* was ${step.leadingWas} */`),
          `  --cap-${step.name}: calc(var(--size-${step.name}) * ${step.capRatio});`,
          `  --space-${step.name}: calc(${rows} * var(--pitch) - mod(var(--cap-${step.name}), var(--pitch)));`
        );
      } else {
        lines.push(
          `  --size-${step.name}: ${step.size}px;`,
          `  --leading-${step.name}: ${step.leading}px;` +
            (step.leadingMoved === 0 ? "" : `  /* was ${step.leadingWas} */`),
          `  --space-${step.name}: ${step.space}px;  /* closes a ${step.residue}px cap residue */`
        );
      }
    }
  }

  lines.push("}");

  /*
     Rules, when the design came off a real page and a selector could be checked
     against it. Handing back custom properties and leaving somebody to wire
     them up is a strange thing to do when the tool is holding the very elements
     it read them from.
  */
  const steps = fitted.families.flatMap((f) => f.steps);
  const addressable = steps.filter((s) => s.selector);

  if (addressable.length) {
    lines.push(
      "",
      "/* Read off the page, so these are the blocks the figures came from.",
      ` * Space is ${fitted.spaceProperty}-top, and before rather than after: it`,
      " * closes the cap height of the block it comes before. */"
    );
    for (const step of addressable) {
      lines.push(
        `${step.selector} {`,
        `  font-size: var(--size-${step.name});`,
        `  line-height: var(--leading-${step.name});`,
        `  ${fitted.spaceProperty}-top: var(--space-${step.name});`,
        ...(fitted.spaceProperty === "margin" ? ["  margin-bottom: 0;"] : []),
        ...(fitted.columns ? ["  break-inside: avoid;"] : []),
        "  text-box-trim: trim-both;",
        `  text-box-edge: ${fitted.edge};`,
        "}"
      );
    }

    const unaddressed = steps.filter((s) => !s.selector);
    if (unaddressed.length) {
      lines.push(
        "",
        "/* No single selector matched these exactly, so they are tokens only:",
        ` * ${unaddressed.map((s) => s.name).join(", ")}.`,
        " * A selector that is nearly right styles the wrong blocks, so none is",
        " * guessed at. */"
      );
    }
  } else {
    lines.push(
      "",
      "/* Required. Every figure above assumes the box is trimmed to its cap",
      " * height at the top and its baseline at the bottom. */",
      ":is(p, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, figcaption, td, th) {",
      "  text-box-trim: trim-both;",
      `  text-box-edge: ${fitted.edge};`,
      "}",
      "",
      `/* Set --space-* as ${fitted.spaceProperty}-top, and before rather than after:`,
      " * the space closes the cap height of the block it comes before, not the one",
      " * it follows.",
      ...(fitted.spaceProperty === "margin"
        ? [
            " *",
            " * Use padding-top instead if the page has columns. A margin at the top of",
            " * a column fragment is truncated, which takes a fitted page from 12 of 12",
            " * to 6 of 12 across two columns; padding survives it.",
          ]
        : [
            " *",
            fitted.columns
              ? " * Set break-inside: avoid on them too, which is the other half of columns."
              : " * For columns, add break-inside: avoid to the blocks as well.",
            " * Padding alone holds in Chromium; WebKit puts a paragraph split across the",
            " * boundary off the grid, and not splitting one is the fix. With both, two,",
            " * three and four columns read 12 of 12 in either engine.",
          ]),
      " */"
    );
  }

  return lines.join("\n");
}
