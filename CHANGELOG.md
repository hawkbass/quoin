# Changelog

## 1.11.0

Text that is not Latin.

Cap height is a Latin idea and everything here defaulted to it without saying
so, which is the kind of assumption worth going and checking rather than
defending.

### Added

**`boxHeightForEdge(font, edge)`, and an `edge` option on the fitter and the
CLI.** Any `text-box-edge`, measured rather than assumed. An edge the engine
refuses comes back as null and nothing is fitted.

`fitFromFiles` supports only `cap alphabetic` and refuses the rest with a
message, because the OS/2 table declares a cap height and does not declare the
others.

### Findings

**Fitting works for every script, and the reason is not the obvious one.** A
trimmed box is a property of the font declared metrics rather than of the glyphs
inside it, so Japanese text in Noto Sans JP trims to exactly the same height as
Latin text in the same face, and so does a line mixing the two. Measured across
Japanese, Arabic, Devanagari, Thai and Latin, each in the face it is for: 15/15
at five widths, on two different edges, in both engines.

**There is no working ideographic edge on the web today.** Chromium refuses every
ideographic form of text-box-edge outright. WebKit accepts them and returns the
same box as text, which is to say it has not implemented the metric either. The
engines also disagree about the single-keyword forms: cap on its own is a parse
error in one and 0.8781 em in the other.

So a Japanese page can be gridded, and not to the ideographic em a Japanese
typesetter would use. That is the platform rather than this library, and it is
worth writing down.

### Fixed

**An earlier note in this repository reported 1.448 em for the ideographic edge
as a real measurement.** It was the untrimmed box: the property had been
rejected, the element kept its previous value, and the probe measured that and
reported it confidently. `boxHeightForEdge` now checks the declaration took
before trusting the number, which is why the mistake is in this changelog rather
than still in the README.

**The action validated its URLs after launching Chromium**, so a misconfigured
workflow cost a browser start to reject a string, and put a browser in the
failure path of a check about a string.

## 1.10.0

A PostCSS plugin and a Vite plugin, so a build can do this without being asked
twice.

### Added

**`quoin/postcss`.** Every rule declaring a pixel font-size and a line-height is
fitted. The size is never touched, the leading is snapped to whole rows, and the
trim is added.

It stops short of margins on purpose. A rule that already declares margin-top
gets it rewritten, because the author has decided that is where the spacing
lives; every other rule gets --quoin-space and keeps its layout. Rewriting every
rule margin is exactly how the corpus study produced numbers that were nonsense
in both directions.

**`quoin/vite`.** Runs the PostCSS plugin over the project CSS, and serves the
fitted tokens as an importable module for designs that live in a token file
rather than in a stylesheet. Both halves are independent, and a test asserts they
produce the same numbers when both run, because a page built from a mixture of
two disagreeing grids is on neither.

postcss and vite are optional peer dependencies. The package still has no
dependencies of its own, and neither plugin imports the tool it plugs into: they
describe the shapes they need structurally.

**`npm run test:linux`.** Runs the browser suite in the same image CI uses.

### Fixed

**Eight of the last twelve CI runs were red, and every one was a difference
between this machine and the runner.** The generic serif is a different typeface
on Linux, so any threshold tuned locally fails there, and a test that waits on a
panel rather than on a number is slower there and reads the previous value.

Three tests asserted absolute numbers when their claims were comparative. The
fluid control now asserts that the fitted page beats the unfitted one rather than
naming a percentage. The zoom test asserts that zoom does not take blocks off the
grid rather than that the page is perfect, which was a second claim belonging to
another file. The layout-change test measures the same page without its media
query in the same run and compares the two: 0/4 against 4/4, which is the same
finding without a number that travels badly.

**The Vite plugin resolved a relative design path against the process working
directory** rather than the project root, so it looked for the file wherever the
build happened to be launched from.

## 1.9.0

What a baseline grid would actually cost the web.

The corpus said the median site is at 28% on an 8px grid. That describes the
medium and does not answer what those sites would have to give up to be on one.
This release measures the price.

### Added

**`npm run fittable`.** Reads each corpus site design off its own rendered page,
fits it, and reports what the type would cost. 175 of 212 rendered enough to
read.

### Findings

**The median site would move 15.6px of leading across 8 sizes**, which is 1.95px
per size. No size ever changes, so that is the entire cost. The largest single
change is 4px, and that is the median of the worst change on each site rather
than the best case: no site in 175 would have to move any one leading by more
than about four pixels.

**The cost is the number of sizes, not the size of the change.** Rollup could be
fitted for nothing at all; Deno would cost 67px. The difference is not that Deno
typography is worse. Deno has twenty-nine distinct size-and-leading combinations
on one page and Rollup has five, and every one of Deno changes is under four
pixels, the same as everybody else. There are simply twenty-nine of them.

Which reframes what the grid asks for. Not that you accept type that looks
different, but how many sizes you actually needed.

**Studios are cheapest at 11px and products dearest at 21.38px**, and the
ordering is by how many sizes each carries: 5 against 12.5.

**The median site is 18.9% in rhythm**, and that is the obstacle a type fit does
not remove. Fitting sets sizes, leadings and spacing. It cannot make a container
with thirteen pixels of padding into a whole number of rows.

### Changed

**The study stopped claiming to retrofit live sites.** A first version walked
each page setting margin-top on every text block, and produced nonsense in both
directions: the site with the best rhythm in the sample got worse and the one
with the worst improved by fifty points. A real site vertical spacing lives on
its containers rather than its paragraphs, so overwriting every block margins
measures the demolition and not the fit. What it reports now is the cost, which
is a real number.

**Zoom and forced size changes are measured.** A fitted page holds 5/5 at 1x,
1.25x, 1.5x, 2x and 3x in both engines, because zoom scales the pitch along with
everything else. A forced minimum font size degrades it: overriding one size in a
five-block page took it from 5/5 to 3/5, the caption and the block below it, with
the three above unmoved.

## 1.8.0

Fluid type on a baseline grid, which this README said was impossible.

The reasoning it said it with was sound as far as it went. A block phase is
size times cap ratio, so a size that varies continuously has a phase that varies
continuously and lands on the grid only where it happens to. What it missed is
that the space does not have to be a number.

### Added

**A `fluid` range on a design step, and the CSS to make it hold.** CSS Values 4
has `mod()`, so the arithmetic the fitter does at build time can be done by the
browser at layout time instead:

```css
--size: clamp(28px, 5vw, 56px);
--cap: calc(var(--size) * 0.6621);
margin-top: calc(6 * var(--pitch) - mod(var(--cap), var(--pitch)));
```

Measured at eleven widths from 320 to 1440 in Chromium and WebKit, a page with
a clamped heading goes from on the grid at no width to on the grid at every one.
The control runs first and has to fail, because if the unfitted page were already
on the grid the result would be measuring nothing.

The leading still cannot be fluid, and that is not a limitation of the tool: a
leading has to be a whole number of rows or the second line of every paragraph is
off the grid, and there is no continuum of whole numbers.

### Fixed

**Nine font-file tests failed in CI rather than skipping.** The guard checked
that the fonts directory exists, and it does: a manifest is committed and the
fonts are not, because they are thirty megabytes of somebody else work that
`npm run fonts` downloads. Guarding on the directory is guarding on the wrong
thing.

That left the real problem, which is that the parser `fitFromFiles` depends on
had no coverage in any CI run there has ever been. There are now fonts built byte
by byte in the test file, so the parser is tested where the corpus is not: without
it, fifteen pass and nine skip.

### Findings

**`mod()` and `text-box-trim` are supported in the same engines.** Not a
coincidence, since both are recent additions to the same part of the platform,
and there is a test asserting they stay together so that a future divergence
grows a fallback rather than breaking quietly.

## 1.7.0

Taking a design in the shape somebody actually has it.

`fitScale` wanted families with fonts and steps, which is the shape the
arithmetic needs and not the shape anybody arrives with. A Figma export calls it
`fontSize` and `lineHeight` in px strings, a token file is flat, and an agent
reading a screenshot has a list of measurements and no idea what this library
calls things. All three are the same information.

### Added

**`normaliseDesign(input)`, used by `quoin fit`.** Accepts `font`,
`fontFamily`, `family` or `stack`; `steps`, `sizes`, `scale` or `tokens`;
`size` or `fontSize`; `leading` or `lineHeight`; `space`, `spacing`,
`marginTop` or `gap`. Points convert. A bare number is a step, because a flat
token file is nothing else. A unitless line-height is a ratio and a number of
pixels is not, since CSS spells it that way and the two stop overlapping at four.

Anything interpreted is reported on stderr, so `--json` stays clean and a guess
is still impossible to miss.

### Changed

**A relative length is refused rather than assumed.** A rem is 16px only if
nothing changed the root size, and a design saying 1.0625rem against an 18px root
means 19.125px. Guessing produces a fit that looks right, which is the one
outcome worth avoiding.

**Every error names the entry it is about**, in dotted path form. An agent
cannot ask a follow-up question, so an error that does not say which step was
wrong and what was expected costs a round trip and sometimes a confidently wrong
answer.

### Findings

**Cap height does not move with a variable font axis.** Six variable families at
three weights and two optical sizes, in Chromium and WebKit: identical every
time. `text-box-edge: cap` uses the static `sCapHeight`, so reading the default
instance out of a file is correct for variable fonts too, and a bold heading
shares a phase with regular body text at the same size.

## 1.6.0

Fitting without a browser, which is what makes it usable in a build.

1.5.0 fits a design to a grid and keeps every size the design asked for. It also
needed Playwright to do it, which rules the tool out of every pipeline that does
not already have one: a PostCSS step, a Vite plugin, a token build, an agent with
no display.

### Added

**`fitFromFiles(families, files, options)`, and `quoin fit` uses it whenever the
design names its font files.** Cap heights come out of the OS/2 table instead of
a browser. Three families and five sizes in 76ms, against roughly two seconds and
a browser install for the other route. Measured against real engines across nine
fonts at five sizes, the two disagreed by at most 0.008px.

**`readFontMetrics(bytes)`.** Units per em, cap height, x height and the
ascenders, from a TTF, OTF or WOFF. Deliberately small: it reads the table
directory and three tables, because those are the ones the arithmetic needs, and
a font parser that grows to handle glyphs is a dependency wearing a hat. WOFF2 is
refused rather than half-parsed, because it transforms glyf and loca rather than
merely compressing them.

**`fit-core.ts`**, the arithmetic with nothing in it that needs a browser, so the
modular equation the whole library now rests on is checked against hand-computed
cases rather than only through nine viewport widths.

### Findings

**The engines check a declared cap height, and only sometimes.** Three fonts
manufactured for the earlier metrics study, measured through a trim probe in both
Chromium and WebKit: a font declaring 0.60 em whose capitals are really 0.70 was
drawn at 0.60, and a font declaring 1.40 em was drawn at 0.70. The table is the
authority whenever the table is credible, and an impossible declaration is
ignored in favour of measuring the glyphs. Both engines behave identically.

That is the whole reason reading a file works, and the whole reason it needs a
guard. `readFontMetrics` refuses a cap height taller than the em, so
`fitFromFiles` declines rather than producing a stylesheet wrong by thirty pixels
at a display size. It cannot catch the credible lie, and should not: the engine
believes that one too, so a fit built on it is right about the page.

## 1.5.0

Fitting a design to a grid without changing the design.

Everything before this release was remedial. It measured a page that was off the
grid and pushed each block into place, and what came back was a list of absolute
pixel corrections. This release replaces that with arithmetic that does not need
correcting, and the measurement that made it possible was finding out exactly
where the corrections fail.

### Added

**`fitScale(families, options)` and `quoin fit`.** Give it a design's own sizes
and it returns those exact sizes, a leading snapped to whole rows, and the space
before each block that puts it on the grid. A page built from the result is on
the grid at every viewport width with one stylesheet, no media queries and no
corrections, measured at nine widths from 320 to 1440 in Chromium and WebKit.

The arithmetic, for a trimmed box:

```
baseline(B) - baseline(A) = (lines(A) - 1) x leading(A) + space(B) + cap(B)
```

`lines(A)` is the only width-dependent term and it is multiplied by a leading
that is a whole number of rows, so modulo the pitch what remains is
`space(B) + cap(B) = 0`, in which every term belongs to block B alone. Nothing
relates one size to another, which is why the sizes are free.

**A JSON contract, for agents.** `quoin fit --design - --json` reads a design on
stdin and writes the whole result out, including `leadingWas`, `leadingMoved` and
the cap height each figure came from. An agent working from a Figma file or a
screenshot has the same problem a person does and nobody to ask, so everything
the answer rests on is in the output rather than in the prose around it.

**A cap basis for the scale solver**, `basis: "cap"`. The line-box basis rests on
`fontBoundingBox`, which every engine rounds to whole pixels; the cap basis rests
on the font's own `sCapHeight`, which agreed across engines on 130 fonts out of
130 with a worst case of 0.022px where the canvas measurement managed 90. Under
trim the phase also stops depending on the leading, so any solved size works with
any leading that is a whole number of rows.

**`dist/quoin.fit.js`**, a separate bundle for the fitter. It is four kilobytes
and it is a build-time question that happens to need a browser for its metrics,
so it does not belong in the bundle whose whole constraint is being small enough
to paste into a console.

**`inferDesign(options)` and `quoin fit --from <url>`.** Most people have a site
rather than a design file, and the question they want answered is what to change
about the site they have. It walks a rendered page, groups every block of text by
the family, size and leading it actually resolved to, and fits that. Run against
quoin.dev, it read 233 of 236 text blocks into two families and thirteen sizes,
with nothing needing to move. Combinations used fewer than twice are left out and
listed in `rare`, so the long tail of one-off widget sizes is a decision rather
than a silent omission.

### Fixed

**Quoin measured trimmed pages wrongly, in two places.** `text-box-trim` reached
Baseline in August 2026, so pages built on it are arriving now, and both of these
would have got worse rather than better.

`verifyGrid` put the first baseline at half-leading plus ascent, which is right
for an ordinary block and 17.8px too low for a trimmed 32px serif one. That is
more than two rows of an 8px grid, in the same direction, on every block on the
page: a page built correctly would have been reported as almost entirely off the
grid, and the page would have been right.

`verifyRhythm` expected every box to be a whole number of rows. A trimmed box is
deliberately not one, because it ends at its own baseline, so its height is
`(lines - 1) x leading + capHeight` by design. Every block would have been
flagged and the author told to fix a leading that was already correct.

**`makeBaseline` and `compareToBaseline` were documented and not exported.** The
README's API table listed both for a release in which `import { makeBaseline }
from "quoin"` was a `TypeError`. Nothing caught it, because every test imports
from `src/` by path and none of them imported the package the way a reader would.
`test/unit/documented.test.ts` now reads the README's API table, the CLI's
commands and the action's inputs, and fails when the prose and the code disagree.

**A font stack resolved on the whole stack.** `fontIsAvailable("Georgia, serif")`
asks whether a family literally called `Georgia, serif` exists, which nothing is,
so every realistic design came back marked as not having rendered. A warning that
fires on every correct input is a warning people learn to ignore.

### Changed

**The README's account of what corrections can do was wrong**, and the correction
is more useful than the claim. Measured properly, a stylesheet seated at 1280 and
carried to 375 holds at **100%** when only the line breaks have moved, because
`mode: "full"` snaps every leading to whole rows and a page whose leadings are
whole rows reflows in whole rows. It falls to **0%** when a media query changes a
container's padding by thirteen pixels. Corrections survive reflow and do not
survive a layout change, which is a sharper statement than "corrections are
per-layout" and points at exactly what fitting is for.

**The size budget went from 24 kB to 28 kB**, recorded as one raise rather than
the two it actually happened in, because splitting it in the log would make each
look smaller than the change was.

### Findings

**A trimmed single-line block's height is exactly the cap height**, measured at
21.188px against a font table declaring 21.188px in both Chromium and WebKit. A
four-line block at 29px leading came to 98.25px, which is `3 x 29 + 11.25`
exactly. Everything in this release rests on that measurement.

**Sizes do not need to share a phase.** A page set at 44, 27, 17 and 13.5, none
of them solved for anything, sat on the grid at all nine test widths once each
size's space closed its own cap residue. An earlier version of the fitter
enforced a shared phase across families and moved a 17px body to 20.5 and a 15px
mono to 10.5, which is not fitting a design to a grid, it is replacing it.

## 1.4.0

The GitHub Action, rhythm, and an origin that is solved rather than assumed.

1.3.0 could solve a type scale so a page needs no corrections. This release adds
the two things that make the tool usable by a team rather than a person: a gate
that stops a page getting worse, and the other half of the measurement, without
which that gate misses the commonest defect there is.

### Added

**A GitHub Action.** It serves a built directory, measures every page at every
width, compares against a committed `.quoin-baseline.json`, and leaves one pull
request comment, edited in place rather than added to on every push.

```yaml
- uses: hawkbass/quoin@v1
  with:
    urls: /index.html
    directory: ./dist
    widths: "1280,900,375"
```

The gate is a regression rather than a floor. `--min 90` is the obvious CI gate
and it is the wrong primitive: almost no real page is at 90, so the number a team
can set is the number they are already at, and then the gate does nothing until
somebody edits it. The corpus says the median page is at 28%. So the first run
records where you are, and every run after that fails if you go backwards.

The delta is in blocks rather than percent, because a percentage moves when the
page gains a paragraph, and a tool that blocks a pull request over added copy is
a tool that gets removed.

**`verifyRhythm(options)` and `quoin rhythm`.** Whether each box is a whole
number of grid rows tall, and which part of the box is not. Height is border plus
padding plus content, and each is checked separately in the order somebody can
act on. It only blames leading on a box that owns text, because `line-height`
inherits and a wrapper's height is its children's: changing its leading changes
nothing at all, and the first version pointed at a container as the cause of its
own child's fraction. Issues rank by how many blocks they move rather than by how
many pixels, since three pixels at the top of a page moves everything and seven
at the bottom moves nothing.

**`bestOrigin(baselines, grid)` and `origin: "auto"`, now the default.** An
origin of zero asks whether baselines sit on multiples of the pitch from the top
of the document, and a page with a header answers no however carefully it is set,
because everything below the header moved by the same amount. That page is on a
grid whose origin is 3, and measuring it against zero reported nothing on the
grid at all.

**`makeBaseline` and `compareToBaseline`.** The committed record and the
comparison, exported so the Action's behaviour can be reasoned about outside it.

### Changed

**`--origin` accepts `auto` and defaults to it**, for `check`, `seat` and the
Action. `seat` resolves it before anything moves: seating to zero would shift
every block on a page that is merely offset, which is a great deal of correction
to fix one header's border. Pass `--origin 0` for the old strict reading.

**Rhythm is a gate as well as phase.** A hairline border moves every block below
it by one pixel, so the page splits into two phases a pixel apart, and on an 8px
grid with half a pixel of tolerance an origin sitting between those halves is
within tolerance of both. The phase count does not move at all. Gating on phase
alone waved through the exact defect this library was written to find.

**The corpus is 212 sites, not 12**, across design systems, documentation,
editorial, type foundries, studios, products, institutions and universities.
`npm run corpus` writes `findings/corpus.md`.

### Fixed

**The action's static server wrote its 200 header before reading the file**, so a
missing page threw with the headers already sent and the run died inside the
request handler rather than reporting a 404. The same bug was in
`scripts/serve-site.mjs`.

**The absolute floor was skipped on the first run.** Recording a baseline exited
zero before the floor was evaluated, so a repository that set `min: 90` on a page
sitting at 80 got a green build on the one gate it had asked for.

**`bestOrigin` counted candidates with the window rather than with
`checkBaseline`.** A span exactly two tolerances wide sits on a floating-point
boundary where the two disagree, and the solver claimed a block the report then
called off-grid.

### Findings

**Not one site in 212 reaches 90% on an 8px grid.** The best is Fonts In Use at
89.2%. Seven clear 50%. The median is 28.2%.

**The categories are indistinguishable, and that is the finding.** Best to worst
runs 32.0% to 24.4%. Type foundries, whose entire trade is typography, land at
31.3%, which is the same as documentation sites at 30.5%.

**Except in rhythm, where design systems are eight times better than anyone
else**: a median of 29.5% against 3.7% for type foundries and 2.2% for
institutions. That is the largest gap in the study, it is exactly what a design
system is for, and it buys them nothing on phase, where they sit mid-table at
30.8%. Quantising your CSS gives you rhythm, and rhythm is not phase. The whole
argument of this library, measured across 27 design systems.

**Solving for the origin is worth 14.9 points of median**, and far more on
individual sites: The Met reads 0.8% against zero and 48.8% against its own
origin.

**Leading is the commonest rhythm defect on 106 of the 153 sites scored.** A
`line-height` that is a ratio rather than a number of rows. `1.5` on 17px is
25.5px, and every extra line carries the half pixel down the page. It is the
least visible defect available, because `1.5` looks like a decision.

## 1.3.0

Solving instead of correcting.

Everything in this library up to now was remedial: measure a page that is off the
grid, push each block into place, hand back a stylesheet to regenerate whenever
the copy changes. This release adds the constructive answer, and for new work it
makes the corrector unnecessary.

### Added

**`gridNativeScale(font, options)` and `quoin scale`.** A block's phase is
`L/2 + S(A - D)/2`, with `A` and `D` the font's per-em ascent and descent. If
every size-and-leading pair on a page produces the same phase, one grid origin
seats the whole page and there is nothing left to correct.

```
npx quoin scale --font "EB Garamond" --sizes 16,28,44

  8px grid, shared phase 2.5px, solved sizes about 11.27px apart
  16px   17.5px / 24px   ratio 1.37   +1.5
  28px   28.5px / 48px   ratio 1.68   +0.5
  44px   42px   / 56px   ratio 1.33   -2
```

`test/browser/scale.spec.ts` builds a page out of a solved scale and asserts the
seater finds nothing to do. It finds nothing to do.

**The cost is real and it is reported.** Solved sizes sit `pitch / (A - D)`
apart, 11 to 12px for a text face on an 8px grid, so two targets closer together
than that cannot both be met. Ask for 16 and 20 and it gives you one and names
the other as missed. The first version of the solver answered 17px and 17.5px,
which satisfies both and is one step and a rounding error.

**`GridScale.resolved`.** A scale solved against a font that did not render
describes a typeface nobody will set in, and the obvious check does not work.
Solving for Inter on a page that never loaded it produced numbers identical to
Times New Roman, down to the last step. It now probes widths against two
different fallbacks, and the emitted CSS warns rather than quietly lying.

### Fixed

**`FontMetrics.font` was documented as "the shorthand the browser resolved".**
It is not. `ctx.font` returns the specified value, normalised: request a font
nobody has installed and it hands the name straight back while measuring
something else. The doc comment now says so and points at `fontIsAvailable`.

**`ScaleOptions.tolerance` meant two things.** The interface extends `GridConfig`,
which already has a `tolerance` meaning how far a baseline may drift. Passing 4
as a scale window threw a range error about the grid. Renamed to `near`.

**The spacing figure was quantised by rounding.** Taken at 48px, where
`fontBoundingBox` is rounded to whole pixels, six different typefaces reported an
identical 11.64px. Taken at 400px they differ: Georgia 11.47, Arial 11.55,
JetBrains Mono 11.11.


## 1.2.0

quoin.dev, and three things building it found in the tool.

### Fixed

**It was seating inline boxes.** An inline box has no baseline of its own: it
sits on the line box its parent laid out, which is where every `strong`, `em`,
`code`, `a` and `span` in a sentence lives. Counting one counted the parent's
line twice, and seating one moved those words off the line the rest of the
sentence was on. Visible on the first build of quoin.dev, where a version number
in a span was pushed seven pixels below the words either side of it, by the
tool, on the tool's own homepage. The walk now skips inline-level elements.

**`checkExport` verified the mechanism and not the outcome.** It confirmed every
rule matched exactly one element and every computed value equalled what was
asked for, returned `clean: true`, and the page it was describing sat at 69%.
Something above the corrections had changed height by a pixel, so the right
values were applied in the wrong place. It now measures the grid with the
stylesheet applied and reports `onGrid`, `total` and `seats`.

Checking that a correction was made rather than that it worked is the exact
failure this library exists to argue against, and it was in the library.

**`SeatResult` now carries the selectors it ignored**, so the check measures the
same page the seating measured rather than reporting a denominator that never
matches.

### Added

- **The site**, at `site/`, built with `npm run build:site`. The last step of
  that build points Quoin at the page and writes the corrections to
  `baseline.css`, once per breakpoint. The build fails below 95% at any
  breakpoint, so the page cannot quietly stop being on the grid.

### Two things the site taught the tool

**Every hairline is a pixel in the flow.** Six section borders plus seventeen
table rows at 32+1 is twenty-three pixels of accumulated offset, and everything
below drifts by exactly that. Subtracting each border from its own padding keeps
a bordered box a whole number of grid rows. The same cause the corpus survey
found on craighawkes.dev, met from the other side.

**A correction is an absolute number of pixels for one layout.** Seated at one
width and shipped, the site measured 100% at 1280 and 79% at 820. Seated once
per breakpoint it holds at every width above 1040px, where its layout stops
reflowing, and degrades between breakpoints below that. More breakpoints narrow
the gaps and never close them. Static corrections for a layout that has settled;
the script for one that has not.


## 1.1.0

A browser extension, and the reason it is an extension rather than a website.

### Added

- **A Manifest V3 extension** for Chromium and Firefox. It measures the page you
  are on, draws the grid over it, seats it, and hands back the verified
  stylesheet. `npm run build:extension`, then load `./dist-extension` unpacked.

  It reports what it could not reach as plainly as what it could: closed shadow
  roots, frames and transformed subtrees are named rather than dropped out of the
  denominator. The panel also sweeps for the page's own best origin, because a
  page can be perfectly rhythmic and score nought against an origin of zero,
  which is a true reading and a useless one.

- **`activeTab` rather than host permissions.** The install prompt says "read
  your data on the site you are on" instead of "on all websites". The cost is
  that the grant comes from a toolbar click, which nothing can automate, so the
  test suite builds a second copy scoped to `127.0.0.1` and differing by that one
  line.

- **Eight tests that load the built extension into a real browser** and click the
  buttons. An extension is four files that only run together in a context no unit
  test reaches, so every defect in one lives where nothing else looks.

### Why an extension and not a hosted playground

A page's Content-Security-Policy governs script tags injected from outside, and a
hosted "paste your URL" service has no other way in. Measured:

| | Stripe | GitHub | Klim | Linear |
|---|---|---|---|---|
| `<script>` tag, which a hosted service must use | no | no | yes | yes |
| `chrome.scripting`, which the extension uses | yes | yes | yes | yes |

The two most famous URLs anyone would paste are the two it could not measure.

### Fixed

- **The grid button wrote its label into its own icon.** `firstChild.nextSibling`
  found the swatch `<span>`, so toggling replaced the icon with text and left the
  original label behind it, overlapping. Labels now have their own element.
- **The score panel was revealed before it was filled**, so it showed a blank
  readout for a frame, which reads as a hang on a page with a few thousand text
  nodes. Filled first, revealed last.
- **A fully seated page was described as "orderly"**, which is the message for a
  page with few distinct drifts and is nonsense when there are none because
  everything is on the grid. It now says so.


## 1.0.0

First release as a standalone package. Extracted from the site it was built in,
where it had lived as an internal tool for four months.

The extraction was not a move. Publishing meant every claim in the README had to
be re-derived from the code rather than from memory of writing it, and three of
them did not survive.

### Fixed

**The exported CSS did nothing.** `exportCss()` keyed every rule on
`[data-quoin-seat="7"]`, an attribute the script writes at runtime, while the
documentation told you to export the stylesheet, paste it in and delete the
script. Do that and no element carries the attribute, so every rule matched
nothing. The export now builds a real selector per element and verifies each one
against the document before writing it, the same way the seater verifies its own
corrections. Blocks with no unique selector are counted in
`SeatResult.unexportable` and named in a comment rather than emitted as a rule
that matches something else.

The test that covered this asserted the output string contained `padding-top`.
It did. The replacement seats the page, exports, undoes everything, injects the
stylesheet alone and re-measures.

**Font size was read with `parseFloat`.** On a shorthand like
`normal 700 18px Satoshi` that returns `NaN`, and on `700 18px Satoshi` it
returns **700**. `FontMetrics.fontSize` was therefore wrong for every non-default
weight and silently fell back to 16 for the shape this library builds internally.
Replaced with a parser that matches the size's position in the shorthand grammar,
converts absolute units, and returns `null` rather than guessing at `em` or `%`.
Callers that know the computed size now pass it in.

**The CSS export index could desynchronise from the DOM.** `exportCss()` used the
array position of each block while the DOM carried a counter incremented during
the sweep. A node whose height changed between passes shifted every subsequent
index. Moot now that the export uses selectors, and worth recording.

**`contain: size` on the cap-height probe.** Size containment makes a box's
dimensions independent of its contents, which is exactly the height being
measured, so the probe reported "unsupported" in every engine including the two
that support it.

**The verified export escalated nothing.** A NUL byte got into a template
literal during an automated edit, so the key `${selector} ${property}` was built
with a NUL where the space should be while the lookup used a space. Nothing
matched, no declaration was escalated, and the function reported nine
escalations because it counted what it intended rather than what it did, which
is the exact failure this repository exists to argue against. Git flagged the
file as binary, which is the only reason it surfaced. `npm run encoding:check`
now fails the build on a NUL byte in any text file.

### Added

- **`exportCssVerified()` and `checkExport()`.** The seater has always
  re-measured its own corrections. The export did not, and on Material Design 3
  that cost the whole page: 123 of 123 blocks seated with the script, 18 of 123
  with the stylesheet. Every rule matched exactly one element and no padding
  declaration was overruled; nine `line-height` declarations lost the cascade to
  Angular's own `.title[_ngcontent-hfd-c28] .description[_ngcontent-hfd-c28]`,
  which carries four components of specificity against the two a class selector
  offers. Nine of 106 rules cost 105 of 123 blocks, because a block whose
  leading stays 2px short moves everything below it up by 2px. `exportCssVerified`
  applies the sheet, measures every declaration, adds `!important` to exactly the
  ones measured to have lost, and checks again. Material Design 3 now round-trips
  at 100%.
- **The round trip against five live design systems**, `npm run wild`. Fixtures
  prove the seater handles the cases it was built for, which is also grading your
  own homework. After the escalation fix: GOV.UK 100%, Polaris 100%, Tailwind
  99%, Material Design 3 100%, Ant Design 98%.
- **A test suite.** 43 unit tests over the arithmetic, run in Node with no
  browser, including swept property tests: that a seating shift never moves text
  upward, never exceeds one pitch, and always lands the baseline on the grid,
  checked across every sub-pixel drift in a whole grid row. The README had
  claimed these existed for four months.
- **57 browser tests** across Chromium, Firefox and WebKit, against fixtures that
  reproduce the cases the seater exists for rather than against a live site.
- **`capHeightFromFontTable()`**, a cap height that travels between engines. See
  the finding below.
- **A command line.** `npx quoin check <url>`, `seat`, `engine`. `--min` exits
  non-zero below a floor, so it works as a CI gate on any URL.
- **`gridConfig()` validation.** A pitch of zero divided by zero and reported
  every baseline as perfect. A tolerance of half the pitch put every possible
  baseline within tolerance of something. Both now throw.
- **Transform detection.** `getBoundingClientRect` reports the transformed box
  while `line-height` stays in untransformed px. Those nodes are now excluded and
  counted in `skippedTransformed` rather than folded into a percentage they
  cannot be part of.
- **`GridReport.distinctDrifts`**, promoted from a derived figure to a reported
  field. It is the one to read first.
- **Vertical writing modes** are skipped rather than measured against a
  horizontal grid.
- **A size budget** on the single-file build, and a check that it still has no
  dependencies.


### Fixed, second pass

The first pass at this release stopped at the point where the fixtures were
green. Pointing it at real pages found three more, and the pattern in all three
is the same: a claim the tool made about itself that nothing checked.

**The walk could not see shadow roots.** A `TreeWalker` does not cross a shadow
boundary. On a page built out of web components almost all the text is on the
other side of one, and the tool found none of it, seated none of it, and reported
the page 100% on the grid. Silent and flattering, which is precisely what
`gridConfig` validation exists to prevent elsewhere in this library. The walk was
rewritten as a recursive descent that enters open roots; closed ones and frames
are counted and reported rather than dropped out of the denominator.

Blocks inside a shadow root are seated at runtime and reported as uncarryable by
CSS, because a document stylesheet does not reach in: `::part()` exposes only
what the component chose to expose, and the piercing combinator was removed from
the platform years ago. `uniqueSelector()` returns null for them and they are
counted in `SeatResult.inShadow`.

**The sweep could exhaust its passes silently.** If the page was still moving on
the last of `maxPasses` sweeps, the result described a layout the page was
passing through rather than one it settled on, and nothing said so.
`SeatResult.exhausted` now does.

**`measureFontWithCap` took a line-height and ignored it.** The trim-both probe
gives the same answer at every leading, which is a result rather than an
omission, so the parameter went.

### Added, second pass

- **75 more browser tests**, taking the suite to 132 across three engines. The
  new ones cover the walk, shadow roots, frames, the selector builder, the
  verified export, and the CLI, which is a shipped binary that had none at all.
- **A torture fixture**: shadow roots, a frame, multi-column, drop capitals, a
  table, right-to-left text, a vertical writing mode, `display: contents`,
  `content-visibility: auto`, a scroll container, fourteen levels of nesting and
  three hundred generated paragraphs. It seats 334 of 334 in two sweeps, in 75ms,
  with no page errors and nothing malformed in the output.
- **A specificity fixture** reproducing the Material Design 3 cascade defeat, so
  the case is covered by CI rather than by remembering to run a script against
  somebody else's deploy. Building it corrected an assumption: `!important` in
  the page is not on its own enough to beat an escalated rule, because `p.locked`
  carries more specificity than `.locked` and at equal importance specificity
  still decides. Genuinely unbeatable needs both.
- **Firefox 154 in the cap-height study.** Playwright bundles Firefox 153, one
  release short of `text-box-trim`, so the study could only ever have reported
  "Firefox: unsupported" and would have been describing Playwright rather than
  Firefox. The suite now drives the machine's own Firefox over WebDriver BiDi
  where one is new enough, and says in its output when it could not. That turns
  the headline finding from a two-engine result plus an inference into a
  three-engine measurement: 124 of 124 rows agreeing within 0.5px, worst spread
  0.022px, against 85 of 124 and 0.864px for the canvas route.
- **`npm run wild`**: the round trip against five live design systems. GOV.UK
  100%, Polaris 100%, Tailwind 99%, Material Design 3 100%, Ant Design 98%.
- **An encoding gate**, after a NUL byte in a template literal made a function
  report nine escalations and perform zero.


### Findings, from CI

Making the repository public let the Actions run for the first time, and they
found two tests asserting properties of the machine they were written on. Both
had one cause, and it is a better finding than the bug.

**Chromium rounds advance widths to whole pixels on Linux.** Measuring a
fifteen-glyph probe across 24 webfonts at five sizes on the Ubuntu runner:
Chromium 130 readings of 130 landing on a whole pixel, Firefox 9 of 130, WebKit 8
of 130. The same hinting behaviour this project measures in cap heights, in the
other axis, and absent from Chromium on Windows where subpixel text positioning
is on.

The studies had been using advance width to check whether the same font had
loaded in every engine, so a correctly loaded font looked like a substitution and
95 of 130 rows were discarded.

**And metric-compatible substitutes defeat the check from the other side.**
Liberation Sans is built to reproduce Arial's advance widths exactly, so on a
machine without Arial the widths agree perfectly and the vertical metrics do not.
That is why the cross-engine study reported `fontBoundingBox` disagreeing on
Arial, Times and `system-ui` and blamed the engines for it.

Font identity is now fingerprinted on `fontBoundingBox` ascent and descent: off
the font's own tables, unhinted, and independent of the cap height being
measured. On Windows that also recovers Inter and Merriweather, whose widths
differ because WebKit picks a different optical size and whose vertical metrics do
not. 124 comparable rows became 130.

The general lesson is not about fonts. **A validity check that shares a failure
mode with the thing under test will quietly delete the evidence.** This one used
hinted measurements to decide which unhinted measurements to trust.

The cross-engine study no longer gates on system font stacks at all. A system
stack is a request rather than a font, and asserting engine agreement over one
asserts a property of whatever the machine happens to have installed. The
portability claim lives with the 24 webfonts, where identical bytes make "the
same font" a property of the setup rather than an inference.

### Changed, second pass

- The single-file budget went from 16 kB to 20 kB, and it is worth recording that
  it was raised rather than met. Crossing shadow boundaries cost 2.7 kB and bought
  the difference between measuring a component-built page and lying about one.

### Findings

**Cap height travels now, and it did not before.** `text-box-trim` reached its
third engine in August 2026 with Firefox 154. Measured over 24 webfonts at five
sizes in three engines: cap height via `text-box-edge: cap` agrees across engines
on 124 of 124 rows, worst spread 0.016px, against 85 of 124 and 0.864px for
canvas `actualBoundingBoxAscent`.

Establishing *why* needed a font that lies. Every real font sets `sCapHeight` to
the height of its own capital H, so "reads the table" and "measures the glyph"
predict the same number for all 21 real fonts in the corpus and no quantity of
further real fonts would separate them. A manufactured Space Mono declaring 600
where its H is 700 reports the declared value in both engines. They read the
table.

It has to be `trim-both`. Trimming only the start edge leaves the bottom
half-leading in the box, and the engines split leading differently: half a pixel
apart on the same Georgia at the same size.

**The original divergence was hinting, not the font.** Chromium and WebKit's
canvas reports the rasterised glyph, which lands on whole pixels 49 times out of
49. Firefox's reports the scaled outline, which never does. `text-box-edge: cap`
routes around the rasteriser, and what Chromium and WebKit then report matches
what Firefox's canvas was reporting all along.

**`fontBoundingBox` agreed exactly wherever the engines resolved the same
typeface.** It disagreed on two rows, `monospace` and `system-ui`, which are the
two rows where they resolved different typefaces. The test now measures font
identity by width signature rather than trusting the family name, because
`ctx.font` reads back the family you asked for and not the one the engine found.

**WebKit does not apply automatic optical sizing.** Inter at 48px with
`font-optical-sizing: auto` is 483.59px wide across a thirty-glyph probe in
WebKit against 460.88px in Chromium and Firefox. With `none` all three agree to
0.03px. A variable font with an `opsz` axis is a different instance in WebKit at
display sizes. This surfaced as two fonts failing a validity check, which is
worth recording: the excluded pile is where the unexpected result was.

### Changed

- `capOvershoot` now documents which of its two sources it came from, via
  `FontMetrics.capSource`.
- The corpus study excludes transformed nodes, so its figures are not comparable
  with those published before this release. Re-run rather than reconciled.
