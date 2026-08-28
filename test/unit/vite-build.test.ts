/* The Vite plugin, built by Vite and measured in a browser.

   The PostCSS plugin was unit-tested against its own output for four releases
   and made real pages worse the whole time, because a test that asserts the
   output contains `text-box-trim` cannot tell you what the page did with it. The
   other plugins deserved the same look, and this is the Vite one getting it: a
   real project, `vite build`, served, opened, measured.

   Two things are under test and only the first had ever been exercised. The
   plugin runs the PostCSS plugin over the project's CSS. And it serves the
   fitted tokens as a module you can import, which is what a design system that
   keeps its scale in JSON actually needs.

   Skipped where Vite or Playwright is missing rather than failed, because this
   is a package with no dependencies and its tests should not invent one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { extname } from "node:path";

const ROOT = join("test", ".vite-app");
const FONT = join("test", "browser", "fixtures", "fonts", "EBGaramond.ttf");

async function available(): Promise<boolean> {
  if (!existsSync(FONT) || !existsSync(join("dist", "vite.js"))) return false;
  try {
    await import("vite");
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

const have = await available();

/** A minimal project that imports the tokens and uses them. */
function scaffold(withFontFace: boolean): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "public"), { recursive: true });
  cpSync(FONT, join(ROOT, "public", "EBGaramond.ttf"));

  writeFileSync(
    join(ROOT, "design.json"),
    JSON.stringify({
      families: [
        {
          role: "body",
          font: "EB Garamond",
          file: "../browser/fixtures/fonts/EBGaramond.ttf",
          steps: [
            { name: "body", size: 17, leading: 25.5, space: 24 },
            { name: "h2", size: 34, leading: 40, space: 48 },
          ],
        },
      ],
    })
  );

  const fontFace = withFontFace
    ? '@font-face { font-family: "EB Garamond"; src: url(/EBGaramond.ttf) format("truetype"); font-display: block }\n'
    : "";

  writeFileSync(
    join(ROOT, "style.css"),
    fontFace +
      `body { margin: 0; font-family: "EB Garamond", Georgia, serif }
       main { width: 640px; margin: 0 auto }
       p  { font-size: var(--size-body); line-height: var(--leading-body);
            margin-top: var(--space-body); margin-bottom: 0 }
       h2 { font-size: var(--size-h2); line-height: var(--leading-h2);
            margin-top: var(--space-h2); margin-bottom: 0 }
       p, h2 { text-box-trim: trim-both; text-box-edge: cap alphabetic }`
  );

  writeFileSync(join(ROOT, "main.js"), 'import "quoin/tokens.css";\nimport "./style.css";\n');

  writeFileSync(
    join(ROOT, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>
       <main>
         <h2>A heading in the fitted scale</h2>
         <p>A paragraph of body text that runs to several lines at this width so
            the leading has something to do and drift somewhere to show itself.</p>
         <p>A second paragraph, below the first, also several lines long.</p>
         <p>A third, for the same reason.</p>
       </main>
       <script type="module" src="/main.js"></script>
     </body></html>`
  );

  writeFileSync(
    join(ROOT, "vite.config.js"),
    `import quoin from "../../dist/vite.js";
     export default {
       plugins: [quoin({ pitch: 8, design: "./design.json" })],
       build: { outDir: "dist", emptyOutDir: true },
       logLevel: "silent",
     };`
  );
}

async function build(): Promise<string> {
  const { build: viteBuild } = await import("vite");
  await viteBuild({ root: ROOT, configFile: join(ROOT, "vite.config.js") });

  const assets = join(ROOT, "dist", "assets");
  const css = readdirSync(assets).filter((f) => f.endsWith(".css"));
  assert.equal(css.length, 1, `expected one stylesheet, got ${css.join(", ")}`);
  return readFileSync(join(assets, css[0]!), "utf8");
}

/** Serve the built output and report what is on the grid. */
async function measure(): Promise<{ onGrid: number; total: number; font: string }> {
  const { chromium } = await import("playwright");
  const dir = join(ROOT, "dist");
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".ttf": "font/ttf",
  };

  const server = createServer((request, response) => {
    const url = (request.url ?? "/").split("?")[0]!;
    const name = url === "/" ? "index.html" : url.replace(/^\//, "");
    try {
      const body = readFileSync(join(dir, name));
      response.writeHead(200, {
        "content-type": types[extname(name)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("no");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(600);
    await page.addScriptTag({ content: readFileSync("dist/quoin.global.js", "utf8") });
    return await page.evaluate(() => {
      const grid = (window as never as {
        quoin: { verifyGrid: (o: unknown) => { report: { onGrid: number; total: number } } };
      }).quoin.verifyGrid({ pitch: 8, origin: "auto" });
      return {
        onGrid: grid.report.onGrid,
        total: grid.report.total,
        font: [...(document as never as { fonts: Iterable<{ family: string; status: string }> }).fonts]
          .map((f) => `${f.family} ${f.status}`)
          .join(", "),
      };
    });
  } finally {
    await browser.close();
    server.close();
  }
}

test("a real Vite build serves the tokens and lands on the grid", { skip: !have }, async () => {
  scaffold(true);
  const css = await build();

  /* The tokens reached the bundle, fitted rather than as written. */
  assert.match(css, /--size-body:\s*17px/, "the tokens are not in the built CSS");
  assert.match(css, /--leading-body:\s*24px/, "25.5 should have snapped to 24");
  assert.match(css, /--space-body:\s*[\d.]+px/, "no space was emitted");

  const seen = await measure();
  assert.match(seen.font, /EB Garamond/, "the fitted face did not load");
  assert.ok(seen.total >= 4, `only ${seen.total} blocks were measured`);
  assert.equal(
    seen.onGrid,
    seen.total,
    `the built page reads ${seen.onGrid}/${seen.total} on the grid`
  );

  rmSync(ROOT, { recursive: true, force: true });
});

test("and it is a fit for the font it was given, which is worth knowing", {
  skip: !have,
}, async () => {
  /*
     Every space here closes a cap height, a cap height belongs to one font, and
     a page that falls back to another is a page fitted for a font nobody is
     looking at. The same project without its `@font-face` reads 2 of 5 where it
     read 5 of 5 with it.

     Not a defect and not fixable at build time: nothing there can know whether
     a font will load. It is a condition of the method, so it is measured, said
     in the emitted CSS, and pinned here rather than left for somebody to
     discover as a mystery.
  */
  scaffold(false);
  await build();

  const seen = await measure();
  assert.doesNotMatch(seen.font, /EB Garamond/, "the font loaded, so this proves nothing");
  assert.ok(
    seen.onGrid < seen.total,
    `a fallback face still read ${seen.onGrid}/${seen.total}, so the fit does not depend on the font after all`
  );

  rmSync(ROOT, { recursive: true, force: true });
});
