/* Point it at a URL.

   The library measures inside a page. This drives a browser to the page first,
   which is the difference between a tool you can run on your own site and one
   you can run on anybody's. Every finding in this repository, the corpus
   survey, the cross-engine divergence, came out of the second kind. */

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GridReport } from "./grid.ts";
import { bestOrigin } from "./grid.ts";
import type { TextNodeResult } from "./verify.ts";
import type { SeatResult } from "./seat.ts";
import { readPdfText, baselinesFromTop } from "./pdf.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `
quoin: it puts a web page on a baseline grid

  quoin check <url>          how much of the page is on the grid
  quoin seat  <url>          seat it, and print the CSS that does the same
  quoin engine [url]         what this engine's font metrics do
  quoin scale                solve a type scale that needs no correction
  quoin rhythm <url>         which boxes are not a whole number of rows, and why
  quoin fit                  fit a whole design to one grid, every family at once
  quoin print <url>          render it to PDF and read the baselines back out
  quoin columns <url>        the other axis: does the column module divide

Options
  --pitch <px>               grid pitch                        (default 8)
  --tolerance <px>           how far off still counts as on    (default 0.5)
  --origin <px|auto>         where the grid starts          (default auto)
  --ignore <selectors>       comma-separated, skipped entirely
  --viewport <WxH>           browser size                (default 1280x900)
  --browser <name>           chromium | firefox | webkit  (default chromium)
  --wait <ms>                settle time after load          (default 800)
  --mode <full|first-line>   snap the leading too, or only seat line one
  --min <percent>            exit non-zero below this         (check only)
  -o, --out <file>           write the CSS here                (seat only)
  --important                add !important to every rule      (seat only)
  --font <stack>             CSS font family                 (scale only)
  --sizes <a,b,c>            the sizes you want              (scale only)
  --basis <line-box|cap>     phase from the line box, or from a trimmed cap
  --design <file|->          a design as JSON, for fit. Use - for stdin
  --edge <text-box-edge>     default "cap alphabetic"; ex and text also work
  --space <margin|padding>   which property carries the space (default margin)
  --columns                  emit break-inside: avoid too, for a page in columns
  --print-margin <pt>        the @page margin, for print. Solved when omitted
  --grid-columns <n>         columns for the horizontal check. Solved when omitted
  --gutter <px>              the gutter between them. Solved when omitted
  --from <url>               read the design off a page instead, for fit
  --near <px>                how far from those is acceptable (default 3)
  --json                     machine-readable output
  -h, --help                 this

Examples
  npx quoin check https://example.com
  npx quoin check https://example.com --pitch 4 --min 90
  npx quoin seat https://example.com -o baseline.css
  npx quoin engine --browser firefox
  npx quoin scale --font "EB Garamond" --sizes 16,20,28,40
  npx quoin rhythm https://example.com
  npx quoin print https://example.com
  npx quoin columns https://example.com
`;

interface Options {
  pitch: number;
  tolerance: number;
  /* A number, or "auto" to solve for the origin the page is already built on.

     Auto by default, because zero asks whether baselines sit on multiples of
     the pitch from the top of the document, and a page with a header answers no
     however well it is set. Reporting nought per cent for a page that is on an
     8px grid starting at 3 is not a stricter reading, it is a wrong one. */
  origin: number | "auto";
  ignore: string[];
  viewport: { width: number; height: number };
  browser: "chromium" | "firefox" | "webkit";
  wait: number;
  mode: "full" | "first-line";
  min: number | null;
  out: string | null;
  font: string;
  sizes: number[];
  near: number;
  important: boolean;
  json: boolean;
  /** Path to a design description for `fit`, or "-" for stdin. */
  design: string | null;
  /** A URL to read the design off, instead of a file. */
  from: string | null;
  /* The `text-box-edge` to fit against. Cap height is a Latin idea, though it
     turns out to grid every script correctly because a trimmed box comes from
     the font rather than from the glyphs. */
  edge: string | null;
  /* Which property carries the space. Padding is what survives a column break. */
  space: "margin" | "padding" | null;
  /* The @page margin in points, so print knows where each page grid starts. */
  printMargin: number | null;
  /* Whether to emit break-inside: avoid, which is the other half of columns. */
  columns: boolean;
  /* How many columns the horizontal check measures against. Solved when null. */
  gridColumns: number | null;
  /* The gutter between them, in px. Solved when null. */
  gutter: number | null;
}

function fail(message: string): never {
  console.error(`quoin: ${message}`);
  process.exit(2);
}

function parseArgs(argv: string[]): { command: string; url: string | null; options: Options } {
  const options: Options = {
    pitch: 8,
    tolerance: 0.5,
    origin: "auto",
    ignore: [],
    viewport: { width: 1280, height: 900 },
    browser: "chromium",
    wait: 800,
    mode: "full",
    min: null,
    out: null,
    font: "serif",
    sizes: [16, 20, 28, 40],
    near: 3,
    important: false,
    json: false,
    design: null,
    from: null,
    edge: null,
    space: null,
    printMargin: null,
    columns: false,
    gridColumns: null,
    gutter: null,
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;

    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    const number = (): number => {
      const raw = next();
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) fail(`${arg} wants a number, got ${raw}`);
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        console.log(USAGE.trim());
        process.exit(0);
        break;
      case "--pitch": options.pitch = number(); break;
      case "--tolerance": options.tolerance = number(); break;
      case "--origin": {
        /* `--origin auto` is the default and is still accepted explicitly, so a
           script that wants to be unambiguous can say so. */
        const raw = next();
        if (raw === "auto") { options.origin = "auto"; break; }
        const value = Number(raw);
        if (!Number.isFinite(value)) fail(`--origin needs a number or "auto", got ${raw}`);
        options.origin = value;
        break;
      }
      case "--wait": options.wait = number(); break;
      case "--min": options.min = number(); break;
      case "--ignore":
        options.ignore = next().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--viewport": {
        const raw = next();
        const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(raw);
        if (!match) fail(`--viewport wants WIDTHxHEIGHT, e.g. 1280x900, got ${raw}`);
        options.viewport = { width: Number(match[1]), height: Number(match[2]) };
        break;
      }
      case "--browser": {
        const value = next();
        if (value !== "chromium" && value !== "firefox" && value !== "webkit") {
          fail(`--browser wants chromium, firefox or webkit, got ${value}`);
        }
        options.browser = value;
        break;
      }
      case "--mode": {
        const value = next();
        if (value !== "full" && value !== "first-line") {
          fail(`--mode wants full or first-line, got ${value}`);
        }
        options.mode = value;
        break;
      }
      case "--font": options.font = next(); break;
      case "--near": options.near = number(); break;
      case "--design": options.design = next(); break;
      case "--from": options.from = next(); break;
      case "--edge": options.edge = next(); break;
      case "--space": {
        const value = next();
        if (value !== "margin" && value !== "padding") {
          fail(`--space wants margin or padding, got ${value}`);
        }
        options.space = value;
        break;
      }
      case "--grid-columns": {
        const value = Number.parseInt(next(), 10);
        if (!Number.isFinite(value) || value < 1 || value > 32) {
          fail(`--grid-columns wants a count between 1 and 32, got ${value}`);
        }
        options.gridColumns = value;
        break;
      }
      case "--gutter": {
        const value = Number.parseFloat(next());
        if (!Number.isFinite(value) || value < 0) {
          fail(`--gutter wants a number of px, got ${value}`);
        }
        options.gutter = value;
        break;
      }
      case "--print-margin": {
        const value = Number.parseFloat(next());
        if (!Number.isFinite(value) || value < 0) {
          fail(`--print-margin wants a number of points, got ${value}`);
        }
        options.printMargin = value;
        break;
      }
      case "--columns":
        /* Implies padding, because break-inside on its own does not stop the
           margin being truncated and half a recipe is worse than none. */
        options.columns = true;
        if (options.space === null) options.space = "padding";
        break;
      case "--sizes": {
        const raw = next();
        const parsed = raw.split(",").map((v) => Number.parseFloat(v.trim()));
        if (parsed.some((v) => !Number.isFinite(v) || v <= 0)) {
          fail(`--sizes wants a comma-separated list of positive numbers, got ${raw}`);
        }
        options.sizes = parsed;
        break;
      }
      case "-o":
      case "--out": options.out = next(); break;
      case "--important": options.important = true; break;
      case "--json": options.json = true; break;
      default:
        if (arg.startsWith("-")) fail(`unknown option ${arg}`);
        positional.push(arg);
    }
  }

  return { command: positional[0] ?? "", url: positional[1] ?? null, options };
}

function bundle(name = "quoin.global.js"): string {
  /* Whatever the build just produced, so the CLI and the console API can never
     be two different versions of the same tool. */
  for (const candidate of [name, `../dist/${name}`]) {
    try {
      return readFileSync(join(HERE, candidate), "utf8");
    } catch {
      /* try the next */
    }
  }
  return fail("could not find the built bundle. Run `npm run build`.");
}

async function launch(name: Options["browser"]) {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return fail(
      "this command drives a real browser, and playwright is not installed.\n" +
        "  npm install -D playwright && npx playwright install\n" +
        "  The library itself has no dependencies. Only this command needs one."
    );
  }
  return playwright[name].launch();
}

async function open(url: string, options: Options) {
  const browser = await launch(options.browser);
  const page = await browser.newPage({ viewport: options.viewport });

  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    if (response && !response.ok()) {
      console.error(`quoin: warning, ${url} returned ${response.status()}`);
    }
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(options.wait);
    await page.addScriptTag({ content: bundle() });
    return { browser, page };
  } catch (error) {
    await browser.close();
    const message = error instanceof Error ? error.message : String(error);
    /* A content security policy that refuses injected scripts is a correct
       policy and a real limit on this method, so it gets said plainly rather
       than reported as a crash. */
    if (/content security policy/i.test(message)) {
      return fail(
        `${url} refuses injected scripts (Content Security Policy).\n` +
          "  That is a correct policy, and there is no way around it from outside\n" +
          "  the page. Import the library into the site itself instead."
      );
    }
    return fail(`could not load ${url}\n  ${message}`);
  }
}

/* What the injected bundle puts on `window`. Declared rather than imported:
   this runs in Node, that runs in the page. */
interface InPage {
  verifyGrid: (o: unknown) => {
    results: TextNodeResult[];
    report: GridReport;
    /* Carries the origin actually used, which is the solved one when the
       caller asked for `auto`. */
    grid: { pitch: number; tolerance: number; origin: number };
    originSolved: boolean;
    skippedTransformed: number;
    closedShadowRoots: number;
    frames: number;
  };
  seatPage: (o: unknown) => SeatResult;
  exportCss: (r: SeatResult, o?: unknown) => string;
  offGrid: (r: TextNodeResult[], limit?: number) => TextNodeResult[];
  capHeightIsRasterised: () => boolean;
  verifyRhythm: (o: unknown) => {
    total: number;
    onRhythm: number;
    accumulated: number;
    inherited: number;
    byCause: Record<string, number>;
    issues: {
      over: number; cause: string; below: number; path: string;
      detail: string; fix: string; height: number;
    }[];
  };
  gridNativeScale: (font: string, o: unknown) => {
    font: string;
    phase: number;
    spacing: number;
    steps: { size: number; leading: number; ratio: number; rows: number; wanted: number; off: number }[];
    missed: number[];
    available: number[];
  };
  scaleToCss: (scale: unknown) => string;
  canReadFontTableCapHeight: () => boolean;
  measureFont: (font: string, size?: number) => Record<string, unknown>;
  version: string;
}

interface InPageFit {
  inferDesign: (options: unknown) => {
    families: { role: string; font: string; steps: { name?: string; size: number; leading?: number; space?: number }[] }[];
    rare: { font: string; size: number; leading: number; blocks: number }[];
    blocks: number;
    covered: number;
  };
  fitScale: (families: unknown, options: unknown) => {
    grid: { pitch: number; tolerance: number; origin: number };
    origin: number;
    cost: number;
    unavailable: boolean;
    families: {
      role: string;
      font: string;
      resolved: boolean;
      steps: {
        name: string; size: number; leading: number; leadingWas: number;
        leadingMoved: number; rows: number; space: number; spaceWas: number;
        spaceMoved: number; cap: number; residue: number;
      }[];
    }[];
  };
  fittedScaleToCss: (fitted: unknown) => string;
}

declare global {
  // eslint-disable-next-line no-var
  var quoin: InPage;
  interface Window { quoinFit: InPageFit }
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

const { command, url, options } = parseArgs(process.argv.slice(2));

if (!command) {
  console.log(USAGE.trim());
  process.exit(0);
}

const gridOptions = {
  pitch: options.pitch,
  tolerance: options.tolerance,
  origin: options.origin,
  ignore: options.ignore,
};

switch (command) {
  case "check": {
    if (!url) fail("check needs a URL");
    const { browser, page } = await open(url, options);

    const data = await page.evaluate((o) => {
      const { results, report, skippedTransformed, closedShadowRoots, frames } =
        quoin.verifyGrid(o);
      return {
        report,
        skippedTransformed,
        closedShadowRoots,
        frames,
        worst: quoin
          .offGrid(results, 12)
          .map((r) => ({ drift: r.drift, path: r.path, sample: r.sample })),
      };
    }, gridOptions);

    await browser.close();

    const share = percent(data.report.onGrid, data.report.total);

    if (options.json) {
      console.log(JSON.stringify({ url, grid: gridOptions, ...data, percent: share }, null, 2));
    } else {
      console.log(`\n  ${url}`);
      console.log(
        `  ${data.report.onGrid} of ${data.report.total} text blocks on a ` +
          `${options.pitch}px grid  (${share}%)`
      );
      console.log(`  worst drift ${data.report.worst.toFixed(2)}px`);
      console.log(
        `  ${data.report.distinctDrifts} distinct drift ` +
          `${data.report.distinctDrifts === 1 ? "value" : "values"}` +
          (data.report.systematic ? "  one shared offset: check your origin" : "")
      );
      if (data.skippedTransformed > 0) {
        console.log(`  ${data.skippedTransformed} skipped: under a CSS transform`);
      }
      if (data.closedShadowRoots > 0) {
        console.log(`  ${data.closedShadowRoots} shadow roots could not be entered`);
      }
      if (data.frames > 0) {
        console.log(`  ${data.frames} frames: a different document, measure them separately`);
      }
      console.log("");
      for (const row of data.worst) {
        console.log(
          `  ${row.drift.toFixed(2).padStart(7)}px  ${row.path.padEnd(38).slice(0, 38)}  ` +
            `${row.sample.slice(0, 34)}`
        );
      }
      console.log("");
    }

    if (options.min !== null && share < options.min) {
      console.error(`quoin: ${share}% is below the ${options.min}% floor`);
      process.exit(1);
    }
    break;
  }

  case "seat": {
    if (!url) fail("seat needs a URL");
    const { browser, page } = await open(url, options);

    const data = await page.evaluate(
      ({ o, mode, important }) => {
        /* The seater takes a fixed origin, so an auto origin is resolved to the
           number the page is already built on before anything moves. Seating to
           zero instead would shift every block on a page that is merely offset,
           which is a great deal of correction to fix a header's border. */
        const first = quoin.verifyGrid(o);
        const resolved = { ...(o as object), origin: first.grid.origin };

        const before = first.report;
        const seated = quoin.seatPage({ ...resolved, mode });
        const after = quoin.verifyGrid(resolved).report;
        const css = quoin.exportCss(seated, { important });

        const levers = seated.blocks.reduce<Record<string, number>>((acc, b) => {
          acc[b.lever] = (acc[b.lever] ?? 0) + 1;
          return acc;
        }, {});

        return {
          before,
          after,
          css,
          levers,
          passes: seated.passes,
          missed: seated.missed,
          unexportable: seated.unexportable,
          inShadow: seated.inShadow,
          exhausted: seated.exhausted,
        };
      },
      { o: gridOptions, mode: options.mode, important: options.important }
    );

    await browser.close();

    if (options.out) {
      writeFileSync(options.out, data.css, "utf8");
    }

    if (options.json) {
      console.log(JSON.stringify({ url, ...data }, null, 2));
      break;
    }

    console.log(`\n  ${url}`);
    console.log(
      `  ${data.before.onGrid}/${data.before.total} ` +
        `(${percent(data.before.onGrid, data.before.total)}%) before, ` +
        `${data.after.onGrid}/${data.after.total} ` +
        `(${percent(data.after.onGrid, data.after.total)}%) after, ` +
        `in ${data.passes} ${data.passes === 1 ? "sweep" : "sweeps"}`
    );
    console.log(
      `  padding moved ${data.levers.padding ?? 0}, offset moved ${data.levers.offset ?? 0}, ` +
        `${data.missed} could not be moved`
    );
    if (data.unexportable > 0) {
      console.log(
        `  ${data.unexportable} corrected blocks have no unique selector` +
          (data.inShadow > 0 ? `, ${data.inShadow} of them inside a shadow root` : "")
      );
    }
    if (data.exhausted) {
      console.log(`  the page had not converged after ${data.passes} sweeps: provisional`);
    }
    console.log(options.out ? `  CSS written to ${options.out}\n` : "");
    if (!options.out) console.log(data.css);
    break;
  }

  case "engine": {
    const target = url ?? "https://example.com";
    const { browser, page } = await open(target, options);

    const data = await page.evaluate(() => ({
      rasterised: quoin.capHeightIsRasterised(),
      fontTable: quoin.canReadFontTableCapHeight(),
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
    }));

    await browser.close();

    if (options.json) {
      console.log(JSON.stringify({ browser: options.browser, ...data }, null, 2));
      break;
    }

    console.log(`\n  ${options.browser}  (device pixel ratio ${data.dpr})`);
    console.log(
      `  cap heights come off the rasteriser:  ${data.rasterised ? "yes" : "no"}`
    );
    console.log(
      `  text-box-trim can read the font table: ${data.fontTable ? "yes" : "no"}`
    );
    console.log(
      data.fontTable
        ? "\n  Cap height is portable here: measureFontWithCap() reads sCapHeight.\n"
        : "\n  Cap height here comes from the drawn glyph and does not travel.\n" +
            "  Compute and apply it in this browser, never ship the number.\n"
    );
    break;
  }

  case "print": {
    /*
       The case a baseline grid comes from, and the one this could not answer.

       Everything else here measures a page in a browser, where a baseline is a
       number the engine hands you. A paginated rendering is not a DOM, so every
       claim about how a fit behaves across pages was reasoning rather than
       measurement. This renders the page to PDF and reads the baselines back
       out of the file.
    */
    if (!url) fail("print needs a URL");
    const { browser, page } = await open(url, options);

    let bytes: Uint8Array;
    try {
      bytes = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    } catch (error) {
      await browser.close();
      fail(
        "print needs Chromium, because it is the only engine Playwright will " +
          `render a PDF with. ${(error as Error).message}`
      );
      break;
    }
    await browser.close();

    const pages = readPdfText(bytes, inflateSync);

    /*
       Measured from the top of the page box, with the origin solved rather than
       asked for.

       Each page restarts its own grid at its own content edge, and where that
       edge is depends on the `@page` margin, which the tool does not know and
       should not have to be told: an early version defaulted it to 24pt, and on
       a page that sets none it reported first baselines of -10px, which is a
       tool blaming a document for the tool's own guess.

       So one origin is solved across every page at once, which is the right
       shape for the question. If the pages agree about where their grid starts,
       one origin fits all of them. If they do not, none does, and the low score
       is the finding rather than a measurement error.
    */
    const perPage = pages.map((p) => baselinesFromTop(p));
    const marginPx =
      options.printMargin === null ? 0 : options.printMargin / 0.75;
    const shifted = perPage.map((tops) =>
      tops.map((top) => Math.round((top - marginPx) * 1000) / 1000)
    );

    const grid = { pitch: options.pitch, tolerance: options.tolerance, origin: 0 };
    const solved =
      options.printMargin === null
        ? bestOrigin(shifted.flat(), grid).origin
        : 0;

    const onRow = (top: number) => {
      const residue = (((top - solved) % options.pitch) + options.pitch) % options.pitch;
      return Math.min(residue, options.pitch - residue) <= options.tolerance;
    };

    const results = shifted.map((tops, index) => ({
      page: index + 1,
      width: pages[index]!.width,
      height: pages[index]!.height,
      baselines: tops.length,
      onGrid: tops.filter(onRow).length,
      first: tops[0] === undefined ? null : Math.round((tops[0] - solved) * 1000) / 1000,
    }));

    const onGrid = results.reduce((sum, r) => sum + r.onGrid, 0);
    const total = results.reduce((sum, r) => sum + r.baselines, 0);

    if (options.json) {
      console.log(JSON.stringify({ url, pages: results, onGrid, total }, null, 2));
      break;
    }

    console.log(`\n  ${url}`);
    console.log(
      `  ${onGrid} of ${total} baselines on a ${options.pitch}px grid across ` +
        `${results.length} ${results.length === 1 ? "page" : "pages"}  ` +
        `(${percent(onGrid, total)}%)`
    );
    console.log("");
    console.log("  page   baselines   on grid   first baseline");
    for (const r of results) {
      console.log(
        `  ${String(r.page).padEnd(7)}${String(r.baselines).padEnd(12)}` +
          `${String(r.onGrid).padEnd(10)}${r.first === null ? "-" : r.first + "px"}`
      );
    }

    /*
       The first baseline on each page is the diagnostic, not the score. A
       margin at the top of a page fragment is truncated at an unforced break,
       which is css-break-3 and the same rule that costs a fitted page its
       second column, so page one starts at its space and every page after it
       starts at the cap alone.
    */
    const firsts = results.map((r) => r.first).filter((f): f is number => f !== null);
    const agree = firsts.every((f) => Math.abs(f - firsts[0]!) <= options.tolerance);
    console.log("");
    if (firsts.length > 1 && !agree) {
      console.log(
        "  The pages do not start at the same offset, which is the margin at\n" +
          "  the top of each fragment being truncated. Carry the space as\n" +
          "  padding-top instead and every page starts where the first one does."
      );
    } else if (onGrid === total && total > 0) {
      console.log(
        "  Every page holds. A page box does not have to be a whole number of\n" +
          "  rows for this: each page restarts its grid at its own content edge."
      );
    }
    console.log("");
    break;
  }
  case "columns": {
    /*
       The other axis. A baseline grid is a vertical rhythm inside a column
       grid, and this is the half everything else here ignored.
    */
    if (!url) fail("columns needs a URL");
    const { browser, page } = await open(url, options);
    await page.addScriptTag({ content: bundle("quoin.columns.js") });

    const data = await page.evaluate(
      (o) => (globalThis as never as { quoinColumns: { verifyColumns: (x: unknown) => unknown } })
        .quoinColumns.verifyColumns(o),
      {
        ignore: options.ignore,
        tolerance: options.tolerance,
        limit: 40,
        ...(options.gridColumns === null ? {} : { columns: options.gridColumns }),
        ...(options.gutter === null ? {} : { gutter: options.gutter }),
      }
    ) as import("./columns.ts").ColumnReport;

    await browser.close();

    if (options.json) {
      console.log(JSON.stringify({ url, ...data }, null, 2));
      break;
    }

    console.log(`\n  ${url}`);
    console.log(
      `  ${data.columns} ${data.columns === 1 ? "column" : "columns"} of ` +
        `${data.module}px with a ${data.gutter}px gutter, in ${data.container.width}px` +
        (data.solved ? "  (solved from the page)" : "")
    );
    console.log(
      `  ${data.aligned} of ${data.total} blocks have both edges on a division  ` +
        `(${percent(data.aligned, data.total)}%)`
    );

    /*
       The module first, because it is the one thing nothing downstream can
       recover from. A fractional module is the horizontal version of a leading
       that is not a whole number of rows: every division after the first sits on
       a fraction and no care taken with the markup will move it.
    */
    console.log("");
    if (data.moduleWhole) {
      console.log(`  The module is a whole number of pixels.`);
    } else {
      console.log(
        `  The module is ${data.module}px, which is not a whole number, so every\n` +
          `  division after the first lands on a fraction. That is decided by the\n` +
          `  container width, not by the markup.`
      );
      if (data.widthsThatDivide.length) {
        console.log(
          `\n  ${data.container.width}px does not divide by ${data.columns} with a ` +
            `${data.gutter}px gutter.\n  These do: ` +
            data.widthsThatDivide.map((w) => `${w}px`).join(", ")
        );
      }
    }

    if (data.issues.length) {
      console.log("");
      for (const issue of data.issues.slice(0, 12)) {
        console.log(
          `  ${String(issue.off + "px").padEnd(9)}${issue.which.padEnd(7)}` +
            `${issue.left} to ${issue.right}`.padEnd(20) +
            issue.path.slice(0, 40)
        );
      }
    }

    console.log(
      "\n  Columns are the half of a grid a designer draws and the half this\n" +
        "  library used to ignore. The vertical answers where a line sits; this\n" +
        "  answers whether the column it sits in begins anywhere in particular.\n"
    );

    if (options.min !== null) {
      const share = data.total === 0 ? 0 : (data.aligned / data.total) * 100;
      if (share < options.min) {
        console.error(
          `quoin: ${share.toFixed(1)}% aligned, below the ${options.min}% floor`
        );
        process.exit(1);
      }
    }
    break;
  }
  case "rhythm": {
    if (!url) fail("rhythm needs a URL");
    const { browser, page } = await open(url, options);

    const data = await page.evaluate(
      (o) => quoin.verifyRhythm(o),
      { ...gridOptions, limit: 40 }
    );

    await browser.close();

    if (options.json) {
      console.log(JSON.stringify({ url, ...data }, null, 2));
      break;
    }

    const share = percent(data.onRhythm, data.total);
    console.log(`\n  ${url}`);
    console.log(
      `  ${data.onRhythm} of ${data.total} boxes are a whole number of ` +
      `${options.pitch}px rows  (${share}%)`
    );
    console.log(
      `  ${data.accumulated}px of drift introduced, across ${data.total - data.onRhythm - data.inherited} boxes`
    );
    if (data.inherited) {
      console.log(`  ${data.inherited} more inherited it from their contents`);
    }

    const causes = Object.entries(data.byCause).filter(([, n]) => n > 0);
    if (causes.length) {
      console.log("\n  " + causes.map(([k, n]) => `${k} ${n}`).join(", "));
    }

    console.log("");
    for (const issue of data.issues.slice(0, 12)) {
      console.log(
        `  +${String(issue.over).padEnd(6)}${issue.cause.padEnd(10)}` +
        `moves ${String(issue.below).padStart(4)} blocks   ${issue.path.slice(0, 44)}`
      );
      console.log(`      ${issue.detail}`);
      console.log(`      ${issue.fix}`);
      console.log("");
    }

    console.log(
      "  Rhythm is what makes a correction survive a reflow. A box that is a\n" +
      "  whole number of rows can wrap to any number of lines without moving\n" +
      "  anything below it. One that is not moves everything, at every width.\n"
    );

    if (options.min !== null && share < options.min) {
      console.error(`quoin: ${share}% is below the ${options.min}% floor`);
      process.exit(1);
    }
    break;
  }

  case "fit": {
    /*
       The agent-facing command, and the one that answers the question a design
       actually poses: here is what the design says, what is the nearest thing
       that is genuinely on a grid, and how far did you have to move it.

       JSON in, JSON out, because the caller is as likely to be an agent working
       from a Figma file or a screenshot as a person at a terminal. Everything
       the answer rests on is in the output: the sizes, the leadings, the
       spacing, the shared phase, and a per-size record of the deviation, so the
       decision to accept a 0.4px shift is made by whoever has to live with it.
    */
    if (!options.design && !options.from) {
      fail("fit needs --design <file|-> or --from <url>");
    }
    if (options.design && options.from) {
      fail("fit takes --design or --from, not both");
    }

    /*
       `--from` reads the design off a page that already exists, which is the
       case most people are in: they have a site rather than a design file, and
       the question they want answered is what to change about the site they
       have. It reads what the browser resolved rather than what the stylesheet
       asked for, because between those two sit an inherited line-height, a
       reset, a webfont that failed, and a heading with a clamp() that resolved
       to something nobody intended.
    */
    if (options.from) {
      const { browser, page } = await open(options.from, options);
      await page.addScriptTag({ content: bundle("quoin.fit.js") });

      const read = await page.evaluate(
        ({ ignore, pitch, tolerance, edge, spaceProperty }) => {
          const design = window.quoinFit.inferDesign({ ignore, minimumBlocks: 2 });
          const result = window.quoinFit.fitScale(design.families, {
            pitch, tolerance, edge, spaceProperty,
          });
          return {
            design,
            result,
            css: window.quoinFit.fittedScaleToCss(result),
          };
        },
        {
          ignore: options.ignore,
          pitch: options.pitch,
          tolerance: options.tolerance,
          edge: options.edge ?? "cap alphabetic",
          spaceProperty: options.space ?? "margin",
          columns: options.columns,
        }
      );

      await browser.close();

      if (options.out) writeFileSync(options.out, read.css, "utf8");

      if (options.json) {
        console.log(
          JSON.stringify({ read: read.design, ...read.result, css: read.css }, null, 2)
        );
        break;
      }

      if (read.result.unavailable) {
        fail(
          "fitting reads each size's cap height through a text-box-trim probe,\n" +
            "  and this browser does not support it. Chrome 133, Safari 18.2\n" +
            "  or Firefox 154."
        );
      }

      console.log(`\n  ${options.from}`);
      console.log(
        `  ${read.design.blocks} text blocks, ${read.design.covered} covered by ` +
          `${read.design.families.length} ` +
          `${read.design.families.length === 1 ? "family" : "families"}`
      );
      if (read.design.rare.length) {
        console.log(
          `  ${read.design.rare.length} one-off combinations left out, which is usually` +
            "\n  a widget or a third party rather than the design"
        );
      }
      console.log(
        `  ${read.result.cost === 0 ? "nothing" : read.result.cost + "px of leading"} had to move`
      );

      for (const family of read.result.families) {
        console.log(`\n  ${family.role}  ${family.font}`);
        console.log("    name          size      leading   space     was");
        for (const step of family.steps) {
          console.log(
            "    " + step.name.padEnd(14) +
              String(step.size + "px").padEnd(10) +
              String(step.leading + "px").padEnd(10) +
              String(step.space + "px").padEnd(10) +
              (step.leadingMoved === 0 ? "exact" : `leading ${step.leadingWas}px`)
          );
        }
      }

      console.log(
        "\n  Every size is the size the page already sets. Apply the spaces as" +
          "\n  margin-top, add the trim, and it is on the grid at every width."
      );
      if (options.out) console.log(`\n  CSS written to ${options.out}\n`);
      else console.log("\n" + read.css + "\n");
      break;
    }

    const source = options.design as string;
    let design: {
      pitch?: number;
      tolerance?: number;
      families?: {
        role: string;
        font: string;
        /**
         * The font file this family is set in, relative to the design file.
         *
         * When every family has one, nothing launches a browser: the cap heights
         * come out of the OS/2 table instead, which is what lets this run in a
         * build step that has no display. Measured against real engines the two
         * routes agree to eight thousandths of a pixel.
         */
        file?: string;
        steps: { name?: string; size: number; leading?: number; ratio?: number; space?: number }[];
      }[];
    };

    let raw: string;
    try {
      raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
    } catch (error) {
      fail(
        `could not read the design from ${source === "-" ? "stdin" : source}\n  ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(
        `the design is not valid JSON\n  ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    /*
       Normalised rather than required in one exact spelling.

       A person exporting from Figma has `fontSize` and `lineHeight` in px
       strings; a design system has a flat token file; an agent reading a
       screenshot has a list of measurements and no idea what this library calls
       them. All three are the same information, and an agent cannot ask a
       follow-up question, so an error that does not name the entry and say what
       was expected costs a round trip and sometimes a wrong answer instead.
    */
    const { normaliseDesign, DesignError } = await import("./design-input.ts");
    let normalised;
    try {
      normalised = normaliseDesign(parsed);
    } catch (error) {
      if (error instanceof DesignError) fail(error.message);
      throw error;
    }

    design = {
      ...(parsed as Record<string, unknown>),
      families: normalised.families,
    } as typeof design;

    /* Anything that had to be interpreted is said out loud on stderr, so it does
       not pollute `--json` and is still impossible to miss. */
    for (const note of normalised.notes) console.error(`quoin: ${note}`);

    /*
       When every family names a font file, none of this needs a browser.

       That is the difference between a tool a build can use and one it cannot.
       A PostCSS step, a Vite plugin, a token pipeline or an agent with no
       display can all read an OS/2 table; none of them can be asked to install
       Playwright first. Measured against real engines across nine fonts and
       five sizes, the two routes disagreed by at most 0.008px.

       A browser is still the better answer when a page exists, because it tells
       you which font actually rendered where a file only tells you about the
       file. This is the answer when a page does not exist yet.
    */
    if (normalised.families.every((family) => family.file)) {
      const { fitFromFiles } = await import("./fit-file.ts");
      const { inflateSync } = await import("node:zlib");
      const { dirname: dirOf, resolve: resolveFrom } = await import("node:path");
      const base = source === "-" ? process.cwd() : dirOf(source);

      const files = normalised.families.map((family) => {
        const path = resolveFrom(base, family.file as string);
        try {
          return { font: family.font, bytes: new Uint8Array(readFileSync(path)) };
        } catch (error) {
          return fail(
            `could not read the font file for ${family.role} at ${path}\n  ` +
              (error instanceof Error ? error.message : String(error))
          );
        }
      });

      const result = fitFromFiles(normalised.families, files, {
        pitch: design.pitch ?? options.pitch,
        tolerance: design.tolerance ?? options.tolerance,
        inflate: (compressed) => new Uint8Array(inflateSync(compressed)),
      });
      const css = (await import("./fit-core.ts")).fittedScaleToCss(result);

      if (options.out) writeFileSync(options.out, css, "utf8");
      if (options.json) {
        console.log(JSON.stringify({ ...result, css }, null, 2));
        break;
      }

      /* A file that could not be used is named rather than quietly skipped:
         a font predating OS/2 version 2 declares no cap height, and a design
         missing one of its families is a stylesheet missing a third of itself. */
      for (const font of result.fonts) {
        if (font.problem) console.error(`quoin: ${font.font}: ${font.problem}`);
      }

      console.log(
        `\n  ${result.grid.pitch}px grid, origin ${result.origin}px, read from font files`
      );
      console.log(
        `  ${result.families.length} ${result.families.length === 1 ? "family" : "families"}, ` +
          (result.cost === 0
            ? "nothing in the design had to move"
            : `${result.cost}px of leading moved, no size touched`)
      );

      for (const family of result.families) {
        if (!family.steps.length) continue;
        console.log(`\n  ${family.role}  ${family.font}`);
        console.log("    name          size      leading   space     cap      moved");
        for (const step of family.steps) {
          console.log(
            "    " + step.name.padEnd(14) +
              String(step.size + "px").padEnd(10) +
              String(step.leading + "px").padEnd(10) +
              String(step.space + "px").padEnd(10) +
              String(step.cap).padEnd(9) +
              (step.leadingMoved === 0
                ? "exact"
                : `leading ${step.leadingMoved > 0 ? "+" : ""}${step.leadingMoved}`)
          );
        }
      }

      console.log(
        "\n  No browser was used. Cap heights came from each font's OS/2 table," +
          "\n  which is the same number the engines use for text-box-edge: cap."
      );
      if (options.out) console.log(`\n  CSS written to ${options.out}\n`);
      else console.log("\n" + css + "\n");
      break;
    }

    const target = url ?? "about:blank";
    const { browser, page } = await open(target, options);
    /* The fitter is its own bundle: it is four kilobytes that the console
       bundle has no reason to carry. */
    await page.addScriptTag({ content: bundle("quoin.fit.js") });

    const fitted = await page.evaluate(
      ({ families, grid }) => {
        const result = window.quoinFit.fitScale(families, grid);
        return { result, css: window.quoinFit.fittedScaleToCss(result) };
      },
      {
        families: normalised.families,
        grid: {
          pitch: design.pitch ?? options.pitch,
          tolerance: design.tolerance ?? options.tolerance,
          edge: options.edge ?? (design as { edge?: string }).edge ?? "cap alphabetic",
          spaceProperty: options.space ?? "margin",
          columns: options.columns,
        },
      }
    );

    await browser.close();

    if (options.out) writeFileSync(options.out, fitted.css, "utf8");

    if (options.json) {
      console.log(JSON.stringify({ ...fitted.result, css: fitted.css }, null, 2));
      break;
    }

    const f = fitted.result;
    if (f.unavailable) {
      fail(
        "fitting reads each size's cap height through a text-box-trim probe,\n" +
          "  and this browser does not support it. Chrome 133, Safari 18.2\n" +
          "  or Firefox 154."
      );
    }

    console.log(`
  ${f.grid.pitch}px grid, origin ${f.origin}px`);
    console.log(
      `  ${f.families.length} ${f.families.length === 1 ? "family" : "families"}, ` +
        (f.cost === 0
          ? "nothing in the design had to move"
          : `${f.cost}px of leading moved, no size touched`)
    );

    for (const family of f.families) {
      console.log(
        `
  ${family.role}  ${family.font}` +
          (family.resolved ? "" : "  (DID NOT RENDER)")
      );
      console.log("    name          size      leading   space     cap      moved");
      for (const step of family.steps) {
        console.log(
          "    " + step.name.padEnd(14) +
            String(step.size + "px").padEnd(10) +
            String(step.leading + "px").padEnd(10) +
            String(step.space + "px").padEnd(10) +
            String(step.cap).padEnd(9) +
            (step.leadingMoved === 0
              ? "exact"
              : `leading ${step.leadingMoved > 0 ? "+" : ""}${step.leadingMoved}`)
        );
      }
    }

    console.log(
      "\n  Every size is the size the design asked for. Set the spaces as" +
        "\n  margin-top and the page is on the grid at every width, with no" +
        "\n  corrections and no media queries."
    );

    if (options.out) console.log(`
  CSS written to ${options.out}
`);
    else console.log("\n" + fitted.css + "\n");
    break;
  }

  case "scale": {
    /* Needs a browser for the font metrics and nothing else, so it measures
       against a blank page rather than whatever URL happened to be passed. */
    const target = url ?? "about:blank";
    const { browser, page } = await open(target, options);

    /* The family has to be loadable in that page. A local file or a webfont
       the page does not link is a request for a fallback, and a scale solved
       against a fallback describes the wrong typeface. */
    const solved = await page.evaluate(
      ({ font, sizes, near, pitch }) => {
        const scale = quoin.gridNativeScale(font, {
          pitch,
          targets: sizes,
          near,
        });
        return { scale, css: quoin.scaleToCss(scale) };
      },
      { font: options.font, sizes: options.sizes, near: options.near, pitch: options.pitch }
    );

    await browser.close();

    if (options.out) writeFileSync(options.out, solved.css, "utf8");

    if (options.json) {
      console.log(JSON.stringify(solved.scale, null, 2));
      break;
    }

    const s = solved.scale;
    console.log(`\n  ${s.font}`);
    console.log(
      `  ${options.pitch}px grid, shared phase ${s.phase}px, ` +
      `solved sizes about ${s.spacing}px apart`
    );
    console.log("");
    console.log("  wanted    size      leading   ratio   rows   off by");
    for (const step of s.steps) {
      console.log(
        "  " + String(step.wanted + "px").padEnd(10) +
        String(step.size + "px").padEnd(10) +
        String(step.leading + "px").padEnd(10) +
        String(step.ratio).padEnd(8) +
        String(step.rows).padEnd(7) +
        (step.off === 0 ? "exact" : (step.off > 0 ? "+" : "") + step.off)
      );
    }
    if (s.missed.length) {
      console.log(`\n  no solved size within ${options.near}px of: ${s.missed.join(", ")}`);
    }
    console.log(
      `\n  Set the grid origin to ${s.phase}px and keep every vertical distance a` +
      `\n  whole number of ${options.pitch}px rows. Nothing then needs correcting.`
    );
    if (options.out) console.log(`\n  CSS written to ${options.out}\n`);
    else console.log("\n" + solved.css + "\n");
    break;
  }

  default:
    fail(`unknown command "${command}". Try --help.`);
}
