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
}

/** Elements whose text is not prose and should not be judged as prose. */
export const NON_TEXT: readonly string[] = [
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS",
  "IFRAME", "OPTION", "TEXTAREA", "CODE", "PRE", "KBD", "SAMP",
  "OBJECT", "EMBED", "VIDEO", "AUDIO", "MAP", "MATH",
];

const NON_TEXT_SET = new Set(NON_TEXT);

/* Whether anything between this element and the root is transformed. Memoised
   per element, because a deep tree asks the same question about the same
   ancestors several hundred times. */
function transformedUnder(el: Element, cache: Map<Element, boolean>): boolean {
  const seen = cache.get(el);
  if (seen !== undefined) return seen;

  const style = getComputedStyle(el);
  const own =
    (style.transform !== "none" && style.transform !== "") ||
    (style.scale !== "none" && style.scale !== "") ||
    (style.zoom !== "" && style.zoom !== "1" && style.zoom !== "normal");

  const parent = el.parentElement;
  const result = own || (parent ? transformedUnder(parent, cache) : false);
  cache.set(el, result);
  return result;
}

/* Every element that directly owns rendered words, in document order. */
export function textBlocks(
  root: Element = document.body,
  ignore: readonly string[] = []
): Element[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      /* `tagName` is uppercase for HTML and as-authored for SVG and MathML,
         so both cases are checked rather than assumed. */
      if (NON_TEXT_SET.has(el.tagName) || NON_TEXT_SET.has(el.tagName.toUpperCase())) {
        return NodeFilter.FILTER_REJECT;
      }

      for (const selector of ignore) {
        try {
          if (el.matches(selector)) return NodeFilter.FILTER_REJECT;
        } catch {
          /* An unparseable ignore selector should not take the whole walk
             down with it. Skipping nothing is the safe reading. */
        }
      }

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }
      /* Vertical writing modes have a baseline, but it runs the other way and
         a horizontal grid has nothing to say about it. */
      if (style.writingMode && style.writingMode !== "horizontal-tb") {
        return NodeFilter.FILTER_REJECT;
      }

      /* Only elements that directly own rendered words. A wrapper div inherits
         its child's text and would otherwise be measured twice. */
      const ownsText = [...el.childNodes].some(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()
      );
      return ownsText ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const found: Element[] = [];
  let current = walker.nextNode() as Element | null;
  while (current) {
    found.push(current);
    current = walker.nextNode() as Element | null;
  }
  return found;
}

export interface VerifyResult {
  results: TextNodeResult[];
  report: GridReport;
  grid: GridConfig;
  /** Nodes skipped because they sit under a transform. */
  skippedTransformed: number;
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

  /* Cache per resolved font shorthand: measuring is cheap, but a long document
     asks the same question thousands of times. */
  const metricCache = new Map<string, FontMetrics>();

  for (const el of textBlocks(root, ignore)) {
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
    });
  }

  return { results, report: summarise(results), grid, skippedTransformed };
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
