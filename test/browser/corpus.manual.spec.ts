/* Quoin pointed at two hundred other people's websites.

   Not run in CI, because it measures live sites over the network and a test
   whose result depends on somebody else's deploy is not a test. Run it on
   purpose: `npm run corpus`.

   None of these sites claims a baseline grid. Being off one is not a defect,
   and the table describes the medium rather than the teams. What the sample is
   for is the question the tool cannot answer from a single page: whether any
   category of site is systematically closer to a grid than another, and whether
   the sites whose entire business is typography do better than the rest. A
   dozen sites cannot answer that. Two hundred can begin to.

   Every site is measured twice, at a fixed origin of zero and at the origin
   solved from the page. The gap between those two numbers is the finding that
   made the solver necessary: a page can be perfectly gridded and still read as
   nought per cent against zero, because everything above the first paragraph
   moved it. */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");

interface Site {
  category: string;
  name: string;
  url: string;
}

const CORPUS = JSON.parse(
  readFileSync(resolve("test/corpus/sites.json"), "utf8")
) as { sites: Site[] };

/* How many pages to hold open at once. Six keeps a run under ten minutes
   without asking a lot of any one host: each site is loaded once. */
const CONCURRENCY = Number(process.env.CORPUS_CONCURRENCY ?? 6);

/*
   Below this many text blocks a percentage is noise wearing a decimal point:
   at twenty blocks each one is worth five points.

   Set at twenty-five rather than forty, because forty dropped pages that had
   genuinely finished rendering. Adobe Spectrum's front page really does carry
   about twenty blocks of text, and calling that a load failure was wrong. Rows
   between here and sixty are kept and marked `thin`, so a reader can see which
   figures rest on a small sample.
*/
const THIN = 25;
const SMALL_SAMPLE = 60;

interface Reading {
  total: number;
  fixed4: number;
  fixed8: number;
  solved4: number;
  solved8: number;
  origin4: number;
  origin8: number;
  worst: number;
  distinctDrifts: number;
  systematic: boolean;
  skippedTransformed: number;
  onRhythm: number;
  rhythmTotal: number;
  accumulated: number;
  topCause: string | null;
}

interface Row extends Partial<Reading> {
  category: string;
  name: string;
  url: string;
  ok: boolean;
  /** Measured, but on few enough blocks that the percentage is coarse. */
  thin?: boolean;
  note?: string;
}

/* These drive their own browsers, so running the file under all three Playwright
   projects would run the same work three times and report it as three results. */
test.skip(({ browserName }) => browserName !== "chromium", "drives its own browsers");

async function measure(browser: Browser, site: Site): Promise<Row> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    /* Said plainly. A survey that disguises itself as a person is a survey
       whose method cannot be published. */
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36 quoin-corpus/1.0 (+https://quoin.dev)",
  });
  const page = await context.newPage();

  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 });

    /*
       Load the page the way a visitor experiences it, not the way a crawler
       does.

       The first version measured at DOM-ready plus two and a half seconds, and
       dropped half the design systems in the corpus as "too thin": Adobe
       Spectrum rendered twenty text nodes, Primer twenty-three. Those pages are
       not thin. They hydrate, and they defer everything below the fold until
       something scrolls. Measuring before that is measuring a skeleton and
       calling it a design system.
    */
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    /* Scroll the whole page, then come back. Content behind an intersection
       observer only exists once something has looked at it. */
    await page
      .evaluate(async () => {
        const step = window.innerHeight;
        const end = document.body.scrollHeight;
        for (let y = 0; y < end; y += step) {
          window.scrollTo(0, y);
          await new Promise((done) => setTimeout(done, 120));
        }
        window.scrollTo(0, 0);
        await new Promise((done) => setTimeout(done, 300));
      })
      .catch(() => {});

    /* Webfonts change every metric on the page, so measuring before they land
       measures a fallback. */
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(1500);

    /* A consent dialog is a different page, and measuring it and calling the
       result somebody's design system would be worse than not measuring. */
    const blocked = await page.evaluate(() => {
      const probe = document.elementFromPoint(
        window.innerWidth / 2,
        window.innerHeight / 2
      );
      for (let el: Element | null = probe; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") continue;
        if (cs.backgroundColor === "rgba(0, 0, 0, 0)") continue;
        const r = el.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.5 && r.height > window.innerHeight * 0.3) {
          return true;
        }
      }
      return false;
    });

    await page.addScriptTag({ content: BUNDLE });

    const reading = await page.evaluate((): Reading => {
      const fixed4 = window.quoin.verifyGrid({ pitch: 4, origin: 0 });
      const fixed8 = window.quoin.verifyGrid({ pitch: 8, origin: 0 });
      const solved4 = window.quoin.verifyGrid({ pitch: 4, origin: "auto" });
      const solved8 = window.quoin.verifyGrid({ pitch: 8, origin: "auto" });
      const rhythm = window.quoin.verifyRhythm({ pitch: 8, limit: 1 });

      const causes = Object.entries(rhythm.byCause)
        .filter(([name]) => name !== "contents" && name !== "unknown")
        .sort((a, b) => b[1] - a[1]);

      return {
        total: fixed8.report.total,
        fixed4: fixed4.report.onGrid,
        fixed8: fixed8.report.onGrid,
        solved4: solved4.report.onGrid,
        solved8: solved8.report.onGrid,
        origin4: Math.round(solved4.grid.origin * 100) / 100,
        origin8: Math.round(solved8.grid.origin * 100) / 100,
        worst: Math.round(solved8.report.worst * 100) / 100,
        distinctDrifts: solved8.report.distinctDrifts,
        systematic: solved8.report.systematic,
        skippedTransformed: solved8.skippedTransformed,
        onRhythm: rhythm.onRhythm,
        rhythmTotal: rhythm.total,
        accumulated: rhythm.accumulated,
        topCause: causes.length && causes[0]![1] > 0 ? causes[0]![0] : null,
      };
    });

    const thin = reading.total < THIN;

    return {
      ...site,
      ok: !thin && !blocked,
      thin: reading.total < SMALL_SAMPLE,
      note: blocked
        ? "a consent dialog was covering the page"
        : thin
          ? `only ${reading.total} text blocks rendered; too thin to characterise`
          : undefined,
      ...reading,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...site,
      ok: false,
      note: /content security policy/i.test(message)
        ? "refuses injected scripts, which is a correct policy and a real limit on this method"
        : `did not load: ${message.split("\n")[0]!.slice(0, 90)}`,
    };
  } finally {
    await context.close();
  }
}

/** Run `worker` over `items`, `limit` at a time, keeping input order. */
async function inPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return out;
}

const share = (n: number, d: number) => (d ? (n / d) * 100 : 0);
const pct = (n: number, d: number) => `${share(n, d).toFixed(1)}%`;

test("@network measure the corpus", async ({ browser }) => {
  test.skip(!process.env.CORPUS, "set CORPUS=1 to measure the corpus over the network");
  test.setTimeout(90 * 60_000);

  const sites = process.env.CORPUS_LIMIT
    ? CORPUS.sites.slice(0, Number(process.env.CORPUS_LIMIT))
    : CORPUS.sites;

  console.log(`\n  Measuring ${sites.length} sites, ${CONCURRENCY} at a time.\n`);

  let done = 0;
  const rows = await inPool(sites, CONCURRENCY, async (site) => {
    const row = await measure(browser, site);
    done++;
    const status = row.ok
      ? `${pct(row.solved8!, row.total!)} on 8px, ${pct(row.fixed8!, row.total!)} against zero`
      : `dropped: ${row.note}`;
    console.log(`  [${String(done).padStart(3)}/${sites.length}] ${row.name.padEnd(30)}${status}`);
    return row;
  });

  const scored = rows.filter((r) => r.ok);
  const dropped = rows.filter((r) => !r.ok);

  /* ---------------------------------------------------------------- *
     What the sample says
   * ---------------------------------------------------------------- */

  const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };

  const categories = [...new Set(scored.map((r) => r.category))].map((category) => {
    const group = scored.filter((r) => r.category === category);
    return {
      category,
      sites: group.length,
      medianSolved8: Number(median(group.map((r) => share(r.solved8!, r.total!))).toFixed(1)),
      medianFixed8: Number(median(group.map((r) => share(r.fixed8!, r.total!))).toFixed(1)),
      medianSolved4: Number(median(group.map((r) => share(r.solved4!, r.total!))).toFixed(1)),
      medianRhythm: Number(
        median(group.map((r) => share(r.onRhythm!, r.rhythmTotal!))).toFixed(1)
      ),
      medianDistinctDrifts: Number(median(group.map((r) => r.distinctDrifts!)).toFixed(1)),
      systematic: group.filter((r) => r.systematic).length,
    };
  });
  categories.sort((a, b) => b.medianSolved8 - a.medianSolved8);

  /* The headline: how much of the corpus the origin alone accounts for. */
  const liftedBy = scored.map((r) => share(r.solved8!, r.total!) - share(r.fixed8!, r.total!));

  const causeTally: Record<string, number> = {};
  for (const row of scored) {
    if (row.topCause) causeTally[row.topCause] = (causeTally[row.topCause] ?? 0) + 1;
  }

  const findings = {
    method: {
      measured: sites.length,
      viewport: "1280x900",
      pitch: [4, 8],
      tolerance: 0.5,
      origins: ["0", "solved"],
      quoin: JSON.parse(readFileSync("package.json", "utf8")).version,
      note:
        "None of these sites claims a baseline grid. Off-grid is not a defect; " +
        "the table describes the medium. Nodes under a CSS transform are excluded, " +
        "because their measured position is in a different coordinate space. " +
        "Each site is loaded once, at one viewport, on one day.",
    },
    summary: {
      scored: scored.length,
      dropped: dropped.length,
      medianSolved8: Number(median(scored.map((r) => share(r.solved8!, r.total!))).toFixed(1)),
      medianFixed8: Number(median(scored.map((r) => share(r.fixed8!, r.total!))).toFixed(1)),
      medianSolved4: Number(median(scored.map((r) => share(r.solved4!, r.total!))).toFixed(1)),
      medianRhythm: Number(
        median(scored.map((r) => share(r.onRhythm!, r.rhythmTotal!))).toFixed(1)
      ),
      medianOriginLift: Number(median(liftedBy).toFixed(1)),
      over90: scored.filter((r) => share(r.solved8!, r.total!) >= 90).length,
      over50: scored.filter((r) => share(r.solved8!, r.total!) >= 50).length,
      systematic: scored.filter((r) => r.systematic).length,
      topRhythmCauses: Object.entries(causeTally).sort((a, b) => b[1] - a[1]),
    },
    categories,
    rows: [...scored.sort((a, b) => share(b.solved8!, b.total!) - share(a.solved8!, a.total!)), ...dropped],
  };

  mkdirSync("findings", { recursive: true });
  writeFileSync("findings/corpus.json", JSON.stringify(findings, null, 2));

  /* ---------------------------------------------------------------- *
     The same thing, readable
   * ---------------------------------------------------------------- */

  const md: string[] = [
    "# The corpus",
    "",
    `${scored.length} sites measured, ${dropped.length} dropped, ` +
      `at 1280x900 with quoin ${findings.method.quoin}.`,
    "",
    findings.method.note,
    "",
    "## By category",
    "",
    "| Category | Sites | On 8px grid | Against origin 0 | On 4px grid | Rhythm | Distinct drifts |",
    "|---|---|---|---|---|---|---|",
    ...categories.map(
      (c) =>
        `| ${c.category} | ${c.sites} | ${c.medianSolved8}% | ${c.medianFixed8}% | ` +
        `${c.medianSolved4}% | ${c.medianRhythm}% | ${c.medianDistinctDrifts} |`
    ),
    "",
    "Medians, not means: one site at 4% would drag an average and tell you nothing",
    "about the category.",
    "",
    "## Every site",
    "",
    "| Site | Category | Nodes | 8px | 4px | Rhythm | Drifts | Origin |",
    "|---|---|---|---|---|---|---|---|",
    ...scored.map(
      (r) =>
        `| [${r.name}](${r.url})${r.thin ? " *" : ""} | ${r.category} | ${r.total} | ` +
        `${pct(r.solved8!, r.total!)} | ${pct(r.solved4!, r.total!)} | ` +
        `${pct(r.onRhythm!, r.rhythmTotal!)} | ${r.distinctDrifts} | ${r.origin8}px |`
    ),
    "",
    `\* Fewer than ${SMALL_SAMPLE} text blocks, so the percentage is coarse.`,
    "",
    "## Not measured",
    "",
    ...dropped.map((r) => `- **${r.name}**: ${r.note}`),
    "",
  ];

  writeFileSync("findings/corpus.md", md.join("\n"));

  /* ---------------------------------------------------------------- *
     And on the terminal
   * ---------------------------------------------------------------- */

  console.log(`\n  Category         Sites   8px grid   vs origin 0   Rhythm   Drifts`);
  for (const c of categories) {
    console.log(
      `  ${c.category.padEnd(17)}${String(c.sites).padEnd(8)}` +
        `${(c.medianSolved8 + "%").padEnd(11)}${(c.medianFixed8 + "%").padEnd(14)}` +
        `${(c.medianRhythm + "%").padEnd(9)}${c.medianDistinctDrifts}`
    );
  }

  console.log(
    `\n  ${scored.length} scored, ${dropped.length} dropped.` +
      `\n  Median on an 8px grid: ${findings.summary.medianSolved8}%` +
      ` (${findings.summary.medianFixed8}% if the origin is pinned to zero,` +
      ` so solving for it is worth ${findings.summary.medianOriginLift} points).` +
      `\n  Median rhythm: ${findings.summary.medianRhythm}%.` +
      `\n  ${findings.summary.over90} sites at or above 90%, ` +
      `${findings.summary.over50} at or above 50%.` +
      `\n  Commonest rhythm cause: ${
        findings.summary.topRhythmCauses[0]?.[0] ?? "none recorded"
      }.\n  Written to findings/corpus.md\n`
  );

  /* The study is the deliverable, so the only failure is not gathering one. */
  expect(scored.length, "most of the corpus rendered enough to measure").toBeGreaterThan(
    sites.length * 0.5
  );
});
