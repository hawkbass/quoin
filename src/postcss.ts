/* A PostCSS plugin, for the stylesheets it can help.

   Everything else in this library needs either a browser or a design file. A
   build has neither at the moment it is processing CSS, and it has the one thing
   that actually matters: the rules themselves, with the sizes and leadings
   already written down.

   So this reads them. Every rule declaring a pixel `font-size` and a
   `line-height` is fitted the way `fitScale` fits a design, with cap heights
   read from the font files you name. No size is ever changed.

   ## What it can and cannot do, measured

   It used to say it put a stylesheet on the grid. Run against the one this
   site is built from it took the page from 38% on the grid to 32%, and its
   rhythm from 350 of 374 to 299. The claim was wrong in the worst direction and
   the tests did not catch it, because they checked that the output contained
   `text-box-trim` rather than what the page did with it.

   Three things came out of measuring it.

   **The trim goes on with the space and never without it.** An untrimmed box
   begins half a leading above its first ascent and a trimmed one begins at the
   cap, so adding the trim moves the block's first baseline. The space is what
   puts it back on a row. Written together they are one change; written apart the
   first is a page whose blocks have moved and whose spacing has not.

   **The leading is not always safe to snap.** A box is its leading plus its
   border and padding, and an author who made that sum a whole number of rows has
   done the thing this tool is for by a route it did not expect. quoin.dev's
   table cells set a 31px leading against a 1px rule: neither is a whole row and
   32 is. Snapping to 32 makes the box 33. So it is left alone, and said so.

   **Which leaves a small tool.** On a stylesheet whose vertical spacing lives on
   its containers rather than on its text rules, and most do, there is almost
   nothing here for it to write, and it now writes almost nothing rather than
   writing harm. It earns its keep on a stylesheet that keeps its type and its
   spacing in the same rules, which is what a design-system stylesheet usually
   looks like.

   For everything else, `quoin fit --from <url>` reads the rendered page and
   knows what the CSS alone cannot. */

import { readFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { inflateSync } from "node:zlib";
import { readFontMetrics, capHeightAt, FontFileError } from "./font-file.ts";
import type { FontFileMetrics } from "./font-file.ts";
import { spaceFor } from "./fit-core.ts";

export interface QuoinPostcssOptions {
  /** Grid pitch, in px. */
  pitch?: number;
  /**
   * Font files, keyed by the family name as the CSS writes it.
   *
   * The key is matched against the first family in a rule's `font-family`,
   * unquoted and case-insensitively, because that is what the browser will
   * resolve and what the cap height belongs to.
   */
  fonts: Record<string, string>;
  /**
   * The family to use for a rule that does not declare one.
   *
   * Most rules inherit their family, and a stylesheet that sets `font-size` on a
   * paragraph rarely repeats the family with it. Without this those rules are
   * skipped, which is safe and usually not what anybody wants.
   */
  defaultFont?: string;
  /**
   * Whether to rewrite `margin-top` on rules that already declare one.
   *
   * On by default. Set false to have every rule get `--quoin-space` and nothing
   * else, which is the entirely non-destructive mode.
   */
  rewriteSpace?: boolean;
  /** Called with each rule that could not be fitted, and why. */
  onSkip?: (selector: string, reason: string) => void;
}

/* PostCSS's own types are not a dependency here, so the shapes this needs are
   described structurally. A plugin that pulled in `postcss` to read two
   properties off a node would be a dependency in a package whose whole argument
   is that it has none. */
interface Declaration {
  prop: string;
  value: string;
  remove(): void;
}
interface Rule {
  selector: string;
  walkDecls(callback: (decl: Declaration) => void): void;
  append(...nodes: unknown[]): unknown;
}
interface Root {
  walkRules(callback: (rule: Rule) => void): void;
  walkDecls(callback: (decl: Declaration) => void): void;
}

/*
   `font-family: var(--serif)` is what a modern stylesheet says.

   The plugin matched font files against the literal first family in a rule, so
   every rule naming its face through a custom property was skipped: on the
   stylesheet this site is built from, sixteen of the eighteen skips were exactly
   that, which is to say the plugin did nothing to a stylesheet it reported
   having read.

   Custom properties are resolved from the stylesheet itself, which is the only
   place a build can look. A value defined outside it, or by JavaScript, or by a
   media query that has not applied, is not resolvable here and the rule is
   skipped with its reason as before.
*/
function resolveVars(value: string, defined: Map<string, string>, depth = 0): string {
  if (depth > 4 || !value.includes("var(")) return value;

  const resolved = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g,
    (whole, name: string, fallbackValue: string | undefined) => {
      const found = defined.get(name);
      if (found !== undefined) return found;
      if (fallbackValue !== undefined) return fallbackValue.trim();
      return whole;
    }
  );

  return resolved === value ? value : resolveVars(resolved, defined, depth + 1);
}

/** The first family in a stack, unquoted and folded. */
function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? stack).replace(/^["']|["']$/g, "").trim().toLowerCase();
}

/** A length in px, or null when it is not one this can use. */
function px(value: string): number | null {
  const match = /^\s*(-?\d*\.?\d+)px\s*$/.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!);
  return Number.isFinite(amount) ? amount : null;
}

/*
   The vertical halves of a box shorthand.

   `padding: 3px 16px` is two numbers meaning four, and a plugin that only reads
   `padding-top` sees neither. Border and padding are the terms the fitter learned
   to account for in 1.14.0, when quoin.dev's tables showed it prescribing a
   leading change that would have broken the rhythm the author had built by hand.
   The same arithmetic belongs here, and for the same reason: this plugin snapped
   a 22px leading to 24 on a rule carrying a 2px border and turned a 24px box
   into a 26px one.

   Returns null when a value is not a plain px length, because a percentage or a
   calc is not a number this can add.
*/
function verticalHalves(value: string): { top: number; bottom: number } | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || parts.length > 4) return null;

  const top = px(parts[0]!);
  if (top === null) return null;

  /* One value is all four; two and three put the bottom third; four is explicit. */
  const bottomRaw = parts.length >= 3 ? parts[2]! : parts[0]!;
  const bottom = px(bottomRaw);
  if (bottom === null) return null;

  return { top, bottom };
}

/* The width out of a `border` or `border-top` shorthand, which leads with it. */
function borderWidth(value: string): number | null {
  const first = value.trim().split(/\s+/)[0];
  if (first === undefined) return null;
  if (first === "none" || first === "0") return 0;
  return px(first);
}

/**
 * The leading a declaration asks for, in px, given the size.
 *
 * `line-height` is unitless far more often than not, which is the same ambiguity
 * the design reader has and is resolved the same way: CSS spells a ratio without
 * a unit, so a bare number is one.
 */
function leadingPx(value: string, size: number): number | null {
  const asPx = px(value);
  if (asPx !== null) return asPx;

  const bare = /^\s*(\d*\.?\d+)\s*$/.exec(value);
  if (bare) {
    const ratio = Number.parseFloat(bare[1]!);
    return Number.isFinite(ratio) ? ratio * size : null;
  }

  /* `normal` resolves per font and per engine, which is exactly the number this
     cannot know without a browser. Skipped and reported rather than guessed. */
  return null;
}

/**
 * Put a stylesheet on a baseline grid.
 *
 * ```js
 * // postcss.config.js
 * import quoin from "quoin/postcss";
 * export default { plugins: [quoin({ fonts: { Lato: "./fonts/Lato.ttf" } })] };
 * ```
 */
export function quoinPostcss(options: QuoinPostcssOptions) {
  const pitch = options.pitch ?? 8;
  const rewriteSpace = options.rewriteSpace ?? true;
  const onSkip = options.onSkip ?? (() => {});

  /* Parsed once. A stylesheet can have hundreds of rules in one family, and a
     font file is not small. */
  const metrics = new Map<string, FontFileMetrics | null>();
  const problems = new Map<string, string>();

  for (const [family, file] of Object.entries(options.fonts)) {
    const key = family.replace(/^["']|["']$/g, "").trim().toLowerCase();
    try {
      const parsed = readFontMetrics(
        new Uint8Array(readFileSync(resolvePath(file))),
        (compressed) => new Uint8Array(inflateSync(compressed))
      );
      if (parsed.capHeight === null) {
        problems.set(
          key,
          parsed.capHeightImplausible
            ? `${file} declares a cap height taller than the em, which the browsers ignore`
            : `${file} declares no cap height, which needs an OS/2 table at version 2 or later`
        );
        metrics.set(key, null);
      } else {
        metrics.set(key, parsed);
      }
    } catch (error) {
      problems.set(
        key,
        error instanceof FontFileError ? error.message : String(error)
      );
      metrics.set(key, null);
    }
  }

  const fallback = options.defaultFont
    ? options.defaultFont.replace(/^["']|["']$/g, "").trim().toLowerCase()
    : null;

  return {
    postcssPlugin: "quoin",
    Once(root: Root) {
      /* Every custom property the stylesheet defines, wherever it defines it.
         Later wins, which is what the cascade does with two definitions at the
         same specificity and is the best a build can do without one. */
      const defined = new Map<string, string>();
      root.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) defined.set(decl.prop, decl.value.trim());
      });

      root.walkRules((rule) => {
        let paddingTop: number | null = null;
        let paddingBottom: number | null = null;
        let borderTop: number | null = null;
        let borderBottom: number | null = null;
        let sizeDecl: Declaration | null = null;
        let leadingDecl: Declaration | null = null;
        let familyDecl: Declaration | null = null;
        let marginTopDecl: Declaration | null = null;
        let skip = false;

        rule.walkDecls((decl) => {
          switch (decl.prop.toLowerCase()) {
            case "font-size": sizeDecl = decl; break;
            case "line-height": leadingDecl = decl; break;
            case "font-family": familyDecl = decl; break;
            case "margin-top": marginTopDecl = decl; break;
            case "padding-top": paddingTop = px(decl.value); break;
            case "padding-bottom": paddingBottom = px(decl.value); break;
            case "border-top-width": borderTop = px(decl.value); break;
            case "border-bottom-width": borderBottom = px(decl.value); break;
            case "border-top": borderTop = borderWidth(decl.value); break;
            case "border-bottom": borderBottom = borderWidth(decl.value); break;
            case "padding": {
              const halves = verticalHalves(decl.value);
              if (halves) {
                paddingTop = halves.top;
                paddingBottom = halves.bottom;
              }
              break;
            }
            case "border": {
              const width = borderWidth(decl.value);
              if (width !== null) {
                borderTop = width;
                borderBottom = width;
              }
              break;
            }
            /* An explicit opt-out, for the rule somebody has already thought
               about and does not want touched. */
            case "--quoin": if (decl.value.trim() === "skip") skip = true; break;
            default: break;
          }
        });

        if (skip || !sizeDecl || !leadingDecl) return;

        const size = px((sizeDecl as Declaration).value);
        if (size === null) {
          onSkip(rule.selector, `font-size ${(sizeDecl as Declaration).value} is not a px length`);
          return;
        }

        const family = familyDecl
          ? firstFamily(resolveVars((familyDecl as Declaration).value, defined))
          : fallback;
        if (!family) {
          onSkip(rule.selector, "no font-family here and no defaultFont given");
          return;
        }

        const font = metrics.get(family);
        if (font === undefined) {
          onSkip(rule.selector, `no font file given for "${family}"`);
          return;
        }
        if (font === null) {
          onSkip(rule.selector, problems.get(family) ?? `"${family}" could not be read`);
          return;
        }

        const wanted = leadingPx((leadingDecl as Declaration).value, size);
        if (wanted === null) {
          onSkip(
            rule.selector,
            `line-height ${(leadingDecl as Declaration).value} resolves per font, which needs a browser`
          );
          return;
        }

        const cap = capHeightAt(font, size)!;
        const leading = Math.max(1, Math.round(wanted / pitch)) * pitch;
        const currentSpace = marginTopDecl ? px((marginTopDecl as Declaration).value) : null;
        /*
           Everything above the first baseline, not just the cap.

           A border-top and a padding-top sit between the top of the box and its
           first line, so they move the baseline by their sum and the space has
           to close all three. The fitter learned this in 1.14.0 and this had not.
        */
        const leadIn = (borderTop ?? 0) + (paddingTop ?? 0);
        const space = spaceFor(cap + leadIn, currentSpace ?? leading, pitch);

        /*
           Snapping the leading is not always safe, which took a real stylesheet
           to notice.

           A box is its leading plus its border and padding, and an author who
           has made that sum a whole number of rows has done the thing this tool
           is for, by a route it did not expect. quoin.dev's table cells set a
           31px leading against a 1px rule: neither is a whole row and 32 is.
           Snapping the leading to 32 makes the box 33 and breaks what was right.

           So: snap it when the box is not already whole, or when snapping keeps
           it whole. Leave it alone and say why otherwise. The page loses the
           phase correction for that rule and keeps the rhythm it had, which is
           the better trade when only one of them is on offer.
        */
        const boxOwn = (borderTop ?? 0) + (borderBottom ?? 0) +
          (paddingTop ?? 0) + (paddingBottom ?? 0);
        const whole = (value: number) => {
          const over = ((value % pitch) + pitch) % pitch;
          return over < 0.01 || pitch - over < 0.01;
        };

        if (whole(wanted + boxOwn) && !whole(leading + boxOwn)) {
          onSkip(
            rule.selector,
            `line-height ${wanted}px with ${boxOwn}px of border and padding is ` +
              `already a whole number of rows; snapping it to ${leading} would not be`
          );
          return;
        }

        (leadingDecl as Declaration).value = `${leading}px`;

        const spaceTarget =
          rewriteSpace && currentSpace !== null ? (marginTopDecl as Declaration | null) : null;

        if (spaceTarget) {
          spaceTarget.value = `${space}px`;

          /*
             The trim goes on with the space and never without it.

             An untrimmed box begins half a leading above its first ascent and a
             trimmed one begins at the cap, so adding the trim moves the block's
             first baseline by that half-leading. The space is what puts it back
             on a row. Written together they are one change; written apart the
             first is a page whose blocks have moved and whose spacing has not.

             This plugin used to add the trim unconditionally and write the space
             only where a margin-top already existed, on the reasoning that
             spacing is the destructive thing to touch. The trim is the
             destructive thing. On the stylesheet this site is built from that
             took the page from 38% on the grid to 32%, and its rhythm from 350
             of 374 to 299.
          */
          rule.append(
            { prop: "text-box-trim", value: "trim-both" },
            { prop: "text-box-edge", value: "cap alphabetic" }
          );
        } else {
          /*
             The author has not said the spacing lives here, so it is offered
             rather than imposed, and the trim is withheld with it. Writing
             margin-top onto every rule that sets a size is how you demolish
             somebody's layout while reporting success; writing the trim without
             it is how you do the same thing more quietly.
          */
          rule.append({ prop: "--quoin-space", value: `${space}px` });
          onSkip(
            rule.selector,
            "no margin-top to write the space into, so the trim was withheld too: " +
              "set --quoin-space as the space above this block, or turn on rewriteSpace"
          );
        }
      });
    },
  };
}

quoinPostcss.postcss = true;

export default quoinPostcss;
