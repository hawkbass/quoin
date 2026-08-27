/* Point it at a URL.

   The library measures inside a page. This drives a browser to the page first,
   which is the difference between a tool you can run on your own site and one
   you can run on anybody's. Every finding in this repository, the corpus
   survey, the cross-engine divergence, came out of the second kind. */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GridReport } from "./grid.ts";
import type { TextNodeResult } from "./verify.ts";
import type { SeatResult } from "./seat.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `
quoin: it puts a web page on a baseline grid

  quoin check <url>          how much of the page is on the grid
  quoin seat  <url>          seat it, and print the CSS that does the same
  quoin engine [url]         what this engine's font metrics do

Options
  --pitch <px>               grid pitch                        (default 8)
  --tolerance <px>           how far off still counts as on    (default 0.5)
  --origin <px>              where the grid starts             (default 0)
  --ignore <selectors>       comma-separated, skipped entirely
  --viewport <WxH>           browser size                (default 1280x900)
  --browser <name>           chromium | firefox | webkit  (default chromium)
  --wait <ms>                settle time after load          (default 800)
  --mode <full|first-line>   snap the leading too, or only seat line one
  --min <percent>            exit non-zero below this         (check only)
  -o, --out <file>           write the CSS here                (seat only)
  --important                add !important to every rule      (seat only)
  --json                     machine-readable output
  -h, --help                 this

Examples
  npx quoin check https://example.com
  npx quoin check https://example.com --pitch 4 --min 90
  npx quoin seat https://example.com -o baseline.css
  npx quoin engine --browser firefox
`;

interface Options {
  pitch: number;
  tolerance: number;
  origin: number;
  ignore: string[];
  viewport: { width: number; height: number };
  browser: "chromium" | "firefox" | "webkit";
  wait: number;
  mode: "full" | "first-line";
  min: number | null;
  out: string | null;
  important: boolean;
  json: boolean;
}

function fail(message: string): never {
  console.error(`quoin: ${message}`);
  process.exit(2);
}

function parseArgs(argv: string[]): { command: string; url: string | null; options: Options } {
  const options: Options = {
    pitch: 8,
    tolerance: 0.5,
    origin: 0,
    ignore: [],
    viewport: { width: 1280, height: 900 },
    browser: "chromium",
    wait: 800,
    mode: "full",
    min: null,
    out: null,
    important: false,
    json: false,
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
      case "--origin": options.origin = number(); break;
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

function bundle(): string {
  /* Whatever the build just produced, so the CLI and the console API can never
     be two different versions of the same tool. */
  for (const candidate of ["quoin.global.js", "../dist/quoin.global.js"]) {
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
    skippedTransformed: number;
    closedShadowRoots: number;
    frames: number;
  };
  seatPage: (o: unknown) => SeatResult;
  exportCss: (r: SeatResult, o?: unknown) => string;
  offGrid: (r: TextNodeResult[], limit?: number) => TextNodeResult[];
  capHeightIsRasterised: () => boolean;
  canReadFontTableCapHeight: () => boolean;
  measureFont: (font: string, size?: number) => Record<string, unknown>;
  version: string;
}

declare global {
  // eslint-disable-next-line no-var
  var quoin: InPage;
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
        const before = quoin.verifyGrid(o).report;
        const seated = quoin.seatPage({ ...(o as object), mode });
        const after = quoin.verifyGrid(o).report;
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

  default:
    fail(`unknown command "${command}". Try --help.`);
}
