/* Entry point for the column check's single-file build.

   The same argument as `fit-global.ts`, and the same conclusion. The console
   bundle has a size budget because it gets typed into devtools, dropped into a
   bookmarklet and injected into somebody else's site, and that budget has been
   raised once already, which is once more than a budget should be.

   A column check is not a console question. It is a thing you run against a
   layout to find out whether its module divides, which is a build-time or
   review-time question and does not need to be two kilobytes of what somebody
   pastes into a page to see where their baselines are.

   It still has to run in a browser, because the edges it measures are laid out
   ones. So it is a bundle rather than a Node module, and the CLI injects it. */

import * as library from "./page.ts";
import { verifyColumns } from "./columns.ts";

const global = globalThis as unknown as Record<string, unknown>;
global.quoinColumns = { ...library, verifyColumns };
