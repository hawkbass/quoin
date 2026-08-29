/* Entry point for the fitter's single-file build.

   Separate from `global.ts` on purpose. That bundle exists to be pasted into a
   console on a page somebody is looking at, and it has a size budget because
   that is a real constraint: it gets typed into devtools, dropped into a
   bookmarklet, injected into somebody else's site. The fitter is a different
   job. It answers "what sizes would this design need", which is a question you
   ask once at the start of a project rather than while poking at a rendered
   page, and it costs four kilobytes that the console bundle should not have to
   carry to stay under budget.

   It still has to run in a browser, because the only trustworthy source of font
   metrics is the font the browser actually resolved. So it is a bundle rather
   than a Node module, and the CLI injects it for `quoin fit`. */

import * as library from "./page.ts";
import { fitScale, fittedScaleToCss, inferDesign } from "./fit.ts";
import { fitVertical, fittedVerticalToCss } from "./fit-core.ts";
import { verifyVertical } from "./verify-vertical.ts";

const global = globalThis as unknown as Record<string, unknown>;
global.quoinFit = {
  ...library,
  fitScale,
  fittedScaleToCss,
  inferDesign,
  /* Vertical needs no browser at all, but it belongs beside its sibling. */
  fitVertical,
  fittedVerticalToCss,
  /* And the checker for what it emits. A fitter whose output the tool
     cannot verify is half a feature. */
  verifyVertical,
};
