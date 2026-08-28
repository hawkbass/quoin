/* Run the browser suite in the same Linux image CI uses.

   This exists because of a run of eight red builds in twelve. Every one of them
   was a difference between this machine and the runner, and every one was found
   after pushing: the generic `serif` is a different typeface on Linux, so a
   threshold tuned here fails there, and a test that waits on a panel rather than
   on a number is slower there and reads the previous value.

   Neither is a hard problem. Both are invisible without a Linux box, and the
   answer to "I cannot see it" is not to guess more carefully.

   Needs Docker running. It is not wired into `test:all`, because a gate that
   depends on a daemon somebody may not have started is a gate that fails for
   reasons unrelated to the code. Run it before pushing anything that touches a
   measurement. */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { devDependencies } = JSON.parse(readFileSync("package.json", "utf8"));
/* The image has to match the Playwright the project installs, or the browsers
   in it are not the browsers the tests were written against. */
const version = (devDependencies["@playwright/test"] ?? "").replace(/^[^\d]*/, "");
if (!version) {
  console.error("could not read the Playwright version from package.json");
  process.exit(1);
}

const image = `mcr.microsoft.com/playwright:v${version}-noble`;

const ping = spawnSync("docker", ["info", "--format", "{{.OSType}}"], {
  encoding: "utf8",
});
if (ping.status !== 0) {
  console.error(
    "\n  Docker is not running, so the Linux suite cannot be run here.\n" +
      "  Start Docker Desktop and try again. Everything else still works;\n" +
      "  this is the check that would have caught eight red builds.\n"
  );
  process.exit(1);
}

const args = process.argv.slice(2);

console.log(`\n  Running the browser suite in ${image}\n`);

/* The working directory is mounted rather than copied, so this tests the files
   as they are rather than as they were last committed. `--ipc=host` is what the
   Playwright image documents for Chromium, which otherwise runs out of shared
   memory and dies in ways that look like flakes. */
const result = spawnSync(
  "docker",
  [
    "run", "--rm", "--ipc=host",
    "-v", `${process.cwd()}:/work`,
    "-w", "/work",
    "-e", "CI=1",
    image,
    "bash", "-lc",
    [
      "npm ci --no-audit --no-fund",
      "npm run build",
      "npm run build:extension:test",
      `npx playwright test --grep-invert "@network" ${args.join(" ")}`,
    ].join(" && "),
  ],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
