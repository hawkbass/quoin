/* Seat a rendered page on the baseline grid.

   Seating one element is arithmetic. Seating a page is a constraint problem,
   and two things make it one.

   Correcting a block moves every block below it, so the corrections cannot be
   computed in a batch and then applied: each block has to be measured after
   the ones above it are already corrected. Compute-then-apply gives you a
   perfect first paragraph and a page that is worse than when you started.

   Correcting a block can move blocks above it too. In a flex row under
   `align-items: flex-end`, making any item taller grows the line's cross size
   and shifts every end-aligned sibling, so seating the third item lifts two
   already-seated ones back off. That is why this sweeps until nothing moves
   rather than walking the page once. */

import { measureFont, fontShorthand, baselineWithinLineBox } from "./metrics.ts";
import {
  checkBaseline,
  gridConfig,
  seatingShift,
  snapLineHeight,
  type GridConfig,
} from "./grid.ts";
import { textBlocks } from "./verify.ts";
import { describe, uniqueSelector } from "./selector.ts";

export type SeatMode = "full" | "first-line";

export interface SeatOptions extends Partial<GridConfig> {
  root?: Element;
  /** Selectors to leave alone, and everything inside them. */
  ignore?: string[];
  /**
   * `"full"` snaps line-height as well as seating the first baseline, so every
   * line in a block lands on the grid rather than only its first.
   *
   * This is a real cost and it is the same one print pays: an honest baseline
   * grid quantises your leading. It is what InDesign does when you tick "align
   * to baseline grid", and it is why that checkbox changes your leading when
   * you turn it on. `"first-line"` skips it if you would rather keep your type
   * scale and accept drift inside long blocks.
   */
  mode?: SeatMode;
  /** Cap on how much leading may grow, as a multiple of the original. */
  maxLeadingGrowth?: number;
  /** How many times to sweep the page before giving up. */
  maxPasses?: number;
}

/** Which lever moved the text. */
export type Lever = "padding" | "offset" | "none";

export interface SeatedBlock {
  /** Readable path, for reports. */
  path: string;
  /**
   * A selector that addresses this element in the page as authored, verified
   * unique against the document. Null when no unique selector could be built,
   * in which case this block cannot appear in the exported CSS and is counted
   * in `SeatResult.unexportable`.
   */
  selector: string | null;
  /** First few words, so a human recognises it. */
  sample: string;
  lever: Lever;
  /** Final computed `padding-top`, in px. The value the export writes. */
  paddingTop: number;
  /** How much of that this tool added. */
  paddingAdded: number;
  /** Relative offset applied, in px. Zero when the lever was not offset. */
  offset: number;
  /** Line-height before and after, in px. Equal when nothing was snapped. */
  leadingFrom: number;
  leadingTo: number;
  /** Drift before the correction and after it. */
  driftBefore: number;
  driftAfter: number;
  /** True when leading was left alone because of `maxLeadingGrowth`. */
  partial: boolean;
  /** True when the block ended up within tolerance. */
  seated: boolean;
}

export interface SeatResult {
  blocks: SeatedBlock[];
  grid: GridConfig;
  mode: SeatMode;
  /** How many sweeps it took before the page stopped moving. */
  passes: number;
  /** Blocks neither lever could move. */
  missed: number;
  /** Blocks that were moved but have no selector that could carry the fix. */
  unexportable: number;
  /** Restore every element this touched to how it was. */
  undo: () => void;
}

interface Original {
  paddingTop: string;
  lineHeight: string;
  position: string;
  top: string;
}

/* Marks elements this tool has moved, so a second run can recognise its own
   work. Deliberately NOT what the exported CSS keys on: see selector.ts. */
const STAMP = "data-quoin-seat";

/* Walk the page in document order and seat every block on the grid. */
export function seatPage(options: SeatOptions = {}): SeatResult {
  const grid = gridConfig(options);
  const root = options.root ?? document.body;
  const mode = options.mode ?? "full";
  const maxGrowth = options.maxLeadingGrowth ?? 1.35;
  const maxPasses = Math.max(1, options.maxPasses ?? 5);
  const ignore = options.ignore ?? [];

  /* Keyed by element and written once, on first touch, so undo returns the
     page to the state it was actually in rather than to a half-corrected one. */
  const original = new Map<HTMLElement, Original>();
  const records = new Map<HTMLElement, SeatedBlock>();

  let passes = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1;
    const moved = seatOnce(root, ignore, grid, mode, maxGrowth, original, records);
    /* Nothing needed correcting, so another sweep would find the same. */
    if (moved === 0) break;
  }

  /* Selectors last, and only for blocks that carry a correction. Each one runs
     `querySelectorAll` to prove itself, which is far too expensive to do on
     every element on every sweep. */
  for (const [el, block] of records) {
    if (!carriesCorrection(block)) continue;
    block.selector = uniqueSelector(el);
  }

  const blocks = [...records.values()];

  return {
    blocks,
    grid,
    mode,
    passes,
    missed: blocks.filter((b) => b.lever === "none").length,
    unexportable: blocks.filter((b) => carriesCorrection(b) && b.selector === null).length,
    undo() {
      for (const [el, was] of original) {
        el.style.paddingTop = was.paddingTop;
        el.style.lineHeight = was.lineHeight;
        el.style.position = was.position;
        el.style.top = was.top;
        if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
        el.removeAttribute(STAMP);
      }
      original.clear();
      records.clear();
    },
  };
}

function carriesCorrection(block: SeatedBlock): boolean {
  return (
    block.leadingTo !== block.leadingFrom ||
    (block.lever === "padding" && block.paddingAdded > 0.01) ||
    (block.lever === "offset" && block.offset !== 0)
  );
}

/* One sweep. Returns how many blocks it had to move. */
function seatOnce(
  root: Element,
  ignore: readonly string[],
  grid: GridConfig,
  mode: SeatMode,
  maxGrowth: number,
  original: Map<HTMLElement, Original>,
  records: Map<HTMLElement, SeatedBlock>
): number {
  let moved = 0;

  for (const node of textBlocks(root, ignore)) {
    const el = node as HTMLElement;
    if (el.getBoundingClientRect().height <= 0) continue;

    const style = getComputedStyle(el);
    const fontSize = Number.parseFloat(style.fontSize);
    const leadingFrom = Number.parseFloat(style.lineHeight) || fontSize * 1.2;

    /* Leading first: it changes the box, and everything after this measures
       the box. */
    let leadingTo = leadingFrom;
    let partial = false;

    if (mode === "full") {
      const snapped = snapLineHeight(leadingFrom, grid);
      if (snapped / leadingFrom <= maxGrowth) leadingTo = snapped;
      else partial = true;
    }

    if (!original.has(el)) {
      original.set(el, {
        paddingTop: el.style.paddingTop,
        lineHeight: el.style.lineHeight,
        position: el.style.position,
        top: el.style.top,
      });
    }
    const was = original.get(el)!;

    if (leadingTo !== leadingFrom) el.style.lineHeight = `${leadingTo}px`;

    /* NOW measure, with this block's own leading applied and every block above
       it already corrected. */
    const metrics = measureFont(
      fontShorthand(getComputedStyle(el)),
      Number.isFinite(fontSize) ? fontSize : undefined
    );
    const within = baselineWithinLineBox(metrics, leadingTo);

    /* Border and padding included, because the rect is the border box and text
       starts inside both. Re-read every time: this is the measurement the whole
       thing rests on and it is only true immediately. */
    const firstBaseline = (): number => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        rect.top +
        window.scrollY +
        (Number.parseFloat(cs.borderTopWidth) || 0) +
        (Number.parseFloat(cs.paddingTop) || 0) +
        within
      );
    };

    const driftBefore = checkBaseline(firstBaseline(), grid).drift;
    el.setAttribute(STAMP, "");

    const prior = records.get(el);

    /* Already within tolerance, from an earlier sweep or from luck. */
    if (Math.abs(driftBefore) <= grid.tolerance) {
      if (prior) {
        prior.driftAfter = round(driftBefore);
        prior.seated = true;
        prior.leadingTo = round(leadingTo);
      } else {
        records.set(el, {
          path: describe(el),
          selector: null,
          sample: sampleOf(el),
          lever: "padding",
          paddingTop: round(Number.parseFloat(getComputedStyle(el).paddingTop) || 0),
          paddingAdded: 0,
          offset: 0,
          leadingFrom: round(leadingFrom),
          leadingTo: round(leadingTo),
          driftBefore: round(driftBefore),
          driftAfter: round(driftBefore),
          partial,
          seated: true,
        });
      }
      continue;
    }

    moved++;

    let lever: Lever = "padding";
    let offset = 0;

    /* Corrections accumulate on top of whatever the previous sweep applied,
       because each sweep corrects the residual rather than starting over. */
    const paddingBefore = Number.parseFloat(getComputedStyle(el).paddingTop) || 0;
    el.style.paddingTop = `${round(paddingBefore + seatingShift(driftBefore, grid))}px`;

    /*
       Check the correction rather than trust it.

       `padding-top` is the lever you want, because it moves the text AND pushes
       everything below it down, so the column keeps its rhythm. It does not
       always work: padding lives inside the box, and plenty of boxes are
       positioned by something other than their own size. A flex child under
       `align-items: center` grows when you pad it and the container re-centres
       the bigger box, so the text moves half as far as you asked. Under
       `flex-end` it does not move at all. An inline box ignores vertical
       padding for layout entirely.

       A corrector that trusts its own corrections is the verifier with extra
       steps. */
    if (Math.abs(checkBaseline(firstBaseline(), grid).drift) > grid.tolerance) {
      el.style.paddingTop = was.paddingTop;

      /* Second lever: move what is drawn rather than what is laid out. Safe on
         anything already taken out of static flow, and on static boxes by
         promoting them to relative, which changes nothing else. */
      const position = getComputedStyle(el).position;
      const canOffset =
        position === "static" || position === "relative" ||
        position === "absolute" || position === "sticky";

      if (canOffset) {
        const existingTop = Number.parseFloat(el.style.top) || 0;
        const residual = checkBaseline(firstBaseline(), grid).drift;
        const shift = round(existingTop + seatingShift(residual, grid));

        if (position === "static") el.style.position = "relative";
        el.style.top = `${shift}px`;
        offset = shift;
        lever = "offset";

        if (Math.abs(checkBaseline(firstBaseline(), grid).drift) > grid.tolerance) {
          el.style.position = was.position;
          el.style.top = was.top;
          offset = 0;
          lever = "none";
        }
      } else {
        lever = "none";
      }
    }

    const paddingNow = round(Number.parseFloat(getComputedStyle(el).paddingTop) || 0);
    const driftAfter = round(checkBaseline(firstBaseline(), grid).drift);

    records.set(el, {
      path: prior?.path ?? describe(el),
      selector: null,
      sample: prior?.sample ?? sampleOf(el),
      lever,
      paddingTop: paddingNow,
      paddingAdded: round(
        lever === "padding" ? (prior?.paddingAdded ?? 0) + (paddingNow - paddingBefore) : 0
      ),
      offset,
      leadingFrom: round(prior?.leadingFrom ?? leadingFrom),
      leadingTo: round(leadingTo),
      /* The first sweep's reading is the one that describes the original page. */
      driftBefore: prior?.driftBefore ?? round(driftBefore),
      driftAfter,
      partial,
      seated: Math.abs(driftAfter) <= grid.tolerance,
    });
  }

  return moved;
}

function sampleOf(el: Element): string {
  return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ *
   The export
 * ------------------------------------------------------------------ */

export interface ExportOptions {
  /**
   * Add `!important` to every declaration.
   *
   * The generated selectors are as specific as the document allows, which is
   * not always more specific than the rule they are correcting. Off by default
   * because it is a blunt instrument; reach for it when appending the sheet
   * last is not enough.
   */
  important?: boolean;
  /** Include the per-block comment naming the text each rule corrects. */
  comments?: boolean;
  /**
   * `"<selector> <property>"` keys to mark `!important`, as measured by
   * `checkExport`. Set by `exportCssVerified`; there is no reason to build one
   * by hand.
   */
  escalate?: ReadonlySet<string>;
}

/**
 * The corrections as a stylesheet, keyed on selectors that address the page as
 * authored, so it still works once the script is gone, which is the entire
 * reason the export exists.
 *
 * Append it last. Nothing here raises specificity beyond what the document
 * offers, so a rule of equal weight defined later in your own CSS still wins.
 */
export function exportCss(result: SeatResult, options: ExportOptions = {}): string {
  const comments = options.comments ?? true;
  const escalate = options.escalate;

  /* `!important` on everything when asked for it, on nothing by default, and on
     exactly the declarations measured to have lost when `checkExport` says so. */
  const bang = (selector: string, property: string): string => {
    if (options.important) return " !important";
    return escalate?.has(`${selector} ${property}`) ? " !important" : "";
  };

  const lines: string[] = [
    `/* Generated by quoin. Grid: ${result.grid.pitch}px, mode: ${result.mode}, ` +
      `${result.passes} ${result.passes === 1 ? "sweep" : "sweeps"}. */`,
    `/* Applies to the DOM as measured. Re-run after changing type or copy. */`,
    `/* Append last: these selectors are no more specific than your own. */`,
  ];

  if (result.unexportable > 0) {
    lines.push(
      `/* ${result.unexportable} corrected ${result.unexportable === 1 ? "block has" : "blocks have"} ` +
        `no unique selector and ${result.unexportable === 1 ? "is" : "are"} not in this file. */`
    );
  }
  if (result.missed > 0) {
    lines.push(
      `/* ${result.missed} ${result.missed === 1 ? "block" : "blocks"} could not be moved by ` +
        `either lever and ${result.missed === 1 ? "is" : "are"} not in this file. */`
    );
  }
  lines.push("");

  let written = 0;

  for (const block of result.blocks) {
    if (!carriesCorrection(block) || !block.selector) continue;

    const declarations: string[] = [];
    const sel = block.selector;

    if (block.leadingTo !== block.leadingFrom) {
      declarations.push(`  line-height: ${block.leadingTo}px${bang(sel, "line-height")};`);
    }
    if (block.lever === "padding" && block.paddingAdded > 0.01) {
      declarations.push(`  padding-top: ${block.paddingTop}px${bang(sel, "padding-top")};`);
    }
    if (block.lever === "offset" && block.offset !== 0) {
      /* Relative rather than padding because this block's position is decided
         by its parent's alignment, not by its own size. */
      declarations.push(
        `  position: relative${bang(sel, "top")};`,
        `  top: ${block.offset}px${bang(sel, "top")};`
      );
    }
    if (!declarations.length) continue;

    if (comments) lines.push(`/* "${block.sample.slice(0, 32)}" */`);
    lines.push(`${block.selector} {`, ...declarations, "}", "");
    written++;
  }

  if (written === 0) {
    lines.push("/* Nothing to correct: the page was already on the grid. */");
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
   Checking the export, which is the same rule applied to itself
 * ------------------------------------------------------------------ */

export interface LostDeclaration {
  selector: string;
  sample: string;
  property: "line-height" | "padding-top" | "top";
  wanted: number;
  got: number;
}

export interface ExportCheck {
  /** Rules whose selector no longer matches exactly one element. */
  unmatched: number;
  /** Declarations that were overruled by the page's own CSS. */
  lost: LostDeclaration[];
  /** True when every declaration took. */
  clean: boolean;
}

/**
 * Apply an exported stylesheet to the page and report every declaration the
 * page's own CSS overruled.
 *
 * The page must be **unseated** when this runs: call `result.undo()` first, or
 * use `exportCssVerified`, which handles it.
 *
 * ## Why this exists
 *
 * The seater has always re-measured its own corrections, because a corrector
 * that trusts itself is the verifier with extra steps. The export did not, and
 * on Material Design 3 that cost the entire page.
 *
 * 106 rules, all 106 injected, all 106 matching exactly one element, no padding
 * declaration overruled, and **nine `line-height` declarations lost the
 * cascade**: the generated rule asked for 32px against a more specific rule of
 * the page's own asking for 30px. The tool reported nought unexportable and the
 * on-grid count went from 123 of 123 with the script to 18 of 123 with the
 * stylesheet.
 *
 * Nine of 106 costing 105 of 123 is not a rounding error, and the reason is the
 * same constraint that makes seating a page hard in the first place. A block
 * whose leading stays 2px short is 2px short, so everything below it moves up by
 * 2px, so a single overruled declaration near the top of a document
 * desynchronises every block after it. The corrections are a chain, and the
 * export applies them all at once.
 */
export function checkExport(result: SeatResult, css: string): ExportCheck {
  const style = document.createElement("style");
  style.setAttribute("data-quoin-check", "");
  style.textContent = css;
  document.head.appendChild(style);

  const lost: LostDeclaration[] = [];
  let unmatched = 0;

  try {
    for (const block of result.blocks) {
      if (!block.selector || !carriesCorrection(block)) continue;

      let found: NodeListOf<Element>;
      try {
        found = document.querySelectorAll(block.selector);
      } catch {
        unmatched++;
        continue;
      }
      if (found.length !== 1) {
        unmatched++;
        continue;
      }

      const cs = getComputedStyle(found[0] as Element);
      const near = (a: number, b: number) => Math.abs(a - b) < 0.1;

      if (block.leadingTo !== block.leadingFrom) {
        const got = Number.parseFloat(cs.lineHeight);
        if (!near(got, block.leadingTo)) {
          lost.push({
            selector: block.selector,
            sample: block.sample,
            property: "line-height",
            wanted: block.leadingTo,
            got,
          });
        }
      }

      if (block.lever === "padding" && block.paddingAdded > 0.01) {
        const got = Number.parseFloat(cs.paddingTop) || 0;
        if (!near(got, block.paddingTop)) {
          lost.push({
            selector: block.selector,
            sample: block.sample,
            property: "padding-top",
            wanted: block.paddingTop,
            got,
          });
        }
      }

      if (block.lever === "offset" && block.offset !== 0) {
        const got = Number.parseFloat(cs.top) || 0;
        if (!near(got, block.offset)) {
          lost.push({
            selector: block.selector,
            sample: block.sample,
            property: "top",
            wanted: block.offset,
            got,
          });
        }
      }
    }
  } finally {
    style.remove();
  }

  return { unmatched, lost, clean: unmatched === 0 && lost.length === 0 };
}

export interface VerifiedExport {
  css: string;
  /** The check after escalation. `clean` is the answer to "will this work". */
  check: ExportCheck;
  /** How many declarations needed `!important` to survive the cascade. */
  escalated: number;
}

/**
 * `exportCss`, then apply it, then add `!important` to exactly the declarations
 * the page overruled, then check again.
 *
 * **This undoes the seating.** The page is left as it was before `seatPage`,
 * with none of the tool's own styles on it, because that is the only state in
 * which the stylesheet can be honestly tested. Re-seat if you still need it.
 *
 * `!important` is a blunt instrument and it is applied here with a scalpel: only
 * to declarations measured to have lost, never pre-emptively. Where nothing lost,
 * nothing is escalated and the output is byte-for-byte `exportCss`.
 */
export function exportCssVerified(
  result: SeatResult,
  options: ExportOptions = {}
): VerifiedExport {
  result.undo();

  const plain = exportCss(result, options);
  const first = checkExport(result, plain);

  if (first.clean || options.important) {
    return { css: plain, check: first, escalated: 0 };
  }

  /* Escalate only what lost, keyed by selector and property. */
  const escalate = new Set(first.lost.map((l) => `${l.selector} ${l.property}`));
  const css = exportCss(result, { ...options, escalate });
  const check = checkExport(result, css);

  return { css, check, escalated: escalate.size };
}
