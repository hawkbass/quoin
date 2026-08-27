/* Entry point for the single-file build.

   Drop this into any page: a script tag, a bookmarklet, a devtools snippet,
   `page.addScriptTag`, and `quoin` is on `window`. No build step, no bundler,
   no dependencies. That is what makes it possible to point the thing at
   somebody else's site, which is where every finding in this repository came
   from.

   The global carries the four console verbs and the whole page-side library
   underneath them, so `quoin.check()` prints a table and
   `quoin.verifyGrid({pitch: 4})` hands back data, from the same object.

   It deliberately imports `page.ts` rather than `index.ts`. The package entry
   also carries the baseline comparison, which reads a committed file and
   decides whether a pull request should fail. None of that has any business in
   a bundle whose whole purpose is to be small enough to paste into a console,
   and the size budget noticed the moment it was added: 26.4 kB against a 24 kB
   budget, for two functions no page can use. */

import * as library from "./page.ts";
import { install } from "./console.ts";

install(
  globalThis as unknown as Record<string, unknown>,
  library as unknown as Record<string, unknown>
);
