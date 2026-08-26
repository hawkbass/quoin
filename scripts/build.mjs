/* Build the four things this ships as, and fail if the single-file build stops
   being single-file. */

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, statSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

/* The single file is meant to be pasted into a console, injected into somebody
   else's page, or served off a CDN. All three stop being reasonable somewhere,
   and this is where. */
const BUDGET_KB = 16;

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
  [createRequire(import.meta.url).resolve("typescript/lib/tsc.js"), "--emitDeclarationOnly", "--outDir", "dist"],
  { stdio: "inherit" }
);

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
