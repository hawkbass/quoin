/* One place, because three was one too many.

   The version appeared in package.json, in the library entry and in the console
   API, and CONTRIBUTING.md gained a release step telling a human to remember all
   three. A release step that says "remember to" is a defect with a note attached.

   `test/unit/version.test.ts` fails if this and package.json disagree. */

export const VERSION = "1.14.0";
