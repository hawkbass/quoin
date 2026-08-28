/* A PostCSS plugin, so a build can put its own stylesheet on the grid.

   Everything else in this library needs either a browser or a design file. A
   build has neither at the moment it is processing CSS, and it has the one thing
   that actually matters: the rules themselves, with the sizes and leadings
   already written down.

   So this reads them. Every rule declaring a pixel `font-size` and a
   `line-height` is fitted the way `fitScale` fits a design, with cap heights
   read from the font files you name. No size is ever changed.

   ## What it changes, and what it refuses to

   It snaps the leading to a whole number of rows and adds the trim, because
   those are the two things that cannot be wrong afterwards: a leading off the
   grid puts every line after the first off it too, and every figure here assumes
   the box is trimmed.

   Spacing is where it stops short. The space before a block is what closes that
   block's cap height, and without it the page is not on a grid. It is also the
   most destructive thing to write into somebody's stylesheet, because a real
   site's vertical spacing lives on its containers rather than on its
   paragraphs. Rewriting every rule's `margin-top` is how a study in this
   repository produced numbers that were nonsense in both directions.

   So: a rule that already declares `margin-top` gets it rewritten, because the
   author has already decided that is where the spacing lives. Every other rule
   gets `--quoin-space` and a note. That is a smaller promise than the CLI makes
   and it is one a build can keep. */

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
      root.walkRules((rule) => {
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

        const family = familyDecl ? firstFamily((familyDecl as Declaration).value) : fallback;
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
        const space = spaceFor(cap, currentSpace ?? leading, pitch);

        (leadingDecl as Declaration).value = `${leading}px`;

        if (rewriteSpace && marginTopDecl && currentSpace !== null) {
          (marginTopDecl as Declaration).value = `${space}px`;
        } else {
          /*
             The author has not said the spacing lives here, so it is offered
             rather than imposed. Writing margin-top onto every rule that sets a
             size is how you demolish somebody's layout while reporting success.
          */
          rule.append({ prop: "--quoin-space", value: `${space}px` });
        }

        rule.append(
          { prop: "text-box-trim", value: "trim-both" },
          { prop: "text-box-edge", value: "cap alphabetic" }
        );
      });
    },
  };
}

quoinPostcss.postcss = true;

export default quoinPostcss;
