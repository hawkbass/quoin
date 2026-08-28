/* The GitHub Action.

   Measures every page at every width, compares against the committed baseline,
   and writes a comment. Everything it does is available from the CLI; what this
   adds is the baseline, which is the primitive that gets a tool adopted.

   Plain Node against the built bundle, deliberately. An action that pulls a
   dependency tree is an action that breaks on somebody else's release. */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync } from "node:fs";
import { join, extname, normalize, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
   Inputs
 * ------------------------------------------------------------------ */

const input = (name, fallback = "") => (process.env[name] ?? "").trim() || fallback;
const flag = (name, fallback) => {
  const raw = input(name);
  return raw === "" ? fallback : raw === "true" || raw === "1";
};

const URLS = input("QUOIN_URLS")
  .split(/[\n,]/)
  .map((u) => u.trim())
  .filter(Boolean);

const DIRECTORY = input("QUOIN_DIRECTORY");
const PITCH = Number(input("QUOIN_PITCH", "8"));
const WIDTHS = input("QUOIN_WIDTHS", "1280")
  .split(",")
  .map((w) => Number(w.trim()))
  .filter((w) => Number.isFinite(w) && w > 0);
const IGNORE = input("QUOIN_IGNORE").split(",").map((s) => s.trim()).filter(Boolean);
const BASELINE_PATH = input("QUOIN_BASELINE", ".quoin-baseline.json");
const ALLOWED = Number(input("QUOIN_ALLOWED_DROP", "1"));
const UPDATE = flag("QUOIN_UPDATE_BASELINE", false);
const MIN = input("QUOIN_MIN") === "" ? null : Number(input("QUOIN_MIN"));
const RHYTHM = flag("QUOIN_RHYTHM", true);
/* A number, or "auto" to solve for the origin the page is already built on.

   Auto by default. An origin of zero asks whether baselines sit on multiples of
   the pitch measured from the top of the document, and a page with a header
   answers no however carefully it is set, because everything below the header
   moves by the same amount. Gating a repository on that number would fail every
   page for a reason nobody can act on. */
const ORIGIN_RAW = input("QUOIN_ORIGIN", "auto");
const ORIGIN = ORIGIN_RAW === "auto" ? "auto" : Number(ORIGIN_RAW);
if (ORIGIN !== "auto" && !Number.isFinite(ORIGIN)) {
  die(`origin must be a number or "auto", got ${ORIGIN_RAW}`);
}
const FAIL = flag("QUOIN_FAIL", true);

if (!URLS.length) die("no urls given");
if (!Number.isFinite(PITCH) || PITCH <= 0) die(`pitch must be a positive number, got ${PITCH}`);
if (!WIDTHS.length) die("no valid widths given");

function die(message) {
  console.error(`::error::quoin: ${message}`);
  process.exit(1);
}

function note(message) {
  console.log(message);
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  /* Multi-line values need a delimiter, and the delimiter must not appear in
     the value or the workflow file is malformed in a way that is very hard to
     read back. */
  const delimiter = `quoin_${name}_${Math.abs(hash(String(value)))}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------------------------ *
   The library, and a browser to run it in
 * ------------------------------------------------------------------ */

function findBundle() {
  for (const candidate of [
    join(HERE, "..", "dist", "quoin.global.js"),
    join(process.cwd(), "node_modules", "quoin", "dist", "quoin.global.js"),
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  return die("could not find the quoin bundle. Run `npm run build` in the action's checkout.");
}

const BUNDLE = findBundle();

let playwright;
try {
  playwright = await import("playwright");
} catch {
  die("playwright is not installed. The action installs it in an earlier step.");
}

/* ------------------------------------------------------------------ *
   Serving a built directory, for relative URLs
 * ------------------------------------------------------------------ */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

let server = null;
let origin = "";

if (DIRECTORY) {
  const root = resolve(DIRECTORY);
  if (!existsSync(root)) die(`directory not found: ${DIRECTORY}`);

  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let name = decodeURIComponent(url.pathname);
    if (name.endsWith("/")) name += "index.html";

    let target = normalize(join(root, name));
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403).end("outside the served directory");
      return;
    }
    /* Extensionless paths, which is how most built sites address their pages. */
    if (!existsSync(target) && !extname(target) && existsSync(target + ".html")) {
      target += ".html";
    }
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = join(target, "index.html");
    }

    try {
      /* Read first, then write headers. Writing the 200 before the read means a
         missing file throws with headers already sent, and the catch cannot
         send a 404 on top of them. */
      const body = readFileSync(target);
      response.writeHead(200, {
        "content-type": TYPES[extname(target)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not here");
    }
  });

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  note(`Serving ${DIRECTORY} on ${origin}`);
}

function absolute(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (!origin) {
    die(`"${url}" is relative and no directory was given to serve it from`);
  }
  return origin + (url.startsWith("/") ? url : "/" + url);
}

/* ------------------------------------------------------------------ *
   Measure
 * ------------------------------------------------------------------ */

/*
   Every URL resolved before anything is launched.

   `absolute()` refuses a relative path when there is no directory to serve it
   from, which is a pure input check, and it used to happen inside the measuring
   loop: the run started Chromium, loaded it, and only then discovered the
   workflow was misconfigured. Two seconds to reject a string, and a browser in
   the failure path of a test that has nothing to do with browsers.
*/
const targets = URLS.map((raw) => ({ raw, url: absolute(raw) }));

const browser = await playwright.chromium.launch();
const readings = [];
const failures = [];

try {
  for (const { raw, url } of targets) {

    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
        if (response && !response.ok()) {
          note(`::warning::${url} returned ${response.status()}`);
        }
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        /* Webfonts change every metric on the page, so measuring before they
           land measures a fallback. */
        await page.waitForTimeout(1200);
        await page.addScriptTag({ content: BUNDLE });

        const measured = await page.evaluate(
          ({ pitch, ignore, rhythm, origin }) => {
            const options = { pitch, origin, ignore: ignore.length ? ignore : undefined };
            const grid = window.quoin.verifyGrid(options);
            const out = {
              origin: Math.round(grid.grid.origin * 100) / 100,
              originSolved: grid.originSolved,
              onGrid: grid.report.onGrid,
              total: grid.report.total,
              distinctDrifts: grid.report.distinctDrifts,
              systematic: grid.report.systematic,
              worst: grid.report.worst,
              skippedTransformed: grid.skippedTransformed,
              closedShadowRoots: grid.closedShadowRoots,
              frames: grid.frames,
              offenders: window.quoin
                .offGrid(grid.results, 5)
                .map((r) => ({ drift: r.drift, path: r.path, sample: r.sample })),
            };
            if (rhythm) {
              /* Rhythm is about heights, so the origin does not enter it. Passed
                 the resolved grid anyway, so one config describes the run. */
              const r = window.quoin.verifyRhythm({
                ...options, origin: grid.grid.origin, limit: 5,
              });
              out.onRhythm = r.onRhythm;
              out.rhythmTotal = r.total;
              out.accumulated = r.accumulated;
              out.rhythmIssues = r.issues.map((i) => ({
                over: i.over, cause: i.cause, below: i.below, path: i.path, fix: i.fix,
              }));
            }
            return out;
          },
          { pitch: PITCH, ignore: IGNORE, rhythm: RHYTHM, origin: ORIGIN }
        );

        readings.push({ url: raw, width, pitch: PITCH, ...measured });

        const share = measured.total
          ? Math.round((measured.onGrid / measured.total) * 1000) / 10
          : 0;
        note(
          `  ${raw} @ ${width}px  ${measured.onGrid}/${measured.total} (${share}%)` +
          (RHYTHM ? `  rhythm ${measured.onRhythm}/${measured.rhythmTotal}` : "") +
          (measured.originSolved ? `  origin ${measured.origin}px` : "")
        );

        if (MIN !== null && share < MIN) {
          failures.push(`${raw} @ ${width}px is ${share}%, below the ${MIN}% floor`);
        }
      } catch (error) {
        const message = String(error?.message ?? error);
        if (/content security policy/i.test(message)) {
          note(
            `::warning::${url} refuses injected scripts. That is a correct ` +
            `policy and a real limit: import the library into the site instead.`
          );
        } else {
          note(`::warning::could not measure ${url} at ${width}px: ${message.slice(0, 160)}`);
        }
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  server?.close();
}

if (!readings.length) die("nothing could be measured");

writeFileSync("quoin-results.json", JSON.stringify({ pitch: PITCH, readings }, null, 2));
setOutput("results", "quoin-results.json");

/* ------------------------------------------------------------------ *
   Compare
 * ------------------------------------------------------------------ */

const entries = readings.map((r) => ({
  url: r.url,
  width: r.width,
  pitch: r.pitch,
  /* Recorded because a reading taken against a solved origin answers a
     different question from one taken against a fixed origin, and a committed
     number whose question is unstated is a number that gets quoted wrongly. */
  origin: r.origin,
  onGrid: r.onGrid,
  total: r.total,
  distinctDrifts: r.distinctDrifts,
  ...(RHYTHM ? { onRhythm: r.onRhythm, rhythmTotal: r.rhythmTotal } : {}),
}));

const version = JSON.parse(
  readFileSync(join(HERE, "..", "package.json"), "utf8")
).version;

if (UPDATE || !existsSync(BASELINE_PATH)) {
  const baseline = {
    version: 1,
    quoin: version,
    recorded: new Date().toISOString().slice(0, 10),
    entries: [...entries].sort((a, b) =>
      `${a.url}@${a.width}`.localeCompare(`${b.url}@${b.width}`)
    ),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");

  const why = UPDATE ? "as asked" : "because there was not one";
  note(`\nWrote ${BASELINE_PATH} ${why}. Commit it, and the next run compares against it.`);
  /* The floor is absolute, so it applies with or without a baseline.

     Recording a first baseline must not silently pass a page that is already
     below a floor somebody deliberately set. A green build on the one gate you
     asked for is worse than having no gate at all, because you stop looking. */
  for (const failure of failures) console.log(`::error::${failure}`);
  const floorHeld = failures.length === 0;

  setOutput("clean", String(floorHeld));
  setOutput("regressed", "0");
  setOutput("markdown", "");
  process.exit(floorHeld || !FAIL ? 0 : 1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
if (baseline.version !== 1) {
  die(`${BASELINE_PATH} is version ${baseline.version}, which this quoin does not read`);
}

/* The comparison is duplicated from src/baseline.ts rather than imported,
   because the action runs from a checkout that has a built bundle and no
   compiled Node modules. It is thirty lines and it is tested there. */
const key = (e) => `${e.url}@${e.width}`;
const before = new Map(baseline.entries.map((e) => [key(e), e]));
const after = new Map(entries.map((e) => [key(e), e]));
const comparisons = [];

for (const [id, now] of after) {
  const then = before.get(id);
  if (!then) {
    comparisons.push({ ...now, verdict: "new", delta: 0, before: null });
    continue;
  }
  const delta = now.onGrid - then.onGrid;
  const rhythmDelta =
    typeof now.onRhythm === "number" && typeof then.onRhythm === "number"
      ? now.onRhythm - then.onRhythm
      : null;

  /*
     Phase and rhythm are two different defects and either one is a regression.

     A hairline border is the case that makes this necessary, and it is the most
     common defect there is. It moves every block below it by one pixel, so the
     page splits into two phases a pixel apart, and on an 8px grid with half a
     pixel of tolerance an origin sitting between those halves is within
     tolerance of both. The phase count does not move. Only rhythm sees it, and
     a gate on phase alone would wave through the exact thing this was built to
     catch.
  */
  const worst = rhythmDelta === null ? delta : Math.min(delta, rhythmDelta);
  const verdict =
    worst < -ALLOWED
      ? "regressed"
      : delta > ALLOWED || (rhythmDelta ?? 0) > ALLOWED
        ? "improved"
        : "unchanged";

  comparisons.push({
    ...now, verdict, delta, rhythmDelta, worst,
    before: then, grew: now.total - then.total,
    rhythmOnly: delta >= -ALLOWED && rhythmDelta !== null && rhythmDelta < -ALLOWED,
  });
}
for (const [id, then] of before) {
  if (!after.has(id)) comparisons.push({ ...then, verdict: "removed", delta: 0, before: then });
}

const cost = (c) => (typeof c.worst === "number" ? c.worst : c.delta);
comparisons.sort((a, b) => cost(a) - cost(b) || a.url.localeCompare(b.url));
const regressed = comparisons.filter((c) => c.verdict === "regressed");
const improved = comparisons.filter((c) => c.verdict === "improved");

/* ------------------------------------------------------------------ *
   Report
 * ------------------------------------------------------------------ */

const mark = { regressed: "🔻", improved: "🔺", new: "•", removed: "○", unchanged: " " };

const heading = regressed.length
  ? `**${regressed.length} ${regressed.length === 1 ? "reading" : "readings"} came off the grid.**`
  : improved.length
    ? `**${improved.length} improved.** Nothing regressed.`
    : "No change against the baseline.";

const signed = (n) => (n === 0 || n === null || n === undefined ? "" : (n > 0 ? "+" : "") + n);

const rows = comparisons.map((c) => {
  const share = c.total ? Math.round((c.onGrid / c.total) * 1000) / 10 : 0;
  const grew = c.grew ? ` (${c.grew > 0 ? "+" : ""}${c.grew} blocks on the page)` : "";
  const rhythm =
    c.verdict === "removed" || typeof c.onRhythm !== "number"
      ? ""
      : `${c.onRhythm}/${c.rhythmTotal} ${signed(c.rhythmDelta)}`.trim();
  return (
    `| ${mark[c.verdict]} | \`${c.url}\` | ${c.width}px | ` +
    /* A page that was not measured says so in words. A dash in the cell reads
       as a zero to anybody skimming, and zero is the one thing it does not
       mean. */
    `${c.verdict === "removed" ? "not measured" : `${c.onGrid}/${c.total}`} | ` +
    `${c.verdict === "removed" ? "" : share + "%"} | ` +
    `${signed(c.delta)}${grew} | ${rhythm} |`
  );
});

const drift = regressed
  .flatMap((c) => {
    const reading = readings.find((r) => r.url === c.url && r.width === c.width);
    return (reading?.rhythmIssues ?? []).slice(0, 2).map(
      (i) => `- \`${c.url}\` ${i.path} is ${i.over}px past a row, which moves ${i.below} blocks. ${i.fix}`
    );
  })
  .slice(0, 6);

const markdown = [
  "### Quoin",
  "",
  heading,
  "",
  "| | Page | Width | On grid | | Δ | Rhythm |",
  "|---|---|---|---|---|---|---|",
  ...rows,
  ...(drift.length ? ["", "**Where the drift comes from**", "", ...drift] : []),
  ...(regressed.some((c) => c.rhythmOnly)
    ? [
        "",
        "Phase held and rhythm did not. A box that is not a whole number of " +
        "rows shifts everything after it, and it shifts it by a different " +
        "amount at every viewport, so no correction above it survives a reflow.",
      ]
    : []),
  "",
  `<sub>Baseline recorded ${baseline.recorded} with quoin ${baseline.quoin}. ` +
    `The delta is blocks, not percent, because a percentage moves when the page ` +
    `gains a paragraph. Tolerance ${ALLOWED} ${ALLOWED === 1 ? "block" : "blocks"}.</sub>`,
].join("\n");

console.log("\n" + markdown + "\n");

setOutput("markdown", markdown);
setOutput("clean", String(regressed.length === 0));
setOutput("regressed", String(regressed.length));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
}

for (const failure of failures) console.log(`::error::${failure}`);

if (regressed.length && FAIL) {
  for (const c of regressed) {
    console.log(
      c.rhythmOnly
        ? `::error::${c.url} at ${c.width}px lost ${-c.rhythmDelta} boxes off the ` +
          `rhythm (${c.before.onRhythm}/${c.before.rhythmTotal} to ` +
          `${c.onRhythm}/${c.rhythmTotal}). Phase held, which it will not after a reflow.`
        : `::error::${c.url} at ${c.width}px lost ${-c.delta} blocks off the grid ` +
          `(${c.before.onGrid}/${c.before.total} to ${c.onGrid}/${c.total})`
    );
  }
  process.exit(1);
}
if (failures.length && FAIL) process.exit(1);
