/* Quoin: it puts a web page on a baseline grid.

   A quoin is the wedge a printer hammers into the chase to lock the type so
   nothing shifts on the press. Same job.

   The package entry. Everything that runs in a page comes through `page.ts`,
   which is what the single-file build imports; the baseline comparison below it
   runs in Node, against a file somebody committed. */

export * from "./page.ts";

export {
  fitScale,
  inferDesign,
  type InferOptions,
  type InferredDesign,
  fittedScaleToCss,
  type FamilyRequest,
  type FittedFamily,
  type FittedScale,
  type FittedStep,
  type DesignStep,
} from "./fit.ts";

export {
  fitFromFiles,
  readFontMetrics,
  capHeightAt,
  FontFileError,
  type FamilyFile,
  type FitFromFilesResult,
  type FontFileMetrics,
} from "./fit-file.ts";

export {
  fitWith,
  spaceFor,
  leadingFor,
  type CapSource,
} from "./fit-core.ts";

export {
  normaliseDesign,
  DesignError,
  type NormaliseResult,
} from "./design-input.ts";

export {
  makeBaseline,
  compareToBaseline,
  comparisonToMarkdown,
  type Baseline,
  type BaselineEntry,
  type Comparison,
  type CompareResult,
  type Verdict,
} from "./baseline.ts";

export {
  figmaToDesign,
  FigmaError,
  type FigmaDesign,
  type FigmaOptions,
} from "./figma.ts";

export {
  readPdfText,
  baselinesFromTop,
  PdfError,
  type PdfPage,
  type PdfTextRun,
} from "./pdf.ts";

export {
  verifyColumns,
  type ColumnReport,
  type ColumnEdge,
  type ColumnOptions,
} from "./columns.ts";
