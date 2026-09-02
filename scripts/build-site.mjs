/* Build the site, and seat it with Quoin.

   The last step is the one that matters. The site is written on an 8px rhythm,
   which CSS can do, and rhythm is not phase. So the build serves the page,
   points the tool at it, and writes the phase corrections to `baseline.css`,
   which the page already links.

   That makes the claim in the footer true by construction rather than by
   assertion, and it means the site cannot quietly stop being on the grid: the
   build fails if seating it does not work. */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  cpSync,
  existsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { extname } from "node:path";

/*
   Where the site is served from, in one place.

   It used to be quoin.dev in five of them: the canonical tag, og:url,
   og:image, robots.txt and the sitemap. quoin.dev is the login page of Quoin
   Systems Limited, an unrelated company, so all five pointed search engines and
   social cards at somebody else. The canonical was the worst of them: it told
   Google their page was the authoritative version of this one.

   One constant now, and the build writes it into the HTML, so the copies
   cannot drift apart the way they had.
*/
const SITE_URL = process.env.SITE_URL ?? "https://quoin.craighawkes.dev";
const SITE_HOST = new URL(SITE_URL).host;

const SRC = "site";
const OUT = "site/dist";
const PORT = Number(process.env.SITE_PORT ?? 4180);

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

if (!existsSync("dist/quoin.global.js")) {
  console.error("  FAIL: dist/quoin.global.js is missing. Run `npm run build` first.");
  process.exit(1);
}

/* Empty the directory, but leave `.git` where it is.

   `site/dist` is a checkout of the repo GitHub Pages serves. Removing the whole
   directory takes its `.git` with it, and the next `git` command run in there
   walks up and finds this repo instead, so a commit meant for the site lands on
   the library under the site's message. It has happened. Empty the contents and
   keep the checkout. */
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(OUT)) {
  if (entry === ".git") continue;
  rmSync(join(OUT, entry), { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
   Copy, and drop the library in beside it
 * ------------------------------------------------------------------ */

for (const file of ["index.html", "demo.html", "style.css", "main.js"]) {
  cpSync(join(SRC, file), join(OUT, file));
}
cpSync("dist/quoin.global.js", join(OUT, "quoin.global.js"));

/*
   The absolute URLs in the head, written from SITE_URL rather than typed.

   og:image is dropped rather than rewritten. It pointed at /og.png, which has
   never existed in this build, so it was a 404 on a domain that is not ours. A
   card with no image is worse than one with an image and better than one that
   claims an image and fails to load it.
*/
{
  const page = join(OUT, "index.html");
  const before = readFileSync(page, "utf8");
  const after = before
    .replace(/<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${SITE_URL}/">`)
    .replace(/<meta property="og:url" content="[^"]*">/,
      `<meta property="og:url" content="${SITE_URL}/">`)
    .replace(/\s*<meta property="og:image" content="[^"]*">/, "");

  if (after.includes("quoin.dev")) {
    console.error(
      "\n  FAIL: the built page still refers to quoin.dev, which belongs to" +
        "\n  Quoin Systems Limited. Every reference has to be built from SITE_URL."
    );
    process.exit(1);
  }
  writeFileSync(page, after);
}

/* GitHub Pages reads the host to serve from this file, and Jekyll would eat
   nothing here, but .nojekyll costs nothing and removes a whole class of
   surprise. */
writeFileSync(join(OUT, "CNAME"), SITE_HOST + "\n");
writeFileSync(join(OUT, ".nojekyll"), "");

/* The specimen loads the same bundle, so the readout above it comes from the
   library rather than from a description of it. */
const demo = readFileSync(join(OUT, "demo.html"), "utf8").replace(
  "</head>",
  '<script src="/quoin.global.js"></script>\n</head>'
);
writeFileSync(join(OUT, "demo.html"), demo);

/* The colour bar, as a favicon: the four inks at the head of the sheet, full
   bleed. The old wedge came from the palette the site had before the forme,
   and a favicon in colours the page no longer uses reads as a leftover. */
writeFileSync(
  join(OUT, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="0" y="0" width="8" height="32" fill="#00A6E0"/>
  <rect x="8" y="0" width="8" height="32" fill="#E5007D"/>
  <rect x="16" y="0" width="8" height="32" fill="#FFE400"/>
  <rect x="24" y="0" width="8" height="32" fill="#0F0F0E"/>
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
  `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
);
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
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

   The range edges are the stylesheet's own breakpoints, and that is not a
   convention, it is the whole correctness condition. A correction is measured
   at one width and applied across a range; if the layout changes inside that
   range, half the range is wearing the other half's numbers. These ranges used
   to divide at 440/600/768/960/1152 while the page divided at 641 and 1081,
   and the gate reported 100% at every width it sampled while 620px sat at 12%
   and 1100px at 16% — both of them inside a range, neither of them sampled.
   `assertRangesCoverBreakpoints` below now refuses to build that.
*/
const BREAKPOINTS = [
  { at: 380, query: "(max-width: 439px)" },
  { at: 540, query: "(min-width: 440px) and (max-width: 640px)" },
  { at: 760, query: "(min-width: 641px) and (max-width: 880px)" },
  { at: 980, query: "(min-width: 881px) and (max-width: 1080px)" },
  { at: 1180, query: "(min-width: 1081px) and (max-width: 1279px)" },
  { at: 1400, query: "(min-width: 1280px)" },
];

/*
   Refuse to seat a range the page changes shape inside.

   Reads the breakpoints out of the site's own stylesheet and checks that none
   of them falls strictly inside a seating range. It is a structural check, not
   a sampled one, which is the point: sampling is exactly what missed this.
*/
function assertRangesCoverBreakpoints() {
  const css = readFileSync(join(SRC, "style.css"), "utf8");

  /* A `max-width: N` divides the page between N and N+1; a `min-width: N`
     divides it between N-1 and N. Either way the boundary sits after `edge`. */
  const edges = new Set();
  for (const [, value] of css.matchAll(/\(\s*max-width:\s*(\d+)px\s*\)/g)) {
    edges.add(Number(value));
  }
  for (const [, value] of css.matchAll(/\(\s*min-width:\s*(\d+)px\s*\)/g)) {
    edges.add(Number(value) - 1);
  }

  const ranges = BREAKPOINTS.map(({ query, at }) => ({
    at,
    query,
    from: Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0),
    to: Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? Infinity),
  }));

  const straddled = [];
  for (const edge of [...edges].sort((a, b) => a - b)) {
    for (const range of ranges) {
      if (edge >= range.from && edge < range.to) {
        straddled.push({ edge, range });
      }
    }
  }

  if (straddled.length > 0) {
    console.error(
      "\n  FAIL: the page changes layout inside a seating range, so the" +
        "\n  corrections measured at one width would be applied at another.\n"
    );
    for (const { edge, range } of straddled) {
      console.error(
        `    style.css changes at ${edge}/${edge + 1}px, inside ${range.query}` +
          ` (measured at ${range.at}px)`
      );
    }
    console.error(
      "\n  Either move the stylesheet breakpoint onto a range edge, or move the" +
        "\n  range edge onto the breakpoint. They have to be the same number.\n"
    );
    process.exit(1);
  }
}

assertRangesCoverBreakpoints();

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
console.log(`  ${SITE_HOST} ready in ./${OUT}\n`);
