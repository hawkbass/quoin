/* Everything that runs inside a page.

   Split out from the package entry so the single-file build can import it
   directly. `index.ts` is this plus the baseline comparison, which runs in Node
   against a committed file and would only be dead weight in a bundle meant to
   be pasted into a console. */

export { VERSION } from "./version.ts";

export {
  measureFont,
  measureFontWithCap,
  fontShorthand,
  fontSizeFromShorthand,
  baselineWithinLineBox,
  firstBaselineOffset,
  capOvershoot,
  capOvershootFromFontTable,
  capHeightFromFontTable,
  boxHeightForEdge,
  canReadFontTableCapHeight,
  capHeightIsRasterised,
  fontIsAvailable,
  descenderSlack,
  resetMeasurementCache,
  type FontMetrics,
  type CapSource,
} from "./metrics.ts";

export {
  checkBaseline,
  snapLineHeight,
  seatingShift,
  seatingPadding,
  summarise,
  gridConfig,
  bestOrigin,
  DEFAULT_GRID,
  type GridConfig,
  type GridResult,
  type GridReport,
} from "./grid.ts";


export {
  verifyGrid,
  offGrid,
  textBlocks,
  NON_TEXT,
  inShadowRoot,
  type TextNodeResult,
  type VerifyOptions,
  type VerifyResult,
  type WalkOptions,
  type WalkResult,
} from "./verify.ts";

export { walk } from "./walk.ts";

export {
  verifyRhythm,
  type RhythmReport,
  type RhythmIssue,
  type RhythmCause,
  type RhythmOptions,
} from "./rhythm.ts";

/* The scale solver is deliberately absent.

   It answers "what sizes would this design need", which is a question you ask
   once at the start of a project, not while poking at a page in devtools. It
   costs the console bundle about half a kilobyte of a 28 kB budget that exists
   because this file gets pasted into somebody else's site. Same reasoning as
   the fitter, so it lives in the same place: `fit-global.ts`, injected by the
   CLI for `quoin scale`. The package entry still exports it. */

export {
  seatPage,
  exportCss,
  exportCssVerified,
  checkExport,
  type SeatOptions,
  type SeatMode,
  type SeatedBlock,
  type SeatResult,
  type ExportOptions,
  type ExportCheck,
  type LostDeclaration,
  type VerifiedExport,
  type Lever,
} from "./seat.ts";

export {
  uniqueSelector,
  matchesOnly,
  describe,
} from "./selector.ts";

export { install, type QuoinConsole } from "./console.ts";
