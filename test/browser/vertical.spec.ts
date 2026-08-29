/* Vertical writing, which is a different problem and a smaller one.

   Everything else here assumes lines stack downwards and baselines are
   horizontal rules. In `writing-mode: vertical-rl` the block axis runs across
   the page, lines stack sideways, and the dominant baseline is the central one.

   That last part is the whole finding. Measured in both engines, at every
   leading, for CJK and Latin alike, the vertical baseline sits at exactly half
   the leading:

       mode              leading   baseline at   off centre
       horizontal            32         23            7
       horizontal            30         22            7
       vertical              32         16          centred
       vertical              30         15          centred

   Horizontally the baseline is half the leading plus the ascent and the ascent
   belongs to the typeface, which is the asymmetry this whole library exists to
   correct. Vertically it is gone. So there is no cap height to close, no residue
   to solve, and the rule has no font in it:

     1. every leading a whole number of rows,
     2. every leading the same parity in rows,
     3. every space a whole number of rows.

   The parity is the only part that is not obvious, and the first prediction made
   here was wrong about it. Between one block's last baseline and the next
   block's first lies `leadingA/2 + space + leadingB/2`. Two even leadings give
   two whole rows. Two ODD ones give two half-rows, which sum to a whole one, so
   all-odd holds as well and only a mix fails.

   All three engines are run, Firefox included, and that is the part worth
   noticing. The Firefox Playwright ships is 153, one release short of
   `text-box-trim`, so every horizontal spec here skips it. This one does not
   need to, because nothing in the vertical method needs trim, and it passes.

   The first version of this file skipped Firefox anyway and said in a comment
   that the horizontal control needed trim. Nothing in this file has ever used
   trim. The skip was copied from another spec and the reason was written
   afterwards to justify it. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fitVertical } from "../../src/fit-core.ts";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FONT = resolve("test/browser/fixtures/fonts/NotoSansJP.ttf");
const PITCH = 8;

const TEXT =
  "組版とは文字を配置する技術である。行送りと字送りが揃っていれば、" +
  "読み手は文字ではなく文章を見る。これは日本語の伝統的な原稿用紙が" +
  "何百年も前から解決していた問題であり、活字の時代からある約束事である。";

interface Step {
  name: string;
  size: number;
  leading: number;
  space: number;
}

function markup(steps: Step[]): string {
  const rules = steps
    .map(
      (s) =>
        `.${s.name} { font-size:${s.size}px; line-height:${s.leading}px; ` +
        `margin:0 0 0 ${s.space}px }`
    )
    .join("\n");

  /* Interleaved, so every pair of adjacent sizes occurs and a parity mismatch
     has somewhere to show itself. */
  const order = [0, 1, 2, 0, 2, 1, 0];
  const body = order.map((i) => `<p class="${steps[i % steps.length]!.name}">${TEXT}</p>`).join("");

  return `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "NotoJP"; src: url(/font.ttf) format("truetype"); font-display: block }
    html { font-family: "NotoJP", serif } body { margin: 0 }
    main { writing-mode: vertical-rl; height: 560px; width: 1140px; margin: 0 }
    p { margin: 0 }
    ${rules}
  </style><main>${body}</main>`;
}

/**
 * Every line's baseline, which vertically is the centre of its line box, scored
 * against the best single origin.
 */
async function measure(page: import("@playwright/test").Page, html: string) {
  await page.setContent(html);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);

  return page.evaluate((pitch) => {
    const centres: number[] = [];
    for (const block of document.querySelectorAll("p")) {
      const range = document.createRange();
      range.selectNodeContents(block);
      for (const rect of range.getClientRects()) centres.push(rect.left + rect.width / 2);
    }

    const distinct: number[] = [];
    for (const x of [...new Set(centres.map((v) => Math.round(v * 100) / 100))].sort(
      (a, b) => b - a
    )) {
      const last = distinct[distinct.length - 1];
      if (last === undefined || Math.abs(last - x) > 0.5) distinct.push(x);
    }

    let best = -1;
    for (const candidate of distinct) {
      const shifted = ((candidate % pitch) + pitch) % pitch;
      const on = distinct.filter((value) => {
        const r = (((value - shifted) % pitch) + pitch) % pitch;
        return Math.min(r, pitch - r) <= 0.5;
      }).length;
      if (on > best) best = on;
    }

    return { onGrid: best, total: distinct.length };
  }, PITCH);
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.route("**/font.ttf", (route) => route.fulfill({ path: FONT }));
});

test("what fitVertical returns lands on the grid", async ({ page, browserName }) => {

  /* A design as somebody would state it, with nothing on a row. */
  const design = [
    { name: "caption", size: 13, leading: 17.5 },
    { name: "body", size: 20, leading: 27 },
    { name: "heading", size: 32, leading: 41 },
  ];

  const fitted = fitVertical(design, { pitch: PITCH });
  const steps = fitted.steps.map((s) => ({
    name: s.name,
    size: s.size,
    leading: s.leading,
    space: s.space,
  }));

  const seen = await measure(page, markup(steps));

  console.log(
    `\n  ${browserName}: ${fitted.parity} parity, rows ` +
      `${fitted.steps.map((s) => s.rows).join("/")}, ${seen.onGrid}/${seen.total}\n`
  );

  expect(seen.total, "nothing was measured").toBeGreaterThan(10);
  expect(
    seen.onGrid,
    `a fitted vertical page read ${seen.onGrid}/${seen.total} with ` +
      `${fitted.parity} parity and leadings ${steps.map((s) => s.leading).join(", ")}`
  ).toBe(seen.total);
});

test("a mix of parities is what breaks it, and the fitter never produces one", async ({
  page,
  browserName,
}) => {
  /*
     The control, and the reason the parity rule is in the fitter at all. Without
     this the first test passes for any design whose leadings happen to agree,
     and says nothing about whether the rule is doing anything.
  */

  const mixed = [
    { name: "a", size: 13, leading: 16, space: 24 },
    { name: "b", size: 15, leading: 24, space: 24 },
    { name: "c", size: 20, leading: 32, space: 24 },
  ];

  const seen = await measure(page, markup(mixed));
  expect(
    seen.onGrid,
    `16, 24 and 32 are two even row counts and one odd, and the page still read ` +
      `${seen.onGrid}/${seen.total}`
  ).toBeLessThan(seen.total);

  /* And the fitter will not hand you that. */
  const fitted = fitVertical(mixed, { pitch: PITCH });
  const parities = new Set(fitted.steps.map((s) => s.rows % 2));
  expect(parities.size, `it produced rows ${fitted.steps.map((s) => s.rows).join(", ")}`).toBe(1);
});

test("all odd holds, which the first prediction said it would not", async ({
  page,
  browserName,
}) => {

  const odd = [
    { name: "a", size: 15, leading: 24, space: 24 },
    { name: "b", size: 26, leading: 40, space: 24 },
    { name: "c", size: 36, leading: 56, space: 24 },
  ];

  const seen = await measure(page, markup(odd));
  expect(
    seen.onGrid,
    `three odd row counts read ${seen.onGrid}/${seen.total}, so two half-rows do ` +
      "not sum to a whole one after all"
  ).toBe(seen.total);
});

test("the vertical baseline is centred and the horizontal one is not", async ({
  page,
  browserName,
}) => {
  /*
     The mechanism, measured rather than asserted, because every other claim in
     this file rests on it. A zero-sized inline-block aligned to the baseline
     reports the dominant baseline in whichever mode it is in.
  */

  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "NotoJP"; src: url(/font.ttf) format("truetype"); font-display: block }
    body { margin: 0; font-family: "NotoJP", serif }
  </style><body></body>`);
  await page.evaluate(() => document.fonts?.ready);

  const readings = await page.evaluate(() => {
    const out: { mode: string; leading: number; baselineAt: number }[] = [];

    for (const writingMode of ["horizontal-tb", "vertical-rl"]) {
      for (const leading of [32, 30]) {
        const holder = document.createElement("div");
        holder.style.cssText =
          `writing-mode:${writingMode};margin:0;padding:0;border:0;` +
          (writingMode === "vertical-rl" ? "height:400px;width:320px" : "width:420px");

        const block = document.createElement("p");
        block.style.cssText = `margin:0;font:20px/${leading}px "NotoJP", serif`;
        block.innerHTML =
          '<span class="mark" style="display:inline-block;width:0;height:0;' +
          'vertical-align:baseline"></span>組版とは文字を配置する';
        holder.appendChild(block);
        document.body.appendChild(holder);

        const box = block.getBoundingClientRect();
        const mark = block.querySelector(".mark")!.getBoundingClientRect();
        const baselineAt =
          writingMode === "vertical-rl" ? box.right - mark.right : mark.top - box.top;

        out.push({
          mode: writingMode,
          leading,
          baselineAt: Math.round(baselineAt * 1000) / 1000,
        });
        holder.remove();
      }
    }
    return out;
  });

  for (const reading of readings) {
    const half = reading.leading / 2;
    if (reading.mode === "vertical-rl") {
      expect(
        reading.baselineAt,
        `vertical at ${reading.leading} leading put the baseline at ${reading.baselineAt}, ` +
          `not at half of it`
      ).toBeCloseTo(half, 1);
    } else {
      expect(
        Math.abs(reading.baselineAt - half),
        `horizontal at ${reading.leading} leading put the baseline at ${reading.baselineAt}, ` +
          "which is centred, so the asymmetry this library corrects is not there"
      ).toBeGreaterThan(1);
    }
  }
});

/* --------------------------------------------------------------------------
   verifyVertical, which is the other half of the feature.

   `fit --vertical` was shipped before there was any way to check what it
   emitted. The browser tests above prove the arithmetic by measuring line-box
   centres with a Range, which is a test harness rather than a tool: nobody
   auditing their own vertical page can run it. These check the checker.
   -------------------------------------------------------------------------- */

const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");

interface VerticalCheck {
  report: {
    total: number;
    onGrid: number;
    offGrid: number;
    parities: { even: number; odd: number; fractional: number };
    mixedParity: boolean;
  };
  skippedHorizontal: number;
  grid: { pitch: number; origin: number };
}

async function check(
  page: import("@playwright/test").Page,
  html: string
): Promise<VerticalCheck> {
  await page.setContent(html);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
  await page.addScriptTag({ content: FIT_BUNDLE });

  return page.evaluate((pitch) => {
    const api = (globalThis as unknown as { quoinFit: Record<string, Function> }).quoinFit;
    const out = api.verifyVertical!({ pitch }) as VerticalCheck;
    return {
      report: out.report,
      skippedHorizontal: out.skippedHorizontal,
      grid: out.grid,
    };
  }, PITCH) as Promise<VerticalCheck>;
}

test("verifyVertical reads a page fitted by fitVertical as seated", async ({ page }) => {
  const design = [
    { name: "caption", size: 13, leading: 17.5 },
    { name: "body", size: 20, leading: 27 },
    { name: "heading", size: 32, leading: 41 },
  ];
  const fitted = fitVertical(design, { pitch: PITCH });
  const steps = fitted.steps.map((s) => ({
    name: s.name,
    size: s.size,
    leading: s.leading,
    space: s.space,
  }));

  const seen = await check(page, markup(steps));

  expect(seen.report.total, "nothing was measured").toBeGreaterThan(5);
  expect(
    seen.report.onGrid,
    `a page fitted by the tool read ${seen.report.onGrid}/${seen.report.total} ` +
      `when checked by the tool`
  ).toBe(seen.report.total);
  expect(seen.report.mixedParity).toBe(false);
});

test("verifyVertical fails the page the arithmetic says should fail", async ({ page }) => {
  /* The control. Without it the test above passes for a checker that returns
     100% unconditionally, which is a checker somebody would ship. */
  const mixed = [
    { name: "a", size: 13, leading: 16, space: 24 },
    { name: "b", size: 15, leading: 24, space: 24 },
    { name: "c", size: 20, leading: 32, space: 24 },
  ];

  const seen = await check(page, markup(mixed));

  expect(
    seen.report.offGrid,
    `16, 24 and 32 are two even row counts and one odd, and the checker read ` +
      `${seen.report.onGrid}/${seen.report.total} with nothing off it`
  ).toBeGreaterThan(0);
  expect(
    seen.report.mixedParity,
    `parities counted ${JSON.stringify(seen.report.parities)}, which the checker ` +
      "did not call mixed"
  ).toBe(true);
});

test("a horizontal page is not reported as a seated vertical one", async ({ page }) => {
  /*
     The failure this checker could plausibly have. Point it at an ordinary
     horizontal page and every block is skipped, which leaves nothing measured,
     which averages to a perfect score over an empty set. That is the exact
     shape of defect this project keeps finding in itself: an answer that is
     true about a part and false about the thing somebody would act on.
  */
  const horizontal = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; font: 20px/27px serif }
    p { margin: 0 0 21px }
  </style><p>${TEXT}</p><p>${TEXT}</p><p>${TEXT}</p>`;

  const seen = await check(page, horizontal);

  expect(seen.report.total, "a horizontal page was measured as vertical text").toBe(0);
  expect(
    seen.skippedHorizontal,
    "the blocks were dropped without being counted, so the caller cannot tell " +
      "an unmeasurable page from a seated one"
  ).toBeGreaterThan(0);
});
