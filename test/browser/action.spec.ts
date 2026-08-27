/* The GitHub Action, driven the way GitHub drives it.

   Everything here goes through the real entry point as a subprocess, with the
   inputs arriving as environment variables and the outputs read back out of a
   GITHUB_OUTPUT file, because that is the only interface a workflow has. A test
   that imported the module and called a function would pass while the action
   itself was broken, and this file exists because two of them were: the static
   server wrote a 200 header before reading the file, so a missing page crashed
   the run rather than reporting a 404, and the absolute floor was skipped
   entirely on the first run, so a page below a floor somebody had deliberately
   set went green.

   The site is built here rather than borrowed from the fixtures, because these
   tests need to change a page between two runs and watch the number move. */

import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const ACTION = resolve("action/run.mjs");

/* The action drives its own browser, so running this file under all three
   Playwright projects would run identical work three times and report it as
   three results. */
test.skip(({ browserName }) => browserName !== "chromium", "drives its own browser");
test.describe.configure({ mode: "serial" });

/* ------------------------------------------------------------------ *
   A page whose geometry is known
 * ------------------------------------------------------------------ */

/*
   Everything is a whole number of 8px rows: 24px leading, 24px margins, no
   borders. Sizes are set in px and the family is a generic keyword, because a
   webfont that has not loaded and a font that is not installed on the runner
   both change every metric on the page. That mistake has been made three times
   in this repository, most recently by assuming Georgia was on Ubuntu.
*/
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Measured</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<main>
  <p>The first paragraph, which sits on a row because the leading is a whole number of rows.</p>
  <p>The second paragraph, long enough to wrap onto more than one line at the widths under test.</p>
  <section>
    <p>A third, inside a section that carries the padding.</p>
    <p>And a fourth, so that a shift near the top has something below it to move.</p>
  </section>
  <p>The last paragraph on the page.</p>
</main>
</body></html>
`;

const CSS = `
:root { font-family: sans-serif; }
body { margin: 0; padding: 24px; font-size: 16px; line-height: 24px; }
main { max-width: 640px; }
p { margin: 0 0 24px; }
section { padding: 24px 0; }
`;

/* The change under test. A single hairline is the defect this tool exists to
   find: it is one pixel, it is invisible in a design tool, and it moves every
   block below it. What it moves is rhythm, not phase: see the test that says
   so. */
const HAIRLINE = `
section { border-top: 1px solid #000; }
`;

/* A phase defect, for the tests that need one. A leading of 25px on an 8px grid
   puts three of the five paragraphs at their own phase, far enough from the
   other two that no single origin serves both. Every box stays a whole number
   of rows, so rhythm does not move and phase carries the whole change. */
const PHASE_BREAK = `
section p, main > p:last-child { line-height: 25px; }
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
}

function makeSite(): string {
  const dir = mkdtempSync(join(tmpdir(), "quoin-action-"));
  writeFileSync(join(dir, "index.html"), PAGE);
  writeFileSync(join(dir, "style.css"), CSS);
  return dir;
}

/** Read a GITHUB_OUTPUT file back the way the runner does. */
function parseOutputs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = /^([a-zA-Z0-9_-]+)<<(.+)$/.exec(lines[i] ?? "");
    if (!match) continue;
    const [, name, delimiter] = match;
    const body: string[] = [];
    i++;
    while (i < lines.length && lines[i] !== delimiter) {
      body.push(lines[i] ?? "");
      i++;
    }
    out[name!] = body.join("\n");
  }
  return out;
}

let siteCount = 0;

async function action(
  dir: string,
  env: Record<string, string> = {}
): Promise<Run> {
  const outputFile = join(dir, `output-${siteCount++}.txt`);
  writeFileSync(outputFile, "");

  const environment = {
    ...process.env,
    GITHUB_OUTPUT: outputFile,
    QUOIN_URLS: "index.html",
    QUOIN_DIRECTORY: dir,
    QUOIN_WIDTHS: "1280",
    QUOIN_BASELINE: join(dir, "baseline.json"),
    ...env,
  };

  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    const result = await run(process.execPath, [ACTION], {
      env: environment,
      cwd: dir,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    code = e.code ?? 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }

  return { code, stdout, stderr, outputs: parseOutputs(readFileSync(outputFile, "utf8")) };
}

const readBaseline = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"));

/* ------------------------------------------------------------------ *
   Recording
 * ------------------------------------------------------------------ */

test("the first run records a baseline instead of judging the page", async () => {
  /* A tool that fails on the run that introduces it is a tool nobody adds to a
     repository that already has pages. */
  const dir = makeSite();
  try {
    const result = await action(dir);

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("because there was not one");
    expect(existsSync(join(dir, "baseline.json"))).toBe(true);

    const baseline = readBaseline(dir);
    expect(baseline.version).toBe(1);
    expect(baseline.entries).toHaveLength(1);
    expect(baseline.entries[0].width).toBe(1280);
    expect(baseline.entries[0].onGrid).toBeGreaterThan(0);
    expect(baseline.entries[0].onGrid).toBe(baseline.entries[0].total);

    /* No comparison happened, so there is nothing to comment. */
    expect(result.outputs.markdown).toBe("");
    expect(result.outputs.clean).toBe("true");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page it cannot fetch is reported, not a crash", async () => {
  /*
     The server used to write its 200 header before reading the file, so a
     missing page threw with the headers already sent and the run died inside
     the request handler rather than measuring anything.
  */
  const dir = makeSite();
  try {
    const result = await action(dir, { QUOIN_URLS: "index.html,not-here.html" });

    expect(result.stdout + result.stderr).not.toContain("ERR_HTTP_HEADERS_SENT");
    expect(result.stdout).toContain("404");
    /* And the page that does exist was still measured. */
    const baseline = readBaseline(dir);
    expect(baseline.entries.some((e: { url: string }) => e.url === "index.html")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
   Comparing
 * ------------------------------------------------------------------ */

test("an unchanged page passes and says nothing moved", async () => {
  const dir = makeSite();
  try {
    await action(dir);
    const second = await action(dir);

    expect(second.code, second.stdout).toBe(0);
    expect(second.outputs.markdown).toContain("No change against the baseline");
    expect(second.outputs.clean).toBe("true");
    expect(second.outputs.regressed).toBe("0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one hairline border fails the run, and it is rhythm that catches it", async () => {
  /*
     The defect this tool exists for, and the one that proves phase alone is not
     enough to gate on.

     A 1px border on the section moves every block below it down by one pixel,
     so the page now has two phases one pixel apart. On an 8px grid with half a
     pixel of tolerance, an origin sitting between those two halves is within
     tolerance of both, and the phase count does not move at all: 5 on grid
     before, 5 on grid after. Only rhythm sees it, because the section is no
     longer a whole number of rows tall.

     So this asserts the rhythm regression rather than a phase one. Writing it
     the other way round is how the first version passed while the gate was
     letting the commonest defect there is straight through.
  */
  const dir = makeSite();
  try {
    const first = await action(dir);
    expect(first.code).toBe(0);
    const before = readBaseline(dir).entries[0];

    writeFileSync(join(dir, "style.css"), CSS + HAIRLINE);
    const second = await action(dir);

    expect(second.code, "the gate fires").toBe(1);
    expect(second.outputs.clean).toBe("false");
    expect(Number(second.outputs.regressed)).toBeGreaterThan(0);

    /* Rhythm moved, and it moved down. The relationship, not the number: the
       number is a property of this machine's fonts. */
    const now = JSON.parse(readFileSync(join(dir, "quoin-results.json"), "utf8")).readings[0];
    expect(now.onRhythm, "boxes came off the rhythm").toBeLessThan(before.onRhythm);

    /* And the baseline was not quietly rewritten to the worse figure. */
    expect(readBaseline(dir).entries[0].onRhythm).toBe(before.onRhythm);

    const markdown = second.outputs.markdown ?? "";
    expect(markdown).toContain("came off the grid");
    expect(markdown, "the fix is in the comment").toMatch(/border|padding/);
    expect(markdown, "and it says how much it moved").toMatch(/moves \d+ blocks/);

    /* An annotation, so the failure is visible without opening the log. */
    expect(second.stdout).toContain("::error::");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a regression rhythm alone can see is explained, not just flagged", async () => {
  /* Phase holding while rhythm falls reads as a puzzle unless the comment says
     why, so it says why. */
  const dir = makeSite();
  try {
    const first = await action(dir);
    const before = readBaseline(dir).entries[0];

    writeFileSync(join(dir, "style.css"), CSS + HAIRLINE);
    const second = await action(dir);

    const now = JSON.parse(readFileSync(join(dir, "quoin-results.json"), "utf8")).readings[0];
    /* Only meaningful while phase really does hold. If a future change makes
       phase catch this too, this test has nothing left to prove and should be
       rewritten rather than relaxed. */
    expect(now.onGrid, "phase absorbed the pixel").toBeGreaterThanOrEqual(
      before.onGrid - 1
    );

    expect(first.code).toBe(0);
    expect(second.code).toBe(1);
    expect(second.outputs.markdown).toContain("Phase held and rhythm did not");
    expect(second.stdout).toMatch(/off the rhythm/);

    /* The table carries both numbers, so the reader can see which one moved. */
    expect(second.outputs.markdown).toContain("| Rhythm |");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page that is off in phase, not rhythm, is caught too", async () => {
  /* The other half. A leading that is not a whole number of rows moves the
     baselines without changing any box's height by a fraction of a row, so
     phase is the gate that sees it. */
  const dir = makeSite();
  try {
    await action(dir);
    const before = readBaseline(dir).entries[0];

    /* 24px becomes 25px on three of the five paragraphs: a second phase, far
       enough from the first that no origin serves both. */
    writeFileSync(
      join(dir, "style.css"),
      CSS + "\nsection p, main > p:last-child { line-height: 25px; }\n"
    );
    const second = await action(dir);

    const now = JSON.parse(readFileSync(join(dir, "quoin-results.json"), "utf8")).readings[0];
    expect(now.onGrid, "phase fell").toBeLessThan(before.onGrid);
    expect(second.code).toBe(1);
    expect(second.outputs.markdown).toContain("came off the grid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-on-regression false still reports, it just does not fail", async () => {
  const dir = makeSite();
  try {
    await action(dir);
    writeFileSync(join(dir, "style.css"), CSS + HAIRLINE);
    const second = await action(dir, { QUOIN_FAIL: "false" });

    expect(second.code).toBe(0);
    expect(second.outputs.clean, "it is still honest about it").toBe("false");
    expect(second.outputs.markdown).toContain("came off the grid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fixed page reads as improved against the baseline that recorded it broken", async () => {
  const dir = makeSite();
  try {
    writeFileSync(join(dir, "style.css"), CSS + HAIRLINE);
    await action(dir);
    const broken = readBaseline(dir).entries[0];

    writeFileSync(join(dir, "style.css"), CSS);
    const fixed = await action(dir);

    expect(fixed.code, "an improvement never fails the gate").toBe(0);
    expect(fixed.outputs.markdown).toContain("improved");
    expect(fixed.outputs.clean).toBe("true");

    /* The hairline was a rhythm defect, so rhythm is what recovers. Phase never
       moved in either direction, which is the whole reason rhythm is a gate. */
    const now = JSON.parse(readFileSync(join(dir, "quoin-results.json"), "utf8")).readings[0];
    expect(now.onRhythm).toBeGreaterThan(broken.onRhythm);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("update-baseline overwrites the record rather than judging against it", async () => {
  const dir = makeSite();
  try {
    await action(dir);
    const before = readBaseline(dir).entries[0];

    writeFileSync(join(dir, "style.css"), CSS + HAIRLINE);
    const update = await action(dir, { QUOIN_UPDATE_BASELINE: "true" });

    expect(update.code, "accepting a worse number is not a failure").toBe(0);
    expect(update.stdout).toContain("as asked");
    expect(readBaseline(dir).entries[0].onRhythm).toBeLessThan(before.onRhythm);

    /* And the next run compares against the number it just accepted. */
    const after = await action(dir);
    expect(after.code).toBe(0);
    expect(after.outputs.markdown).toContain("No change");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
   The absolute floor
 * ------------------------------------------------------------------ */

test("the floor applies on the first run, before any baseline exists", async () => {
  /*
     This is the bug the floor had. Recording a baseline exited zero before the
     floor was ever evaluated, so a repository that set `min: 90` on a page
     sitting at 80 got a green build on the one gate it had asked for, and the
     failure mode is that you stop looking.
  */
  const dir = makeSite();
  try {
    /* The floor is a percentage of blocks on the grid, so it takes a phase
       defect to cross it. A hairline would not: it is a rhythm defect and the
       floor does not read rhythm. */
    writeFileSync(join(dir, "style.css"), CSS + PHASE_BREAK);
    const result = await action(dir, { QUOIN_MIN: "95" });

    expect(result.code, "the floor fires with no baseline").toBe(1);
    expect(result.stdout).toMatch(/below the 95% floor/);
    expect(result.outputs.clean).toBe("false");

    /* The baseline is still written: the floor is a verdict on the page, not a
       reason to lose the reading. */
    expect(existsSync(join(dir, "baseline.json"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the floor does not fire on a page that clears it", async () => {
  /* The other half, without which the test above passes on a broken build that
     always fails. */
  const dir = makeSite();
  try {
    const result = await action(dir, { QUOIN_MIN: "95" });
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).not.toContain("floor");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
   Inputs
 * ------------------------------------------------------------------ */

test("each width is its own reading, because a correction is one layout's", async () => {
  const dir = makeSite();
  try {
    await action(dir, { QUOIN_WIDTHS: "1280,600" });
    const baseline = readBaseline(dir);

    expect(baseline.entries).toHaveLength(2);
    expect(
      baseline.entries.map((e: { width: number }) => e.width).sort((a: number, b: number) => a - b)
    ).toEqual([600, 1280]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a url that stopped being measured is reported rather than dropped", async () => {
  const dir = makeSite();
  try {
    writeFileSync(join(dir, "second.html"), PAGE);
    await action(dir, { QUOIN_URLS: "index.html,second.html" });
    expect(readBaseline(dir).entries).toHaveLength(2);

    const narrower = await action(dir, { QUOIN_URLS: "index.html" });
    expect(narrower.outputs.markdown).toContain("second.html");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignored selectors leave the page, and the count follows", async () => {
  const dir = makeSite();
  try {
    const all = await action(dir);
    const measured = readBaseline(dir).entries[0].total;

    rmSync(join(dir, "baseline.json"));
    await action(dir, { QUOIN_IGNORE: "section,section *" });
    const fewer = readBaseline(dir).entries[0].total;

    expect(all.code).toBe(0);
    expect(fewer).toBeLessThan(measured);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bad inputs stop the run instead of being guessed at", async () => {
  const dir = makeSite();
  try {
    for (const [env, expected] of [
      [{ QUOIN_URLS: "" }, /no urls/],
      [{ QUOIN_PITCH: "0" }, /pitch must be a positive number/],
      [{ QUOIN_PITCH: "-8" }, /pitch must be a positive number/],
      [{ QUOIN_WIDTHS: "wide" }, /no valid widths/],
    ] as [Record<string, string>, RegExp][]) {
      const result = await action(dir, env);
      expect(result.code, JSON.stringify(env)).toBe(1);
      expect(result.stdout + result.stderr).toMatch(expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a relative url with nothing to serve it from is an error, not a fetch", async () => {
  const dir = makeSite();
  try {
    const result = await action(dir, { QUOIN_DIRECTORY: "" });
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/relative and no directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a baseline from a future schema is refused rather than misread", async () => {
  const dir = makeSite();
  try {
    writeFileSync(
      join(dir, "baseline.json"),
      JSON.stringify({ version: 2, quoin: "9.0.0", recorded: "2030-01-01", entries: [] })
    );
    const result = await action(dir);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/version 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the run cannot read outside the directory it was given", async () => {
  const dir = makeSite();
  try {
    const result = await action(dir, { QUOIN_URLS: "index.html,../../../etc/passwd" });
    /* Whatever else happens, it does not serve the file. */
    expect(result.stdout + result.stderr).not.toContain("root:");
    expect(result.stdout).toMatch(/40[34]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
   What the workflow reads back
 * ------------------------------------------------------------------ */

test("the step summary gets the comment, so the failure is visible in the run", async () => {
  const dir = makeSite();
  try {
    await action(dir);
    writeFileSync(join(dir, "style.css"), CSS + HAIRLINE);

    const summary = join(dir, "summary.md");
    writeFileSync(summary, "");
    await action(dir, { GITHUB_STEP_SUMMARY: summary, QUOIN_FAIL: "false" });

    expect(readFileSync(summary, "utf8")).toContain("### Quoin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the markdown output survives the delimiter round trip", async () => {
  /*
     A multi-line step output needs a delimiter that does not occur in the
     value. If it ever did, the workflow file would be malformed in a way that
     is very hard to read back, so this checks the value arrives whole.
  */
  const dir = makeSite();
  try {
    await action(dir);
    const second = await action(dir);

    const markdown = second.outputs.markdown ?? "";
    expect(markdown.startsWith("### Quoin")).toBe(true);
    expect(markdown).toContain("| Page | Width | On grid |");
    expect(markdown.split("\n").length).toBeGreaterThan(4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rhythm can be turned off, and then it is absent rather than zero", async () => {
  const dir = makeSite();
  try {
    await action(dir, { QUOIN_RHYTHM: "false" });
    const entry = readBaseline(dir).entries[0];

    expect(entry.onRhythm, "absent, not zero").toBeUndefined();
    expect(entry.onGrid).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
