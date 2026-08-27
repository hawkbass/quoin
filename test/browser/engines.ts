/* Launching the three engines, and being honest about which build of each.

   Playwright bundles its own Firefox, and at the time of writing that is 153.
   `text-box-trim` shipped in 154. So the bundled build cannot exercise the one
   feature the cap-height finding rests on, and a study that quietly reported
   "Firefox: unsupported" would be describing Playwright rather than Firefox.

   `channel: "moz-firefox"` drives the Firefox actually installed on the
   machine, over WebDriver BiDi. Where that is 154 or later the finding is
   measured directly. Where it is absent or older, the bundled build is used and
   the shortfall is recorded in the output rather than left for a reader to
   infer from a column of dashes. */

import { chromium, firefox, webkit, type Browser } from "@playwright/test";

export interface Engine {
  name: string;
  browser: Browser;
  /** What was actually launched, for the findings file. */
  build: string;
  /** True when this is the machine's own browser rather than Playwright's. */
  system: boolean;
}

async function firefoxPreferringSystem(): Promise<Omit<Engine, "name">> {
  try {
    const browser = await firefox.launch({ channel: "moz-firefox" });
    const version = browser.version();
    /* Only worth using if it is actually newer. A system Firefox older than the
       bundled one is a downgrade wearing a flag. */
    if (Number.parseInt(version, 10) >= 154) {
      return { browser, build: `system Firefox ${version}`, system: true };
    }
    await browser.close();
  } catch {
    /* Not installed, too old to speak BiDi, or refused to start. All three mean
       the same thing here. */
  }
  const browser = await firefox.launch();
  return { browser, build: `Playwright Firefox ${browser.version()}`, system: false };
}

/** Chromium, Firefox and WebKit, preferring a system Firefox new enough to matter. */
export async function launchEngines(): Promise<Engine[]> {
  const chrome = await chromium.launch();
  const gecko = await firefoxPreferringSystem();
  const wk = await webkit.launch();

  return [
    { name: "chromium", browser: chrome, build: `Playwright Chromium ${chrome.version()}`, system: false },
    { name: "firefox", ...gecko },
    { name: "webkit", browser: wk, build: `Playwright WebKit ${wk.version()}`, system: false },
  ];
}

export async function closeEngines(engines: Engine[]): Promise<void> {
  for (const engine of engines) {
    try {
      await engine.browser.close();
    } catch {
      /* A browser that has already gone is not a test failure. */
    }
  }
}
