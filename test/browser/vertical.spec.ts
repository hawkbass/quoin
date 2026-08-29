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
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { fitVertical } from "../../src/fit-core.ts";

const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FONT = resolve("test/browser/fixtures/fonts/NotoSansJP.ttf");

/*
   Everything here measures type, so everything here needs the typeface.

   The fixtures are downloaded rather than committed, and only the `metrics` job
   fetches them, deliberately: 30MB from a third party failing is a network
   fault and should not look like a defect in this repository. The browser job
   never had them, so on CI this file has been rendering CJK with no CJK font at
   all, drawing tofu, measuring the boxes, and passing.

   Skipped rather than quietly degraded. A suite that reports success on a run
   where it measured nothing is the failure this whole project keeps finding.
*/
const HAS_FONT = existsSync(FONT);
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
    @font-face { font-family: "NotoJP"; src: url(https://fixtures.test/font.ttf) format("truetype"); font-display: block }
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

test.skip(
  !HAS_FONT,
  "the fixture font is not present, so nothing here would be measuring the face it names. " +
    "Run `npm run fonts` first."
);

test.beforeEach(async ({ page }) => {
  await page.route("**/font.ttf", (route) => route.fulfill({ path: FONT }));
});

/*
   The guard, and the reason it exists.

   Every test in this file loaded the fixture font with `url(/font.ttf)` from a
   page created by `setContent`, which leaves the document on about:blank. A
   relative URL there resolves to nothing, no request is issued, `page.route`
   never fires, and the browser quietly falls back. Every one of these tests ran
   against a system serif, not NotoSansJP, and said in its comments that it was
   measuring CJK in a known face.

   It cost a wrong published rule before it was caught. The first ruby floor was
   a constant, fitted across three faces that were all the same fallback, and it
   concluded the floor does not depend on the typeface. It does. NotoSansJP is
   1.448 and the fallback is 1.107, which is Times New Roman.

   So the font is loaded from an absolute URL now, which does issue a request,
   and this asserts the face that arrived is the one that was asked for. A test
   that measures the wrong font and passes is worse than one that fails.
*/
test("the fixture font actually loaded, which it did not for a long time", async ({ page }) => {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "NotoJP"; src: url(https://fixtures.test/font.ttf) format("truetype"); font-display: block }
    html { font-family: "NotoJP", serif }
  </style><body>組版</body>`);
  await page.evaluate(() => document.fonts?.ready);

  const seen = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = '1000px "NotoJP"';
    const m = context.measureText("Hxy");
    return {
      ratio: (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 1000,
      /* Firefox quotes the family name and the other two do not. */
      loaded: [...document.fonts]
        .map((f) => f.family.replace(/["']/g, "") + ":" + f.status)
        .join(", "),
    };
  });

  expect(
    seen.ratio,
    `the face reported ${seen.ratio}, and 1.107 is Times New Roman. The fixture ` +
      `font did not load. Fonts on the page: ${seen.loaded}`
  ).toBeGreaterThan(1.3);
  expect(seen.loaded, "NotoJP is not in document.fonts at all").toContain("NotoJP:loaded");
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

test("the vertical baseline sits at a constant offset, the horizontal one does not", async ({
  page,
  browserName,
}) => {
  /*
     The mechanism, measured rather than asserted, because every other claim in
     this file rests on it. A zero-sized inline-block aligned to the baseline
     reports the dominant baseline in whichever mode it is in.

     What is asserted here is weaker than what 1.24.0 published, and the weaker
     version is the true one.

     Published: the vertical baseline sits at exactly half the leading, with no
     font term. Measured with the fixture font actually loading, that holds in
     Chromium and WebKit for every face tried, and holds in Firefox for Inter
     and EB Garamond. It does not hold in Firefox for NotoSansJP, which sits
     0.9px off centre. Firefox honours a CJK font's own vertical metrics, and
     that face does not declare a centred vertical origin.

     The offset is CONSTANT across leadings, which is the property the method
     actually needs: a constant shifts every baseline on the page equally, and
     solving the origin absorbs it. That is why a fitted page reads 29 of 29
     even in the engine that is not centring it.

     What it does cost is stated in the README as a limit: two faces on one
     vertical page, where one declares vertical metrics and the other does not,
     do not share a grid in Firefox.
  */

  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "NotoJP"; src: url(https://fixtures.test/font.ttf) format("truetype"); font-display: block }
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

  const verticalOffsets: number[] = [];

  for (const reading of readings) {
    const half = reading.leading / 2;
    if (reading.mode === "vertical-rl") {
      /* Constant, not necessarily zero. Collected and compared below. */
      verticalOffsets.push(Math.round((reading.baselineAt - half) * 100) / 100);
    } else {
      expect(
        Math.abs(reading.baselineAt - half),
        `horizontal at ${reading.leading} leading put the baseline at ${reading.baselineAt}, ` +
          "which is centred, so the asymmetry this library corrects is not there"
      ).toBeGreaterThan(1);
    }
  }

  expect(verticalOffsets.length, "no vertical readings were taken").toBeGreaterThan(1);
  expect(
    new Set(verticalOffsets).size,
    `the vertical offset from centre varied with the leading: ${verticalOffsets.join(", ")}. ` +
      "A constant is absorbed by solving the origin. One that moves with the leading is not, " +
      "and the method does not work in this engine."
  ).toBe(1);
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

/* --------------------------------------------------------------------------
   Ruby, which the 1.24.0 README named as the thing to be suspicious of.

   It was right to be, and the answer is more interesting than a warning.

   An annotation is a second, smaller run of type beside the base text. If the
   leading cannot hold both, every engine reserves the difference at the
   block-start edge: the first baseline moves in, the block grows by the same
   amount, and because there is no trim on this axis the growth reaches every
   block below. Horizontally `text-box-trim` cuts exactly that away.

   No CSS fixes it. `line-height: 0` on `rt`, on `ruby`, on both, and
   `ruby-position: inter-character` all leave it where it was. Only
   `rt { display: none }` restores the grid, which is deleting the content.

   Give the line enough leading and the reservation is zero in all three
   engines. The floor:

       leading >= (size + 2 x ruby) x (ascent + descent) / em

   which held at 58 of 60 held-out combinations of face and size, the other two
   short by half a pixel, so the fitter adds one.

   THE POINT, and why ruby is a section rather than a footnote: that ratio is a
   font metric. The vertical baseline is font-free and stays font-free. An
   annotation is not a baseline, it is a box, and a box is font-sized. Ruby puts
   back exactly the dependence that vertical writing takes away, and only for
   the designs that carry it.

   Two wrong turns are recorded here, because both were nearly shipped.

   The first floor used a constant 1.15 in place of the ratio. It was fitted on
   three faces that were all silently the same fallback font: the probe served
   them from a page on about:blank, where the @font-face could not load and
   `page.route` never saw a request. Eight faces reporting an identical
   ascent+descent of 1.11 was the tell, and 1.11 is Times New Roman. The
   conclusion drawn from it, that the floor does not depend on the typeface, was
   the exact opposite of the truth.

   The second: four held-out cases looked like the real floor failing by half a
   pixel, and every one of them was at an ODD leading. Plain vertical text with
   no ruby anywhere on the page shows the same half pixel at the same leadings
   in Chromium. It is baseline rounding, not ruby, and a fitted design on an
   even pitch never has an odd leading.
   -------------------------------------------------------------------------- */

const RUBY_TEXT =
  "<ruby>組版<rt>くみはん</rt></ruby>とは<ruby>文字<rt>もじ</rt></ruby>を配置する技術である。" +
  "<ruby>行送<rt>ぎょうおく</rt></ruby>りと<ruby>字送<rt>じおく</rt></ruby>りが揃っていれば" +
  "<ruby>読<rt>よ</rt></ruby>み手は文字ではなく文章を見る。";

interface RubyStep {
  name: string;
  size: number;
  leading: number;
  space: number;
  ruby: number;
}

/**
 * The font's own (ascent + descent) / em, read from the face the browser
 * resolved rather than from the stylesheet's intent, the way this library reads
 * every other metric.
 */
async function emRatioOf(page: import("@playwright/test").Page): Promise<number> {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "NotoJP"; src: url(https://fixtures.test/font.ttf) format("truetype"); font-display: block }
    html { font-family: "NotoJP", serif }
  </style><body>x</body>`);
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = '1000px "NotoJP"';
    const m = context.measureText("Hxy組");
    return (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 1000;
  });
}

/** The base text's own baselines. Annotations are not on the grid and need not be. */
async function baseBaselines(page: import("@playwright/test").Page, steps: RubyStep[]) {
  const rules = steps
    .map(
      (s) =>
        `.${s.name} { font-size:${s.size}px; line-height:${s.leading}px; ` +
        `margin:0 0 0 ${s.space}px } .${s.name} rt { font-size:${s.ruby}px }`
    )
    .join("\n");
  const body = [0, 1, 0, 1]
    .map((i) => `<p class="${steps[i % steps.length]!.name}">${RUBY_TEXT}</p>`)
    .join("");

  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "NotoJP"; src: url(https://fixtures.test/font.ttf) format("truetype"); font-display: block }
    html { font-family: "NotoJP", serif } body { margin: 0 }
    main { writing-mode: vertical-rl; height: 700px; width: 1140px; margin: 0 }
    p { margin: 0 }
    ${rules}
  </style><main>${body}</main>`);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(250);

  return page.evaluate((pitch) => {
    const centres: number[] = [];
    for (const block of document.querySelectorAll("p")) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ((n.parentElement as Element).closest("rt")) continue;
        if (!n.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0) centres.push(r.left + r.width / 2);
      }
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

test("a design carrying ruby, fitted, keeps its base text on the grid", async ({
  page,
  browserName,
}) => {
  const emRatio = await emRatioOf(page);
  const design = [
    { name: "body", size: 16, leading: 24, ruby: 8, emRatio },
    { name: "note", size: 13, leading: 20, ruby: 7, emRatio },
  ];

  const fitted = fitVertical(design, { pitch: PITCH });
  const steps: RubyStep[] = fitted.steps.map((s, i) => ({
    name: s.name,
    size: s.size,
    leading: s.leading,
    space: s.space,
    ruby: design[i]!.ruby,
  }));

  const seen = await baseBaselines(page, steps);

  console.log(
    `\n  ${browserName}: em ratio ${emRatio.toFixed(3)}, fitted to ` +
      `${steps.map((s) => s.leading).join("/")} (asked ${design.map((d) => d.leading).join("/")}), ` +
      `${seen.onGrid}/${seen.total}\n`
  );

  expect(seen.total, "nothing was measured").toBeGreaterThan(4);
  expect(
    seen.onGrid,
    `a fitted design carrying ruby read ${seen.onGrid}/${seen.total} at leadings ` +
      steps.map((s) => s.leading).join(", ")
  ).toBe(seen.total);
});

test("the leadings it asked for would not have, which is why they were raised", async ({
  page,
}) => {
  /* The control. Without it the test above passes for a fitter that ignores
     ruby entirely, provided 24 and 20 happen to work, and says nothing about
     whether the floor did anything. */
  const asIs: RubyStep[] = [
    { name: "body", size: 16, leading: 24, space: 24, ruby: 8 },
    { name: "note", size: 13, leading: 24, space: 24, ruby: 7 },
  ];

  const seen = await baseBaselines(page, asIs);
  expect(
    seen.onGrid,
    `24px of leading with an 8px annotation read ${seen.onGrid}/${seen.total}, so the ` +
      "engines reserved nothing and the floor is solving a problem that is not there"
  ).toBeLessThan(seen.total);
});

test("the floor is the font's, not a constant", async ({ page }) => {
  const emRatio = await emRatioOf(page);

  const withRuby = fitVertical([{ name: "body", size: 16, leading: 24, ruby: 8, emRatio }], {
    pitch: PITCH,
  });
  const without = fitVertical([{ name: "body", size: 16, leading: 24 }], { pitch: PITCH });

  expect(without.steps[0]!.leading, "24 is already three whole rows, so it should not move").toBe(
    24
  );
  expect(
    withRuby.steps[0]!.leading,
    "the annotation did not raise a leading the grid was happy with"
  ).toBeGreaterThan(24);
  expect(withRuby.steps[0]!.rubyFloor).toBe(Math.ceil((16 + 2 * 8) * emRatio) + 1);
  expect(withRuby.steps[0]!.leading).toBeGreaterThanOrEqual(withRuby.steps[0]!.rubyFloor!);

  /* A taller face has to ask for more. If this passes with the two equal, the
     ratio is not reaching the arithmetic and a constant would have done, which
     is precisely the mistake the first version of this made. */
  const tall = fitVertical(
    [{ name: "body", size: 16, leading: 24, ruby: 8, emRatio: emRatio + 0.2 }],
    { pitch: PITCH }
  );
  expect(
    tall.steps[0]!.rubyFloor!,
    "a face with taller metrics asked for the same floor, so the metric is not being read"
  ).toBeGreaterThan(withRuby.steps[0]!.rubyFloor!);
});

test("ruby without the metric it needs is reported, not guessed at", async () => {
  /* The same refusal as a font that declares no cap height: the horizontal
     fitter leaves that size out rather than estimate one, because a guess puts
     every baseline on the wrong row while looking like it worked. */
  const unmet = fitVertical([{ name: "body", size: 16, leading: 24, ruby: 8 }], { pitch: PITCH });

  expect(unmet.steps[0]!.rubyUnmet, "it accepted ruby with no metric and said nothing").toBe(true);
  expect(unmet.steps[0]!.rubyFloor, "it invented a floor without the metric").toBeUndefined();
  expect(unmet.steps[0]!.leading, "it moved the leading on a guess").toBe(24);
});
