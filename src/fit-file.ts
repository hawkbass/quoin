/* Fitting from font files, with no browser anywhere in it.

   `fitScale` measures the font a browser resolved, which is the right thing when
   there is a browser. Fitting a design is a build-time question, and needing
   Playwright to answer it rules the tool out of every pipeline that does not
   already have one: a PostCSS step, a Vite plugin, a design-token build, an
   agent with no display.

   This reads the same numbers out of the OS/2 table instead. That is only
   permissible because of what the cap-height study found: `text-box-edge: cap`
   is defined against `sCapHeight`, and across 130 fonts the browsers agreed with
   the file to a worst case of 0.022px. The number in the file is the number the
   engine will use.

   It is worth being clear about what is given up. A browser tells you which font
   actually rendered; a file tells you about the file. If the page ends up setting
   something else, because the webfont failed or the stack fell through, the fit
   describes a typeface nobody saw. `fitScale` is still the better answer when a
   page exists to measure. This is the answer when one does not yet. */

import type { GridConfig } from "./grid.ts";
import {
  readFontMetrics,
  capHeightAt,
  FontFileError,
  type FontFileMetrics,
  type Inflate,
} from "./font-file.ts";
import { fitWith, type CapSource, type FamilyRequest, type FittedScale } from "./fit-core.ts";

export {
  fittedScaleToCss,
  type DesignStep,
  type FamilyRequest,
  type FittedStep,
  type FittedFamily,
  type FittedScale,
} from "./fit-core.ts";

export { readFontMetrics, capHeightAt, FontFileError } from "./font-file.ts";
export type { FontFileMetrics } from "./font-file.ts";

/** A family, and the bytes of the file it is set in. */
export interface FamilyFile {
  /** The CSS family, exactly as it will be set on the page. */
  font: string;
  /** The font file's bytes: a TTF, an OTF or a WOFF. */
  bytes: Uint8Array;
}

export interface FitFromFilesResult extends FittedScale {
  /**
   * What each family's file turned out to be, so a caller can see the cap height
   * every figure was derived from rather than taking it on trust.
   */
  fonts: {
    font: string;
    metrics: FontFileMetrics | null;
    /** Why this file could not be used, when it could not. */
    problem: string | null;
  }[];
}

/**
 * Fit a design using metrics read from font files.
 *
 * Every family in `families` needs a matching entry in `files`, keyed by the
 * same `font` string. A family with no file, or whose file declares no cap
 * height, is reported rather than guessed at: a font that predates OS/2 version
 * 2 has no `sCapHeight`, and synthesising one from the ascender would put every
 * baseline on the wrong row while looking like it had worked.
 */
export function fitFromFiles(
  families: readonly FamilyRequest[],
  files: readonly FamilyFile[],
  options: Partial<GridConfig> & { inflate?: Inflate; edge?: string } = {}
): FitFromFilesResult {
  /*
     Only `cap alphabetic` here, and refused rather than approximated otherwise.

     The file gives `sCapHeight`, which is exactly the box `cap alphabetic`
     produces. Any other edge is a different metric: the ideographic em is not in
     OS/2 in a form this reads, and guessing one from the ascender would produce a
     stylesheet that is confidently wrong for a whole script.
  */
  if (options.edge && options.edge !== "cap alphabetic") {
    throw new Error(
      `quoin: fitting from font files only supports text-box-edge "cap alphabetic", ` +
        `not "${options.edge}". The file declares a cap height and nothing else this ` +
        "can use, so a different edge has to be measured in a browser."
    );
  }

  const parsed = new Map<string, FontFileMetrics>();
  const problems = new Map<string, string>();

  for (const file of files) {
    try {
      const metrics = readFontMetrics(file.bytes, options.inflate);
      if (metrics.capHeight === null) {
        problems.set(
          file.font,
          metrics.capHeightImplausible
            ? "the file declares a cap height taller than the em, which the browsers " +
              "refuse and measure the glyphs instead. Fitting from this file would " +
              "not describe what the engine draws."
            : metrics.os2Version === null
              ? "no OS/2 table, so the file declares no cap height"
              : `OS/2 version ${metrics.os2Version} declares no cap height, which needs version 2 or later`
        );
        continue;
      }
      parsed.set(file.font, metrics);
    } catch (error) {
      problems.set(
        file.font,
        error instanceof FontFileError ? error.message : String(error)
      );
    }
  }

  for (const family of families) {
    if (!parsed.has(family.font) && !problems.has(family.font)) {
      problems.set(family.font, "no font file was given for this family");
    }
  }

  const source: CapSource = {
    capHeight(font, size) {
      const metrics = parsed.get(font);
      return metrics ? capHeightAt(metrics, size) : null;
    },
    /* A file that parsed is a file that exists, which is as much as this can
       honestly claim. Whether the page ends up rendering it is a question only
       a page can answer. */
    resolved: (font) => parsed.has(font),
  };

  const fitted = fitWith(families, source, options);

  return {
    ...fitted,
    fonts: [...new Set([...families.map((f) => f.font), ...files.map((f) => f.font)])].map(
      (font) => ({
        font,
        metrics: parsed.get(font) ?? null,
        problem: problems.get(font) ?? null,
      })
    ),
  };
}
