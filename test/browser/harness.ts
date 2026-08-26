/* Loading a fixture with the built bundle in it.

   The tests exercise `dist/quoin.global.js` rather than the TypeScript source,
   on purpose: the bundle is what anybody actually runs, and the one defect this
   suite exists to prevent, a global that quietly stopped being the console
   API, lived in the bundler configuration and was invisible from the source. */

import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GridReport } from "../../src/grid.ts";
import type { TextNodeResult } from "../../src/verify.ts";
import type { SeatResult, SeatOptions, ExportOptions } from "../../src/seat.ts";

const BUNDLE = resolve("dist/quoin.global.js");

export interface InPage {
  verifyGrid: (o?: unknown) => {
    results: TextNodeResult[];
    report: GridReport;
    skippedTransformed: number;
  };
  seatPage: (o?: SeatOptions) => SeatResult;
  exportCss: (r: SeatResult, o?: ExportOptions) => string;
  offGrid: (r: TextNodeResult[], limit?: number) => TextNodeResult[];
  uniqueSelector: (el: Element) => string | null;
  textBlocks: (root?: Element, ignore?: readonly string[]) => Element[];
  measureFont: (font: string, size?: number) => Record<string, number | string>;
  measureFontWithCap: (font: string, lh: number, size?: number) => Record<string, number | string>;
  capOvershootFromFontTable: (font: string, lh: number) => number | null;
  capHeightFromFontTable: (font: string) => number | null;
  canReadFontTableCapHeight: () => boolean;
  capHeightIsRasterised: (family?: string) => boolean;
  baselineWithinLineBox: (m: { ascent: number; descent: number }, lh: number) => number;
  check: (pitch?: number) => GridReport;
  seat: (o?: SeatOptions) => GridReport | undefined;
  css: (o?: ExportOptions) => string;
  version: string;
}

declare global {
  interface Window {
    quoin: InPage;
  }
}

/** Navigate to a fixture, let it settle, and inject the built bundle. */
export async function load(page: Page, fixture: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${fixture}`);
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  await page.waitForFunction(() => Boolean(window.quoin?.verifyGrid));
}

/** The eight-pixel grid, with display type left out of it. */
export const GRID = { pitch: 8, tolerance: 0.5, origin: 0 };
export const IGNORE = [".display"];
