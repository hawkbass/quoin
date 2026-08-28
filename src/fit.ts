/* Fitting a design to a grid, in a browser.

   The arithmetic is in `fit-core.ts`, because it is the same solve whether the
   cap heights come from a page or from a font file. This supplies them from a
   page: a `text-box-trim` probe against the font the browser actually resolved,
   which is the measurement that is true of the thing on screen rather than of
   the thing that was asked for.

   Why this is the part of the library that makes the rest of it unnecessary is
   set out in `fit-core.ts`, along with the derivation. The short version is that
   with the boxes trimmed, the only requirement is

       space(B) + cap(B) = 0  (mod pitch)

   in which every term belongs to block B alone, so no size has to agree with any
   other and a design keeps every size it asked for. */

import type { GridConfig } from "./grid.ts";
import { textBlocks } from "./verify.ts";
import {
  boxHeightForEdge,
  canReadFontTableCapHeight,
  fontIsAvailable,
} from "./metrics.ts";
import { fitWith, type CapSource, type FamilyRequest, type FittedScale } from "./fit-core.ts";

export {
  fittedScaleToCss,
  spaceFor,
  leadingFor,
  type DesignStep,
  type FamilyRequest,
  type FittedStep,
  type FittedFamily,
  type FittedScale,
  type CapSource,
} from "./fit-core.ts";

/** The first family in a stack, unquoted. */
function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? stack).replace(/^["']|["']$/g, "").trim();
}

const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|math|emoji)$/i;

/**
 * Cap heights from the page, through a `text-box-trim` probe.
 *
 * The probe is what the engine will actually do to the box, so it is preferred
 * to anything scaled from a measurement taken elsewhere, which would be a
 * prediction of it rather than the thing itself.
 */
export function pageCapSource(edge = "cap alphabetic"): CapSource {
  const cache = new Map<string, number | null>();
  const available = new Map<string, boolean>();

  return {
    capHeight(font, size) {
      const key = `${size}|${font}`;
      if (!cache.has(key)) cache.set(key, boxHeightForEdge(`${size}px ${font}`, edge));
      return cache.get(key) ?? null;
    },
    resolved(font) {
      if (!available.has(font)) {
        /*
           Checked on the first name in the stack rather than on the whole
           stack. A probe for "Georgia, serif" asks whether a family literally
           called `Georgia, serif` exists, which nothing is, so every realistic
           design came back marked as not having rendered, and a warning that
           fires on every correct input is a warning people learn to ignore.
        */
        const first = firstFamily(font);
        available.set(font, GENERIC.test(first) ? true : fontIsAvailable(first));
      }
      return available.get(font) ?? false;
    },
  };
}

/**
 * Fit a design to a grid, keeping every size exactly as the design states it.
 *
 * Runs in the browser, because the only trustworthy source of font metrics in a
 * page is the font the browser resolved. For a build step with no browser, see
 * `fitFromFiles` in `fit-file.ts`, which reads the same numbers from the OS/2
 * table and agrees with this to within a fortieth of a pixel.
 */
export function fitScale(
  families: readonly FamilyRequest[],
  options: Partial<GridConfig> & {
    edge?: string;
    spaceProperty?: "margin" | "padding";
    columns?: boolean;
  } = {}
): FittedScale {
  if (!canReadFontTableCapHeight()) {
    return {
      grid: { pitch: options.pitch ?? 8, tolerance: options.tolerance ?? 0.5, origin: 0 },
      edge: options.edge ?? "cap alphabetic",
      spaceProperty: options.spaceProperty ?? "margin",
      columns: options.columns ?? false,
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

  return fitWith(families, pageCapSource(options.edge), options);
}
/* ------------------------------------------------------------------ *
   Reading a design off a page that already exists
 * ------------------------------------------------------------------ */

export interface InferOptions {
  root?: Element;
  ignore?: string[];
  crossShadow?: boolean;
  /**
   * Ignore any combination used by fewer than this many blocks.
   *
   * A page has a long tail of one-off sizes, usually a widget or a third party,
   * and fitting them produces a stylesheet with forty entries nobody asked for.
   * The tail is still reported, in `rare`, so it is a decision rather than a
   * silent omission.
   */
  minimumBlocks?: number;
}

export interface InferredDesign {
  families: FamilyRequest[];
  /**
   * Combinations that appeared too few times to be part of the design, with the
   * count that disqualified each one.
   */
  rare: { font: string; size: number; leading: number; blocks: number }[];
  /** Text blocks the walk found, and how many are covered by `families`. */
  blocks: number;
  covered: number;
  /**
   * Things read off the page that the fit cannot be trusted about.
   *
   * A design half-read in silence is worse than one that refuses, because the
   * spacing that comes out of it looks like an answer.
   */
  warnings: string[];
}

/**
 * Read a design off a rendered page.
 *
 * Most people have a site rather than a design file, and the question they want
 * answered is what to change about the site they have. This walks the page,
 * groups every block of text by the family, size and leading it actually
 * resolved to, and hands back the result in the shape `fitScale` takes.
 *
 * It reads what the browser resolved rather than what the stylesheet asked for,
 * which is the same reason everything else here runs in the page: between the
 * two sit an inherited line-height, a component library's reset, a webfont that
 * failed, and a heading with a `clamp()` that resolved to something the type
 * scale never anticipated.
 */
export function inferDesign(options: InferOptions = {}): InferredDesign {
  const root = options.root ?? document.body;
  const minimum = options.minimumBlocks ?? 2;

  const blocks = textBlocks(root, options.ignore ?? [], {
    crossShadow: options.crossShadow,
  });

  interface Group {
    font: string;
    size: number;
    leading: number;
    /* The block's own border-top and padding-top, which sit between the top of
       the box and the first baseline, and its border-bottom and padding-bottom,
       which sit below the last one under the trim. All four move text and none
       of them used to be read. */
    borderTop: number;
    paddingTop: number;
    borderBottom: number;
    paddingBottom: number;
    blocks: number;
    tags: Map<string, number>;
    elements: Element[];
  }

  const groups = new Map<string, Group>();
  let collapsedCells = 0;

  for (const element of blocks) {
    const style = getComputedStyle(element);
    const size = Math.round(Number.parseFloat(style.fontSize) * 100) / 100;
    const leading =
      Math.round((Number.parseFloat(style.lineHeight) || size * 1.2) * 100) / 100;
    if (!Number.isFinite(size) || size <= 0) continue;

    const font = style.fontFamily;
    const box = (value: string) => {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    };
    const borderTop = box(style.borderTopWidth);
    const paddingTop = box(style.paddingTop);
    const borderBottom = box(style.borderBottomWidth);
    const paddingBottom = box(style.paddingBottom);

    /*
       A cell in a collapsed table reports a border it does not wholly own.

       Under `border-collapse: collapse` the border between two cells is drawn on
       the edge and counted half to each, so a cell declaring 24px of line, 7px
       of padding and a 1px rule renders 31.5px rather than 32. Every figure
       above is the declared one, and the space solved from it will be out by
       whatever the engine kept for the neighbour.

       The size and the leading are unaffected, so the step is still worth
       having. The box terms are not, and saying so is better than a spacing
       that is half a pixel wrong for a reason nobody can see.
    */
    const table = element.closest?.("table");
    if (table && getComputedStyle(table).borderCollapse === "collapse") {
      collapsedCells++;
    }

    /*
       Grouped on the box as well as the type, because the space that seats a
       block has to close its border-top and padding-top too, and two blocks at
       the same size with different borders need different spaces. On a page
       with no borders on its text every one of these is zero and the grouping
       is exactly what it was.
    */
    const key =
      `${font}|${size}|${leading}|` +
      `${borderTop}|${paddingTop}|${borderBottom}|${paddingBottom}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        font, size, leading,
        borderTop, paddingTop, borderBottom, paddingBottom,
        blocks: 0, tags: new Map(), elements: [],
      };
      groups.set(key, group);
    }
    group.blocks++;
    group.elements.push(element);
    const tag = element.tagName.toLowerCase();
    group.tags.set(tag, (group.tags.get(tag) ?? 0) + 1);
  }

  const kept = [...groups.values()].filter((g) => g.blocks >= minimum);
  const rare = [...groups.values()]
    .filter((g) => g.blocks < minimum)
    .map((g) => ({ font: g.font, size: g.size, leading: g.leading, blocks: g.blocks }))
    .sort((a, b) => b.blocks - a.blocks);

  /* One family per resolved stack, its steps ordered by size. A page setting
     three sizes in one family is one family with three steps, which is what a
     design system would call it. */
  const byFont = new Map<string, Group[]>();
  for (const group of kept) {
    const existing = byFont.get(group.font);
    if (existing) existing.push(group);
    else byFont.set(group.font, [group]);
  }

  const used = new Set<string>();
  const families: FamilyRequest[] = [...byFont.entries()]
    /* Commonest family first, so the one carrying the page's reading is the one
       a person looks at first. */
    .sort((a, b) => sumBlocks(b[1]) - sumBlocks(a[1]))
    .map(([font, members], index) => ({
      role: index === 0 ? "body" : `family-${index + 1}`,
      font,
      steps: members
        .sort((a, b) => a.size - b.size)
        .map((group) => {
          /* Named for whatever tag uses it most, which is how somebody reading
             the output will recognise it. Deduped, because two sizes can both
             be mostly paragraphs. */
          const commonest = [...group.tags.entries()].sort((a, b) => b[1] - a[1])[0];
          let name = commonest ? commonest[0] : `s${group.size}`;
          if (used.has(name)) name = `${name}-${group.size}`;
          /* Grouping on the box as well as the type means two steps can share a
             tag and a size and differ only in their borders, which the size
             suffix does not separate. A name that collides silently overwrites
             a custom property and takes a block off the grid. */
          if (used.has(name)) {
            let n = 2;
            while (used.has(`${name}-${n}`)) n++;
            name = `${name}-${n}`;
          }
          used.add(name);

          return {
            name,
            size: group.size,
            leading: group.leading,
            space: group.leading,
            borderTop: group.borderTop,
            paddingTop: group.paddingTop,
            borderBottom: group.borderBottom,
            paddingBottom: group.paddingBottom,
            selector: selectorFor(group.elements, root),
          };
        }),
    }));

  const warnings: string[] = [];
  if (collapsedCells > 0) {
    warnings.push(
      `${collapsedCells} ${collapsedCells === 1 ? "block sits" : "blocks sit"} in a ` +
        "table with collapsed borders, where a border is drawn on the edge between " +
        "two cells and counted half to each. Their sizes and leadings are right and " +
        "their border and padding figures do not add up to the box, so the space " +
        "solved for them will be out by up to half a pixel. Set border-collapse: " +
        "separate and border-spacing: 0 on the table."
    );
  }

  return {
    families,
    rare,
    warnings,
    blocks: blocks.length,
    covered: kept.reduce((sum, g) => sum + g.blocks, 0),
  };
}

function sumBlocks(groups: { blocks: number }[]): number {
  return groups.reduce((sum, g) => sum + g.blocks, 0);
}

/**
 * A selector that matches this group and nothing outside it, or null.
 *
 * `--from` reads a design off a page and then hands back custom properties that
 * somebody has to wire up by hand, which is a strange thing to do when the tool
 * is holding the very elements it read them from. This tries to close that.
 *
 * Only two shapes are attempted and both are verified against the document
 * before being returned: a bare tag, and a tag with one class. Anything more
 * elaborate would be guessing at somebody's naming, and a selector that is
 * nearly right is worse than none at all, because it silently styles the wrong
 * blocks.
 */
function selectorFor(elements: readonly Element[], root: Element): string | null {
  if (elements.length === 0) return null;

  const exactly = (selector: string): boolean => {
    let found: NodeListOf<Element>;
    try {
      found = root.querySelectorAll(selector);
    } catch {
      return false;
    }
    if (found.length !== elements.length) return false;
    const inGroup = new Set<Element>(elements);
    for (const element of found) if (!inGroup.has(element)) return false;
    return true;
  };

  const tags = new Set(elements.map((e) => e.tagName.toLowerCase()));
  if (tags.size === 1) {
    const tag = [...tags][0]!;
    if (exactly(tag)) return tag;

    /* Classes every element in the group carries, tried commonest first so the
       answer is the one somebody would have written. */
    const counts = new Map<string, number>();
    for (const element of elements) {
      for (const name of element.classList) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    const shared = [...counts.entries()]
      .filter(([, count]) => count === elements.length)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    for (const name of shared) {
      /* Escaped, because a class can contain characters a selector cannot carry
         raw, and Tailwind-shaped names are full of them. */
      const escaped =
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(name) : name;
      if (exactly(`${tag}.${escaped}`)) return `${tag}.${escaped}`;
      if (exactly(`.${escaped}`)) return `.${escaped}`;
    }
  }

  return null;
}
