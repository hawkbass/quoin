/* Walk a page set in a vertical writing mode and report every line that is not
   on the grid.

   This is the sibling of `verifyGrid`, and it is a much smaller function for the
   reason recorded in the README: vertically the dominant baseline is the central
   one, so it sits at exactly half the leading whatever the typeface. There is no
   font in the measurement. No cap height, no OS/2 table, no `text-box-trim` to
   account for, no rasteriser to distrust. Half the line-height, in from the
   block-start edge.

   It lives in its own module rather than as a branch inside `verify.ts` because
   of the console bundle's size budget, which at the time of writing has two
   bytes left in it. `verify.ts` is in that bundle. This is not, and it costs
   that bundle nothing. The CLI and the fitter bundle both carry it. */

import {
  bestOrigin,
  checkBaseline,
  gridConfig,
  summarise,
  type GridConfig,
  type GridReport,
  type GridResult,
} from "./grid.ts";
import { describe } from "./selector.ts";
import { walk, inShadowRoot as isInShadowRoot } from "./walk.ts";

/** The writing modes this measures. Horizontal pages belong to `verifyGrid`. */
const VERTICAL = new Set(["vertical-rl", "vertical-lr", "sideways-rl", "sideways-lr"]);

export interface VerticalNodeResult extends GridResult {
  /** A short readable path. Not unique: for reports, not for stylesheets. */
  path: string;
  /** First few words, so a human recognises it. */
  sample: string;
  fontSize: number;
  lineHeight: number;
  /** The mode this block was actually measured in. */
  writingMode: string;
  /** The leading in grid rows, fractional when it is not a whole number. */
  rows: number;
  inShadow: boolean;
}

export interface VerticalReport extends GridReport {
  /**
   * The parity of every whole-row leading on the page, and whether they agree.
   *
   * This is the vertical equivalent of the rhythm check, and it is the one
   * thing that goes wrong. Between one block's last baseline and the next
   * block's first lies `leadingA/2 + space + leadingB/2`, so two leadings of
   * the same parity leave a whole number of rows between them where one of each
   * leaves half a row over. All-even holds, all-odd holds, a mix does not.
   */
  parities: { even: number; odd: number; fractional: number };
  /** True when both parities occur, which is the failure this page can have. */
  mixedParity: boolean;
}

export interface VerifyVerticalOptions extends Omit<Partial<GridConfig>, "origin"> {
  /** Where the grid starts, in px, or `"auto"` to solve for it. */
  origin?: number | "auto";
  /** Root to walk. Defaults to `document.body`. */
  root?: Element;
  /** Skip elements matching these selectors, and everything inside them. */
  ignore?: string[];
  /** Descend into open shadow roots. On by default. */
  crossShadow?: boolean;
}

export interface VerifyVerticalResult {
  results: VerticalNodeResult[];
  report: VerticalReport;
  grid: GridConfig;
  closedShadowRoots: number;
  frames: number;
  originSolved: boolean;
  /**
   * Blocks skipped because they are set horizontally.
   *
   * Reported rather than silently dropped. A page with one vertical column in
   * it would otherwise come back as a perfect vertical page, and the number
   * would be true about the part somebody was not asking about.
   */
  skippedHorizontal: number;
}

/**
 * Measure a page set in `vertical-rl` or `vertical-lr` against a grid.
 *
 * Only the first line of each block is checked, for the same reason as the
 * horizontal walk: every subsequent line sits one leading further in, so a
 * block whose leading is a whole number of rows has all of them seated once the
 * first one is.
 */
export function verifyVertical(
  options: VerifyVerticalOptions = {}
): VerifyVerticalResult {
  const solveOrigin = options.origin === "auto" || options.origin === undefined;
  const grid = gridConfig({
    ...options,
    origin: typeof options.origin === "number" ? options.origin : 0,
  });

  const root = options.root ?? document.body;
  const shared = {
    ignore: options.ignore ?? [],
    crossShadow: options.crossShadow,
  };
  const walked = walk(root, { ...shared, vertical: true });

  /*
     A second walk, for the blocks this one cannot measure.

     Without it, pointing this at an ordinary horizontal page returns nothing
     measured, and nothing measured averages to a perfect score over an empty
     set. That is the shape of defect this project keeps finding in itself: an
     answer true about a part and false about the thing somebody would act on.
     So the horizontal blocks are counted and reported rather than passed over,
     and a caller can tell an unmeasurable page from a seated one.

     It costs a second traversal. `verifyGrid` reads font metrics per block and
     this reads none, so the vertical check does less work in total even having
     walked twice.
  */
  const skippedHorizontal = walk(root, { ...shared, vertical: false }).blocks.length;

  const results: VerticalNodeResult[] = [];

  for (const el of walked.blocks) {
    const style = getComputedStyle(el);
    const mode = style.writingMode || "horizontal-tb";
    /* The walk filters by axis, so this only catches an explicitly named root,
       which the walk hands back unfiltered on purpose. */
    if (!VERTICAL.has(mode)) continue;

    /* One rect per fragment. Vertically a fragment is a column of the multicol
       or a page of the print flow, exactly as horizontally, and only the first
       one carries the block's own border and padding because
       `box-decoration-break` defaults to `slice`. */
    const fragments = [...el.getClientRects()].filter((r) => r.width > 0);
    if (fragments.length === 0) continue;

    const fontSize = Number.parseFloat(style.fontSize);
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2;

    /* The whole measurement. Half the leading, and nothing else.

       `text-box-trim` is not consulted and does not need to be: it trims to a
       text edge, every text edge it can name is defined relative to the
       alphabetic or ideographic baseline, and neither of those is the baseline
       a vertical line box aligns on. A trimmed vertical block and an untrimmed
       one put their first baseline in the same place. */
    const within = lineHeight / 2;

    /* Block-start is the right edge in the -rl modes and the left edge in -lr,
       so the border and padding to step over are the ones on that side. */
    const rightward = mode === "vertical-lr" || mode === "sideways-lr";
    const borderStart =
      Number.parseFloat(rightward ? style.borderLeftWidth : style.borderRightWidth) || 0;
    const padStart =
      Number.parseFloat(rightward ? style.paddingLeft : style.paddingRight) || 0;

    const path = describe(el);
    const sample = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const rows = lineHeight / grid.pitch;

    for (const [index, fragment] of fragments.entries()) {
      const leading = index === 0 ? borderStart + padStart : 0;

      /* Document space on the inline axis, so scroll position does not enter
         the measurement. In the -rl modes the block runs leftwards from its
         right edge, so the baseline is that much less than `right`. */
      const absolute = rightward
        ? fragment.left + window.scrollX + leading + within
        : fragment.right + window.scrollX - leading - within;

      results.push({
        ...checkBaseline(absolute, grid),
        path: fragments.length > 1 ? `${path} [fragment ${index + 1}]` : path,
        sample,
        fontSize,
        lineHeight,
        writingMode: mode,
        rows,
        inShadow: isInShadowRoot(el),
      });
    }
  }

  let used = grid;
  if (solveOrigin && results.length > 0) {
    const solved = bestOrigin(
      results.map((r) => r.baseline),
      grid
    );
    used = { ...grid, origin: solved.origin };
    for (const result of results) {
      Object.assign(result, checkBaseline(result.baseline, used));
    }
  }

  /* Counted per distinct leading rather than per block, so a page with one
     heading and four hundred paragraphs is not reported as unanimous. */
  const parities = { even: 0, odd: 0, fractional: 0 };
  for (const leading of new Set(results.map((r) => r.lineHeight))) {
    const rows = leading / used.pitch;
    if (!Number.isInteger(rows)) parities.fractional++;
    else if (rows % 2 === 0) parities.even++;
    else parities.odd++;
  }

  return {
    results,
    report: {
      ...summarise(results),
      parities,
      mixedParity: parities.even > 0 && parities.odd > 0,
    },
    grid: used,
    closedShadowRoots: walked.closedShadowRoots,
    frames: walked.frames,
    originSolved: solveOrigin,
    skippedHorizontal,
  };
}
