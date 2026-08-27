/* Catches the workflow mistakes that only show up as a failed CI run.

   This exists because of one commit. A step was written as

     run: printf '\nsection { border-top: 3px solid red; }\n' >> style.css

   which is a YAML plain scalar containing `: `, and a colon followed by a space
   is how YAML separates a key from a value. GitHub rejected the whole file, the
   run failed before any job started, and the only diagnostic was "this run
   likely failed because of a workflow file issue".

   A YAML parser would catch it. This repository has no dependencies and is not
   adding one to lint four files, so instead it enforces the rule that makes the
   hazard unreachable: a `run:` is always a block scalar. `run: |` cannot be
   broken by anything inside it, which is why it is the form worth requiring
   rather than merely the form that happens to work here. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = ".github/workflows";
if (!existsSync(DIR)) {
  console.log("\n  workflows: none\n");
  process.exit(0);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
const problems = [];

for (const file of files) {
  const path = join(DIR, file);
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    const at = `${path}:${index + 1}`;

    /* Tabs are not valid YAML indentation anywhere, and they are invisible. */
    if (/^\s*\t/.test(line)) {
      problems.push(`${at}  a tab in the indentation: YAML does not allow it`);
    }

    const run = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
    if (run) {
      const value = run[2].trim();
      const block = /^[|>][-+]?\d*$/.test(value);
      const quoted = /^".*"$/.test(value) || /^'.*'$/.test(value);

      /*
         Only the characters that actually break a plain scalar, not the form
         itself. `run: npm ci` is fine and always was, and a check that fires on
         twenty correct lines to catch one wrong one is a check somebody deletes
         in a week.

         A plain scalar ends at a colon followed by a space, because that is how
         YAML separates a key from a value. It also ends at a space followed by
         a hash, which starts a comment. And it cannot begin with an indicator
         character, because those introduce other node types.
      */
      if (value !== "" && !block && !quoted) {
        const hazard =
          value.includes(": ") ? "a colon followed by a space, which YAML reads as a key"
          : / #/.test(value) ? "a space followed by a hash, which YAML reads as a comment"
          : value.endsWith(":") ? "a trailing colon, which YAML reads as a key"
          : /^[[\]{}>|*&!%@`]/.test(value) ? `a leading \`${value[0]}\`, which YAML reads as an indicator`
          : null;

        if (hazard) {
          problems.push(
            `${at}  \`run:\` on one line containing ${hazard}. ` +
              `Use \`run: |\` and put the command on the line below.`
          );
        }
      }
    }

    /* `uses:` pinned to a branch is a supply chain question rather than a
       syntax one, but it is the other thing that goes wrong quietly. */
    const uses = /^\s*-?\s*uses:\s*(\S+)\s*$/.exec(line);
    if (uses && !uses[1].startsWith("./") && !uses[1].includes("@")) {
      problems.push(`${at}  \`uses:\` with no version: pin it to a tag or a sha`);
    }
  });
}

if (problems.length) {
  console.log("");
  for (const problem of problems) console.log(problem);
  console.log(`\n  ${problems.length} to fix.\n`);
  process.exit(1);
}

console.log(`\n  workflows: ${files.length} file${files.length === 1 ? "" : "s"} clean\n`);
