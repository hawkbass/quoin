/* No NUL bytes in a text file.

   One got into a template literal during an automated edit, turning the key
   `${selector} ${property}` into `${selector}\0${property}`. The lookup built
   the version with a space, so nothing ever matched, no rule was escalated, and
   the function still reported nine escalations because it counted what it
   intended rather than what it did.

   Nothing failed. Git called the file binary, which is the only reason it was
   noticed at all. */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const FILES = globSync(["src/**/*.ts", "test/**/*.ts", "scripts/**/*.mjs", "*.md", "*.json"]);

let bad = 0;
for (const file of FILES.sort()) {
  const bytes = readFileSync(file);
  const at = bytes.indexOf(0);
  if (at === -1) continue;
  bad++;
  const around = bytes.subarray(Math.max(0, at - 60), at + 60).toString("utf8");
  console.error(`${file}: NUL byte at offset ${at}\n    ...${around.replace(/\0/g, "\0")}...`);
}

if (bad) {
  console.error(`\n${bad} ${bad === 1 ? "file" : "files"} with NUL bytes.\n`);
  process.exit(1);
}
console.log(`  encoding: ${FILES.length} files clean`);
