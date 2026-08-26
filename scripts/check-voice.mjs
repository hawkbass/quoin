/* Gate the two things that make prose read as machine-written.

   Not a style opinion dressed as a rule. Em-dashes and en-dashes are the single
   most reliable tell, and a repository whose whole argument is "measure it
   rather than assert it" cannot ship a README that reads as generated. */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

/* Built from character codes rather than written literally, so this file does
   not fail its own check. It did, on the first run, which is the correct
   behaviour from the checker and an awkward one from the check. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2014, 0x2013, 0x2015)}]`, "g");

const PATTERNS = [
  {
    name: "em-dash, en-dash or horizontal bar",
    test: DASHES,
    why: "use a comma, a colon or a full stop",
  },
  {
    name: "double space after a full stop",
    test: /(?<=\.) {2,}(?=[A-Z])/g,
    why: "one space",
  },
];

const FILES = globSync([
  "src/**/*.ts",
  "scripts/**/*.mjs",
  "test/**/*.ts",
  "test/browser/fixtures/*.html",
  "*.md",
  "docs/**/*.md",
]);

let failures = 0;

for (const file of FILES.sort()) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");

  for (const pattern of PATTERNS) {
    lines.forEach((line, index) => {
      pattern.test.lastIndex = 0;
      if (!pattern.test.test(line)) return;
      failures++;
      console.error(
        `${file}:${index + 1}  ${pattern.name}: ${pattern.why}\n    ${line.trim().slice(0, 100)}`
      );
    });
  }
}

if (failures) {
  console.error(`\n${failures} ${failures === 1 ? "line" : "lines"} to fix.\n`);
  process.exit(1);
}

console.log(`  voice: ${FILES.length} files clean`);
