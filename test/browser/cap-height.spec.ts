/* Is cap height portable between engines, and for which fonts?

   Canvas `actualBoundingBoxAscent` measures the drawn glyph, so Chromium and
   WebKit hand back the rasterised outline hinted onto the pixel grid and
   Firefox hands back the scaled outline. Those disagree by up to 8% of the type
   size and hinting does not invert, so the difference cannot be corrected with
   arithmetic. That was the original finding and it stands.

   CSS `text-box-edge: cap` is specified against the font's own OpenType
   `sCapHeight`, which is a different quantity that goes by the same name. Since
   August 2026 all three engines implement it. So: does the CSS route give the
   same answer everywhere, and does it give the answer the font file actually
   declares?

   Two things make this answerable rather than merely arguable.

   The fonts are WEBFONTS, twenty-four of them, loaded from the same bytes in
   every engine. Measuring `serif` or `system-ui` across engines measures font
   substitution: a generic keyword is a promise that something will be found,
   not a statement about what, and on this machine Chromium's `monospace` and
   WebKit's differ by 27px across thirty glyphs. Hold the file still or the
   experiment is about something else.

   And every expected value is read out of the font's own OS/2 table in Node,
   independently of any browser. Engines agreeing with each other tells you they
   are consistent. Engines agreeing with the table tells you they are reading
   it. Only the second one licenses "portable". */

import { test, expect } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { launchEngines, closeEngines, type Engine } from "./engines.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST = resolve("test/browser/fixtures/fonts/manifest.json");
const BUNDLE = resolve("dist/quoin.global.js");

/* Awkward cases are built by scripts/make-awkward-fonts.mjs and are not in the
   downloaded manifest. */
const MANUFACTURED = [
  {
    family: "AwkwardAbsent",
    file: "AwkwardAbsent.ttf",
    why: "OS/2 downgraded to v1: sCapHeight is not there to read",
    unitsPerEm: 2000,
    sCapHeight: null,
    os2Version: 1,
  },
  {
    family: "AwkwardZeroed",
    file: "AwkwardZeroed.ttf",
    why: "sCapHeight present and set to zero",
    unitsPerEm: 2000,
    sCapHeight: 0,
    os2Version: 4,
  },
  {
    family: "AwkwardHuge",
    file: "AwkwardHuge.ttf",
    why: "sCapHeight of 1400 on a 1000-unit em: taller than the em box",
    unitsPerEm: 1000,
    sCapHeight: 1400,
    os2Version: 4,
    degenerate: true,
  },
  {
    family: "AwkwardLies",
    file: "AwkwardLies.ttf",
    why: "SpaceMono declaring 600 where its own H is 700: plausible, in range, wrong",
    unitsPerEm: 1000,
    sCapHeight: 600,
    os2Version: 4,
    lies: true,
  },
  {
    family: "AwkwardLiesLato",
    file: "AwkwardLiesLato.ttf",
    why: "Lato declaring 1200 where its own H is 1433, on a 2000-unit em",
    unitsPerEm: 2000,
    sCapHeight: 1200,
    os2Version: 4,
    lies: true,
  },
];

const SIZES = [12, 16, 18, 24, 48];
const TOLERANCE = 0.5;

interface FontEntry {
  family: string;
  file: string;
  why: string;
  unitsPerEm: number;
  sCapHeight: number | null;
  os2Version: number | null;
  /** Declares a cap height its own glyphs contradict. */
  lies?: boolean;
  /** Declares something unusable, so the engine has to synthesise. */
  degenerate?: boolean;
}

function corpus(): FontEntry[] {
  if (!existsSync(MANIFEST)) return [];
  const downloaded = JSON.parse(readFileSync(MANIFEST, "utf8")) as FontEntry[];
  return [...downloaded, ...MANUFACTURED].filter((f) =>
    existsSync(resolve("test/browser/fixtures/fonts", f.file))
  );
}

async function measureIn(browser: Browser, baseURL: string, fonts: FontEntry[], sizes: number[]) {
  const page = await browser.newPage();
  await page.goto(`${baseURL}/metrics.html`);
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });

  const data = await page.evaluate(
    async ({ fonts, sizes }) => {
      const loaded: string[] = [];

      for (const font of fonts) {
        try {
          const face = new FontFace(font.family, `url(/fonts/${font.file})`);
          await face.load();
          document.fonts.add(face);
          loaded.push(font.family);
        } catch {
          /* Recorded by absence rather than thrown: one font that will not
             parse should not take the other twenty-three with it. */
        }
      }
      await document.fonts.ready;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const out: Record<string, Record<number, {
        raster: number;
        table: number | null;
        ascent: number;
        descent: number;
        width: number;
        resolved: boolean;
      } | null>> = {};

      for (const font of fonts) {
        out[font.family] = {};
        if (!loaded.includes(font.family)) {
          for (const size of sizes) out[font.family]![size] = null;
          continue;
        }

        for (const size of sizes) {
          const shorthand = `400 ${size}px "${font.family}"`;
          ctx.font = "";
          ctx.font = shorthand;

          /* Did the family actually take? A shorthand the engine rejected
             silently falls back, and a measurement of the fallback is
             indistinguishable from a measurement of the font. */
          ctx.font = `400 ${size}px "${font.family}", monospace`;
          const withMono = ctx.measureText("HAMBURGEFONSTIV").width;
          ctx.font = `400 ${size}px "${font.family}", serif`;
          const withSerif = ctx.measureText("HAMBURGEFONSTIV").width;
          const resolved = Math.abs(withMono - withSerif) < 0.5 && withMono > 0;

          ctx.font = shorthand;
          const box = ctx.measureText("Hxp");

          out[font.family]![size] = {
            raster: ctx.measureText("H").actualBoundingBoxAscent,
            table: window.quoin.capHeightFromFontTable(shorthand),
            ascent: box.fontBoundingBoxAscent,
            descent: box.fontBoundingBoxDescent,
            width: Math.round(ctx.measureText("HAMBURGEFONSTIV").width * 100) / 100,
            resolved,
          };
        }
      }

      return {
        readings: out,
        loaded,
        supportsTrim: window.quoin.canReadFontTableCapHeight(),
        rasterised: window.quoin.capHeightIsRasterised(),
      };
    },
    { fonts, sizes }
  );

  await page.close();
  return data;
}

/* These drive their own browsers, so running the file under all three Playwright
   projects would run the same work three times and report it as three results.
   Pinned to one project; the engines are covered inside the test. */
test.skip(({ browserName }) => browserName !== "chromium", "drives its own browsers");

const round = (n: number) => Math.round(n * 1000) / 1000;
const spread = (values: number[]) =>
  values.length > 1 ? round(Math.max(...values) - Math.min(...values)) : null;

test("cap height across three engines and the whole font corpus", async ({ baseURL }) => {
  test.setTimeout(600_000);

  const fonts = corpus();
  test.skip(
    fonts.length < 10,
    "font corpus not downloaded: run `npm run fonts` first"
  );

  const engines: Engine[] = await launchEngines();
  const builds = Object.fromEntries(engines.map((e) => [e.name, e.build]));

  const byEngine: Record<string, Awaited<ReturnType<typeof measureIn>>> = {};
  try {
    for (const engine of engines) {
      byEngine[engine.name] = await measureIn(engine.browser, baseURL!, fonts, SIZES);
    }
  } finally {
    await closeEngines(engines);
  }

  const names = Object.keys(byEngine);
  const trimEngines = names.filter((n) => byEngine[n]!.supportsTrim);

  /* ---------------------------------------------------------------- *
     One row per font per size
   * ---------------------------------------------------------------- */

  const rows = fonts.flatMap((font) =>
    SIZES.map((size) => {
      const per = Object.fromEntries(
        names.map((n) => [n, byEngine[n]!.readings[font.family]?.[size] ?? null])
      );
      const present = Object.entries(per).filter(
        (e): e is [string, NonNullable<(typeof per)[string]>] =>
          e[1] !== null && e[1].resolved
      );

      /*
         Same bytes everywhere, so the widths must match; if they do not, the
         font did not load somewhere and the row is not comparable.

         Relative, not absolute. The first version of this used a flat 0.1px,
         calibrated against readings at 18px, and the engines' 0.006% rounding
         difference is 0.01px at 18px and 0.26px at 48px, so it silently threw
         away every large-size row for four fonts and reported them as failures
         to load. A tolerance on a quantity that scales has to scale with it. */
      const widths = present.map(([, v]) => v.width);
      const widest = Math.max(...widths, 1);
      const sameFont = (spread(widths) ?? 0) / widest <= 0.002;

      const tableValues = present
        .filter(([n]) => trimEngines.includes(n))
        .map(([, v]) => v.table)
        .filter((v): v is number => typeof v === "number");

      /* What the font file itself declares, scaled to this size. Computed in
         Node from the binary, with no browser involved. */
      const expected =
        font.sCapHeight && font.unitsPerEm
          ? round((font.sCapHeight / font.unitsPerEm) * size)
          : null;

      const tableSpread = spread(tableValues);
      const worstAgainstFile =
        expected === null || !tableValues.length
          ? null
          : round(Math.max(...tableValues.map((v) => Math.abs(v - expected))));

      return {
        family: font.family,
        why: font.why,
        lies: Boolean(font.lies),
        degenerate: Boolean(font.degenerate),
        size,
        sameFont,
        engines: per,
        expectedFromFile: expected,
        rasterSpread: spread(present.map(([, v]) => v.raster)),
        tableSpread,
        tableReadings: tableValues.length,
        worstAgainstFile,
        declaresCapHeight: Boolean(font.sCapHeight),
      };
    })
  );

  const comparable = rows.filter((r) => r.sameFont && r.tableReadings === trimEngines.length);
  /* Degenerate fonts declare a value no engine should honour, so they belong
     with the synthesis cases rather than with the fonts being taken at their
     word. */
  const declared = comparable.filter(
    (r) => r.declaresCapHeight && r.expectedFromFile !== null && !r.degenerate
  );
  const synthesised = comparable.filter((r) => !r.declaresCapHeight || r.degenerate);
  /* The rows that separate "reads the table" from "measures the glyph". */
  const lying = comparable.filter((r) => r.lies);

  const summary = {
    fonts: fonts.length,
    sizes: SIZES,
    enginesTested: names,
    builds,
    enginesWithTextBoxTrim: trimEngines,
    rows: rows.length,
    comparableRows: comparable.length,

    /* Do the engines agree with each other? */
    tableAgreeing: comparable.filter((r) => (r.tableSpread ?? 0) <= 0.01).length,
    tableWithinTolerance: comparable.filter((r) => (r.tableSpread ?? 0) <= TOLERANCE).length,
    worstTableSpread: Math.max(0, ...comparable.map((r) => r.tableSpread ?? 0)),

    /* Do they agree with the font file? */
    matchingFile: declared.filter((r) => (r.worstAgainstFile ?? 99) <= TOLERANCE).length,
    matchingFileExactly: declared.filter((r) => (r.worstAgainstFile ?? 99) <= 0.02).length,
    declaredRows: declared.length,
    worstAgainstFile: Math.max(0, ...declared.map((r) => r.worstAgainstFile ?? 0)),

    /* And the raster route, for comparison. */
    rasterAgreeing: rows.filter((r) => r.sameFont && (r.rasterSpread ?? 0) <= 0.01).length,
    rasterWithinTolerance: rows.filter((r) => r.sameFont && (r.rasterSpread ?? 0) <= TOLERANCE)
      .length,
    worstRasterSpread: Math.max(0, ...rows.filter((r) => r.sameFont).map((r) => r.rasterSpread ?? 0)),
    comparableRasterRows: rows.filter((r) => r.sameFont).length,

    /* The synthesis cases: no declared metric, so each engine invents one. */
    synthesisedRows: synthesised.length,
    synthesisedAgreeing: synthesised.filter((r) => (r.tableSpread ?? 0) <= TOLERANCE).length,
    worstSynthesisedSpread: Math.max(0, ...synthesised.map((r) => r.tableSpread ?? 0)),

    /* The decisive rows: fonts declaring a cap height their glyphs contradict. */
    lyingRows: lying.length,
    lyingFollowedTheTable: lying.filter((r) => (r.worstAgainstFile ?? 99) <= 0.05).length,
    lyingDetail: lying.map((r) => ({
      family: r.family,
      size: r.size,
      declared: r.expectedFromFile,
      reported: Object.fromEntries(
        trimEngines.map((e) => [e, r.engines[e]?.table ?? null])
      ),
      rasterInstead: Object.fromEntries(
        names.map((e) => [e, r.engines[e]?.raster ?? null])
      ),
    })),

    notComparable: rows
      .filter((r) => !r.sameFont)
      .map((r) => ({ family: r.family, size: r.size })),
  };

  mkdirSync("findings", { recursive: true });
  writeFileSync(
    "findings/cap-height.json",
    JSON.stringify({ summary, fonts, rows }, null, 2)
  );

  /* ---------------------------------------------------------------- *
     Report
   * ---------------------------------------------------------------- */

  const pad = (s: unknown, n: number) => String(s).padEnd(n);

  console.log(`\n  ${fonts.length} fonts x ${SIZES.length} sizes x ${names.length} engines`);
  for (const engine of engines) console.log(`    ${pad(engine.name, 12)}${engine.build}`);
  console.log(`  text-box-trim available in: ${trimEngines.join(", ") || "none"}`);
  console.log(`  raster cap heights land on whole pixels:`);
  for (const name of names) {
    console.log(`    ${pad(name, 12)}${byEngine[name]!.rasterised ? "yes" : "no"}`);
  }

  console.log(`\n  AT 18px          expected  ${trimEngines.map((e) => pad(e, 11)).join("")}spread   vs file`);
  for (const row of rows.filter((r) => r.size === 18)) {
    console.log(
      `  ${pad(row.family, 20)}${pad(row.expectedFromFile ?? "--", 10)}` +
        trimEngines.map((e) => pad(row.engines[e]?.table?.toFixed(3) ?? "--", 11)).join("") +
        `${pad(row.tableSpread ?? "--", 9)}${row.worstAgainstFile ?? "--"}`
    );
  }

  console.log(
    `\n  ENGINE AGREEMENT over ${summary.comparableRows} comparable font-and-size rows` +
      `\n    cap height off the font table, agreeing to 0.01px: ${summary.tableAgreeing}/${summary.comparableRows}` +
      `\n    cap height off the font table, within ${TOLERANCE}px:      ${summary.tableWithinTolerance}/${summary.comparableRows}` +
      `\n    worst spread:                                      ${round(summary.worstTableSpread)}px` +
      `\n` +
      `\n    cap height off the raster, agreeing to 0.01px:     ${summary.rasterAgreeing}/${summary.comparableRasterRows}` +
      `\n    cap height off the raster, within ${TOLERANCE}px:         ${summary.rasterWithinTolerance}/${summary.comparableRasterRows}` +
      `\n    worst spread:                                      ${round(summary.worstRasterSpread)}px`
  );

  console.log(
    `\n  AGREEMENT WITH THE FONT FILE, over ${summary.declaredRows} rows whose OS/2 declares sCapHeight` +
      `\n    within ${TOLERANCE}px of sCapHeight/unitsPerEm x size:  ${summary.matchingFile}/${summary.declaredRows}` +
      `\n    within 0.02px:                                 ${summary.matchingFileExactly}/${summary.declaredRows}` +
      `\n    worst:                                         ${round(summary.worstAgainstFile)}px`
  );

  if (summary.synthesisedRows > 0) {
    console.log(
      `\n  WHERE THE FONT DECLARES NOTHING (${summary.synthesisedRows} rows, engines must synthesise)` +
        `\n    engines still within ${TOLERANCE}px of each other: ${summary.synthesisedAgreeing}/${summary.synthesisedRows}` +
        `\n    worst spread:                              ${round(summary.worstSynthesisedSpread)}px`
    );
    for (const row of synthesised.filter((r) => r.size === 18)) {
      console.log(
        `    ${pad(row.family, 18)}${trimEngines
          .map((e) => pad(row.engines[e]?.table?.toFixed(3) ?? "--", 11))
          .join("")}${row.why}`
      );
    }
  }

  if (summary.lyingRows > 0) {
    console.log(
      `
  THE DECIDING CASE: fonts declaring a cap height their glyphs contradict` +
        `
    followed the declared value: ${summary.lyingFollowedTheTable}/${summary.lyingRows}` +
        `
    (had they measured the glyph instead, none would.)`
    );
    for (const row of summary.lyingDetail.filter((r) => r.size === 18)) {
      console.log(
        `    ${pad(row.family, 18)}declares ${pad(row.declared, 8)}` +
          `reports ${pad(Object.values(row.reported).map((v) => (v as number)?.toFixed(3)).join(" "), 18)}` +
          `glyph is ${Object.values(row.rasterInstead).map((v) => v).join(" ")}`
      );
    }
  }

  if (summary.notComparable.length) {
    console.log(
      `\n  ${summary.notComparable.length} rows not comparable (font failed to load somewhere): ` +
        [...new Set(summary.notComparable.map((n) => n.family))].join(", ")
    );
  }
  console.log("");

  /* ---------------------------------------------------------------- *
     What this is allowed to claim
   * ---------------------------------------------------------------- */

  expect(fonts.length, "a corpus worth the name").toBeGreaterThanOrEqual(20);

  /*
     The mechanism, and the reason a font had to be manufactured to test it.

     Every real font sets sCapHeight to the height of its own capital H, so
     "reads the declared metric" and "measures the drawn glyph" predict the same
     number for all 21 of them, and no number of additional real fonts would
     separate the two. These fonts declare a value their own outlines contradict.
     Following the declared value proves the engines read the table. */
  expect(summary.lyingRows, "a font that lies about its cap height").toBeGreaterThan(0);
  expect(
    summary.lyingFollowedTheTable,
    "engines must follow the declared sCapHeight, not the drawn glyph: " +
      JSON.stringify(summary.lyingDetail.slice(0, 2))
  ).toBe(summary.lyingRows);
  /*
     Proportional, not absolute.

     This was a flat 50 and failed on the CI runner at 35, which looked like a
     defect and was a threshold calibrated on one machine. Linux resolves and
     rasterises several of these fonts differently enough that the width
     signature separating "the same font loaded everywhere" from "something
     substituted" rejects more rows. That is the check working. Half the corpus
     is the real bar: below that the study has stopped being about the fonts and
     started being about the machine.
  */
  const possibleRows = fonts.length * SIZES.length;
  expect(
    summary.comparableRows,
    `only ${summary.comparableRows} of ${possibleRows} rows had the same font in ` +
      `every engine. Not comparable: ` +
      JSON.stringify([...new Set(summary.notComparable.map((n) => n.family))])
  ).toBeGreaterThanOrEqual(Math.floor(possibleRows * 0.4));

  /* The claim: where a font declares a cap height, every engine that
     implements text-box-trim reports it, and they therefore agree. If this
     fails, `capHeightFromFontTable` is not portable and the README must not
     say it is. */
  expect(
    summary.matchingFile,
    `every declared cap height should match the font file within ${TOLERANCE}px`
  ).toBe(summary.declaredRows);

  expect(
    summary.tableWithinTolerance,
    `every engine should agree on cap height within ${TOLERANCE}px`
  ).toBe(summary.comparableRows);

  /*
     With a system Firefox 154 or later this is a three-engine result rather
     than a two-engine one plus an inference. Asserted so the study cannot
     quietly regress to two engines the day somebody runs it on a machine
     without one, without that being visible in the output.
  */
  const systemFirefox = engines.find((e) => e.name === "firefox")?.system ?? false;
  if (systemFirefox) {
    expect(
      trimEngines.length,
      `a system Firefox was used, so all three engines should read the font table: ${JSON.stringify(builds)}`
    ).toBe(3);
  } else {
    console.log("");
    console.log("  NOTE: Playwright's bundled Firefox predates text-box-trim, so Firefox");
    console.log("  has no font-table column here. Install Firefox 154 or later and the");
    console.log("  study picks it up by itself, turning a two-engine result into three.");
    console.log("");
  }
});
