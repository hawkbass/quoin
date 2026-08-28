/* Text that is not Latin.

   Cap height is a Latin idea, and everything here defaults to
   `text-box-edge: cap alphabetic`, which is an assumption the tool made without
   ever saying so. Two questions came out of examining it and the answers are
   different.

   Does the arithmetic still work outside Latin? Yes, and for a reason worth
   knowing: a trimmed box is a property of the font declared metrics rather than
   of the glyphs inside it, so Japanese text in a face trims to exactly the same
   height as Latin text in the same face. The engines lay both out against the
   alphabetic baseline in horizontal writing, so a grid built on it is a real
   grid for any script.

   Could you instead grid to the ideographic em, which is what a Japanese
   typesetter would do? No, and that is a finding rather than a limitation of
   this library. Chromium rejects every ideographic form of `text-box-edge`
   outright. WebKit accepts them and returns the same box as `text`, which is to
   say it has not implemented the metric either. There is no working ideographic
   edge on the web today.

   What does work in both, and is genuinely different, is `ex alphabetic` and
   `text alphabetic`. So the edge is an option, it is validated rather than
   assumed, and an edge an engine refuses comes back as null instead of silently
   measuring the default box. That last part is how the mistake above was caught:
   an earlier reading of 1.448 em for ideographic was the untrimmed box, measured
   because the property had been rejected and left at its previous value. */

import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const FONTS = resolve("test/browser/fixtures/fonts");
const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");
const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");

const PITCH = 8;
const WIDTHS = [360, 480, 640, 900, 1280];

/* One face per script, each with text in the script it is for. The Latin row
   uses the Japanese face on purpose: it is the comparison that shows the box is
   a property of the font rather than of the characters. */
const SAMPLES = [
  { name: "Latin in a CJK face", file: "NotoSansJP.ttf", text: "Handgloves and quartz" },
  { name: "Japanese", file: "NotoSansJP.ttf", text: "日本語の組版とベースライングリッド" },
  { name: "Arabic", file: "NotoSansArabic.ttf", text: "الطباعة العربية وخط الأساس" },
  { name: "Devanagari", file: "NotoSansDevanagari.ttf", text: "देवनागरी लिपि और आधाररेखा" },
  { name: "Thai", file: "NotoSerifThai.ttf", text: "การพิมพ์ไทยและเส้นฐาน" },
];

const available = SAMPLES.filter((s) => existsSync(join(FONTS, s.file)));

async function loadFace(
  page: import("@playwright/test").Page,
  file: string,
  family: string
): Promise<boolean> {
  const base64 = readFileSync(join(FONTS, file)).toString("base64");
  return page.evaluate(
    async ({ family, base64 }) => {
      const face = new FontFace(
        family,
        `url(data:font/truetype;base64,${base64}) format("truetype")`
      );
      try {
        await face.load();
      } catch {
        return false;
      }
      document.fonts.add(face);
      await document.fonts.ready;
      return true;
    },
    { family, base64 }
  );
}

test.describe.configure({ mode: "serial" });

test("a trimmed box is the same height whatever script is inside it", async ({
  page,
  browserName,
}) => {
  /*
     The measurement the rest of this rests on, and the thing that makes fitting
     work outside Latin at all. If the box depended on the glyphs, a page mixing
     scripts would have as many phases as it had writing systems.
  */
  test.skip(available.length === 0, "no font corpus: run `npm run fonts`");

  await page.goto("/prose.html");
  await page.addScriptTag({ content: BUNDLE });
  const supported = await page.evaluate(() => CSS.supports("text-box-trim", "trim-both"));
  test.skip(!supported, `${browserName} has no text-box-trim`);

  const jp = available.find((s) => s.file === "NotoSansJP.ttf");
  test.skip(!jp, "the CJK face is not in the corpus");

  expect(await loadFace(page, jp!.file, "ScriptProbe")).toBe(true);

  const heights = await page.evaluate(() => {
    const at = (text: string) => {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;visibility:hidden;font-family:ScriptProbe;font-size:1000px;" +
        "line-height:3;white-space:pre;text-box-trim:trim-both;text-box-edge:cap alphabetic";
      el.textContent = text;
      document.body.appendChild(el);
      const height = el.getBoundingClientRect().height;
      el.remove();
      return height;
    };
    return { latin: at("Handgloves"), japanese: at("日本語の組版"), mixed: at("Hg 日本語") };
  });

  expect(
    Math.abs(heights.japanese - heights.latin),
    `Latin trimmed to ${heights.latin} and Japanese to ${heights.japanese} in the same face`
  ).toBeLessThan(0.5);
  expect(Math.abs(heights.mixed - heights.latin)).toBeLessThan(0.5);
});

test("the engines disagree about which edges exist, and it is checked not assumed", async ({
  page,
  browserName,
}) => {
  /*
     Chromium accepts `auto`, `text`, and the two-keyword forms ending in
     `alphabetic` or `text`. It rejects every single-keyword form and every
     ideographic one. WebKit accepts all of them, and returns the plain text box
     for the ideographic ones, so it has not implemented that metric either.

     An edge an engine refuses has to come back as null. Left to itself the
     property keeps its previous value, so a rejected edge measures whatever was
     set before it, which is how a reading of 1.448 em for ideographic got into
     these notes as a real number.
  */
  await page.goto("/prose.html");
  await page.addScriptTag({ content: BUNDLE });
  const supported = await page.evaluate(() => CSS.supports("text-box-trim", "trim-both"));
  test.skip(!supported, `${browserName} has no text-box-trim`);

  const boxes = await page.evaluate(() => ({
    cap: window.quoin.boxHeightForEdge("1000px serif", "cap alphabetic"),
    ex: window.quoin.boxHeightForEdge("1000px serif", "ex alphabetic"),
    text: window.quoin.boxHeightForEdge("1000px serif", "text alphabetic"),
    nonsense: window.quoin.boxHeightForEdge("1000px serif", "not-an-edge whatsoever"),
  }));

  /* The three that work in both engines, ordered as their names suggest. */
  expect(boxes.cap).not.toBeNull();
  expect(boxes.ex).not.toBeNull();
  expect(boxes.text).not.toBeNull();
  expect(boxes.ex!, "an x-height box is shorter than a cap-height one").toBeLessThan(boxes.cap!);
  expect(boxes.text!, "and a text box is taller than both").toBeGreaterThan(boxes.cap!);

  expect(
    boxes.nonsense,
    "an edge the engine refuses comes back as null rather than as the previous box"
  ).toBeNull();
});

for (const edge of ["cap alphabetic", "ex alphabetic"]) {
  test(`a page in every script holds at every width on ${edge}`, async ({
    browser,
    browserName,
  }) => {
    /*
       The end-to-end claim, run over five scripts and both edges. Each sample is
       set in the face that script is for, at two sizes, with the spacing solved
       from whichever box the edge produces.
    */
    test.skip(available.length < 3, "no font corpus: run `npm run fonts`");

    const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await setup.setContent("<p>probe</p>");
    await setup.addScriptTag({ content: FIT_BUNDLE });
    const supported = await setup.evaluate(() =>
      CSS.supports("text-box-trim", "trim-both")
    );
    if (!supported) {
      await setup.close();
      test.skip(true, `${browserName} has no text-box-trim`);
      return;
    }

    for (const sample of available) {
      const family = `S${sample.file.replace(/\W/g, "")}`;
      expect(await loadFace(setup, sample.file, family), `${sample.name} loaded`).toBe(true);
    }

    const fitted = await setup.evaluate(
      ({ samples, pitch, edge }) => {
        const api = (window as unknown as {
          quoinFit: {
            fitScale: (f: unknown, o: unknown) => {
              unavailable: boolean;
              edge: string;
              families: {
                font: string;
                steps: { name: string; size: number; leading: number; space: number }[];
              }[];
            };
          };
        }).quoinFit;

        return api.fitScale(
          samples.map((s) => ({
            role: s.role,
            font: s.family,
            steps: [
              { name: `${s.role}-body`, size: 17, ratio: 1.5, space: 24 },
              { name: `${s.role}-head`, size: 44, leading: 56, space: 56 },
            ],
          })),
          { pitch, edge }
        );
      },
      {
        pitch: PITCH,
        edge,
        samples: available.map((s, i) => ({
          role: `s${i}`,
          family: `S${s.file.replace(/\W/g, "")}`,
        })),
      }
    );
    await setup.close();

    if (fitted.unavailable) {
      test.skip(true, `${browserName} could not measure this edge`);
      return;
    }
    expect(fitted.edge, "the fit reports the edge it used").toBe(edge);

    const faces = available
      .map(
        (s) =>
          `@font-face { font-family: S${s.file.replace(/\W/g, "")}; src: url(data:font/truetype;base64,${readFileSync(
            join(FONTS, s.file)
          ).toString("base64")}) format("truetype") }`
      )
      .join("\n");

    const rules = fitted.families
      .flatMap((family, i) =>
        family.steps.map(
          (step) =>
            `.${step.name} { font-family: ${family.font}; font-size: ${step.size}px; ` +
            `line-height: ${step.leading}px; margin: ${step.space}px 0 0 }`
        )
      )
      .join("\n");

    const body = available
      .map(
        (s, i) =>
          `<h2 class="s${i}-head">${s.text}</h2>` +
          `<p class="s${i}-body">${s.text} ${s.text} ${s.text} ${s.text} ${s.text}</p>` +
          `<p class="s${i}-body">${s.text} ${s.text}</p>`
      )
      .join("\n");

    const html = `<!doctype html><meta charset="utf-8"><style>
      ${faces}
      body { margin: 0 } main { width: 92%; max-width: 700px; margin: 0 auto }
      :is(h2,p) { text-box-trim: trim-both; text-box-edge: ${edge} }
      ${rules}
    </style><main>${body}</main>`;

    const readings: string[] = [];
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(html);
      await page.evaluate(() => document.fonts?.ready);
      await page.addScriptTag({ content: BUNDLE });
      const report = await page.evaluate(
        ({ pitch }) => {
          const measured = window.quoin.verifyGrid({ pitch, origin: "auto" });
          return {
            onGrid: measured.report.onGrid,
            total: measured.report.total,
            worst: measured.results
              .filter((r) => !r.onGrid)
              .slice(0, 3)
              .map((r) => `${r.path} ${Math.round(r.drift * 100) / 100}px`),
          };
        },
        { pitch: PITCH }
      );
      await page.close();

      readings.push(`${width}px ${report.onGrid}/${report.total}`);
      expect(
        report.onGrid,
        `${edge} at ${width}px: ${report.onGrid}/${report.total}, worst ${JSON.stringify(report.worst)}`
      ).toBe(report.total);
      expect(report.total, "the page rendered").toBeGreaterThan(available.length * 2);
    }

    console.log(
      `\n  ${browserName}, ${available.length} scripts, ${edge}: ${readings.join("  ")}\n`
    );
  });
}

test("the emitted CSS carries whichever edge was used", async ({ page, browserName }) => {
  /* Every figure in a fit is the box that edge produces, so a stylesheet that
     said `cap alphabetic` while the numbers came from the ideographic em would
     be wrong for a whole script and look finished. */
  await page.goto("/prose.html");
  await page.addScriptTag({ content: FIT_BUNDLE });

  const emitted = await page.evaluate(() => {
    const api = (window as unknown as {
      quoinFit: {
        fitScale: (f: unknown, o: unknown) => { unavailable: boolean };
        fittedScaleToCss: (f: unknown) => string;
      };
    }).quoinFit;
    const fitted = api.fitScale(
      [{ role: "body", font: "serif", steps: [{ name: "p", size: 17, ratio: 1.5 }] }],
      { pitch: 8, edge: "ex alphabetic" }
    );
    return { css: api.fittedScaleToCss(fitted), unavailable: fitted.unavailable };
  });

  if (emitted.unavailable) {
    test.skip(true, `${browserName} could not measure that edge`);
    return;
  }

  expect(emitted.css).toContain("text-box-edge: ex alphabetic");
  expect(emitted.css, "and says the default was not used").toMatch(/not the default cap/);
});
