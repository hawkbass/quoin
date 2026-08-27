/* Quoin: it puts a web page on a baseline grid.

   A quoin is the wedge a printer hammers into the chase to lock the type so
   nothing shifts on the press. Same job. */

export { VERSION } from "./version.ts";

export {
  measureFont,
  measureFontWithCap,
  fontShorthand,
  fontSizeFromShorthand,
  baselineWithinLineBox,
  capOvershoot,
  capOvershootFromFontTable,
  capHeightFromFontTable,
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
