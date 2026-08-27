/* Assemble the browser extension.

   The content script is the library bundle with the bridge appended, so the
   extension can never be running a different version of Quoin from the one the
   package ships. There is no second copy to drift. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const SRC = "extension";

/*
   A second build for the test suite, and the only difference is one permission.

   The shipped extension asks for `activeTab`, which grants access to a single
   tab and only after the user clicks the icon. That is the right ask for a
   measuring tool and it makes the extension untestable from outside: the grant
   comes from a toolbar click, and nothing can click a browser toolbar.

   So the test build adds a host permission for the local fixture server, and
   nothing else. Every line of logic is the same file; only the door differs.
*/
const TEST_BUILD = process.argv.includes("--test");
const OUT = TEST_BUILD ? "dist-extension-test" : "dist-extension";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

if (!existsSync("dist/quoin.global.js")) {
  console.error("  FAIL: dist/quoin.global.js is missing. Run `npm run build` first.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "icons"), { recursive: true });

/* ------------------------------------------------------------------ *
   The content script
 * ------------------------------------------------------------------ */

const bundle = readFileSync("dist/quoin.global.js", "utf8");
const bridge = readFileSync(join(SRC, "bridge.js"), "utf8");

writeFileSync(
  join(OUT, "quoin.content.js"),
  `/* quoin ${version} browser extension content script. MIT. */\n${bundle}\n${bridge}`
);

/* ------------------------------------------------------------------ *
   Everything else
 * ------------------------------------------------------------------ */

for (const file of ["popup.html", "popup.css", "popup.js"]) {
  cpSync(join(SRC, file), join(OUT, file));
}

/*
   One version number, taken from package.json. A manifest that says 1.1.0
   while the library inside it says 1.0.0 is a bug report nobody can reproduce.
*/
const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
manifest.version = version;
if (TEST_BUILD) {
  manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
  manifest.name = "Quoin (test build)";
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

/* ------------------------------------------------------------------ *
   Icons
 * ------------------------------------------------------------------ */

const require = createRequire(import.meta.url);
let rendered = 0;
try {
  require.resolve("playwright");
  execFileSync(process.execPath, ["scripts/build-icons.mjs"], { stdio: "inherit" });
  rendered = 4;
} catch {
  console.log("  icons: playwright not available, keeping whatever is in extension/icons");
}

for (const size of [16, 32, 48, 128]) {
  const from = join(SRC, "icons", `icon-${size}.png`);
  if (existsSync(from)) cpSync(from, join(OUT, "icons", `icon-${size}.png`));
  else console.error(`  WARNING: icons/icon-${size}.png is missing`);
}

/* ------------------------------------------------------------------ *
   Report, and refuse to ship something that will not load
 * ------------------------------------------------------------------ */

const kb = (file) => (statSync(file).size / 1024).toFixed(1);

console.log("");
for (const file of ["manifest.json", "popup.html", "popup.css", "popup.js", "quoin.content.js"]) {
  console.log(`  ${("dist-extension/" + file).padEnd(38)}${kb(join(OUT, file))} kB`);
}

/*
   Manifest V3 forbids remote code. A stylesheet or script pulled off a CDN
   fails review and, worse, fails silently on a slow connection.

   Only `<script src>`, `<link href>` and `<img src>` count. The first version
   of this matched any attribute and failed the build on the ordinary anchor to
   the repository in the footer, which is a link a person clicks rather than a
   resource the page loads.
*/
const html = readFileSync(join(OUT, "popup.html"), "utf8");
const remote = [
  ...html.matchAll(/<(?:script|img)\b[^>]*\bsrc="(?:https?:)?\/\/[^"]+"/gi),
  ...html.matchAll(/<link\b[^>]*\bhref="(?:https?:)?\/\/[^"]+"/gi),
].map((m) => m[0].slice(0, 90));
if (remote.length) {
  console.error(`\n  FAIL: popup.html loads ${remote.length} remote resource(s):`);
  for (const r of remote) console.error(`    ${r}`);
  console.error("  Manifest V3 forbids remote code, and a remote font is a request per open.");
  process.exit(1);
}

const missingIcons = [16, 32, 48, 128].filter(
  (s) => !existsSync(join(OUT, "icons", `icon-${s}.png`))
);
if (missingIcons.length) {
  console.error(`\n  FAIL: missing icons: ${missingIcons.join(", ")}`);
  process.exit(1);
}

console.log(
  `\n  quoin ${version}, no remote resources, ${rendered ? "icons rendered" : "icons reused"}` +
  `\n  Load unpacked from ./${OUT}\n`
);
