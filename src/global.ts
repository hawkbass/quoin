/* Entry point for the single-file build.

   Drop this into any page: a script tag, a bookmarklet, a devtools snippet,
   `page.addScriptTag`, and `quoin` is on `window`. No build step, no bundler,
   no dependencies. That is what makes it possible to point the thing at
   somebody else's site, which is where every finding in this repository came
   from.

   The global carries the four console verbs and the whole library underneath
   them, so `quoin.check()` prints a table and `quoin.verifyGrid({pitch: 4})`
   hands back data, from the same object. */

import * as library from "./index.ts";
import { install } from "./console.ts";

install(
  globalThis as unknown as Record<string, unknown>,
  library as unknown as Record<string, unknown>
);
