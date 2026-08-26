import { defineConfig, devices } from "@playwright/test";

/* Fixtures are served over http rather than opened as files: `file://` gives
   different origin rules in each engine, and a cross-engine study whose
   variable is the origin policy is not a cross-engine study. */
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },

  webServer: {
    command: "node scripts/serve-fixtures.mjs",
    url: "http://127.0.0.1:4173/prose.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
