/* Walk a rendered page and report every line of text that is not on the grid.

   It runs in the page rather than over the source, and that is the point. The
   source says what was intended. The DOM says what happened, and between them
   sit inherited line-heights, a component library's reset, a webfont that
   failed to load, and one heading with a `clamp()` that resolves to something
   the type scale never anticipated. */

import {
  measureFont,
  fontShorthand,
  baselineWithinLineBox,
  type FontMetrics,
} from "./metrics.ts";
import {
  checkBaseline,
  gridConfig,
  summarise,
  type GridConfig,
  type GridReport,
  type GridResult,
} from "./grid.ts";
import { describe } from "./selector.ts";
import { walk, inShadowRoot as isInShadowRoot } from "./walk.ts";

export interface TextNodeResult extends GridResult {
  /** A short readable path. Not unique: for reports, not for stylesheets. */
  path: string;
  /** First few words, so a human recognises it. */
  sample: string;
  fontSize: number;
  lineHeight: number;
  /** The font the browser resolved, which may not be the one requested. */
  resolvedFont: string;
  /**
   * True when the element sits under a CSS transform.
   *
   * `getBoundingClientRect` reports the transformed box while `line-height`
   * stays in untransformed px, so the two are in different coordinate spaces
   * and the drift computed from them is not a drift. Reported rather than
   * silently mixed in.
   */
  transformed: boolean;
  /**
   * True when this element lives inside a shadow root.
   *
   * It can be seated at runtime like anything else. It cannot be carried by an
   * exported stylesheet, because a document stylesheet does not reach inside a
   * shadow root and there is no selector that does.
   */
  inShadow: boolean;
}

export interface VerifyOptions extends Partial<GridConfig> {
  /** Root to walk. Defaults to `document.body`. */
  root?: Element;
  /** Skip elements matching these selectors, and everything inside them. */
  ignore?: string[];
  /**
   * Count nodes under a CSS transform. Off by default: their measured position
   * is in a different coordinate space, so including them reports a number
   * that cannot be acted on.
   */
  includeTransformed?: boolean;
  /** Descend into open shadow roots. On by default. */
  crossShadow?: boolean;
}

/*
   The walk itself lives in walk.ts, because it stopped being a tree walk: a
   shadow root hangs off its host rather than sitting under it, and a TreeWalker
   will not cross that boundary.
*/
export { NON_TEXT, inShadowRoot, type WalkOptions, type WalkResult } from "./walk.ts";

/** Every element that directly owns rendered words, in flattened tree order. */
export function textBlocks(
  root: Element = document.body,
  ignore: readonly string[] = [],
  options: { crossShadow?: boolean } = {}
): Element[] {
  return walk(root, { ignore, crossShadow: options.crossShadow }).blocks;
}

/* Whether anything between this element and the document root is transformed.

   Memoised per element, because a deep tree asks the same question about the
   same ancestors several hundred times, and because the answer is inherited:
   once an ancestor is known to be transformed, every descendant is too. */
function transformedUnder(el: Element, cache: Map<Element, boolean>): boolean {
  const seen = cache.get(el);
  if (seen !== undefined) return seen;

  const style = getComputedStyle(el);
  const own =
    (style.transform !== "none" && style.transform !== "") ||
    (style.scale !== "none" && style.scale !== "") ||
    (style.rotate !== "none" && style.rotate !== "") ||
    (style.zoom !== "" && style.zoom !== "1" && style.zoom !== "normal");

  /* `parentElement` is null at a shadow root's boundary, so step to the host
     and keep going: a transform on the host moves everything the component
     renders. */
  const root = el.getRootNode();
  const parent =
    el.parentElement ??
    (root !== el.ownerDocument && root instanceof ShadowRoot ? root.host : null);

  const result = own || (parent ? transformedUnder(parent, cache) : false);
  cache.set(el, result);
  return result;
}

export interface VerifyResult {
  results: TextNodeResult[];
  report: GridReport;
  grid: GridConfig;
  /** Nodes skipped because they sit under a transform. */
  skippedTransformed: number;
  /**
   * Shadow roots the walk could not enter, either because they are closed or
   * because `crossShadow` was turned off.
   *
   * Text inside them is real and unmeasured. A percentage that quietly omits a
   * region is worse than no percentage, so this is reported rather than folded
   * into the total.
   */
  closedShadowRoots: number;
  /** Frames on the page, whose content is a different document. */
  frames: number;
}

/* Only the FIRST line of each block is checked. Every subsequent line sits one
   line-height below it, so a block whose leading is a whole number of grid rows
   has all of them seated once the first one is, and a block whose leading is
   not has drift that grows down the paragraph and is a leading problem rather
   than a seating one. */
export function verifyGrid(options: VerifyOptions = {}): VerifyResult {
  const grid = gridConfig(options);
  const root = options.root ?? document.body;
  const ignore = options.ignore ?? [];
  const includeTransformed = options.includeTransformed ?? false;

  const results: TextNodeResult[] = [];
  const transformCache = new Map<Element, boolean>();
  let skippedTransformed = 0;

  const walked = walk(root, { ignore, crossShadow: options.crossShadow });

  /* Cache per resolved font shorthand: measuring is cheap, but a long document
     asks the same question thousands of times. */
  const metricCache = new Map<string, FontMetrics>();

  for (const el of walked.blocks) {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) continue;

    const transformed = transformedUnder(el, transformCache);
    if (transformed && !includeTransformed) {
      skippedTransformed++;
      continue;
    }

    const style = getComputedStyle(el);
    const shorthand = fontShorthand(style);
    const fontSize = Number.parseFloat(style.fontSize);

    let metrics = metricCache.get(shorthand);
    if (!metrics) {
      /* The computed `font-size` is authoritative, so it is passed in rather
         than parsed back out of the shorthand. */
      metrics = measureFont(shorthand, Number.isFinite(fontSize) ? fontSize : undefined);
      metricCache.set(shorthand, metrics);
    }

    /* `normal` computes to a number in getComputedStyle, but guard anyway: a
       font that has not loaded can report something unusable. */
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2;

    const within = baselineWithinLineBox(metrics, lineHeight);

    /* The rect is the BORDER box, and text starts inside both the border and
       the padding. */
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const padTop = Number.parseFloat(style.paddingTop) || 0;

    /* Document space, so scroll position does not enter the measurement. */
    const absolute = rect.top + window.scrollY + borderTop + padTop + within;

    results.push({
      ...checkBaseline(absolute, grid),
      path: describe(el),
      sample: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
      fontSize,
      lineHeight,
      resolvedFont: metrics.font,
      transformed,
      inShadow: isInShadowRoot(el),
    });
  }

  return {
    results,
    report: summarise(results),
    grid,
    skippedTransformed,
    closedShadowRoots: walked.closedShadowRoots,
    frames: walked.frames,
  };
}

/* The off-grid nodes, worst first. */
export function offGrid(
  results: readonly TextNodeResult[],
  limit = 10
): TextNodeResult[] {
  return results
    .filter((r) => !r.onGrid)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    .slice(0, limit);
}
