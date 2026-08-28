/* Build the four things this ships as, and fail if the single-file build stops
   being single-file. */

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, statSync, readFileSync, existsSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

/* The single file is meant to be pasted into a console, injected into somebody
   else's page, or served off a CDN. All three stop being reasonable somewhere,
   and this is where.

   Raised from 16 to 20 when the walk learned to cross shadow boundaries, which
   cost 2.7 kB. Worth recording that it was raised rather than met: a budget
   quietly edited upward every time it fails is not a budget. That one bought
   the difference between measuring a page built out of web components and
   reporting it 100% correct because the text was somewhere the walk could not
   see.

   Raised again from 20 to 24 for the scale solver, which is 2.5 kB and is the
   only thing in here that prevents the problem rather than correcting it. It
   stays in the console bundle rather than moving to the CLI because the
   question it answers, what sizes would this font need, is one you ask while
   looking at a page.

   Raised a third time, from 24 to 28, for the cap basis and the candidate
   enumeration the fitter shares with it.

   Recorded as one raise rather than two because it happened in two goes in a
   single sitting, 24 to 26 and then 26 to 28, and splitting it in the log would
   make each look smaller than the change actually was. That is precisely the
   habit this comment exists to prevent, so it is written down the honest way.

   What it buys: the untrimmed basis rests on `fontBoundingBox`, which every
   engine rounds to whole pixels before handing it over, while the trimmed one
   rests on the cap height in the font file, which agreed across engines on 130
   fonts out of 130 with a worst case of 0.022px where the canvas measurement
   managed 90. It also moves the whole method off per-element corrections, which
   are bound to one layout, and onto a scale that holds at every width.

   What was kept out: the fitter itself, which solves several families onto one
   shared phase, is four kilobytes and lives in `dist/quoin.fit.js` instead. It
   is a build-time question that happens to need a browser for its metrics,
   rather than something anybody types into devtools, so it does not belong in
   the bundle whose whole constraint is being small enough to paste. */
const BUDGET_KB = 28;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const shared = {
  bundle: true,
  target: ["es2022", "chrome111", "firefox113", "safari15.4"],
  logLevel: "warning",
  metafile: true,
};

/* Library builds: readable, with source maps, so anyone who ends up stepping
   through a seating pass in devtools is stepping through the real thing. */
const esm = await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  format: "esm",
  outfile: "dist/quoin.js",
  sourcemap: true,
});

await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  format: "cjs",
  outfile: "dist/quoin.cjs",
  sourcemap: true,
});

/* The single file. Self-installs onto `window` and has to stay dependency-free
   and small enough to paste into a console.

   No `globalName`: the entry assigns `window.quoin` itself, and esbuild would
   overwrite that assignment with the bare module namespace afterwards, which
   is how `quoin.check()` quietly became undefined the first time. */
const global = await build({
  ...shared,
  entryPoints: ["src/global.ts"],
  format: "iife",
  outfile: "dist/quoin.global.js",
  /* Minified, unlike the library builds: this is the file you paste into a
     console or inject with `addScriptTag`, and nobody reads it. */
  minify: true,
  legalComments: "none",
  banner: {
    js: "/* quoin " + version + ": a baseline grid for the web. MIT. github.com/hawkbass/quoin */",
  },
});

/* The CLI runs in Node and drives a browser, so it is not bundled with the
   library and it does not bundle its own driver. */
/* The build-tool plugins.

   Node-side, so no bundling of the browser surface: a PostCSS plugin that
   dragged `verifyGrid` and a canvas probe into a build would be carrying a page
   it is never going to be on. They reach `font-file.ts` and the fitting
   arithmetic and nothing else.

   `postcss` and `vite` are peer dependencies and neither is imported: the
   plugins describe the shapes they need structurally, because a package whose
   argument is that it has no dependencies should not acquire one to read two
   properties off a node. */
for (const [entry, name] of [
  ["src/postcss.ts", "postcss"],
  ["src/vite.ts", "vite"],
]) {
  for (const [format, extension] of [["esm", "js"], ["cjs", "cjs"]]) {
    await build({
      entryPoints: [entry],
      format,
      platform: "node",
      target: "node20",
      outfile: `dist/${name}.${extension}`,
      bundle: true,
      packages: "external",
      logLevel: "warning",
    });
  }
}

/* The fitter, as its own single file.

   Not folded into the console bundle: that one has a size budget because it is
   pasted into devtools, and this is a build-time question that happens to need
   a browser for its font metrics. Different job, different artefact. */
await build({
  entryPoints: ["src/fit-global.ts"],
  format: "iife",
  outfile: "dist/quoin.fit.js",
  bundle: true,
  target: "es2020",
  logLevel: "warning",
});

/* The column check, for the same reason. */
await build({
  entryPoints: ["src/columns-global.ts"],
  format: "iife",
  outfile: "dist/quoin.columns.js",
  bundle: true,
  target: "es2020",
  logLevel: "warning",
});

await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  format: "esm",
  platform: "node",
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
  external: ["playwright", "playwright-core"],
});

/* The local compiler, invoked through node rather than through a shell: a
   shelled-out `npx` concatenates its arguments unescaped, which node 24 now
   warns about and which would break on any path containing a space. */
execFileSync(
  process.execPath,
  [createRequire(import.meta.url).resolve("typescript/lib/tsc.js"), "-p", "tsconfig.build.json"],
  { stdio: "inherit" }
);

/* The entry `package.json` promises. It has been missing before. */
if (!existsSync("dist/index.d.ts")) {
  console.error("  FAIL: dist/index.d.ts was not emitted, so the package ships no types.");
  process.exit(1);
}

const sizeKb = (file) => statSync(file).size / 1024;
const dependencies = Object.keys(global.metafile.inputs).filter((f) =>
  f.includes("node_modules")
);

console.log("");
for (const file of ["dist/quoin.js", "dist/quoin.cjs", "dist/quoin.global.js", "dist/cli.js"]) {
  console.log(`  ${file.padEnd(26)}${sizeKb(file).toFixed(1)} kB`);
}
console.log("");

if (dependencies.length) {
  console.error(`  FAIL: the single-file build pulled in ${dependencies.length} dependencies:`);
  for (const d of dependencies) console.error(`    ${d}`);
  process.exit(1);
}

const globalKb = sizeKb("dist/quoin.global.js");
if (globalKb > BUDGET_KB) {
  console.error(
    `  FAIL: dist/quoin.global.js is ${globalKb.toFixed(1)} kB, over the ${BUDGET_KB} kB budget.\n` +
      `  The budget exists because this file is meant to be pasted into a console.`
  );
  process.exit(1);
}

console.log(`  no dependencies, ${globalKb.toFixed(1)} kB of ${BUDGET_KB} kB budget used`);
console.log(`  ${Object.keys(esm.metafile.inputs).length} source files\n`);
