/* The four verbs you actually type into a console.

   The library API takes options objects and returns data. This takes nothing
   and prints. Both are the same code; the difference is that one of them is
   what a person types at half past eleven while looking at a page that is
   subtly wrong and not yet knowing why. */

import { verifyGrid, offGrid } from "./verify.ts";
import { seatPage, exportCss, type SeatOptions, type SeatResult } from "./seat.ts";
import { capHeightIsRasterised, canReadFontTableCapHeight } from "./metrics.ts";
import { VERSION } from "./version.ts";
import type { GridReport } from "./grid.ts";

export interface QuoinConsole {
  /** How much is off the grid, without changing anything. */
  check(pitch?: number): GridReport;
  /** The off-grid nodes as data, for when a console table is not enough. */
  list(pitch?: number, limit?: number): ReturnType<typeof offGrid>;
  /** Put the page on the grid. Call again to lift it back off. */
  seat(options?: SeatOptions): GridReport | undefined;
  /** The corrections as CSS, so you can ship it without the JavaScript. */
  css(options?: { important?: boolean }): string;
  /** Whether this engine reports cap heights off the rasteriser. */
  engine(): { capHeightIsRasterised: boolean; fontTableCapHeight: boolean };
  readonly version: string;
}



/**
 * Attach the console API to a global. Returns a function that removes it and
 * lifts the page back off the grid.
 *
 * `extras` is merged in underneath, so the single-file build can put the whole
 * library on the same global as the four verbs. The verbs win on a collision:
 * somebody typing `quoin.check()` means the one that prints.
 */
export function install(
  target: Record<string, unknown> = globalThis as never,
  extras: Record<string, unknown> = {}
): () => void {
  let seated: SeatResult | null = null;

  const api: QuoinConsole = {
    version: VERSION,

    check(pitch = 8) {
      const { results, report, skippedTransformed, closedShadowRoots, frames } =
        verifyGrid({ pitch });
      console.log(
        `${report.onGrid} of ${report.total} on a ${pitch}px grid. ` +
          `Worst drift ${report.worst.toFixed(2)}px. ` +
          `${report.distinctDrifts} distinct drift ` +
          `${report.distinctDrifts === 1 ? "value" : "values"}.`
      );
      console.log(
        report.systematic
          ? "One shared offset: check the origin, or a single un-snapped line-height."
          : "Scattered: the type scale and the spacing scale disagree with each other."
      );
      if (skippedTransformed > 0) {
        console.log(
          `${skippedTransformed} nodes skipped: they sit under a CSS transform, ` +
            `so their measured position is in a different coordinate space.`
        );
      }
      /* Regions this could not see. A percentage that quietly omits one is
         worse than no percentage. */
      if (closedShadowRoots > 0) {
        console.log(
          `${closedShadowRoots} shadow ${closedShadowRoots === 1 ? "root" : "roots"} ` +
            `could not be entered, so any text inside is not in this count.`
        );
      }
      if (frames > 0) {
        console.log(
          `${frames} ${frames === 1 ? "frame" : "frames"} on the page. ` +
            `Their content is a different document: point this at the frame's own URL.`
        );
      }
      console.table(
        offGrid(results).map((r) => ({
          drift: Number(r.drift.toFixed(2)),
          where: r.path,
          text: r.sample,
        }))
      );
      return report;
    },

    list(pitch = 8, limit = 500) {
      const { results } = verifyGrid({ pitch });
      return offGrid(results, limit);
    },

    seat(options?: SeatOptions) {
      if (seated) {
        seated.undo();
        seated = null;
        console.log("Lifted back off the grid.");
        return undefined;
      }

      const pitch = options?.pitch ?? 8;
      const before = verifyGrid({ pitch }).report;
      seated = seatPage(options);
      const after = verifyGrid({ pitch }).report;

      const levers = seated.blocks.reduce<Record<string, number>>((acc, b) => {
        acc[b.lever] = (acc[b.lever] ?? 0) + 1;
        return acc;
      }, {});

      console.log(
        `${before.onGrid}/${before.total} on grid before, ` +
          `${after.onGrid}/${after.total} after, in ${seated.passes} ` +
          `${seated.passes === 1 ? "sweep" : "sweeps"}.`
      );
      console.log(
        `Padding moved ${levers.padding ?? 0}, offset moved ${levers.offset ?? 0}, ` +
          `${levers.none ?? 0} could not be moved.`
      );
      if (seated.exhausted) {
        console.log(
          `The page was still moving on the last of ${seated.passes} sweeps, so it ` +
            `has not converged. Raise maxPasses, or treat this as provisional.`
        );
      }
      if (seated.unexportable > 0) {
        const shadow = seated.inShadow
          ? ` ${seated.inShadow} of those are inside a shadow root, where the fix ` +
            `belongs in the component rather than in your stylesheet.`
          : "";
        console.log(
          `${seated.unexportable} corrected blocks have no unique selector and ` +
            `will not appear in quoin.css().${shadow}`
        );
      }
      console.log("quoin.css() for the stylesheet, quoin.seat() again to undo.");
      return after;
    },

    css(options) {
      if (!seated) {
        console.log("Nothing seated yet. Run quoin.seat() first.");
        return "";
      }
      return exportCss(seated, options);
    },

    engine() {
      /* Both of these touch the canvas or the CSS object model, either of
         which can be absent or restricted, and neither is worth taking the
         console down for. */
      const safely = (fn: () => boolean): boolean => {
        try {
          return fn();
        } catch {
          return false;
        }
      };
      return {
        capHeightIsRasterised: safely(() => capHeightIsRasterised()),
        fontTableCapHeight: safely(canReadFontTableCapHeight),
      };
    },
  };

  target.quoin = Object.assign({}, extras, api);

  return () => {
    seated?.undo();
    seated = null;
    delete target.quoin;
  };
}
