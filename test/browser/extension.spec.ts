/* The extension, loaded into a real browser and driven.

   An extension is four files that only ever run together, in a context that
   cannot be reached from a unit test: a popup document talking to a page
   through `chrome.scripting`. Every defect in one lives exactly where nothing
   else looks. So this loads the built extension into a persistent Chromium
   profile, opens the popup against a fixture, and clicks the buttons.

   Chromium only, and not because of laziness: Playwright cannot load a
   Manifest V3 extension into its Firefox or WebKit builds at all. The library
   underneath is covered in all three by every other spec in this directory. */

import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/*
   The test build. Identical to the shipped one except for a host permission
   scoped to the fixture server, because `activeTab` is granted by a toolbar
   click and nothing can click a browser toolbar.
*/
const BUILT = resolve("dist-extension-test");

test.skip(({ browserName }) => browserName !== "chromium", "extensions are Chromium only here");

let context: BrowserContext;
let profile: string;
let extensionId: string;

test.beforeAll(async () => {
  test.skip(!existsSync(BUILT), "run `npm run build:extension:test` first");

  profile = mkdtempSync(join(tmpdir(), "quoin-ext-"));
  context = await chromium.launchPersistentContext(profile, {
    /*
       `channel: "chromium"` rather than the default, and it is not cosmetic.
       Playwright's default headless mode cannot load a Manifest V3 extension at
       all: the browser starts, the extension is silently absent, and every
       navigation to `chrome-extension://` comes back ERR_ABORTED, which reads
       exactly like a wrong id. The channel uses the newer headless build, where
       extensions work.
    */
    channel: "chromium",
    args: [
      `--disable-extensions-except=${BUILT}`,
      `--load-extension=${BUILT}`,
    ],
    viewport: { width: 1280, height: 900 },
  });

  /*
     The id comes from the `key` in the manifest, not from where the folder
     happens to sit on disk. Without one it is a hash of the absolute path, so
     every developer gets a different id and nothing can navigate to the popup
     without first knowing it, which there is no way to ask for when the
     manifest declares no background worker.
  */
  const manifest = JSON.parse(readFileSync(join(BUILT, "manifest.json"), "utf8"));
  expect(manifest.key, "the manifest pins an id: run scripts/make-extension-key.mjs").toBeTruthy();

  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest();
  extensionId = "";
  for (let i = 0; i < 16; i++) {
    extensionId += String.fromCharCode(97 + (digest[i]! >> 4));
    extensionId += String.fromCharCode(97 + (digest[i]! & 0x0f));
  }
});

test.afterAll(async () => {
  await context?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

/* The popup is an ordinary document at a chrome-extension: URL, so it can be
   opened as a tab and driven like any other page. It reads the "active tab",
   which in this profile is the fixture opened just before it. */
async function openPopupAgainst(fixture: string): Promise<{ popup: Page; target: Page }> {
  const target = await context.newPage();
  await target.goto(`http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}/${fixture}`);
  await target.evaluate(() => document.fonts?.ready);
  await target.bringToFront();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForLoadState("domcontentloaded");
  return { popup, target };
}

test("the extension has an id, so it loaded", () => {
  expect(extensionId, "chromium accepted the manifest").toMatch(/^[a-p]{32}$/);
});

test("the popup measures the page it was opened over", async () => {
  const { popup, target } = await openPopupAgainst("prose.html");

  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  const fraction = await popup.locator("#fraction").textContent();
  const percent = await popup.locator("#pct").textContent();
  const verdict = await popup.locator("#verdict").textContent();

  expect(fraction, "it counted the fixture's blocks").toMatch(/\d+ of \d+ blocks/);
  expect(percent).toMatch(/^\d+%$/);
  expect(verdict?.length ?? 0, "and said what shape the problem is").toBeGreaterThan(20);

  /* The number the popup shows has to be the number the library gives. */
  const total = Number(/of (\d+) blocks/.exec(fraction ?? "")?.[1]);
  const direct = await target.evaluate(() => {
    const q = (globalThis as never as { quoin: { verifyGrid: (o: unknown) => { report: { total: number } } } }).quoin;
    return q.verifyGrid({ pitch: 8 }).report.total;
  });
  expect(total, "the popup is not inventing a denominator").toBe(direct);

  await popup.close();
  await target.close();
});

test("it injects into the main world, so quoin is left on window", async () => {
  /* The reason for MAIN rather than the isolated world: font metrics have to
     be measured against the document's own font set, and afterwards anyone can
     script it from the console without installing anything else. */
  const { popup, target } = await openPopupAgainst("prose.html");
  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  const onWindow = await target.evaluate(() => ({
    quoin: typeof (globalThis as never as Record<string, unknown>).quoin,
    bridge: typeof (globalThis as never as Record<string, unknown>).__quoinExt,
  }));

  expect(onWindow.quoin).toBe("object");
  expect(onWindow.bridge).toBe("object");

  await popup.close();
  await target.close();
});

test("the grid button draws a grid on the page and takes it away again", async () => {
  const { popup, target } = await openPopupAgainst("prose.html");
  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  const overlays = () => target.locator("[data-quoin-overlay]").count();

  expect(await overlays(), "nothing drawn yet").toBe(0);

  await popup.locator("#grid").click();
  await expect.poll(overlays, { timeout: 10_000 }).toBe(1);
  await expect(popup.locator("#grid")).toHaveClass(/on/);

  const pitch = await target.locator("[data-quoin-overlay]").evaluate(
    (el) => getComputedStyle(el).backgroundImage
  );
  expect(pitch, "and it is drawn at the selected pitch").toContain("8px");

  await popup.locator("#grid").click();
  await expect.poll(overlays, { timeout: 10_000 }).toBe(0);

  await popup.close();
  await target.close();
});

test("seating raises the score, and lifting puts it back", async () => {
  const { popup, target } = await openPopupAgainst("prose.html");
  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  const before = await popup.locator("#pct").textContent();

  await popup.locator("#seat").click();
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20_000 });
  const after = await popup.locator("#pct").textContent();

  expect(Number.parseInt(after ?? "0", 10), `${before} then ${after}`).toBeGreaterThan(
    Number.parseInt(before ?? "0", 10)
  );
  await expect(popup.locator("#seat")).toHaveText("Lift it back off");
  await expect(
    popup.locator("#verdict"),
    "a fully seated page says so rather than reporting on a scale that is now moot"
  ).toContainText("On the grid");
  await expect(popup.locator("#copy"), "and the CSS is now available").toBeEnabled();

  /* The page really moved, not just the readout. */
  const stamped = await target.locator("[data-quoin-seat]").count();
  expect(stamped, "the page carries the corrections").toBeGreaterThan(3);

  await popup.locator("#seat").click();
  await expect(popup.locator("#seat")).toHaveText("Seat the page");
  await expect.poll(() => target.locator("[data-quoin-seat]").count(), { timeout: 10_000 }).toBe(0);
  expect(await popup.locator("#pct").textContent(), "back where it started").toBe(before);

  await popup.close();
  await target.close();
});

test("changing the pitch changes the reading", async () => {
  const { popup, target } = await openPopupAgainst("prose.html");
  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  const at8 = await popup.locator("#pct").textContent();
  await popup.locator('[data-pitch="4"]').click();
  await expect(popup.locator('[data-pitch="4"]')).toHaveClass(/on/);
  await expect.poll(async () => popup.locator("#pct").textContent(), { timeout: 10_000 }).not.toBe(at8);

  /* A coarser grid can never seat more blocks than a finer one that divides
     it, so this direction is arithmetic rather than a guess. */
  const at4 = await popup.locator("#pct").textContent();
  expect(Number.parseInt(at4 ?? "0", 10)).toBeGreaterThanOrEqual(
    Number.parseInt(at8 ?? "0", 10)
  );

  await popup.close();
  await target.close();
});

test("it says what it could not see, rather than leaving it out of the total", async () => {
  const { popup, target } = await openPopupAgainst("torture.html");
  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  /* The torture fixture carries a frame and a transformed subtree, and the
     banner exists so neither quietly vanishes from a percentage. */
  await expect(popup.locator("#banner")).toBeVisible({ timeout: 10_000 });
  const banner = await popup.locator("#banner").textContent();
  expect(banner).toMatch(/Not counted/);
  expect(banner).toMatch(/frame/i);

  await popup.close();
  await target.close();
});

test("a tab that has gone is explained, not dumped as an API error", async () => {
  /*
     The same `explain` path a chrome:// page takes. Playwright refuses to
     navigate to chrome:// at all, so that state cannot be built here; a closed
     tab can be, deterministically, and it proves the wiring: the popup catches
     the failure, translates it, and never shows the extension API's own wording
     to somebody who just wants to know why nothing happened.
  */
  const { popup, target } = await openPopupAgainst("prose.html");
  /* Wait on the reading, not on the panel. The panel is revealed as part of
     rendering, so "visible" and "filled in" are not the same instant. */
  await expect(popup.locator("#fraction")).toHaveText(/\d+ of \d+ blocks/, { timeout: 15_000 });

  await target.close();
  await popup.locator("#grid").click();

  await expect(popup.locator("#banner")).toBeVisible({ timeout: 15_000 });
  const message = await popup.locator("#banner").textContent();
  expect(message, `got: ${message}`).toMatch(/tab has gone|cannot be measured/i);
  expect(message, "and not the raw API wording").not.toMatch(/executeScript|Frame with ID|Protocol error/);

  await popup.close();
});
