/* Build quoin.dev, and seat it with Quoin.

   The last step is the one that matters. The site is written on an 8px rhythm,
   which CSS can do, and rhythm is not phase. So the build serves the page,
   points the tool at it, and writes the phase corrections to `baseline.css`,
   which the page already links.

   That makes the claim in the footer true by construction rather than by
   assertion, and it means the site cannot quietly stop being on the grid: the
   build fails if seating it does not work. */

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { extname } from "node:path";

const SRC = "site";
const OUT = "site/dist";
const PORT = Number(process.env.SITE_PORT ?? 4180);

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

if (!existsSync("dist/quoin.global.js")) {
  console.error("  FAIL: dist/quoin.global.js is missing. Run `npm run build` first.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ *
   Copy, and drop the library in beside it
 * ------------------------------------------------------------------ */

for (const file of ["index.html", "demo.html", "style.css", "main.js"]) {
  cpSync(join(SRC, file), join(OUT, file));
}
cpSync("dist/quoin.global.js", join(OUT, "quoin.global.js"));

/* The specimen loads the same bundle, so the readout above it comes from the
   library rather than from a description of it. */
const demo = readFileSync(join(OUT, "demo.html"), "utf8").replace(
  "</head>",
  '<script src="/quoin.global.js"></script>\n</head>'
);
writeFileSync(join(OUT, "demo.html"), demo);

/* The wedge, as a favicon. */
writeFileSync(
  join(OUT, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#EFE9DC"/>
  <rect x="3" y="8" width="26" height="2" fill="#191512"/>
  <rect x="3" y="16" width="26" height="2" fill="#191512"/>
  <rect x="3" y="24" width="26" height="2" fill="#191512"/>
  <path d="M29 8 L29 26 L14 17 Z" fill="#7A4A20"/>
</svg>\n`
);

/* An empty one, so the first load of the page is not a 404 for a stylesheet
   that has not been generated yet. */
writeFileSync(
  join(OUT, "baseline.css"),
  "/* Written by the build, after seating the page. */\n"
);

writeFileSync(
  join(OUT, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://quoin.dev/sitemap.xml\n"
);
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://quoin.dev/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>\n`
);

/* ------------------------------------------------------------------ *
   Seat it
 * ------------------------------------------------------------------ */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const name = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = readFileSync(join(OUT, name));
    response.writeHead(200, {
      "content-type": TYPES[extname(name)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not here");
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.log("  playwright not installed, so the page ships rhythmic but unseated.");
  server.close();
  report();
  process.exit(0);
}

/* Display type opts out, and it is named here rather than hidden, because a
   score with a quiet exclusion list is a score with a thumb on it. */
const IGNORE = ["h1", ".standfirst", ".live", "pre", "pre *"];

/*
   Seated once per breakpoint, not once.

   The corrections are absolute pixel values computed for a particular layout,
   and a layout changes with the viewport: a definition list that sits on one
   line at 1280 wraps to two at 820, which makes the block taller and moves
   everything under it. Seating at one width and shipping it produced exactly
   that: 100% at 1280 and 1440, 79% at 820.

   So each range is measured at a representative width inside it and its
   corrections are wrapped in a media query for that range. The ranges are
   mutually exclusive, because these rules set absolute values and two sets
   applying at once is one set applying twice.
*/
const BREAKPOINTS = [
  { at: 380, query: "(max-width: 439px)" },
  { at: 500, query: "(min-width: 440px) and (max-width: 599px)" },
  { at: 660, query: "(min-width: 600px) and (max-width: 767px)" },
  { at: 860, query: "(min-width: 768px) and (max-width: 959px)" },
  { at: 1040, query: "(min-width: 960px) and (max-width: 1151px)" },
  { at: 1280, query: "(min-width: 1152px)" },
];

const browser = await playwright.chromium.launch();
const results = [];

try {
  for (const breakpoint of BREAKPOINTS) {
    const page = await browser.newPage({ viewport: { width: breakpoint.at, height: 900 } });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 45_000 });
    await page.evaluate(() => document.fonts?.ready);
    /* Garamond arrives over the network and changes every metric on the page.
       Measuring before it lands measures Georgia. */
    await page.waitForTimeout(1200);

    const measured = await page.evaluate((ignore) => {
      const options = { pitch: 8, tolerance: 0.5, ignore };
      const before = window.quoin.verifyGrid(options).report;
      const seated = window.quoin.seatPage({ ...options, mode: "full" });
      const after = window.quoin.verifyGrid(options).report;

      /* Verified, so what gets written is what survives the cascade on this
         page rather than what the seater hoped, and the check measures the
         grid rather than only the declarations. */
      const verified = window.quoin.exportCssVerified(seated);

      return {
        before: before.onGrid,
        after: after.onGrid,
        total: after.total,
        passes: seated.passes,
        missed: seated.missed,
        unexportable: seated.unexportable,
        escalated: verified.escalated,
        stillLost: verified.check.lost.length,
        withCss: verified.check.onGrid,
        withCssTotal: verified.check.total,
        seats: verified.check.seats,
        css: verified.css,
      };
    }, IGNORE);

    results.push({ ...breakpoint, ...measured });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

/* ------------------------------------------------------------------ *
   One stylesheet, four ranges
 * ------------------------------------------------------------------ */

function indent(css) {
  return css
    .split("\n")
    .map((line) => (line.trim() ? "  " + line : line))
    .join("\n");
}

const sheet = [
  `/* Generated by quoin ${version} at build time, against this page.`,
  ` *`,
  ` * The site is written on an 8px rhythm, which CSS can do. This file is the`,
  ` * phase, which it cannot: half-leading plus ascent, per font and size.`,
  ` *`,
  ` * Seated once per breakpoint. The corrections are absolute pixel values for`,
  ` * a particular layout, and the layout changes with the viewport.`,
  ` */`,
  "",
];

for (const r of results) {
  const share = ((r.withCss / r.withCssTotal) * 100).toFixed(0);
  sheet.push(
    `/* ${r.query}`,
    ` * measured at ${r.at}px: ${r.before}/${r.total} before, ${r.withCss}/${r.withCssTotal} with this block (${share}%)`,
    ` */`,
    `@media ${r.query} {`,
    indent(r.css),
    "}",
    ""
  );
}

writeFileSync(join(OUT, "baseline.css"), sheet.join("\n"));

const seatResult = results[results.length - 1];

/* ------------------------------------------------------------------ *
   Report, and refuse to ship a site that its own tool could not seat
 * ------------------------------------------------------------------ */

function report() {
  const kb = (f) => (statSync(join(OUT, f)).size / 1024).toFixed(1);
  console.log("");
  for (const file of ["index.html", "style.css", "main.js", "baseline.css", "quoin.global.js", "demo.html"]) {
    if (existsSync(join(OUT, file))) {
      console.log(`  site/dist/${file.padEnd(22)}${kb(file)} kB`);
    }
  }
}

report();

const RANGE_WIDTH =
  Math.max(...results.map((r) => `${r.at}px  ${r.query}`.length), "range".length) + 2;
console.log("");
console.log(
  "  " + "range".padEnd(RANGE_WIDTH) + "before   stylesheet   sweeps"
);
for (const r of results) {
  const before = ((r.before / r.total) * 100).toFixed(0) + "%";
  const withCss = ((r.withCss / r.withCssTotal) * 100).toFixed(0) + "%";
  const notes = [
    r.escalated ? `${r.escalated} escalated` : null,
    r.missed ? `${r.missed} missed` : null,
    r.unexportable ? `${r.unexportable} unexportable` : null,
    r.stillLost ? `${r.stillLost} still lost` : null,
  ].filter(Boolean).join(", ");
  /* Padded to the longest range actually printed, not to a number picked once
     and left behind. Two of the six media queries are longer than 44, so the
     percentage after them was printed with no gap: `(max-width: 599px)10%`. */
  console.log(
    "  " + `${r.at}px  ${r.query}`.padEnd(RANGE_WIDTH) +
    before.padEnd(9) + withCss.padEnd(13) + r.passes +
    (notes ? "   " + notes : "")
  );
}

/* The stylesheet's number at every breakpoint, not the script's. The script's
   is what the tool can do; the stylesheet's is what ships. */
const worst = results.reduce(
  (low, r) => Math.min(low, (r.withCss / r.withCssTotal) * 100),
  100
);

if (worst < 95) {
  const failing = results.filter((r) => (r.withCss / r.withCssTotal) * 100 < 95);
  console.error(
    `\n  FAIL: the stylesheet seats the site to ${worst.toFixed(0)}% at its worst breakpoint.\n` +
    failing.map((r) => `    ${r.at}px  ${((r.withCss / r.withCssTotal) * 100).toFixed(0)}%`).join("\n") +
    `\n  A page arguing for baseline grids does not get to ship off one.`
  );
  process.exit(1);
}

console.log(`\n  worst breakpoint seats to ${worst.toFixed(0)}%`);
console.log(`  quoin.dev ready in ./${OUT}\n`);
