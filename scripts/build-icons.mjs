/* Render the icon at four sizes.

   The mark is the thing the tool is named after: a wedge driven between ruled
   lines. It is drawn per size rather than scaled from one master, because a
   16px favicon that is a 128px drawing shrunk down is a grey smudge, and the
   rules have to land on whole pixels or the icon for a baseline grid tool is
   itself blurry. */

import pw from "playwright";
import { mkdirSync } from "node:fs";

const PAPER = "#EFE9DC";
const INK = "#191512";
const BRASS = "#7A4A20";

/* per size: [canvas, rule thickness, gap between rules, side padding] */
const SIZES = {
  16: { rule: 1, gap: 4, pad: 1 },
  32: { rule: 2, gap: 8, pad: 3 },
  48: { rule: 3, gap: 12, pad: 4 },
  128: { rule: 6, gap: 32, pad: 12 },
};

mkdirSync("extension/icons", { recursive: true });

const browser = await pw.chromium.launch();

for (const [size, spec] of Object.entries(SIZES)) {
  const n = Number(size);
  const { rule, gap, pad } = spec;

  /* Rules on whole pixels, centred as a block. */
  const lines = [];
  for (let y = gap; y + rule <= n - gap + rule; y += gap) {
    lines.push(y);
  }

  /* The wedge: a right triangle driven in from the right edge, in brass. */
  const wedgeTop = lines.length ? lines[0] : gap;
  const wedgeBottom = lines.length ? lines[lines.length - 1] + rule : n - gap;
  const wedgeX = n - pad;
  const wedgeBack = pad + (n - pad * 2) * 0.42;

  const page = await browser.newPage({
    viewport: { width: n, height: n },
    deviceScaleFactor: 1,
  });

  await page.setContent(`<!doctype html>
<style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block}
</style>
<svg width="${n}" height="${n}" viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
  <rect width="${n}" height="${n}" fill="${PAPER}"/>
  ${lines
    .map((y) => `<rect x="${pad}" y="${y}" width="${n - pad * 2}" height="${rule}" fill="${INK}"/>`)
    .join("\n  ")}
  <path d="M ${wedgeX} ${wedgeTop} L ${wedgeX} ${wedgeBottom} L ${wedgeBack} ${(wedgeTop + wedgeBottom) / 2} Z"
        fill="${BRASS}" shape-rendering="geometricPrecision"/>
</svg>`);

  await page.locator("svg").screenshot({
    path: `extension/icons/icon-${n}.png`,
    omitBackground: false,
  });
  await page.close();
  console.log(`  icons/icon-${n}.png  ${lines.length} rules, wedge at ${wedgeBack.toFixed(0)}`);
}

await browser.close();
