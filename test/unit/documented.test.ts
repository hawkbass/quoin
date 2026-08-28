/* The README describes an API. This checks the API is the one it describes.

   Written because it was not. The API table listed `makeBaseline` and
   `compareToBaseline` for a release in which neither was exported: they existed,
   they were tested, and `import { makeBaseline } from "quoin"` was a
   `TypeError`. Nothing in the build, the type check or three hundred tests had
   any opinion about it, because every one of them imports from `src/` by path
   and none of them imports the package the way a reader would.

   This is the second time documentation has run ahead of the code here. The
   first was a README paragraph describing unit tests that did not exist for
   four months. Both are the same failure and it is a particular one: prose is
   not checked by anything, so the only defence is to check it on purpose. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as quoin from "../../src/index.ts";
import * as page from "../../src/page.ts";

/** Every `| \`name(...)\` |` in the README's API table. */
function documentedFunctions(): string[] {
  const readme = readFileSync("README.md", "utf8");
  const names = new Set<string>();
  for (const line of readme.split("\n")) {
    const match = /^\|\s*`([a-zA-Z][a-zA-Z0-9]*)\(/.exec(line);
    if (match) names.add(match[1]!);
  }
  return [...names];
}

test("the API table is not aspirational", () => {
  const documented = documentedFunctions();

  /* If the table stops being found, this test starts passing vacuously, which
     is the failure mode of every test that reads its own input. */
  assert.ok(
    documented.length > 20,
    `only found ${documented.length} documented functions; has the API table moved?`
  );

  const missing = documented.filter(
    (name) => typeof (quoin as Record<string, unknown>)[name] !== "function"
  );

  assert.deepEqual(
    missing,
    [],
    `the README documents ${missing.join(", ")}, which the package does not export`
  );
});

test("the CLI's commands are the ones the README lists", () => {
  const readme = readFileSync("README.md", "utf8");
  const usage = readFileSync("src/cli.ts", "utf8");

  /* Every `npx quoin <command>` in the README has to be a command the CLI
     actually dispatches, or the first thing somebody copies does nothing. */
  const invoked = new Set<string>();
  for (const match of readme.matchAll(/npx quoin ([a-z]+)/g)) invoked.add(match[1]!);
  assert.ok(invoked.size >= 4, `only found ${invoked.size} commands in the README`);

  for (const command of invoked) {
    assert.ok(
      usage.includes(`case "${command}":`),
      `the README tells people to run \`npx quoin ${command}\`, which the CLI does not handle`
    );
  }
});

test("every command the CLI handles is documented", () => {
  /* The other direction. An undocumented command is not a defect in the same
     way, but it is a command nobody will find. */
  const usage = readFileSync("src/cli.ts", "utf8");
  const readme = readFileSync("README.md", "utf8");

  const handled = [...usage.matchAll(/^\s+case "([a-z]+)": \{/gm)].map((m) => m[1]!);
  assert.ok(handled.length >= 4, `only found ${handled.length} commands in the CLI`);

  for (const command of handled) {
    assert.ok(
      readme.includes(`quoin ${command}`),
      `the CLI handles \`${command}\` and the README never mentions it`
    );
  }
});

test("the page bundle carries no Node-side surface", () => {
  /*
     `src/page.ts` is what gets pasted into a console, and the size budget is
     the only thing standing between that and everything else in the package.
     The baseline comparison reads a committed file to decide whether a pull
     request should fail, which no page can do and no page should carry.
  */
  const inPage = Object.keys(page);
  for (const nodeOnly of ["makeBaseline", "compareToBaseline", "comparisonToMarkdown"]) {
    assert.ok(
      !inPage.includes(nodeOnly),
      `${nodeOnly} is in the page bundle, where it is dead weight`
    );
  }

  /* And the package entry has to be a superset, or the split has broken the
     public API rather than organised it. */
  for (const name of inPage) {
    assert.ok(
      name in quoin,
      `${name} is in page.ts and not re-exported from index.ts`
    );
  }
});

test("the inputs the action documents are the inputs it reads", () => {
  /*
     action.yml declares inputs and maps each to an environment variable;
     action/run.mjs reads those variables. A name that appears on one side only
     is silently ignored at runtime, which is the worst way for a CI gate to be
     misconfigured: the workflow looks right and the setting does nothing.
  */
  const yml = readFileSync("action.yml", "utf8");
  const script = readFileSync("action/run.mjs", "utf8");

  const mapped = [...yml.matchAll(/^\s+(QUOIN_[A-Z_]+):/gm)].map((m) => m[1]!);
  assert.ok(mapped.length >= 8, `only found ${mapped.length} mapped inputs`);

  for (const variable of mapped) {
    assert.ok(
      script.includes(`"${variable}"`),
      `action.yml maps ${variable} and run.mjs never reads it`
    );
  }

  const read = [...script.matchAll(/input\("(QUOIN_[A-Z_]+)"|flag\("(QUOIN_[A-Z_]+)"/g)]
    .map((m) => m[1] ?? m[2]!)
    .filter(Boolean);

  for (const variable of new Set(read)) {
    assert.ok(
      mapped.includes(variable),
      `run.mjs reads ${variable} and action.yml never sets it, so it is always empty`
    );
  }
});

test("the version in the changelog is the version being shipped", () => {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;

  const first = /^## (\d+\.\d+\.\d+)/m.exec(changelog);
  assert.ok(first, "the changelog has no version heading");
  assert.equal(
    first![1],
    version,
    `package.json is ${version} and the changelog's newest entry is ${first![1]}`
  );
});

test("every flag the CLI accepts is mentioned in the README", () => {
  /* Added after `--columns` went in. The commands were checked both ways and
     the flags were not, so a flag could be shipped, work, and be findable only
     by reading the source. That is the same defect as an undocumented command
     and it was invisible to this file until now.

     The README is prose rather than a table, so this asks only that the flag
     appears somewhere in it: enough to catch one that was never written up,
     without dictating where it gets explained. */
  const usage = readFileSync("src/cli.ts", "utf8");
  const readme = readFileSync("README.md", "utf8");

  const flags = [...new Set([...usage.matchAll(/case "(--[a-z-]+)":/g)].map((m) => m[1]!))];
  assert.ok(flags.length >= 15, `only found ${flags.length} flags in the CLI`);

  /* `--help` is answered by the CLI itself and needs no prose. */
  const undocumented = flags.filter(
    (flag) => flag !== "--help" && !readme.includes(flag)
  );
  assert.deepEqual(
    undocumented,
    [],
    `the CLI accepts ${undocumented.join(", ")} and the README never mentions ${
      undocumented.length === 1 ? "it" : "them"
    }`
  );
});

test("the flags the README tells people to use are flags the CLI has", () => {
  /* The other direction, and the one that actually misleads somebody: a flag in
     the README that the CLI does not handle is a command line that fails. */
  const usage = readFileSync("src/cli.ts", "utf8");
  const readme = readFileSync("README.md", "utf8");

  /* Only flags inside a shell block, so prose mentioning a CSS property or a
     hyphenated phrase is not mistaken for one. */
  const shell = [...readme.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!).join("\n");
  const used = [...new Set(
    [...shell.matchAll(/(?:^|\s)(--[a-z-]+)/g)].map((m) => m[1]!)
  )];
  assert.ok(used.length >= 5, `only found ${used.length} flags in the README's examples`);

  for (const flag of used) {
    assert.ok(
      usage.includes(`case "${flag}":`),
      `the README shows \`${flag}\`, which the CLI does not handle`
    );
  }
});
