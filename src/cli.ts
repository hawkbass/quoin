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
  quoin scale                solve a type scale that needs no correction
  quoin rhythm <url>         which boxes are not a whole number of rows, and why

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
