/* Font metrics, taken off the font the browser actually resolved.

   Not off a font file, and not off a table of metrics shipped with the tool.
   Both of those describe the font you asked for. The browser gives you the one
   it found, which is a different font whenever a webfont has not loaded, a
   family name is misspelled, or `system-ui` resolves to whatever this machine
   calls its system. Measuring the resolved font is the whole reason this works
   on a page you did not build. */

export interface FontMetrics {
  /** Top of the font's box to the baseline, px. */
  ascent: number;
  /** Baseline to the bottom of the font's box, px. */
  descent: number;
  /** Cap height above the baseline, px. */
  capHeight: number;
  /** x-height above the baseline, px. */
  xHeight: number;
  /**
   * Where `capHeight` came from.
   *
   * `"font-table"` is the font's own sCapHeight, read through a CSS
   * `text-box-trim` probe, and agrees across engines.
   * `"raster"` is the drawn glyph via canvas `actualBoundingBoxAscent`, and
   * does not: see `capHeightIsRasterised`.
   */
  capSource: CapSource;
  /** Size these were taken at, so they can be rescaled. */
  fontSize: number;
  /**
   * The shorthand read back off the canvas after setting it.
   *
   * This is the specified value, normalised, and NOT proof that the family was
   * found. `ctx.font` returns what you asked for: request a font nobody has
   * installed and it hands the name straight back while measuring the fallback.
   * Use `fontIsAvailable` to ask whether a family actually rendered.
   */
  font: string;
}

export type CapSource = "font-table" | "raster";

/* One canvas for the lot. */
let sharedContext: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D {
  if (sharedContext) return sharedContext;
  if (typeof document === "undefined") {
    throw new Error(
      "quoin: font metrics need a DOM. Run this in a browser, or drive one " +
        "with the CLI (`npx quoin check <url>`)."
    );
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("quoin: no 2d context, cannot measure font metrics");
  sharedContext = ctx;
  return ctx;
}

/* Exposed for tests, which need a clean slate between fixtures. */
export function resetMeasurementCache(): void {
  sharedContext = null;
  capProbe?.remove();
  capProbe = null;
  trimSupport = null;
}

/* ------------------------------------------------------------------ *
   Parsing a font shorthand
 * ------------------------------------------------------------------ */

const LENGTH_UNITS =
  "px|pt|pc|in|cm|mm|q|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|%";

/*
   `parseFloat` on a font shorthand reads the first number it finds, and in
   `700 18px Satoshi` that number is the weight. This is not hypothetical: it
   is what the first version of this file did, so every bold run on every page
   reported a font size of 700, and every italic one reported NaN and silently
   fell back to 16.

   The size is the length immediately before the family, optionally followed by
   `/line-height`. Matching that shape rather than "the first number" is the
   difference between reading the shorthand and hoping.
*/
const SIZE_IN_SHORTHAND = new RegExp(
  `(?:^|[\\s])(\\d*\\.?\\d+)(${LENGTH_UNITS})(?:\\s*/\\s*[^\\s]+)?\\s+\\S`,
  "i"
);

/** The font size in a CSS font shorthand, in px, or null if it cannot be read. */
export function fontSizeFromShorthand(shorthand: string): number | null {
  const match = SIZE_IN_SHORTHAND.exec(shorthand);
  if (!match) return null;

  const value = Number.parseFloat(match[1] as string);
  const unit = (match[2] as string).toLowerCase();
  if (!Number.isFinite(value)) return null;

  /* Only absolute units convert without a context. Everything else is a real
     number in some other frame of reference, and guessing at it would be worse
     than saying so. */
  const absolute: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
  };
  const factor = absolute[unit];
  return factor === undefined ? null : value * factor;
}

export function fontShorthand(style: CSSStyleDeclaration): string {
  const { fontStyle, fontWeight, fontSize, fontFamily } = style;
  return `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`.trim();
}

/* ------------------------------------------------------------------ *
   Cap height without the rasteriser
 * ------------------------------------------------------------------ */

let trimSupport: boolean | null = null;
let capProbe: HTMLElement | null = null;

/**
 * Whether this engine can report cap height from the font's own tables.
 *
 * `text-box-edge: cap` is defined against OpenType `sCapHeight`, so a browser
 * that supports it can hand back the font's declared cap height rather than a
 * measurement of the drawn glyph. Chrome 133, Safari 18.2, Firefox 154.
 */
export function canReadFontTableCapHeight(): boolean {
  if (trimSupport !== null) return trimSupport;
  trimSupport =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("text-box-trim", "trim-start") &&
    CSS.supports("text-box-edge", "cap alphabetic");
  return trimSupport;
}

function probe(): HTMLElement {
  if (capProbe?.isConnected) return capProbe;
  const el = document.createElement("div");
  /* Off-screen rather than `display: none`: a box that is not laid out has no
     height to measure, and `visibility: hidden` still lays out. */
  el.setAttribute("aria-hidden", "true");
  /*
     `contain: layout style`, and deliberately NOT `size`. Size containment
     makes a box's dimensions independent of its contents, which is a fine
     optimisation and completely fatal here: the height this probe reports IS
     the measurement, and under size containment it is zero before the trim and
     zero after it. The first version of this had `contain: layout size style`
     and reported "unsupported" in every engine, including the two that support
     it. */
  el.style.cssText =
    "position:absolute!important;left:-99999px!important;top:0!important;" +
    "width:max-content!important;display:block!important;white-space:pre!important;" +
    "margin:0!important;padding:0!important;border:0!important;" +
    "contain:layout style!important;pointer-events:none!important;";
  el.textContent = "Hxp";
  /*
     Nothing here resets `font-size-adjust`, and it is the one property that
     would destroy this measurement: at 0.9 it doubled the trimmed box in both
     engines, 21.19px to 42.64px. It does not need resetting because the `font`
     shorthand that every caller sets on this element already does it, along
     with `font-variation-settings`, `font-feature-settings` and
     `font-optical-sizing`.

     That is load-bearing and it is invisible. Setting `fontFamily` and
     `fontSize` separately instead of the shorthand would look equivalent and
     would silently inherit whatever the page had set, which is checked in
     verify.spec.ts rather than left as a comment.
  */
  document.body.appendChild(el);
  capProbe = el;
  return el;
}

/**
 * Cap height in px, read from the font's own metrics rather than from the drawn
 * glyph. Null where `text-box-trim` is unsupported.
 *
 * Trimming BOTH edges to `cap alphabetic` leaves exactly the distance from the
 * baseline to the cap height, so the box's own height is the answer.
 *
 * It has to be both edges, and that is the whole subtlety. Trimming only the
 * start edge leaves the bottom half-leading in the box, and the engines do not
 * split leading identically: measured on the same Georgia, at the same size, at
 * a line-height of 28px, Chromium's start-trimmed box is 20.469px and WebKit's
 * is 19.969px. Half a pixel apart, and the half pixel is the leading split,
 * not the font. Trim both and they agree to 12.46875 exactly, at every
 * line-height from 26.5px to 40px.
 *
 * Which also means the result does not depend on line-height at all, so this
 * takes only a font. It sets a generous leading of its own so there is
 * something to trim.
 */
export function capHeightFromFontTable(font: string): number | null {
  if (!canReadFontTableCapHeight()) return null;

  const el = probe();
  el.style.font = font;
  /* Unitless, so it scales with whatever size the shorthand carries, and large
     enough that both half-leadings are positive at any of them. */
  el.style.lineHeight = "3";

  el.style.textBoxTrim = "trim-both";
  el.style.textBoxEdge = "cap alphabetic";
  const capHeight = el.getBoundingClientRect().height;

  el.style.textBoxTrim = "none";
  el.style.textBoxEdge = "";
  el.style.lineHeight = "";

  /* Zero means the declaration did not take, not that the font has no
     capitals. */
  return Number.isFinite(capHeight) && capHeight > 0 ? capHeight : null;
}

/**
 * The space between the top of the line box and the cap height, in px, derived
 * from the font's own metrics. Null where `text-box-trim` is unsupported.
 *
 * This is what `text-box-trim: trim-start; text-box-edge: cap` removes, and it
 * is computed here from the portable cap height rather than measured directly,
 * because measuring it directly picks up the engine's leading split.
 */
export function capOvershootFromFontTable(
  font: string,
  lineHeight: number
): number | null {
  const capHeight = capHeightFromFontTable(font);
  if (capHeight === null) return null;

  const ctx = context();
  ctx.font = font;
  const box = ctx.measureText("Hxp");
  const baseline = baselineWithinLineBox(
    { ascent: box.fontBoundingBoxAscent, descent: box.fontBoundingBoxDescent },
    lineHeight
  );
  return baseline - capHeight;
}

/* ------------------------------------------------------------------ *
   The measurement
 * ------------------------------------------------------------------ */

/*
   `H` and `x` rather than `O` and `o`, and that is not fussiness: round letters
   overshoot the line they sit on by a percent or two, deliberately, because
   otherwise they look smaller than the flat ones. Measure a curve and you get a
   cap height slightly too tall and a grid quietly wrong everywhere.
*/
export function measureFont(font: string, knownSize?: number): FontMetrics {
  const ctx = context();
  ctx.font = font;

  /* Reading it back is how we learn what actually resolved. */
  const resolved = ctx.font;

  const box = ctx.measureText("Hxp");
  const caps = ctx.measureText("H");
  const lower = ctx.measureText("x");

  const fontSize =
    knownSize ??
    fontSizeFromShorthand(resolved) ??
    fontSizeFromShorthand(font) ??
    16;

  return {
    ascent: box.fontBoundingBoxAscent,
    descent: box.fontBoundingBoxDescent,
    capHeight: caps.actualBoundingBoxAscent,
    xHeight: lower.actualBoundingBoxAscent,
    capSource: "raster",
    fontSize,
    font: resolved,
  };
}

/**
 * `measureFont`, with a cap height that travels between engines.
 *
 * Costs a layout, so the page walk uses `measureFont` and this is for when the
 * cap height is the number you actually want.
 *
 * It takes no line-height, and that is a result rather than an omission: the
 * trim-both probe below is measured to give the same answer at every leading
 * from 26.5px to 40px, because cap height is a property of the font and not of
 * the box you set it in. An earlier signature took one and ignored it.
 *
 * ## Why there are two routes, and which one you get
 *
 * Canvas `actualBoundingBoxAscent` measures the glyph as drawn. Chromium and
 * WebKit draw it hinted onto the pixel grid, so they return whole pixels,
 * 49 readings out of 49 in the corpus run. Firefox returns the scaled outline
 * and never lands on a whole pixel. That is a real divergence, up to 0.86px
 * across the corpus, and hinting does not invert, so no arithmetic recovers
 * one from the other.
 *
 * CSS `text-box-edge: cap` is specified against the font's OpenType
 * `sCapHeight`, and the engines really do read it: a manufactured SpaceMono
 * declaring 600 units where its own H is 700 reports 10.797px at 18px in both
 * Chromium and WebKit: the declared value, not the drawn one. Where the table
 * says nothing usable, which is to say absent, zero, or larger than the em
 * box, all three of which were tested, both engines fall back to the outline and agree on that too.
 *
 * Either way the answer is portable: worst spread 0.016px across 110
 * font-and-size rows, which is 1/64px and therefore layout-unit quantisation
 * rather than disagreement.
 *
 * Firefox has no `text-box-trim` before 154, so it takes the canvas route,
 * and its canvas route is the unhinted scaled outline, which for all 21 real
 * fonts in the corpus agrees with the other engines' declared value to within
 * 0.02px. The two coincide because real fonts declare what they draw. They
 * come apart only on a font that lies, which is why one had to be built to
 * find out.
 */
export function measureFontWithCap(font: string, knownSize?: number): FontMetrics {
  const metrics = measureFont(font, knownSize);
  const capHeight = capHeightFromFontTable(font);
  if (capHeight === null) return metrics;
  return { ...metrics, capHeight, capSource: "font-table" };
}

/* Half-leading plus ascent. The one number in here that travels: verified
   identical across Chromium, Firefox and WebKit on every font tested. */
export function baselineWithinLineBox(
  metrics: Pick<FontMetrics, "ascent" | "descent">,
  lineHeight: number
): number {
  const contentHeight = metrics.ascent + metrics.descent;
  const halfLeading = (lineHeight - contentHeight) / 2;
  return halfLeading + metrics.ascent;
}

/**
 * Where the first baseline sits below the top of a block's content box, in px,
 * accounting for `text-box-trim`.
 *
 * `baselineWithinLineBox` answers this for an ordinary block, and was the only
 * answer this library had until `text-box-trim` reached Baseline in August 2026.
 * A trimmed box is a different shape: the leading above the first line is cut
 * away, so the content box starts at whichever edge `text-box-edge` names rather
 * than at the top of the line box, and half-leading is no longer in the sum at
 * all.
 *
 * Getting this wrong is not a rounding error. Measuring a trimmed 32px serif
 * block as though it were untrimmed puts the baseline 17.8px too low, which is
 * more than two rows of an 8px grid, and every block on the page is wrong in the
 * same direction. The tool would report a page built correctly on the modern
 * primitive as almost entirely off the grid, and the page would be right.
 *
 * `edge` is the computed `text-box-edge`. `auto` behaves as `text`, which is the
 * ascent, and is what an author gets if they set the trim and nothing else.
 */
export function firstBaselineOffset(
  metrics: Pick<FontMetrics, "ascent" | "descent" | "capHeight" | "xHeight">,
  lineHeight: number,
  trim = "none",
  edge = "auto"
): number {
  const trimsStart = trim === "trim-both" || trim === "trim-start";
  if (!trimsStart) return baselineWithinLineBox(metrics, lineHeight);

  /* The over edge, which the trim has made the top of the box. Only the first
     keyword matters here: the second names the under edge, which decides where
     the box ends rather than where the baseline sits. */
  const over = edge.trim().split(/\s+/)[0] ?? "auto";
  if (over === "cap" && metrics.capHeight > 0) return metrics.capHeight;
  if (over === "ex" && metrics.xHeight > 0) return metrics.xHeight;
  return metrics.ascent;
}

/**
 * The gap `text-box-trim: trim-start; text-box-edge: cap` removes.
 *
 * Portable when `metrics.capSource` is `"font-table"`. When it is `"raster"`,
 * this number belongs to the browser that produced it: 42 readings per engine
 * put Chromium and WebKit on whole pixels every time and Firefox never, peaking
 * at 1.05px on 12px type. Hinting does not invert, so it cannot be corrected
 * with arithmetic. Compute and apply it in the same browser, or use
 * `measureFontWithCap` and check `capSource`.
 */
export function capOvershoot(metrics: FontMetrics, lineHeight: number): number {
  return baselineWithinLineBox(metrics, lineHeight) - metrics.capHeight;
}

/** Baseline to the bottom of the line box. */
export function descenderSlack(metrics: FontMetrics, lineHeight: number): number {
  return lineHeight - baselineWithinLineBox(metrics, lineHeight) - metrics.descent;
}

/* Pass a real family. The candidate gets quoted, so a generic keyword like
   `serif` reads as a family called "serif" and comes back false. */
export function fontIsAvailable(family: string, size = 48): boolean {
  const ctx = context();
  const probeText = "HAMBURGEFONSTIVhamburgefonstiv";

  ctx.font = `${size}px "${family}", monospace`;
  const withMono = ctx.measureText(probeText).width;

  ctx.font = `${size}px "${family}", serif`;
  const withSerif = ctx.measureText(probeText).width;

  if (!withMono || !withSerif) return false;

  return Math.abs(withMono - withSerif) < 0.5;
}

/** True in Chromium and WebKit, false in Firefox. */
export function capHeightIsRasterised(
  family = "serif",
  sizes: readonly number[] = [12, 13, 17, 19, 23]
): boolean {
  const ctx = context();
  return sizes.every((size) => {
    ctx.font = `400 ${size}px ${family}`;
    return Number.isInteger(ctx.measureText("H").actualBoundingBoxAscent);
  });
}
