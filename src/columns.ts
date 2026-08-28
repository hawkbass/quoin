/* The other axis.

   A baseline grid is a vertical rhythm inside a column grid, and everything else
   in this library is the vertical half. The horizontal half is the one a
   designer usually means by "the grid": a page divided into N columns with a
   gutter between them, and every block's edges landing on one of the divisions.

   It has the same shape of defect as the vertical, and for the same reason. A
   leading of 25.5px cannot land on an 8px row, and a module of 341.33px cannot
   land on anything: divide 1104px into three columns with 40px gutters and the
   second column starts at 469.33 and the third at 850.67. Every edge after the
   first is fractional, and no amount of care about the markup fixes it, because
   the arithmetic was decided by the container width.

   So this measures the module rather than the markup, and the fix it offers is
   the container width that makes the module whole. */

import { walk } from "./walk.ts";
import { describe, uniqueSelector } from "./selector.ts";

export interface ColumnOptions {
  root?: Element;
  ignore?: string[];
  crossShadow?: boolean;
  /** How many columns. Solved from the page when absent. */
  columns?: number;
  /** The gutter between columns, in px. Solved from the page when absent. */
  gutter?: number;
  /** How far off an edge may be and still count, in px. */
  tolerance?: number;
  /** Stop after this many issues. */
  limit?: number;
}

export interface ColumnEdge {
  path: string;
  selector: string | null;
  sample: string;
  /** Distance from the container's left edge, in px. */
  left: number;
  right: number;
  /** How far the nearer of the two is from a column boundary, in px. */
  off: number;
  /** Which edge missed: left, right, or both. */
  which: "left" | "right" | "both";
}

export interface ColumnReport {
  /** The content column every measurement is relative to. */
  container: { left: number; width: number; blocks: number };
  columns: number;
  gutter: number;
  /** The width of one column, in px. */
  module: number;
  /**
   * Whether the module is a whole number of pixels.
   *
   * The horizontal equivalent of a leading that is a whole number of rows. A
   * fractional module puts every division after the first on a fraction, and
   * nothing downstream can recover it.
   */
  moduleWhole: boolean;
  /** Blocks measured, and how many have both edges on a division. */
  total: number;
  aligned: number;
  issues: ColumnEdge[];
  /**
   * Container widths within a few px of this one that divide evenly.
   *
   * The fix, stated as a number rather than as advice. Empty when the module is
   * already whole.
   */
  widthsThatDivide: number[];
  /** True when the columns and gutter were solved rather than given. */
  solved: boolean;
}

function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How far `value` is from the nearest of `positions`. */
function distanceTo(value: number, positions: readonly number[]): number {
  let best = Infinity;
  for (const position of positions) {
    const away = Math.abs(value - position);
    if (away < best) best = away;
  }
  return best;
}

/** Where each column starts and ends, relative to the container's left edge. */
function divisions(columns: number, module: number, gutter: number) {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < columns; i++) {
    const start = i * (module + gutter);
    starts.push(start);
    ends.push(start + module);
  }
  return { starts, ends };
}

interface Measured {
  el: Element;
  left: number;
  right: number;
  width: number;
}

/*
   The gutter, measured rather than assumed.

   Two blocks side by side have a gap between them, and the commonest such gap is
   the gutter the page was built with. Taking it from the page rather than asking
   for it means a report can be produced for a site whose grid nobody wrote down,
   which is most of them.
*/
function solveGutter(blocks: readonly Measured[]): number {
  const gaps = new Map<number, number>();

  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue;
      const gap = px(blocks[j]!.left - blocks[i]!.right);
      /* Adjacent, not distant: a gutter is small next to a column. */
      if (gap <= 0 || gap > 120) continue;
      gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
    }
  }

  if (gaps.size === 0) return 0;
  return [...gaps.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * Measure a page against a column grid.
 *
 * The columns and the gutter are solved from the page when they are not given,
 * because a report you can only produce for a site whose grid you already know
 * is a report for the person who needs it least.
 */
export function verifyColumns(options: ColumnOptions = {}): ColumnReport {
  const root = options.root ?? document.body;
  const tolerance = options.tolerance ?? 1;
  const limit = options.limit ?? 40;

  const walked = walk(root, {
    ignore: options.ignore ?? [],
    crossShadow: options.crossShadow,
  });

  const all: Measured[] = [];
  for (const el of walked.blocks) {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    all.push({ el, left: px(box.left), right: px(box.right), width: px(box.width) });
  }

  if (all.length === 0) {
    return {
      container: { left: 0, width: 0, blocks: 0 },
      columns: options.columns ?? 1,
      gutter: options.gutter ?? 0,
      module: 0,
      moduleWhole: true,
      total: 0,
      aligned: 0,
      issues: [],
      widthsThatDivide: [],
      solved: options.columns === undefined,
    };
  }

  /*
     The container is the content column, taken as the commonest left edge and
     the commonest right edge rather than as the widest box on the page. A
     full-bleed header is wider than the measure and is not what the grid is
     divided across.
  */
  /*
     Edges counted in whole pixels, and reported as they were measured.

     Subpixel layout produces 1104 and 1103.98 for the same edge, constantly,
     and counted as written they are two edges with one use each rather than one
     with two. A five-block fixture on a 1104px container came out as a 722.66px
     container for exactly that reason: the real container edge appeared twice
     and neither spelling of it reached a count of two.
  */
  const commonest = (values: number[], pick: (a: number, b: number) => number): number => {
    const buckets = new Map<number, { count: number; values: number[] }>();
    for (const value of values) {
      const key = Math.round(value);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count++;
        bucket.values.push(value);
      } else {
        buckets.set(key, { count: 1, values: [value] });
      }
    }

    const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
    const most = ranked[0]!.count;

    /*
       On a tie, outward. The container is the extent of the content column, so
       where two edges are used equally often the further one is the one the
       column reaches.
    */
    return ranked
      .filter((bucket) => bucket.count === most)
      .flatMap((bucket) => bucket.values)
      .reduce((a, b) => pick(a, b));
  };

  const left = commonest(all.map((b) => b.left), Math.min);
  const right = commonest(all.map((b) => b.right), Math.max);
  const width = px(right - left);

  /*
     Only what is inside the container.

     A skip link parked at -10000px is not off the grid, it is not on the page,
     and left in the reading it was the worst issue on quoin.dev by four
     thousand pixels. Anything that does not overlap the content column is not
     what a column grid is about.
  */
  const blocks = all.filter((b) => b.right > left && b.left < right);

  const gutter = options.gutter ?? solveGutter(blocks);

  /*
     How many columns, scored against the page.

     Every count from one to sixteen is tried and the one whose divisions the
     most edges land on wins. A page with no column grid scores badly at every
     count, which is the right answer rather than a failure to produce one.
  */
  let columns = options.columns ?? 1;
  if (options.columns === undefined) {
    /*
       Scored against chance, not by count.

       Counting hits alone always picks the most columns. Sixteen divisions
       catch more edges than three for the same reason a wider net catches more
       fish, and the first version of this read quoin.dev, which is a
       three-column page, as fifteen columns of 36.27px.

       So what is scored is how far the hits exceed what that many divisions
       would catch from edges scattered at random. A division is a window of
       twice the tolerance, there are two per column, and the share of the
       container they cover is how often a random edge lands in one. Excess over
       that is evidence of a grid; equalling it is evidence of nothing.
    */
    let best = -Infinity;
    for (let candidate = 1; candidate <= 16; candidate++) {
      const module = (width - (candidate - 1) * gutter) / candidate;
      if (module <= 0) break;
      const { starts, ends } = divisions(candidate, module, gutter);

      let hits = 0;
      for (const block of blocks) {
        if (distanceTo(block.left - left, starts) <= tolerance) hits++;
        if (distanceTo(block.right - left, ends) <= tolerance) hits++;
      }

      const coverage = Math.min(1, (2 * candidate * 2 * tolerance) / width);
      const expected = 2 * blocks.length * coverage;
      const excess = hits - expected;

      /* Strictly greater, so a tie goes to the smaller count. */
      if (excess > best) {
        best = excess;
        columns = candidate;
      }
    }
  }

  const module = px((width - (columns - 1) * gutter) / columns);
  const { starts, ends } = divisions(columns, module, gutter);

  const issues: ColumnEdge[] = [];
  let aligned = 0;

  for (const block of blocks) {
    const leftOff = distanceTo(block.left - left, starts);
    const rightOff = distanceTo(block.right - left, ends);
    const leftOk = leftOff <= tolerance;
    const rightOk = rightOff <= tolerance;

    if (leftOk && rightOk) {
      aligned++;
      continue;
    }

    issues.push({
      path: describe(block.el),
      selector: uniqueSelector(block.el),
      sample: (block.el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
      left: px(block.left - left),
      right: px(block.right - left),
      off: px(Math.min(leftOk ? Infinity : leftOff, rightOk ? Infinity : rightOff)),
      which: !leftOk && !rightOk ? "both" : leftOk ? "right" : "left",
    });
  }

  issues.sort((a, b) => b.off - a.off);

  /*
     Container widths that divide evenly, which is the fix.

     A module of 341.33px is not a mistake anybody made in the markup. It is what
     1104px divided three ways with 40px gutters comes to, and the only thing
     that changes it is the container. So the report says which nearby widths
     work rather than telling somebody their edges are off by a third of a pixel.
  */
  const widthsThatDivide: number[] = [];
  const wholeModule = Number.isInteger(module);
  if (!wholeModule) {
    for (let delta = 1; delta <= 24 && widthsThatDivide.length < 4; delta++) {
      for (const candidate of [width - delta, width + delta]) {
        const m = (candidate - (columns - 1) * gutter) / columns;
        if (m > 0 && Number.isInteger(px(m)) && Number.isInteger(m)) {
          widthsThatDivide.push(px(candidate));
        }
      }
    }
  }

  return {
    container: {
      left: px(left),
      width,
      blocks: blocks.filter((b) => Math.abs(b.left - left) < 1).length,
    },
    columns,
    gutter,
    module,
    moduleWhole: wholeModule,
    total: blocks.length,
    aligned,
    issues: issues.slice(0, limit),
    widthsThatDivide: [...new Set(widthsThatDivide)].sort((a, b) => a - b),
    solved: options.columns === undefined,
  };
}
