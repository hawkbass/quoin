import { defineConfig, devices } from "@playwright/test";

/* Fixtures are served over http rather than opened as files: `file://` gives
   different origin rules in each engine, and a cross-engine study whose
   variable is the origin policy is not a cross-engine study. */
/* One source of truth for the port.

   The config used to hardcode 4173 while `serve-fixtures.mjs` honoured
   FIXTURE_PORT, so setting the variable moved the server and left Playwright
   waiting thirty seconds for a URL nothing was listening on. Two places that
   have to agree and no mechanism making them. */
const PORT = Number(process.env.FIXTURE_PORT ?? 4173);
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: ORIGIN,
    trace: "on-first-retry",
  },

  webServer: {
    command: "node scripts/serve-fixtures.mjs",
    url: `${ORIGIN}/prose.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
