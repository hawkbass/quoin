/* Does reading the font file give the same answer as measuring the browser?

   `fitFromFiles` exists so that fitting a design does not need a browser, which
   is what makes it usable in a build step. The entire justification for that is
   one claim: the cap height in a font's OS/2 table is the cap height the engine
   uses for `text-box-edge: cap`.

   That claim was established for the metrics study, on the question of whether
   cap height travels between engines. This asks the narrower and more load-
   bearing question, which is whether the number in the file predicts the box the
   engine actually draws. If it does not, `fitFromFiles` produces a stylesheet
   that is confidently wrong, and confidently wrong is the worst thing a
   measuring tool can be.

   Run over every font in the local corpus, at several sizes, in every engine
   that supports the trim. */

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFontMetrics, capHeightAt, FontFileError } from "../../src/font-file.ts";

const FONTS = resolve("test/browser/fixtures/fonts");
const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");

/* The sizes a design actually uses, plus two awkward ones. Cap height is linear
   in the size, so a disagreement that only shows at 13.5 is a rounding bug
   rather than a parsing one. */
const SIZES = [13.5, 16, 17, 32, 44];

interface Candidate {
  file: string;
  family: string;
  declared: number;
  unitsPerEm: number;
}

function corpus(): Candidate[] {
  if (!existsSync(FONTS)) return [];
  const out: Candidate[] = [];

  for (const file of readdirSync(FONTS).filter((f) => /\.(ttf|otf|woff)$/i.test(f))) {
    let metrics;
    try {
      metrics = readFontMetrics(readFileSync(join(FONTS, file)));
    } catch (error) {
      /* A file this cannot read is a finding for the parser's own tests, not a
         reason to fail this one. */
      if (error instanceof FontFileError) continue;
      throw error;
    }
    if (metrics.capHeight === null) continue;
    /* Variable fonts move their metrics with their axes, and the file declares
       the default instance. Comparing that against a browser rendering some
       other instance is a test of the axes rather than of the parser. */
    if (metrics.variable) continue;

    out.push({
      file,
      family: file.replace(/\.(ttf|otf|woff)$/i, ""),
      declared: metrics.capHeight,
      unitsPerEm: metrics.unitsPerEm,
    });
  }

  return out;
}

test("the cap height in the file is the cap height the engine draws", async ({
  page,
  browserName,
}) => {
  const fonts = corpus();
  test.skip(fonts.length === 0, "no font corpus: run `npm run fonts`");

  await page.goto("/prose.html");
  await page.addScriptTag({ content: BUNDLE });

  const supported = await page.evaluate(() => CSS.supports("text-box-trim", "trim-both"));
  test.skip(!supported, `${browserName} has no text-box-trim`);

  /* Loaded as data URIs so the test does not depend on a server route, and with
     a name nothing else could resolve to, so a failure to load shows up as a
     missing measurement rather than as a fallback quietly measured instead. */
  const worst: { font: string; size: number; declared: number; drawn: number; off: number }[] = [];

  for (const font of fonts) {
    const bytes = readFileSync(join(FONTS, font.file));
    const base64 = bytes.toString("base64");
    const family = `QuoinProbe-${font.family.replace(/[^a-zA-Z0-9]/g, "")}`;

    const measured = await page.evaluate(
      async ({ family, base64, sizes, file }) => {
        const format = /\.otf$/i.test(file)
          ? "opentype"
          : /\.woff$/i.test(file)
            ? "woff"
            : "truetype";
        const face = new FontFace(
          family,
          `url(data:font/${format};base64,${base64}) format("${format}")`
        );
        try {
          await face.load();
        } catch {
          return null;
        }
        document.fonts.add(face);
        await document.fonts.ready;

        return sizes.map((size) => ({
          size,
          drawn: window.quoin.capHeightFromFontTable(`${size}px "${family}"`),
        }));
      },
      { family, base64, sizes: SIZES, file: font.file }
    );

    if (!measured) continue;

    for (const { size, drawn } of measured) {
      if (drawn === null) continue;
      const declared = capHeightAt(
        { capHeight: font.declared, unitsPerEm: font.unitsPerEm } as never,
        size
      )!;
      worst.push({
        font: font.family,
        size,
        declared: Math.round(declared * 1000) / 1000,
        drawn: Math.round(drawn * 1000) / 1000,
        off: Math.round(Math.abs(declared - drawn) * 1000) / 1000,
      });
    }
  }

  expect(worst.length, "something was measured").toBeGreaterThan(20);

  worst.sort((a, b) => b.off - a.off);
  const biggest = worst[0]!;

  console.log(
    `\n  ${browserName}: ${worst.length} measurements across ${fonts.length} fonts\n` +
      `  worst disagreement ${biggest.off}px on ${biggest.font} at ${biggest.size}px ` +
      `(file ${biggest.declared}, drawn ${biggest.drawn})\n`
  );

  /*
     A twentieth of a pixel. Tight enough that a parsing error cannot hide in it,
     loose enough to survive the engines rounding a subpixel differently. The
     study that justified reading files at all found a worst case of 0.022px, so
     anything approaching this bound is a regression rather than noise.
  */
  expect(
    biggest.off,
    `${biggest.font} at ${biggest.size}px: the file says ${biggest.declared} and the ` +
      `engine drew ${biggest.drawn}, so fitFromFiles would be wrong by ${biggest.off}px`
  ).toBeLessThan(0.05);
});

test("a fit from the file matches a fit from the browser", async ({ page, browserName }) => {
  /*
     The end-to-end version. Two routes to the same stylesheet: one measuring the
     font in the page, one reading its bytes in Node. They have to agree on every
     figure, or `fitFromFiles` is a different tool wearing the same name.
  */
  const fonts = corpus();
  test.skip(fonts.length === 0, "no font corpus: run `npm run fonts`");

  await page.goto("/prose.html");
  await page.addScriptTag({ content: readFileSync(resolve("dist/quoin.fit.js"), "utf8") });

  const supported = await page.evaluate(() =>
    CSS.supports("text-box-trim", "trim-both")
  );
  test.skip(!supported, `${browserName} has no text-box-trim`);

  const font = fonts[0]!;
  const bytes = readFileSync(join(FONTS, font.file));
  const family = `QuoinFit-${font.family.replace(/[^a-zA-Z0-9]/g, "")}`;

  const design = [
    {
      role: "body",
      font: `"${family}"`,
      steps: [
        { name: "body", size: 17, ratio: 1.5, space: 24 },
        { name: "h1", size: 44, leading: 48, space: 56 },
      ],
    },
  ];

  const inBrowser = await page.evaluate(
    async ({ family, base64, design, file }) => {
      const format = /\.otf$/i.test(file) ? "opentype" : /\.woff$/i.test(file) ? "woff" : "truetype";
      const face = new FontFace(
        family,
        `url(data:font/${format};base64,${base64}) format("${format}")`
      );
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;

      return (window as unknown as {
        quoinFit: { fitScale: (f: unknown, o: unknown) => unknown };
      }).quoinFit.fitScale(design, { pitch: 8 }) as {
        cost: number;
        families: { steps: { name: string; size: number; leading: number; space: number; cap: number }[] }[];
      };
    },
    { family, base64: bytes.toString("base64"), design, file: font.file }
  );

  const { fitFromFiles } = await import("../../src/fit-file.ts");
  const fromFile = fitFromFiles(design, [{ font: `"${family}"`, bytes }], { pitch: 8 });

  expect(fromFile.unavailable, "the file was readable").toBe(false);
  expect(fromFile.families[0]!.steps.length).toBe(inBrowser.families[0]!.steps.length);

  for (let i = 0; i < fromFile.families[0]!.steps.length; i++) {
    const file = fromFile.families[0]!.steps[i]!;
    const browser = inBrowser.families[0]!.steps[i]!;

    expect(file.size, `${file.name} size`).toBe(browser.size);
    expect(file.leading, `${file.name} leading`).toBe(browser.leading);
    expect(
      Math.abs(file.cap - browser.cap),
      `${file.name}: file read a cap of ${file.cap}, the browser measured ${browser.cap}`
    ).toBeLessThan(0.05);
    expect(
      Math.abs(file.space - browser.space),
      `${file.name}: file solved a space of ${file.space}, the browser solved ${browser.space}`
    ).toBeLessThan(0.05);
  }
});

test("cap height does not move with a variable font's axes", async ({ page, browserName }) => {
  /*
     `fitFromFiles` reads the OS/2 table, which describes the default instance.
     If an engine resolved cap height per instance, every fit for a variable font
     set at anything other than its default would be wrong, and most fonts
     shipped today are variable.

     Measured across six variable families at three weights and two optical
     sizes: the cap height does not move at all, in either engine.
     `text-box-edge: cap` uses the static `sCapHeight`.

     There is a second thing that follows and it is worth having. A bold heading
     and a regular paragraph at the same size share a phase, so a design can set
     weight freely without disturbing the fit.
  */
  const fonts = corpus();
  test.skip(fonts.length === 0, "no font corpus: run `npm run fonts`");

  await page.goto("/prose.html");
  await page.addScriptTag({ content: BUNDLE });

  const supported = await page.evaluate(() => CSS.supports("text-box-trim", "trim-both"));
  test.skip(!supported, `${browserName} has no text-box-trim`);

  /* Fonts the parser flagged as variable, which `corpus()` filters out, so they
     are re-read here rather than borrowed from it. */
  const variable = readdirSync(FONTS)
    .filter((f) => /\.(ttf|otf)$/i.test(f))
    .map((file) => {
      try {
        return { file, metrics: readFontMetrics(readFileSync(join(FONTS, file))) };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { file: string; metrics: ReturnType<typeof readFontMetrics> } =>
      Boolean(entry?.metrics.variable && entry.metrics.capHeight !== null)
    );

  test.skip(variable.length === 0, "no variable fonts in the corpus");

  for (const { file, metrics } of variable) {
    const bytes = readFileSync(join(FONTS, file));
    const family = `QuoinVar-${file.replace(/[^a-zA-Z0-9]/g, "")}`;

    const measured = await page.evaluate(
      async ({ family, base64 }) => {
        const face = new FontFace(
          family,
          `url(data:font/truetype;base64,${base64}) format("truetype")`
        );
        try {
          await face.load();
        } catch {
          return null;
        }
        document.fonts.add(face);
        await document.fonts.ready;

        const at = (variation: string) => {
          const el = document.createElement("div");
          el.style.cssText =
            `position:absolute;visibility:hidden;font-family:"${family}";` +
            "font-size:1000px;line-height:1000px;" +
            "text-box-trim:trim-both;text-box-edge:cap alphabetic;" +
            (variation ? `font-variation-settings:${variation};` : "");
          el.textContent = "H";
          document.body.appendChild(el);
          const height = el.getBoundingClientRect().height / 1000;
          el.remove();
          return height;
        };

        return {
          base: at(""),
          light: at('"wght" 300'),
          bold: at('"wght" 700'),
          small: at('"opsz" 8'),
          large: at('"opsz" 60'),
        };
      },
      { family, base64: bytes.toString("base64") }
    );

    if (!measured) continue;

    const declared = metrics.capHeight! / metrics.unitsPerEm;

    for (const [axis, value] of Object.entries(measured)) {
      expect(
        Math.abs(value - declared),
        `${file} at ${axis}: drew ${value.toFixed(4)} em against a declared ${declared.toFixed(4)}`
      ).toBeLessThan(0.001);
    }
  }
});
