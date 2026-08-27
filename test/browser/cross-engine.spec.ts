/* Does the measurement this library rests on give the same answer everywhere?

   If it does not, a grid computed in Chrome is wrong in Firefox and the whole
   thing is decoration. So this runs the same probes in all three engines and
   writes down where they agree.

   It also asks a question that only became askable in August 2026, when
   `text-box-trim` reached its third engine. Canvas `actualBoundingBoxAscent`
   measures the drawn glyph and does not travel between browsers. CSS
   `text-box-edge: cap` is defined against the font's own OpenType
   `sCapHeight`. Those are two different quantities that both get called "cap
   height", and if the second one is portable then the documented limitation
   has a fix rather than a caveat. */

import { test, expect, type Browser } from "@playwright/test";
import { launchEngines, closeEngines, type Engine } from "./engines.ts";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { baselineWithinLineBox } from "../../src/metrics.ts";

const BUNDLE = resolve("dist/quoin.global.js");
const SIZE = 18;
const LINE_HEIGHT = 28;

/* Swept, because a single size tells you a discrepancy exists and nothing
   about what governs it. */
const SWEEP = [12, 14, 16, 18, 24, 32, 48];

/* Families that resolve on every platform this suite runs on. Naming a webfont
   would make the experiment a test of whether the font loaded. */
const STACKS = [
  { label: "serif", css: "serif" },
  { label: "sans-serif", css: "sans-serif" },
  { label: "monospace", css: "monospace" },
  { label: "Georgia", css: "Georgia, serif" },
  { label: "Arial", css: "Arial, sans-serif" },
  { label: "Times", css: '"Times New Roman", serif' },
  { label: "system-ui", css: "system-ui, sans-serif" },
];

interface Reading {
  ascent: number;
  descent: number;
  /** Cap height off the drawn glyph, via canvas. */
  capRaster: number;
  /** Cap height off the font's own tables, via a text-box-trim probe. */
  capTable: number | null;
  xHeight: number;
  resolved: string;
  /**
   * Advance width of a long mixed-case probe.
   *
   * `ctx.font` reads back the family that was ASKED for, not the one the engine
   * found, so it cannot tell you whether two engines resolved `monospace` to
   * the same typeface. The width of thirty glyphs can: two different fonts do
   * not agree on it, and the same font does, to well under a pixel.
   */
  widthSignature: number;
}

async function measureIn(browser: Browser, url: string) {
  const page = await browser.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });

  const data = await page.evaluate(
    ({ stacks, size, lineHeight, sizes }) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      const readings: Record<string, Reading | null> = {};
      const sweep: Record<string, Record<number, { raster: number; table: number | null } | null>> =
        {};

      for (const stack of stacks) {
        const shorthand = `400 ${size}px ${stack.css}`;
        ctx.font = "";
        ctx.font = shorthand;

        if (!ctx.font || !ctx.font.includes(`${size}px`)) {
          readings[stack.label] = null;
        } else {
          const box = ctx.measureText("Hxp");
          const capRaster = ctx.measureText("H").actualBoundingBoxAscent;
          const overshoot = window.quoin.capOvershootFromFontTable(shorthand, lineHeight);
          const halfLeading =
            (lineHeight - (box.fontBoundingBoxAscent + box.fontBoundingBoxDescent)) / 2;
          const baseline = halfLeading + box.fontBoundingBoxAscent;

          readings[stack.label] = {
            ascent: box.fontBoundingBoxAscent,
            descent: box.fontBoundingBoxDescent,
            capRaster,
            capTable: overshoot === null ? null : baseline - overshoot,
            xHeight: ctx.measureText("x").actualBoundingBoxAscent,
            resolved: ctx.font,
            widthSignature:
              Math.round(ctx.measureText("HAMBURGEFONSTIVhamburgefonstiv").width * 100) / 100,
          };
        }

        sweep[stack.label] = {};
        for (const each of sizes) {
          const swept = `400 ${each}px ${stack.css}`;
          ctx.font = "";
          ctx.font = swept;
          if (!ctx.font.includes(`${each}px`)) {
            sweep[stack.label]![each] = null;
            continue;
          }
          const lh = each * 1.5;
          const box = ctx.measureText("Hxp");
          const overshoot = window.quoin.capOvershootFromFontTable(swept, lh);
          const halfLeading =
            (lh - (box.fontBoundingBoxAscent + box.fontBoundingBoxDescent)) / 2;
          sweep[stack.label]![each] = {
            raster: ctx.measureText("H").actualBoundingBoxAscent,
            table:
              overshoot === null
                ? null
                : halfLeading + box.fontBoundingBoxAscent - overshoot,
          };
        }
      }

      return {
        readings,
        sweep,
        supportsTrim: window.quoin.canReadFontTableCapHeight(),
        rasterised: window.quoin.capHeightIsRasterised(),
      };
    },
    { stacks: STACKS, size: SIZE, lineHeight: LINE_HEIGHT, sizes: SWEEP }
  );

  await page.close();
  return data;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function spread(values: number[]): number | null {
  return values.length > 1 ? round(Math.max(...values) - Math.min(...values)) : null;
}


/* These drive their own browsers, so running the file under all three Playwright
   projects would run the same work three times and report it as three results.
   Pinned to one project; the engines are covered inside the test. */
test.skip(({ browserName }) => browserName !== "chromium", "drives its own browsers");

test("font metrics across three engines", async ({ baseURL }) => {
  test.setTimeout(300_000);

  const url = `${baseURL}/metrics.html`;
  const engines: Engine[] = await launchEngines();
  const builds = Object.fromEntries(engines.map((e) => [e.name, e.build]));

  const byEngine: Record<string, Awaited<ReturnType<typeof measureIn>>> = {};
  try {
    for (const engine of engines) {
      byEngine[engine.name] = await measureIn(engine.browser, url);
    }
  } finally {
    await closeEngines(engines);
  }

  const names = Object.keys(byEngine);

  const rows = STACKS.map((stack) => {
    const perEngine = Object.fromEntries(
      names.map((name) => {
        const raw = byEngine[name]!.readings[stack.label];
        if (!raw) return [name, null];
        return [
          name,
          {
            ...raw,
            baseline: round(baselineWithinLineBox(raw, LINE_HEIGHT)),
          },
        ];
      })
    );

    const present = Object.values(perEngine).filter(
      (v): v is NonNullable<typeof v> => v !== null
    );
    const withTable = present.filter((v) => v.capTable !== null);

    /*
       Whether the engines are even looking at the same typeface.

       `serif`, `monospace` and `system-ui` are generic keywords: a promise that
       something will be found, not a statement about what. Chromium, Firefox
       and WebKit each keep their own idea of what satisfies them, and on this
       machine WebKit's monospace is a different font from Chromium's. A metric
       that differs there is not a measurement disagreement. It is two correct
       measurements of two different objects, and folding the two cases together
       is how a portability claim gets made about the wrong thing. */
    const widths = present.map((v) => v.widthSignature);
    const widthSpread = spread(widths) ?? 0;
    /* A tenth of a pixel across thirty glyphs. Subpixel positioning moves this
       by hundredths; a different typeface moves it by tens. */
    const sameFont = widthSpread <= 0.1;
    const resolutions = [...new Set(present.map((v) => normaliseFamily(v.resolved)))];

    return {
      font: stack.label,
      sameFont,
      widthSpread,
      widths: Object.fromEntries(
        names.map((n) => [n, perEngine[n]?.widthSignature ?? null])
      ),
      resolutions,
      engines: perEngine,
      /*
         Three spreads, because the first version of this experiment computed
         only the baseline one, reported "everything agrees" and missed the
         finding entirely. */
      baselineSpread: spread(present.map((v) => v.baseline)),
      capRasterSpread: spread(present.map((v) => v.capRaster)),
      capTableSpread:
        withTable.length === present.length && present.length > 1
          ? spread(withTable.map((v) => v.capTable as number))
          : null,
      /* How far apart the two definitions of "cap height" are inside a single
         engine. Non-zero means they are measuring different objects, which is
         the point. */
      definitionGap: Object.fromEntries(
        Object.entries(perEngine).map(([name, v]) => [
          name,
          v && v.capTable !== null ? round(v.capTable - v.capRaster) : null,
        ])
      ),
    };
  });

  const quantisation = Object.fromEntries(
    names.map((name) => {
      const values = Object.values(byEngine[name]!.sweep)
        .flatMap((sizes) => Object.values(sizes))
        .filter((v): v is { raster: number; table: number | null } => v !== null);
      return [
        name,
        {
          readings: values.length,
          rasterWholePixels: values.filter((v) => Number.isInteger(v.raster)).length,
          tableWholePixels: values.filter(
            (v) => v.table !== null && Number.isInteger(v.table)
          ).length,
          supportsTrim: byEngine[name]!.supportsTrim,
          rasterisedFlag: byEngine[name]!.rasterised,
        },
      ];
    })
  );

  /* Is the gap bounded, or does it scale with the type size? */
  const sizeSweep = SWEEP.map((size) => {
    const gapsRaster: number[] = [];
    const gapsTable: number[] = [];

    for (const stack of STACKS) {
      const raster = names
        .map((n) => byEngine[n]!.sweep[stack.label]?.[size]?.raster)
        .filter((v): v is number => typeof v === "number");
      const table = names
        .map((n) => byEngine[n]!.sweep[stack.label]?.[size]?.table)
        .filter((v): v is number => typeof v === "number");

      if (raster.length > 1) gapsRaster.push(Math.max(...raster) - Math.min(...raster));
      /* Only comparable when every engine produced one. */
      if (table.length === names.length) {
        gapsTable.push(Math.max(...table) - Math.min(...table));
      }
    }

    const worstRaster = gapsRaster.length ? Math.max(...gapsRaster) : 0;
    const worstTable = gapsTable.length ? Math.max(...gapsTable) : null;

    return {
      size,
      rasterWorstPx: round(worstRaster),
      rasterWorstPercent: round((worstRaster / size) * 100),
      tableWorstPx: worstTable === null ? null : round(worstTable),
      tableWorstPercent: worstTable === null ? null : round((worstTable / size) * 100),
    };
  });

  const measured = rows.filter((r) => r.baselineSpread !== null);
  const comparable = measured.filter((r) => r.sameFont);
  const tableComparable = rows.filter((r) => r.capTableSpread !== null);

  const findings = {
    method: {
      size: SIZE,
      lineHeight: LINE_HEIGHT,
      probe: "Hxp for the box, H and x for cap and x height; text-box-trim for the font table",
      engines: names,
      builds,
      tolerance: 0.5,
      caveat:
        "Playwright's WebKit is not Safari: same engine, without Apple's font stack or " +
        "CoreText rasterisation. Good evidence about the engine, weak evidence about the browser.",
    },
    rows,
    sizeSweep,
    quantisation,
    summary: {
      fonts: measured.length,
      /* Only the rows where every engine resolved the same typeface. */
      comparableFonts: comparable.length,
      baselineAgreeingWhereSameFont: comparable.filter((r) => r.baselineSpread === 0).length,
      differentFontResolved: measured
        .filter((r) => !r.sameFont)
        .map((r) => ({ requested: r.font, widths: r.widths, widthSpread: r.widthSpread })),
      baselineAgreeing: measured.filter((r) => r.baselineSpread === 0).length,
      capRasterAgreeing: measured.filter((r) => r.capRasterSpread === 0).length,
      capTableComparable: tableComparable.length,
      capTableAgreeing: tableComparable.filter((r) => r.capTableSpread === 0).length,
      rasterExceedsTolerance: measured
        .filter((r) => (r.capRasterSpread ?? 0) > 0.5)
        .map((r) => ({ font: r.font, spread: r.capRasterSpread })),
      tableExceedsTolerance: tableComparable
        .filter((r) => (r.capTableSpread ?? 0) > 0.5)
        .map((r) => ({ font: r.font, spread: r.capTableSpread })),
    },
  };

  mkdirSync("findings", { recursive: true });
  writeFileSync("findings/cross-engine.json", JSON.stringify(findings, null, 2));

  /* ---------------------------------------------------------------- */

  const pad = (s: unknown, n: number) => String(s).padEnd(n);

  console.log(`\n  BASELINE  (fontBoundingBox)        ${names.map((e) => pad(e, 12)).join("")}spread`);
  for (const row of rows) {
    console.log(
      `  ${pad(row.font, 24)}${names.map((e) => pad(row.engines[e]?.baseline ?? "--", 12)).join("")}` +
        `${row.baselineSpread ?? "--"}`
    );
  }

  console.log(`\n  CAP HEIGHT  off the raster         ${names.map((e) => pad(e, 12)).join("")}spread`);
  for (const row of rows) {
    console.log(
      `  ${pad(row.font, 24)}` +
        names.map((e) => pad(row.engines[e]?.capRaster?.toFixed(2) ?? "--", 12)).join("") +
        `${row.capRasterSpread ?? "--"}`
    );
  }

  console.log(`\n  CAP HEIGHT  off the font table     ${names.map((e) => pad(e, 12)).join("")}spread`);
  for (const row of rows) {
    console.log(
      `  ${pad(row.font, 24)}` +
        names
          .map((e) => pad(row.engines[e]?.capTable?.toFixed(2) ?? "--", 12))
          .join("") +
        `${row.capTableSpread ?? "--"}`
    );
  }

  console.log("\n  WHOLE-PIXEL CAP HEIGHTS (the mechanism)");
  for (const [name, q] of Object.entries(quantisation)) {
    console.log(
      `  ${pad(name, 12)}raster ${q.rasterWholePixels}/${q.readings}` +
        `   font table ${q.tableWholePixels}/${q.readings}` +
        `   text-box-trim: ${q.supportsTrim ? "yes" : "no"}`
    );
  }

  console.log("\n  WORST CAP-HEIGHT GAP BY SIZE          raster        font table");
  for (const point of sizeSweep) {
    console.log(
      `  ${pad(point.size + "px", 10)}` +
        pad(`${point.rasterWorstPx}px (${point.rasterWorstPercent}%)`, 22) +
        (point.tableWorstPx === null
          ? "not comparable"
          : `${point.tableWorstPx}px (${point.tableWorstPercent}%)`)
    );
  }

  console.log(
    `\n  Baseline agrees exactly:            ${findings.summary.baselineAgreeing}/${findings.summary.fonts}` +
      `\n  Cap height off raster agrees:       ${findings.summary.capRasterAgreeing}/${findings.summary.fonts}` +
      `\n  Cap height off font table agrees:   ${findings.summary.capTableAgreeing}/${findings.summary.capTableComparable}\n`
  );

  /* Gated: the experiment has to have actually measured something. */
  expect(measured.length, "at least four fonts resolved in every engine").toBeGreaterThanOrEqual(4);

  /*
     The finding the library's own maths depends on. If this ever fails, the
     seater is computing a grid that only exists in one browser.

     Asserted only across the fonts every engine actually resolved to the same
     typeface. The generic keywords are excluded by measurement rather than by
     hand: `sameFont` is computed from the shorthand each engine hands back. */
  expect(comparable.length, "at least three fonts resolved identically everywhere").toBeGreaterThanOrEqual(3);
  expect(
    findings.summary.baselineAgreeingWhereSameFont,
    "fontBoundingBox must agree across engines: the seater's arithmetic rests on it. " +
      "Disagreeing rows: " +
      JSON.stringify(
        comparable.filter((r) => r.baselineSpread !== 0).map((r) => ({
          font: r.font,
          spread: r.baselineSpread,
        }))
      )
  ).toBe(comparable.length);
});

/*
   `18px satoshi, "satoshi Fallback"` and `18px "satoshi", "satoshi Fallback"`
   are the same resolution serialised two ways, and comparing the raw strings
   would report every font as engine-specific. Quotes and spacing out, case
   folded, size left in, because a different size is a different measurement. */
function normaliseFamily(resolved: string): string {
  return resolved.replace(/["']/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
