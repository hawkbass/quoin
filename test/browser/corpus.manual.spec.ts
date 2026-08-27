/* Quoin pointed at other people's design systems.

   Not run in CI, because it measures twelve live sites over the network and a
   test whose result depends on somebody else's deploy is not a test. Run it on
   purpose: `npm run corpus`.

   None of these sites claims a baseline grid. Being off one is not a defect,
   and the table describes the medium rather than the teams. */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = resolve("dist/quoin.global.js");

const SITES = [
  { name: "GOV.UK Design System", url: "https://design-system.service.gov.uk/" },
  { name: "Shopify Polaris", url: "https://polaris.shopify.com/" },
  { name: "IBM Carbon", url: "https://carbondesignsystem.com/" },
  { name: "Atlassian Design", url: "https://atlassian.design/" },
  { name: "Adobe Spectrum", url: "https://spectrum.adobe.com/" },
  { name: "Salesforce Lightning", url: "https://www.lightningdesignsystem.com/" },
  { name: "GitHub Primer", url: "https://primer.style/" },
  { name: "Material Design 3", url: "https://m3.material.io/" },
  { name: "Ant Design", url: "https://ant.design/" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com/" },
  { name: "Stripe", url: "https://stripe.com/gb" },
  /* Included on purpose. A survey that leaves out the surveyor is marketing. */
  { name: "craighawkes.dev", url: "https://craighawkes.dev/" },
];

interface Row {
  name: string;
  url: string;
  ok: boolean;
  note?: string;
  total?: number;
  onGrid4?: number;
  onGrid8?: number;
  worst?: number;
  distinctDrifts?: number;
  systematic?: boolean;
  skippedTransformed?: number;
}

/* These drive their own browsers, so running the file under all three Playwright
   projects would run the same work three times and report it as three results.
   Pinned to one project; the engines are covered inside the test. */
test.skip(({ browserName }) => browserName !== "chromium", "drives its own browsers");

test("@network measure the reference design systems", async ({ browser }) => {
  test.skip(!process.env.CORPUS, "set CORPUS=1 to measure twelve live sites");
  test.setTimeout(20 * 60_000);

  const rows: Row[] = [];

  for (const site of SITES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    try {
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(2500);

      /* A consent dialog is a different page, and measuring it and calling the
         result a design system would be worse than not measuring at all. */
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

      await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });

      const result = await page.evaluate(() => {
        const four = window.quoin.verifyGrid({ pitch: 4 });
        const eight = window.quoin.verifyGrid({ pitch: 8 });
        return {
          total: four.report.total,
          onGrid4: four.report.onGrid,
          onGrid8: eight.report.onGrid,
          worst: four.report.worst,
          distinctDrifts: four.report.distinctDrifts,
          systematic: four.report.systematic,
          skippedTransformed: four.skippedTransformed,
        };
      });

      /* Under about forty text nodes the page has not finished rendering, or
         renders almost nothing at load, and a percentage over that is noise
         wearing a decimal point. */
      const thin = result.total < 40;

      rows.push({
        name: site.name,
        url: site.url,
        ok: !thin && !blocked,
        note: blocked
          ? "a consent dialog was covering the page"
          : thin
            ? `only ${result.total} text nodes rendered; too thin to characterise`
            : undefined,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        name: site.name,
        url: site.url,
        ok: false,
        note: /content security policy/i.test(message)
          ? "refuses injected scripts, which is a correct policy and a real limit on this method"
          : `did not load: ${message.slice(0, 72)}`,
      });
    } finally {
      await context.close();
    }
  }

  const scored = rows.filter((r) => r.ok);
  scored.sort((a, b) => b.onGrid4! / b.total! - a.onGrid4! / a.total!);

  const findings = {
    method: {
      viewport: "1280x900",
      pitch: [4, 8],
      tolerance: 0.5,
      quoin: JSON.parse(readFileSync("package.json", "utf8")).version,
      note:
        "None of these sites claims a baseline grid. Off-grid is not a defect; " +
        "the table describes the medium. Nodes under a CSS transform are excluded, " +
        "because their measured position is in a different coordinate space.",
    },
    rows: [...scored, ...rows.filter((r) => !r.ok)],
  };

  mkdirSync("findings", { recursive: true });
  writeFileSync("findings/corpus.json", JSON.stringify(findings, null, 2));

  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;

  console.log(`\n  Design system            Nodes   4px grid   8px grid   Distinct drifts`);
  for (const row of scored) {
    console.log(
      `  ${row.name.padEnd(24)}${String(row.total).padEnd(8)}` +
        `${pct(row.onGrid4!, row.total!).padEnd(11)}` +
        `${pct(row.onGrid8!, row.total!).padEnd(11)}${row.distinctDrifts}`
    );
  }
  for (const row of rows.filter((r) => !r.ok)) {
    console.log(`  ${row.name.padEnd(24)}dropped: ${row.note}`);
  }
  console.log("");

  expect(scored.length, "most of the corpus rendered enough to measure").toBeGreaterThanOrEqual(7);
});
