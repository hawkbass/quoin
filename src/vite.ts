/* A Vite plugin.

   Two jobs, and they are separable on purpose.

   It runs the PostCSS plugin over the project's CSS, which snaps every leading
   to a whole number of rows and adds the trim.

   And it serves the fitted tokens as a module you can import, so a design that
   lives in a JSON file rather than in the stylesheet is available to the
   stylesheet:

       import "quoin/tokens.css"

   That second half exists because most design systems keep their scale in tokens
   and generate the CSS, and a plugin that could only read CSS would be useless
   to exactly those projects.

   No browser at either point. Cap heights come from the OS/2 table, which is the
   same number the engines use for `text-box-edge: cap` and agrees with them to
   eight thousandths of a pixel. */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { inflateSync } from "node:zlib";
import { fitFromFiles, type FamilyFile } from "./fit-file.ts";
import { fittedScaleToCss } from "./fit-core.ts";
import { normaliseDesign } from "./design-input.ts";
import { quoinPostcss, type QuoinPostcssOptions } from "./postcss.ts";

export interface QuoinViteOptions {
  /** Grid pitch, in px. */
  pitch?: number;
  /**
   * A design to fit, or the path to a JSON file holding one.
   *
   * Whatever shape you have it in: `normaliseDesign` takes Figma's spelling, a
   * flat token file, or the canonical families array. Each family needs a `file`
   * pointing at its font, because there is no browser here to measure one.
   */
  design?: string | object;
  /**
   * Also run the PostCSS plugin over the project's CSS.
   *
   * Needs `fonts`, because reading a stylesheet tells you the family a rule sets
   * and not where that family's file is. Off unless you give it one.
   */
  css?: Omit<QuoinPostcssOptions, "pitch">;
  /** The specifier the tokens are served at. */
  virtualId?: string;
}

/* Vite's plugin type is not imported, for the reason nothing else here is
   imported either: this package has no dependencies and a type-only import of
   `vite` would make it need one to type-check. The shape is small. */
interface VitePlugin {
  name: string;
  enforce?: "pre" | "post";
  config?: () => unknown;
  configResolved?: (config: { root: string }) => void;
  resolveId?: (id: string) => string | null;
  load?: (id: string) => string | null;
}

/**
 * Put a project on a baseline grid at build time.
 *
 * ```js
 * // vite.config.js
 * import quoin from "quoin/vite";
 *
 * export default {
 *   plugins: [
 *     quoin({
 *       design: "./design.json",
 *       css: { fonts: { Lato: "./fonts/Lato.ttf" }, defaultFont: "Lato" },
 *     }),
 *   ],
 * };
 * ```
 */
export function quoinVite(options: QuoinViteOptions = {}): VitePlugin {
  const pitch = options.pitch ?? 8;
  const virtualId = options.virtualId ?? "quoin/tokens.css";
  const resolved = `\0${virtualId}`;

  let tokens: string | null = null;
  /*
     The project root, not the process's working directory.

     A relative `design` path means relative to the project, which is what
     anybody writing a Vite config expects and is not where Node happens to have
     been started. Getting this wrong made the plugin look for a design file in
     whichever directory the build was launched from.
  */
  let root = process.cwd();

  const build = (): string => {
    if (tokens !== null) return tokens;

    if (!options.design) {
      /* An empty stylesheet rather than an error. Importing the tokens without
         having given a design is a mistake worth naming, and breaking the build
         over it is not: the comment says what happened and the page still
         loads. */
      tokens =
        "/* quoin: no design was given to the Vite plugin, so there is nothing\n" +
        " * to put here. Pass `design` to quoin() in your Vite config. */\n";
      return tokens;
    }

    const path =
      typeof options.design === "string" ? resolvePath(root, options.design) : null;

    const raw = path ? JSON.parse(readFileSync(path, "utf8")) : options.design;

    /* Font files are relative to the design that names them when there is one,
       and to the project root when the design was passed inline. */
    const base = path ? resolvePath(path, "..") : root;

    const { families, notes } = normaliseDesign(raw);
    for (const note of notes) console.warn(`quoin: ${note}`);

    const files: FamilyFile[] = [];
    for (const family of families) {
      if (!family.file) continue;
      files.push({
        font: family.font,
        bytes: new Uint8Array(readFileSync(resolvePath(base, family.file))),
      });
    }

    const fitted = fitFromFiles(families, files, {
      pitch: (raw as { pitch?: number }).pitch ?? pitch,
      inflate: (compressed) => new Uint8Array(inflateSync(compressed)),
    });

    for (const font of fitted.fonts) {
      if (font.problem) console.warn(`quoin: ${font.font}: ${font.problem}`);
    }

    tokens = fittedScaleToCss(fitted);
    return tokens;
  };

  return {
    name: "quoin",
    /* Before the CSS pipeline, so the PostCSS plugin is in place when Vite
       processes a stylesheet rather than after it has finished. */
    enforce: "pre",

    configResolved(config) {
      root = config.root;
    },

    config() {
      if (!options.css) return {};
      return {
        css: {
          postcss: {
            plugins: [quoinPostcss({ ...options.css, pitch })],
          },
        },
      };
    },

    resolveId(id) {
      return id === virtualId ? resolved : null;
    },

    load(id) {
      return id === resolved ? build() : null;
    },
  };
}

export default quoinVite;
