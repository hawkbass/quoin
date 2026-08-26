/* The round trip against live sites, with WILD=1 set. */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

const result = spawnSync(
  process.execPath,
  [cli, "test", "--project=chromium", "test/browser/wild.manual.spec.ts", "--reporter=list"],
  { stdio: "inherit", env: { ...process.env, WILD: "1" } }
);

process.exit(result.status ?? 1);
