/* Runs the corpus study with CORPUS=1 set, on whatever platform.

   A `cross-env` dependency for one environment variable is not worth it in a
   package whose whole argument is that it has none. */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

const result = spawnSync(
  process.execPath,
  [cli, "test", "--project=chromium", "test/browser/corpus.manual.spec.ts", "--reporter=list"],
  { stdio: "inherit", env: { ...process.env, CORPUS: "1" } }
);

process.exit(result.status ?? 1);
