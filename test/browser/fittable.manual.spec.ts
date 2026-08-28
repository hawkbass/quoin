/* Could the corpus be fitted, and what would it cost?

   The corpus says the median site is at 28% on an 8px grid. That is a
   measurement of the medium and it does not answer the question the rest of this
   library is now about, which is whether those sites could be on a grid and what
   they would have to give up to get there.

   So this reads each site's own design off the rendered page, fits it, and reports
   what the type would cost: how much leading would have to move, across how many
   sizes, with no size ever changing.

   It deliberately does not claim to retrofit anybody's site. A first version did,
   by walking the page and setting margin-top on every text block, and the numbers
   it produced were nonsense in both directions: the site with the best rhythm in
   the sample got worse and the one with the worst improved by fifty points. The
   reason is that a real site's vertical spacing lives on its containers, not on
   its paragraphs, so overwriting every block's margins measures the demolition
   rather than the fit. Fitting a page is something you do when you build it, and
   that claim is tested properly in `fit.spec.ts` and `every-width.spec.ts`
   against pages built from a fit.

   What is here instead is the cost, which is a real number, and the rhythm, which
   is the other obstacle and is measured separately rather than folded in.

   Not run in CI, for the same reason the corpus is not: it measures live sites
   over the network and a test whose result depends on somebody else's deploy is
   not a test. `npm run fittable`. */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";

const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");

interface Site {
  category: string;
  name: string;
  url: string;
}

const CORPUS = JSON.parse(
  readFileSync(resolve("test/corpus/sites.json"), "utf8")
) as { sites: Site[] };

const CONCURRENCY = Number(process.env.CORPUS_CONCURRENCY ?? 6);
const PITCH = 8;

interface Step {
  name: string;
  size: number;
  leading: number;
  leadingWas: number;
  leadingMoved: number;
  space: number;
  cap: number;
}

interface Row {
  category: string;
  name: string;
  url: string;
  ok: boolean;
  note?: string;
  /** Text blocks on the page, and how many the inferred design covers. */
  blocks?: number;
  covered?: number;
  families?: number;
  steps?: number;
  /** Total leading movement, in px, across every step. */
  cost?: number;
  /** The largest single leading change, which is what a designer would object to. */
  worstMove?: number;
  /** Where the site is now, on an 8px grid. */
  onGrid?: number;
  total?: number;
  /**
   * How much of the page is already a whole number of rows tall.
   *
   * The reason a type fit does or does not carry a live site. Fitting sets the
   * type; it cannot make a container with 13px of padding, or an image 137px
   * tall, into a whole number of rows, and everything below one of those is
   * pushed off whatever the type does.
   */
  rhythm?: number;
  rhythmTotal?: number;
}

test.skip(({ browserName }) => browserName !== "chromium", "drives its own browsers");

async function study(browser: Browser, site: Site): Promise<Row> {
  const base: Row = { category: site.category, name: site.name, url: site.url, ok: false };

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36 quoin-corpus/1.0 (+https://quoin.dev)",
  });

  try {
    const page = await context.newPage();
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page
      .evaluate(async () => {
        const step = window.innerHeight;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((done) => setTimeout(done, 120));
        }
        window.scrollTo(0, 0);
      })
      .catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(1200);
    await page.addScriptTag({ content: FIT_BUNDLE });

    const fitted = await page.evaluate(
      ({ pitch }) => {
        const api = (window as unknown as {
          quoinFit: {
            inferDesign: (o: unknown) => {
              families: { role: string; font: string; steps: unknown[] }[];
              blocks: number;
              covered: number;
            };
            fitScale: (f: unknown, o: unknown) => {
              unavailable: boolean;
              cost: number;
              families: { role: string; font: string; steps: Step[] }[];
            };
          };
        }).quoinFit;

        const design = api.inferDesign({ minimumBlocks: 2 });
        if (!design.families.length) return null;

        const result = api.fitScale(design.families, { pitch });
        return { design, result };
      },
      { pitch: PITCH }
    );
    await page.close();

    if (!fitted) {
      return { ...base, note: "no repeated type combinations to infer a design from" };
    }
    if (fitted.result.unavailable) {
      return { ...base, note: "this engine could not read cap heights" };
    }

    const steps = fitted.result.families.flatMap((f) => f.steps);
    if (steps.length === 0) {
      return { ...base, note: "no family declared a usable cap height" };
    }
    if (fitted.design.blocks < 25) {
      return { ...base, note: `only ${fitted.design.blocks} text blocks; too thin` };
    }

    /*
       Rhythm, measured but not fitted. It is the other half of what stands
       between a site and a grid, and no amount of type work touches it: a
       container with thirteen pixels of padding or an image a hundred and
       thirty-seven pixels tall pushes everything below it off, whatever the
       type is doing.
    */
    const measured = await context.newPage();
    await measured.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await measured.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await measured.evaluate(() => document.fonts?.ready).catch(() => {});
    await measured.waitForTimeout(900);
    await measured.addScriptTag({ content: BUNDLE });
    const shape = await measured.evaluate(
      ({ pitch }) => {
        const grid = window.quoin.verifyGrid({ pitch, origin: "auto" }).report;
        const rhythm = window.quoin.verifyRhythm({ pitch, limit: 1 });
        return {
          onGrid: grid.onGrid,
          total: grid.total,
          rhythm: rhythm.onRhythm,
          rhythmTotal: rhythm.total,
        };
      },
      { pitch: PITCH }
    );
    await measured.close();

    return {
      ...base,
      ok: true,
      blocks: fitted.design.blocks,
      covered: fitted.design.covered,
      families: fitted.result.families.length,
      steps: steps.length,
      cost: Math.round(fitted.result.cost * 100) / 100,
      worstMove: Math.round(
        steps.reduce((worst, s) => Math.max(worst, Math.abs(s.leadingMoved)), 0) * 100
      ) / 100,
      onGrid: shape.onGrid,
      total: shape.total,
      rhythm: shape.rhythm,
      rhythmTotal: shape.rhythmTotal,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      note: /content security policy/i.test(message)
        ? "refuses injected scripts"
        : `did not load: ${message.split("\n")[0]!.slice(0, 80)}`,
    };
  } finally {
    await context.close();
  }
}

async function inPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        out[index] = await worker(items[index]!);
      }
    })
  );
  return out;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

test("@network how much would it cost the corpus to be fitted", async ({ browser }) => {
  test.skip(!process.env.CORPUS, "set CORPUS=1 to measure the corpus over the network");
  test.setTimeout(180 * 60_000);

  const sites = process.env.CORPUS_LIMIT
    ? CORPUS.sites.slice(0, Number(process.env.CORPUS_LIMIT))
    : CORPUS.sites;

  console.log(`\n  Fitting ${sites.length} sites, ${CONCURRENCY} at a time.\n`);

  let done = 0;
  const rows = await inPool(sites, CONCURRENCY, async (site) => {
    const row = await study(browser, site);
    done++;
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
    console.log(
      `  [${String(done).padStart(3)}/${sites.length}] ${row.name.padEnd(28)}` +
        (row.ok
          ? `${String(row.cost + "px").padEnd(10)} across ${String(row.steps).padEnd(3)} sizes   ` +
            `now ${pct(row.onGrid!, row.total!)}% on grid, ` +
            `${pct(row.rhythm!, row.rhythmTotal!)}% in rhythm`
          : `dropped: ${row.note}`)
    );
    return row;
  });

  const scored = rows.filter((r) => r.ok);
  const dropped = rows.filter((r) => !r.ok);
  expect(scored.length, "enough sites were read to say anything").toBeGreaterThan(
    sites.length * 0.25
  );

  const rhythmShare = (r: Row) => (r.rhythmTotal ? (r.rhythm! / r.rhythmTotal) * 100 : 0);
  const gridShare = (r: Row) => (r.total ? (r.onGrid! / r.total) * 100 : 0);

  const summary = {
    scored: scored.length,
    dropped: dropped.length,
    /* The whole cost of a grid-native type scale, in px of leading, because no
       size ever moves. */
    medianCost: Number(median(scored.map((r) => r.cost!)).toFixed(2)),
    /* The number a designer would actually argue about: not the total across a
       scale, but the largest single change to one size. */
    medianWorstMove: Number(median(scored.map((r) => r.worstMove!)).toFixed(2)),
    medianStepsPerSite: Number(median(scored.map((r) => r.steps!)).toFixed(1)),
    medianOnGrid: Number(median(scored.map(gridShare)).toFixed(1)),
    medianRhythm: Number(median(scored.map(rhythmShare)).toFixed(1)),
    freeToFit: scored.filter((r) => r.cost === 0).length,
    underFourPixels: scored.filter((r) => r.cost! <= 4).length,
    worstMoveUnderTwo: scored.filter((r) => r.worstMove! <= 2).length,
  };

  const byCategory = [...new Set(scored.map((r) => r.category))]
    .map((category) => {
      const group = scored.filter((r) => r.category === category);
      return {
        category,
        sites: group.length,
        medianCost: Number(median(group.map((r) => r.cost!)).toFixed(2)),
        medianSteps: Number(median(group.map((r) => r.steps!)).toFixed(1)),
        medianRhythm: Number(median(group.map(rhythmShare)).toFixed(1)),
      };
    })
    .sort((a, b) => a.medianCost - b.medianCost);

  mkdirSync("findings", { recursive: true });
  writeFileSync(
    "findings/fittable.json",
    JSON.stringify(
      {
        method: {
          measured: sites.length,
          pitch: PITCH,
          quoin: JSON.parse(readFileSync("package.json", "utf8")).version,
          note:
            "Each site's design is read off its own rendered page and fitted. Sizes " +
            "are never changed, so the cost is entirely leading. This does not " +
            "retrofit anybody's site: a real site's vertical spacing lives on its " +
            "containers, and overwriting every text block's margins measures the " +
            "demolition rather than the fit. Rhythm is measured separately because " +
            "it is the other obstacle and no amount of type work touches it.",
        },
        summary,
        byCategory,
        rows: [...scored, ...dropped],
      },
      null,
      2
    )
  );

  console.log(`\n  Category         Sites   leading to move   sizes   in rhythm`);
  for (const c of byCategory) {
    console.log(
      `  ${c.category.padEnd(17)}${String(c.sites).padEnd(8)}` +
        `${(c.medianCost + "px").padEnd(18)}${String(c.medianSteps).padEnd(8)}${c.medianRhythm}%`
    );
  }

  console.log(
    `\n  ${summary.scored} read, ${summary.dropped} dropped.` +
      `\n  Median cost ${summary.medianCost}px of leading across ` +
      `${summary.medianStepsPerSite} sizes, worst single change ` +
      `${summary.medianWorstMove}px.` +
      `\n  ${summary.freeToFit} sites would cost nothing at all, ` +
      `${summary.underFourPixels} would cost four pixels or less,` +
      `\n  and ${summary.worstMoveUnderTwo} would not move any single leading by more than two.` +
      `\n  Median site is ${summary.medianOnGrid}% on the grid and ` +
      `${summary.medianRhythm}% in rhythm, and the second of those is the` +
      `\n  obstacle a type fit does not remove.` +
      `\n  Written to findings/fittable.json\n`
  );
});
