/* The other half of a baseline grid.

   Phase is where a baseline sits inside its own line box, and everything else in
   this library is about phase. Rhythm is whether each box is a whole number of
   grid rows tall, and it is the half that decides whether a correction survives
   anything changing.

   A block whose height is not a multiple of the pitch shifts every block after
   it by the remainder. That is why one un-quantised box near the top of a page
   costs the whole page: on quoin.dev, six section borders and seventeen table
   rows at 32 plus 1 put twenty-three pixels of drift into everything below them.
   It is also why static corrections stop holding when the viewport moves, since
   a block that reflows to a different number of lines changes height by a
   multiple of its leading, which is only harmless if the leading is a whole
   number of rows.

   So this measures heights rather than baselines, and it tries to say why each
   one is wrong, because "this box is 33px tall" is a fact and "your table rows
   are 32px of line plus a 1px border" is a fix. */

import { gridConfig, type GridConfig } from "./grid.ts";
import { walk } from "./walk.ts";
import { describe, uniqueSelector } from "./selector.ts";
import { measureFontWithCap, fontShorthand } from "./metrics.ts";

export type RhythmCause =
  | "border"
  | "padding"
  | "leading"
  | "contents"
  | "replaced"
  | "unknown";

export interface RhythmIssue {
  path: string;
  /** A selector that addresses it, or null when none could be verified. */
  selector: string | null;
  sample: string;
  /** Border-box height, in px. */
  height: number;
  /** How far past a whole number of rows, in px. Always positive. */
  over: number;
  cause: RhythmCause;
  /** What was measured, in the terms the fix is written in. */
  detail: string;
  /** The change that would make this box a whole number of rows. */
  fix: string;
  /**
   * How many text blocks sit below this one in document order.
   *
   * The cost of an un-quantised box is everything after it, so this is the
   * number to sort by. A section header three pixels short at the top of the
   * page is a bigger problem than a caption three pixels short at the bottom,
   * and the percentage does not know that.
   */
  below: number;
}

export interface RhythmReport {
  grid: GridConfig;
  /** Blocks that take part in the vertical flow and were measured. */
  total: number;
  onRhythm: number;
  issues: RhythmIssue[];
  /**
   * The remainders this page introduces, added together, in px.
   *
   * Only boxes whose own border, padding or leading is off the grid. A wrapper
   * whose height is fractional because its child's is has introduced nothing,
   * and counting both reports the same pixel twice. A naive sum on one page
   * came to 3617px across 1453 boxes, most of it containers inheriting the
   * same 7.28px from the one inside them, nine levels deep.
   */
  accumulated: number;
  /**
   * Boxes whose fraction came from their contents rather than from themselves.
   *
   * Not defects of their own. Fix what is inside them and these resolve.
   */
  inherited: number;
  byCause: Record<RhythmCause, number>;
}

export interface RhythmOptions extends Partial<GridConfig> {
  root?: Element;
  ignore?: string[];
  crossShadow?: boolean;
  /** Stop after this many issues. */
  limit?: number;
}

/* Elements whose height is their content's rather than their type's, so
   "quantise the leading" is not the advice they need. */
const REPLACED = new Set([
  "IMG", "VIDEO", "CANVAS", "SVG", "IFRAME", "EMBED", "OBJECT", "INPUT",
  "SELECT", "TEXTAREA", "BUTTON", "HR", "PROGRESS", "METER",
]);

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function remainder(value: number, pitch: number): number {
  const over = ((value % pitch) + pitch) % pitch;
  /* Within a hundredth of a row either side counts as landing on it: sub-pixel
     layout produces 31.999999999999996 constantly and it is not a defect. */
  return over < 0.01 || pitch - over < 0.01 ? 0 : Math.round(over * 100) / 100;
}

/*
   Which part of the box is not a whole number of rows.

       height = borderTop + paddingTop + content + paddingBottom + borderBottom

   Each part is checked separately, in the order a person can act on: a border
   is one line of CSS, padding is one line, leading is a decision about the type
   scale, and content taller than its own lines is something inside the box.
*/
function diagnose(
  el: Element,
  style: CSSStyleDeclaration,
  height: number,
  pitch: number,
  ownsText: boolean,
  /* How much of this box's height belongs to the trim by design. Zero for an
     ordinary box; the cap height's residue for a trimmed one. */
  trimResidue = 0
): { cause: RhythmCause; detail: string; fix: string } {
  if (REPLACED.has(el.tagName.toUpperCase())) {
    return {
      cause: "replaced",
      detail: `${el.tagName.toLowerCase()} is ${Math.round(height * 100) / 100}px tall`,
      fix: `Give it an explicit height that is a multiple of ${pitch}px, or wrap it in a box that has one.`,
    };
  }

  const borders = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const padding = px(style.paddingTop) + px(style.paddingBottom);
  const content = height - borders - padding;
  const leading = px(style.lineHeight);

  const borderOver = remainder(borders, pitch);
  const paddingOver = remainder(padding, pitch);
  /*
     A trimmed box ends at its own baseline rather than at the bottom of a line
     box, so its height is `(lines - 1) x leading + capHeight` and carrying the
     cap height's fraction is correct rather than a defect. Subtracting it first
     asks the question that is actually worth asking, which is whether the
     leading is a whole number of rows.

     Without this the tool reports a page built the modern way as almost
     entirely off rhythm and tells the author to fix a leading that is already
     right, which is worse than saying nothing.
  */
  const contentOver = remainder(content - trimResidue, pitch);
  const leadingOver = leading > 0 ? remainder(leading, pitch) : 0;

  /*
     Borders first, and not because they are the most common. They are the
     cheapest to fix and the easiest to miss: a hairline is a pixel in the flow,
     it is invisible in a design tool, and the fix is to take it out of the
     box's own padding rather than to remove it.
  */
  if (borderOver > 0) {
    return {
      cause: "border",
      detail: `${borders}px of border on a ${pitch}px grid`,
      fix:
        `Subtract the border from this box's own padding: ` +
        `padding ${Math.max(0, px(style.paddingBottom) - borderOver)}px instead of ` +
        `${px(style.paddingBottom)}px keeps the rule and the rhythm.`,
    };
  }

  /*
     Leading only explains a box that contains lines.

     `line-height` inherits, so a wrapper with no text of its own still reports
     whatever the body set, and blaming that is worse than saying nothing: the
     wrapper's height is its children's, and changing its leading changes
     nothing at all. The first version did exactly that and pointed at a
     container as the cause of its own child's fraction.
  */
  if (ownsText && leadingOver > 0 && contentOver > 0) {
    const rows = Math.ceil(leading / pitch) * pitch;
    return {
      cause: "leading",
      detail: `line-height ${leading}px is not a whole number of ${pitch}px rows`,
      fix:
        `Set line-height to ${rows}px. A block's height is its line count times ` +
        `its leading, so leading off the grid puts every extra line off it too.`,
    };
  }

  if (paddingOver > 0) {
    return {
      cause: "padding",
      detail: `${padding}px of vertical padding`,
      fix: `Round the padding to a multiple of ${pitch}px.`,
    };
  }

  if (contentOver > 0) {
    /* The leading is fine and the content still is not a whole number of
       lines, so something inside is taller than the line it sits on. */
    const lines = leading > 0 ? content / leading : 0;
    return {
      cause: "contents",
      detail:
        leading > 0
          ? `${Math.round(content * 100) / 100}px of content is ${lines.toFixed(2)} lines of ${leading}px`
          : `${Math.round(content * 100) / 100}px of content`,
      fix:
        `The fraction comes from inside this box rather than from the box. ` +
        `Either something inline is taller than its line box, an inline-block, ` +
        `an image or a control, or a child is off the grid. Fix the child.`,
    };
  }

  return {
    cause: "unknown",
    detail: `${Math.round(height * 100) / 100}px, with border, padding and leading all on the grid`,
    fix: `Measure the children: something inside is contributing a fraction.`,
  };
}

/** Every box that is not a whole number of grid rows tall, and why. */
export function verifyRhythm(options: RhythmOptions = {}): RhythmReport {
  const grid = gridConfig(options);
  const root = options.root ?? document.body;
  const limit = options.limit ?? 100;

  const walked = walk(root, {
    ignore: options.ignore ?? [],
    crossShadow: options.crossShadow,
  });

  /*
     Every block in the flow, not only the ones that own words.

     A section wrapper owns no text and is exactly the kind of box that puts a
     pixel into the page: it is the containers that carry the borders and the
     padding. The text blocks are collected separately, to count what sits below
     each issue.
  */
  const inFlow: Element[] = [];
  const textBlocks = new Set(walked.blocks);

  const all = root.querySelectorAll("*");
  for (const el of all) {
    if (REPLACED.has(el.tagName.toUpperCase()) && !textBlocks.has(el)) {
      /* A replaced element still takes up flow, so it is measured. */
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    /* Out of flow: it moves nothing below it. */
    if (style.position === "absolute" || style.position === "fixed") continue;
    /* Inline boxes contribute to a line rather than to the block flow. */
    if (style.display.startsWith("inline") && !REPLACED.has(el.tagName.toUpperCase())) continue;
    if (!/block|flex|grid|table|list-item|flow-root/.test(style.display)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) continue;
    inFlow.push(el);
  }

  /* Document order, so "how many blocks are below this" is a lookup. */
  const order = new Map<Element, number>();
  let index = 0;
  for (const el of all) {
    if (textBlocks.has(el)) order.set(el, index++);
  }
  const totalText = index;

  const issues: RhythmIssue[] = [];
  const byCause: Record<RhythmCause, number> = {
    border: 0, padding: 0, leading: 0, contents: 0, replaced: 0, unknown: 0,
  };
  let accumulated = 0;
  let inherited = 0;

  const capCache = new Map<string, number>();

  for (const el of inFlow) {
    const style = getComputedStyle(el);
    const height = el.getBoundingClientRect().height;

    /*
       What this box's height is allowed to carry. An ordinary box is expected
       to be a whole number of rows; a trimmed one is expected to be a whole
       number of rows plus its own cap height, because that is what the trim
       leaves behind.
    */
    let trimResidue = 0;
    const trim = style.textBoxTrim || "none";
    if (
      textBlocks.has(el) &&
      (trim === "trim-both" || trim === "trim-end") &&
      (style.textBoxEdge || "auto").includes("alphabetic")
    ) {
      const shorthand = fontShorthand(style);
      let cap = capCache.get(shorthand);
      if (cap === undefined) {
        const metrics = measureFontWithCap(shorthand, Number.parseFloat(style.fontSize));
        cap = (style.textBoxEdge || "").trim().startsWith("cap")
          ? metrics.capHeight
          : metrics.ascent;
        capCache.set(shorthand, cap);
      }
      trimResidue = ((cap % grid.pitch) + grid.pitch) % grid.pitch;
    }

    const over = remainder(height - trimResidue, grid.pitch);
    if (over === 0) continue;

    const { cause, detail, fix } = diagnose(
      el, style, height, grid.pitch, textBlocks.has(el), trimResidue
    );
    byCause[cause]++;

    /* A box that is fractional because its contents are has introduced
       nothing: the pixel already belongs to something inside it. */
    if (cause === "contents" || cause === "unknown") inherited++;
    else accumulated += over;

    if (issues.length >= limit) continue;

    /* How many text blocks come after this box. Cheap enough: the walk is in
       document order, so the first text block at or after this element gives
       the count without another pass. */
    let below = 0;
    for (const [block, at] of order) {
      if (el.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) {
        below = totalText - at;
        break;
      }
    }

    issues.push({
      path: describe(el),
      selector: uniqueSelector(el),
      sample: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
      height: Math.round(height * 100) / 100,
      over,
      cause,
      detail,
      fix,
      below,
    });
  }

  /* Worst first, and worst means most blocks moved rather than most pixels. A
     three pixel box at the top of the page costs more than a seven pixel box at
     the bottom. */
  /*
     Worst first, and worst means two things in order. A box that owns its
     fraction is actionable and one that inherited it is not, so inherited ones
     sort last regardless of size. Within each, the cost is how many blocks
     move rather than how many pixels: three pixels at the top of a page is
     worse than seven at the bottom, and a percentage does not know that.
  */
  const inheritedIssue = (i: RhythmIssue) =>
    i.cause === "contents" || i.cause === "unknown" ? 1 : 0;
  issues.sort(
    (a, b) => inheritedIssue(a) - inheritedIssue(b) || b.below - a.below || b.over - a.over
  );

  const off = Object.values(byCause).reduce((a, b) => a + b, 0);

  return {
    grid,
    total: inFlow.length,
    onRhythm: inFlow.length - off,
    issues,
    accumulated: Math.round(accumulated * 100) / 100,
    inherited,
    byCause,
  };
}
