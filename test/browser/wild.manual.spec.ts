/* The round trip, on pages nobody wrote for it.

   Fixtures prove the seater handles the cases it was built to handle, which is
   necessary and is also grading your own homework. These are real design system
   homepages: utility classes, component libraries, web fonts, sticky headers,
   nested flex, and markup that has never heard of a baseline grid.

   The claim under test is the one the README makes: seat the page, export the
   stylesheet, delete the JavaScript, and the page stays seated. So it seats,
   exports, undoes everything, injects the stylesheet on its own, and measures
   again.

   Not in CI, because it depends on somebody else's deploy: `npm run wild`. */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = resolve("dist/quoin.global.js");

const SITES = [
  { name: "GOV.UK Design System", url: "https://design-system.service.gov.uk/" },
  { name: "Shopify Polaris", url: "https://polaris.shopify.com/" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com/" },
  { name: "Material Design 3", url: "https://m3.material.io/" },
  { name: "Ant Design", url: "https://ant.design/" },
];

/* Display type opts out. Not a way of flattering the numbers: a headline at
   4rem with tight leading is a shape rather than a line of reading, and these
   are the conventional names for one. */
const IGNORE = ["h1", "h2", ".display", "[class*='hero']", "[class*='Hero']"];

const GRID = { pitch: 8, tolerance: 0.5, origin: 0 };

interface Result {
  name: string;
  url: string;
  ok: boolean;
  note?: string;
  total?: number;
  before?: number;
  withScript?: number;
  restored?: number;
  withCss?: number;
  passes?: number;
  missed?: number;
  unexportable?: number;
  cssBytes?: number;
  rules?: number;
  escalated?: number;
  clean?: boolean;
  stillLost?: number;
}

/* These drive their own browsers, so running the file under all three Playwright
   projects would run the same work three times and report it as three results.
   Pinned to one project; the engines are covered inside the test. */
test.skip(({ browserName }) => browserName !== "chromium", "drives its own browsers");

test("@network seat, export, delete the script, stay seated", async ({ browser }) => {
  test.skip(!process.env.WILD, "set WILD=1 to run against five live sites");
  test.setTimeout(20 * 60_000);

  const results: Result[] = [];

  for (const site of SITES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    try {
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(2500);
      await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });

      const data = await page.evaluate(
        ({ grid, ignore }) => {
          const options = { ...grid, ignore };
          const before = window.quoin.verifyGrid(options).report;

          const seated = window.quoin.seatPage(options);
          const withScript = window.quoin.verifyGrid(options).report;

          /* Undoes the seating itself, applies the sheet, and escalates only
             the declarations the page overruled. */
          const verified = window.quoin.exportCssVerified(seated);
          const restored = window.quoin.verifyGrid(options).report;

          const style = document.createElement("style");
          style.textContent = verified.css;
          document.head.appendChild(style);
          const withCss = window.quoin.verifyGrid(options).report;

          return {
            total: before.total,
            before: before.onGrid,
            withScript: withScript.onGrid,
            restored: restored.onGrid,
            withCss: withCss.onGrid,
            passes: seated.passes,
            missed: seated.missed,
            unexportable: seated.unexportable,
            escalated: verified.escalated,
            clean: verified.check.clean,
            stillLost: verified.check.lost.length,
            cssBytes: verified.css.length,
            rules: (verified.css.match(/\{/g) ?? []).length,
          };
        },
        { grid: GRID, ignore: IGNORE }
      );

      results.push({ name: site.name, url: site.url, ok: true, ...data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: site.name,
        url: site.url,
        ok: false,
        note: message.slice(0, 90),
      });
    } finally {
      await context.close();
    }
  }

  mkdirSync("findings", { recursive: true });
  writeFileSync(
    "findings/wild.json",
    JSON.stringify({ grid: GRID, ignore: IGNORE, results }, null, 2),
    "utf8"
  );

  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(0)}%`;

  console.log(
    `\n  Site                      Nodes  Before   Seated   Undone   CSS only  Sweeps  Missed  Unexportable`
  );
  for (const r of results) {
    if (!r.ok) {
      console.log(`  ${pad(r.name, 26)}failed: ${r.note}`);
      continue;
    }
    console.log(
      `  ${pad(r.name, 26)}${pad(r.total, 7)}` +
        `${pad(pct(r.before!, r.total!), 9)}${pad(pct(r.withScript!, r.total!), 9)}` +
        `${pad(pct(r.restored!, r.total!), 9)}${pad(pct(r.withCss!, r.total!), 10)}` +
        `${pad(r.passes, 8)}${pad(r.escalated, 11)}${r.stillLost}`
    );
  }
  console.log("");

  const worked = results.filter((r) => r.ok);
  expect(worked.length, "most of them loaded").toBeGreaterThanOrEqual(3);

  for (const r of worked) {
    /* Undo has to be exact, or the CSS-only reading is measuring the stylesheet
       plus whatever the script left behind. */
    expect(r.restored, `${r.name}: undo restored the page`).toBe(r.before);

    expect(
      r.withScript,
      `${r.name}: seating raised the on-grid count`
    ).toBeGreaterThan(r.before!);

    /* The claim in the README. The tolerance is the tool's own reported
       `unexportable` count plus one, because a block it could not build a
       selector for is one it already told you about. */
    expect(
      r.withCss,
      `${r.name}: the exported CSS should reproduce the seating without the script. ` +
        `script ${r.withScript}/${r.total}, css ${r.withCss}/${r.total}, ` +
        `${r.unexportable} reported unexportable`
    ).toBeGreaterThanOrEqual(r.withScript! - r.unexportable! - 1);
  }
});
