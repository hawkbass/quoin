/* The version is in two files. This is the thing that stops them drifting.

   It used to be in three, with a line in CONTRIBUTING.md asking a human to
   remember all of them, which is a defect with a note attached rather than a
   process. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { VERSION } from "../../src/version.ts";

test("the shipped version matches package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(
    VERSION,
    pkg.version,
    `src/version.ts says ${VERSION}, package.json says ${pkg.version}`
  );
});

test("the version is a plain semver triple", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});
