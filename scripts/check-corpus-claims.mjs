/* The corpus figures, checked against the corpus.

   Every number the survey produced is hand-copied into four places: the README's
   category table, the same table on quoin.dev, the prose around both, and the
   summary in `findings/corpus.md`. They rot independently, and they did.

   The published breakdown of rhythm causes was measured with quoin 1.4.0 and
   still read "leading on 106 of the 153" on the front page eighteen releases
   later, after `diagnose` had been corrected three times. Nothing noticed,
   because nothing was looking: the figure was true when it was written and no
   mechanism existed to see it stop being.

   So this is that mechanism, the same shape as the gate on the CLI's flags and
   the one the portfolio runs against its own settled claims. A number nobody can
   check is a number that rots. */

import { readFileSync } from "node:fs";

const corpus = JSON.parse(readFileSync("findings/corpus.json", "utf8"));
const readme = readFileSync("README.md", "utf8");
const site = readFileSync("site/index.html", "utf8");

/*
   The category names as the tables spell them, against the slugs the data uses.
   Two spellings where the README and the site disagree, both accepted, because
   which of them is right is a question for a copy editor and not for a gate.
*/
const NAMES = {
  institution: ["Institutions"],
  "type-foundry": ["Type foundries"],
  "design-system": ["Design systems"],
  documentation: ["Documentation"],
  academic: ["Academic"],
  studio: ["Studios"],
  product: ["Product", "Products"],
  editorial: ["Editorial"],
};

/*
   Deliberately not in the published table, with the reason.

   `surveyor` is a category of one and the one is craighawkes.dev. A survey of
   other people's sites does not get the surveyor's own as a row in it, and the
   site is in the corpus so it is measured by the same instrument rather than
   exempted from it.
*/
const UNPUBLISHED = new Set(["surveyor"]);

/*
   The release at which the measuring changed last.

   The tables agreeing with the data file is only half the question. The other
   half is whether the data file was produced by a tool that still measures the
   way this one does, and that is what actually went wrong: the survey ran under
   1.4.0 and `diagnose` was corrected in 1.18.1, gained a cause in 1.19.0 and
   changed what counts as introducing drift along the way. The tables were
   faithful to a file that had stopped being true.

   Bumped by hand when `verify`, `rhythm` or `grid` changes what a number means,
   which is a deliberate act rather than an automatic one: only the person making
   the change knows whether it moved the measurement or only the wording.
*/
const MEASUREMENT_CHANGED_AT = "1.20.0";

/** Is `version` older than `floor`? Both plain three-part releases. */
function olderThan(version, floor) {
  const a = String(version).split(".").map(Number);
  const b = String(floor).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

const problems = [];
let checked = 0;

function claim(where, description, holds) {
  checked++;
  if (!holds) problems.push(`${where}: ${description}`);
}

/*
   Percentages, with the bars taken out first.

   The site draws each figure with an `<i style="width:32%">` beside it, and that
   width is a rounding of the number rather than the number. Read as data it
   makes every row look wrong by a fraction, which is a gate tripping over
   presentation.
*/
function figuresIn(text) {
  const withoutBars = text.replace(/<i[^>]*><\/i>/g, "");
  return [...withoutBars.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
}

/* Published to one decimal place, so anything closer than that is the same. */
function same(a, b) {
  return Math.abs(a - b) < 0.05;
}

function firstMatch(text, build, spellings) {
  for (const spelling of spellings) {
    const found = build(spelling).exec(text);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ *
   The headline counts
 * ------------------------------------------------------------------ */

const { scored, dropped, medianSolved8, topRhythmCauses } = corpus.summary;
const total = corpus.rows.length;
const measuredWith = corpus.method?.quoin ?? "an unrecorded version";

/*
   The staleness check, which is the one that would have caught this.
*/
claim(
  "findings/corpus.json",
  `was measured with ${measuredWith}, and the measuring last changed in ` +
    `${MEASUREMENT_CHANGED_AT}. Re-run \`npm run corpus\`.`,
  corpus.method?.quoin !== undefined && !olderThan(measuredWith, MEASUREMENT_CHANGED_AT)
);

claim("README", `${scored} sites scored`, readme.includes(`${scored} sites scored`));
claim("README", `${dropped} dropped`, readme.includes(`${dropped} dropped`));
claim("README", `the median is ${medianSolved8}%`, readme.includes(`median is ${medianSolved8}%`));
claim("README", `${total} sites were pointed at`, readme.includes(`${total} sites`));
claim(
  "site",
  `${scored} rendered enough to score`,
  site.includes(`${scored} rendered enough to score`)
);

/*
   The rhythm causes, which is the claim that actually went stale and the reason
   this file exists.
*/
const [topCause, topCount] = topRhythmCauses[0] ?? [];
if (topCause) {
  const capitalised = topCause[0].toUpperCase() + topCause.slice(1);
  claim(
    "README",
    `${topCause} is the commonest cause, on ${topCount} of ${scored}`,
    readme.includes(`on ${topCount} of them is ${topCause}`)
  );
  claim(
    "site",
    `${topCause} is the commonest cause, on ${topCount} of ${scored}`,
    site.includes(`${capitalised} is the cause on ${topCount} of the ${scored}`)
  );
}

/* ------------------------------------------------------------------ *
   The category table, row by row, in both places
 * ------------------------------------------------------------------ */

for (const row of corpus.categories) {
  if (UNPUBLISHED.has(row.category)) continue;

  const spellings = NAMES[row.category];
  if (!spellings) {
    problems.push(
      `the survey has a category "${row.category}" that neither table publishes, ` +
        "and nothing marks it as deliberately left out"
    );
    continue;
  }
  const name = spellings[0];

  /* The README row: | Name | sites | solved8 | fixed8 | rhythm | drifts | */
  const markdownRow = firstMatch(
    readme,
    (spelling) => new RegExp(String.raw`^\|\s*${spelling}\s*\|([^\n]*)$`, "m"),
    spellings
  );

  if (!markdownRow) {
    problems.push(`README table: no row for ${name}`);
  } else {
    const cells = markdownRow[1].split("|").map((cell) => cell.trim());
    const percents = figuresIn(markdownRow[1]);
    claim("README table", `${name} has ${row.sites} sites`, Number(cells[0]) === row.sites);
    claim(
      "README table",
      `${name} reads ${row.medianSolved8}% on the grid, ${row.medianFixed8}% against zero, ` +
        `${row.medianRhythm}% in rhythm`,
      percents.length >= 3 &&
        same(percents[0], row.medianSolved8) &&
        same(percents[1], row.medianFixed8) &&
        same(percents[2], row.medianRhythm)
    );
  }

  /* The site row, which leaves out the pinned-to-zero column. */
  const htmlRow = firstMatch(
    site,
    (spelling) => new RegExp(String.raw`<th scope="row">${spelling}</th>([\s\S]*?)</tr>`),
    spellings
  );

  if (!htmlRow) {
    problems.push(`site table: no row for ${name}`);
  } else {
    const percents = figuresIn(htmlRow[1]);
    const sites = Number(/<td>(\d+)<\/td>/.exec(htmlRow[1])?.[1]);
    claim("site table", `${name} has ${row.sites} sites`, sites === row.sites);
    claim(
      "site table",
      `${name} reads ${row.medianSolved8}% on the grid and ${row.medianRhythm}% in rhythm`,
      percents.length >= 2 &&
        same(percents[0], row.medianSolved8) &&
        same(percents[1], row.medianRhythm)
    );
  }
}

/* ------------------------------------------------------------------ *
   Report
 * ------------------------------------------------------------------ */

console.log("");
console.log("Corpus figures, against findings/corpus.json");
console.log("");
console.log(`  measured with quoin ${measuredWith}`);
console.log(`  ${checked} published figures checked`);
console.log("");

if (problems.length === 0) {
  console.log("  Every published figure matches the survey it came from.");
  console.log("");
  process.exit(0);
}

console.log(`  ${problems.length} do not match what the survey measured:`);
console.log("");
for (const problem of problems) console.log(`    ${problem}`);
console.log("");
console.log("  Re-run `npm run corpus` and update the tables, or the numbers on");
console.log("  the front page describe a survey nobody ran.");
console.log("");
process.exit(1);
