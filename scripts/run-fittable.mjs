/* Runs the fitting study with CORPUS=1 set, on whatever platform.

   Same shape as run-corpus.mjs, and separate from it because they answer
   different questions: that one asks where the corpus is, this one asks what it
   would cost to move. */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

const result = spawnSync(
  process.execPath,
  [cli, "test", "--project=chromium", "test/browser/fittable.manual.spec.ts", "--reporter=list"],
  { stdio: "inherit", env: { ...process.env, CORPUS: "1" } }
);

process.exit(result.status ?? 1);
