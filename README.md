# Quoin

**It puts a web page on a baseline grid.**

A quoin is the wedge a printer hammers into the chase to lock the type so
nothing shifts on the press. Same job.

```js
quoin.check()   // how much of this page is off the grid
quoin.seat()    // put it on. Call again to lift it back off.
quoin.css()     // the corrections as a stylesheet you can ship
```

[![ci](https://github.com/hawkbass/quoin/actions/workflows/ci.yml/badge.svg)](https://github.com/hawkbass/quoin/actions/workflows/ci.yml)

MIT. No dependencies. 26 kB.

---

## The problem

Set a line of text in a button. Centre it vertically. It is sitting slightly
high, and no amount of padding will fix it, because the thing you centred is not
the thing you are looking at.

Every font reserves a band of empty space above its capitals and another below
its baseline for descenders, and those two bands are almost never the same size.
The browser measures the font's box, subtracts it from the line height, and
splits what is left equally. So it centres the **box** perfectly. The **letters**
inside that box were never centred.

Print solved this with the baseline grid: one invisible ruler down the page, and
every line of text in every column seated on it. It has existed since metal type
and it is a checkbox in InDesign.

The web has never had one, because `line-height` centres text in its box rather
than seating it on a line, so the baseline lands wherever a particular typeface's
asymmetry puts it. There is no number you can write down once.

---

## What already exists

Plenty, and it is worth being precise about it, because the interesting claim is
not "nothing does this" but "everything does the other half".

Seating text needs **rhythm**, where every vertical distance is a whole number of
grid rows, and **phase**, where the first baseline inside each box lands on one.
Almost all the prior art is rhythm.

| | |
|---|---|
| [Capsize](https://seek-oss.github.io/capsize/) | Computes the trim for **one element** from metrics you supply. Excellent, and per-element by design. |
| [`text-box-trim`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-trim) | Does the same in CSS, natively. Chrome 133, Safari 18.2, **Firefox 154**, so Baseline since August 2026. Per-element. |
| [baselinegrid.scss](https://github.com/jeromev/baselinegrid.scss) | The strongest thing in the category, actively maintained. Snaps line boxes to the grid through SCSS mixins, and offers an **opt-in** font-metric nudge from **hand-entered per-font presets** (three shipped). Its own README draws exactly this rhythm/phase distinction. |
| [postcss-baseline-vertical-rhythm](https://www.npmjs.com/package/postcss-baseline-vertical-rhythm) | Sets padding from font metrics at build time. Self-described alpha, metrics for Arial and Times New Roman, last published 2022. |
| Sassline, Gutenberg, `postcss-baseline-grid-overlay` | Rhythm, overlays, calculators. All good. All rhythm. |
| [Arrhythmia](https://github.com/mattbaker/Arrhythmia) | Checks a rendered page, and checks **box edges** against line-height multiples rather than baselines. jQuery, self-described proof-of-concept. |

Every one of those needs one of two things: that you author your CSS through it,
or that you hand it the metrics for each font. That is a reasonable price and it
rules out the case this exists for.

**What is left.** Correcting **phase**, across **a whole page**, using the
metrics of **the font the browser actually resolved**, on **a page you did not
author**, and **checking that each correction moved what it was supposed to
move**. That combination is what `quoin.seat()` is, and it is why the survey
further down could be run against nine design systems belonging to other people.

And correcting a page is not correcting many elements, which is the second half
of the argument.

**Correcting a block moves every block below it.** So the corrections cannot be
computed in a batch and then applied. Each block has to be measured after the
ones above it are already corrected. Compute-then-apply gives you a perfect first
paragraph and a page that is worse than when you started.

**Correcting a block can move blocks above it too.** In a flex row under
`align-items: flex-end`, making any item taller grows the line's cross size and
shifts every end-aligned sibling. Seating the third item lifted two already
seated ones back off, which cost 17 blocks on one homepage before it was caught.
So it sweeps until nothing moves.

---

## Correcting

```ts
import { seatPage, exportCssVerified } from "quoin"

const seated = seatPage({
  pitch: 8,
  ignore: [".display"],   // headlines are shapes, not lines of reading
  mode: "full",           // also snap leading, so line two lands as well as line one
})

console.log(`${seated.passes} sweeps, ${seated.missed} could not be moved`)

// Applies the sheet, measures every declaration, escalates only what lost.
// Undoes the seating, because that is the only state it can be tested in.
const { css, check } = exportCssVerified(seated)
console.log(css)
if (!check.clean) console.log(`${check.lost.length} declarations the page overrules`)
```

### Two levers, and it picks by measuring

`padding-top` is the one you want, because it moves the text **and** pushes
everything below it down, so the column keeps its rhythm.

It does not always work. Padding lives inside the box, and plenty of boxes are
positioned by something other than their own size. A flex child under
`align-items: center` grows when you pad it and the container re-centres the
bigger box, so the text moves half as far as you asked. Under `flex-end` it does
not move at all. An inline box ignores vertical padding for layout entirely.

So it applies the padding, **measures again**, and if the text did not land where
it was sent, reverts and uses a relative offset instead: moving what is drawn
rather than what is laid out. If neither lever works the block is reported as
`lever: "none"` rather than quietly counted as fixed.

That check is the difference between a tool and a demo. A corrector that trusts
its own corrections is the verifier with extra steps.

### The exported CSS has to survive the script being deleted

This is worth its own heading because it was wrong for four months.

The export used to key every rule on `[data-quoin-seat="7"]`, an attribute the
script stamps onto the DOM at runtime. The instruction was: export the
stylesheet, paste it in, delete the script. Do that and nothing on the page
carries the attribute, so every rule matches nothing, and the page is exactly as
crooked as it started. The test covering it asserted that the output contained
`padding-top` declarations. It did. It passed.

It now builds a real selector for each corrected element and **verifies each one
against the document** before writing it out. Blocks it cannot address uniquely
are counted in `result.unexportable` and named in a comment at the top of the
stylesheet, rather than emitted as a rule that matches something else.

### And the export has to be checked too, which took a real page to find out

Fixtures prove the seater handles the cases it was built to handle, which is
necessary and is also grading your own homework. So the round trip was run
against five design system homepages: seat, export, undo everything, inject the
stylesheet on its own, measure again.

Four of the five reproduced the seating. Material Design 3 went from 123 of 123
with the script to **18 of 123** with the stylesheet.

Every rule matched. Every rule matched exactly one element. No padding
declaration was overruled. **Nine `line-height` declarations lost the cascade**,
to a rule of the page's own with higher specificity: Angular emits
`.title[_ngcontent-hfd-c28] .description[_ngcontent-hfd-c28]`, four components of
specificity against the two a class-based selector can offer.

Nine of 106 rules costing 105 of 123 blocks is not a rounding error, and the
reason is the constraint that makes seating a page hard in the first place. A
block whose leading stays 2px short is 2px short, so everything below it moves up
by 2px. One overruled declaration near the top of a document desynchronises every
block after it. The corrections are a chain and the stylesheet applies them all
at once.

So `exportCssVerified()` applies the sheet, measures every declaration against
what was asked for, adds `!important` to **exactly** the ones measured to have
lost, and checks again:

| | Before | Seated | Stylesheet alone | Escalated | Still lost |
|---|---|---|---|---|---|
| GOV.UK Design System | 16% | 100% | **100%** | 0 | 0 |
| Shopify Polaris | 29% | 100% | **100%** | 1 | 0 |
| Tailwind CSS | 12% | 100% | **99%** | 0 | 0 |
| Material Design 3 | 17% | 100% | **100%** | 9 | 0 |
| Ant Design | 21% | 98% | **98%** | 5 | 5 |

`npm run wild` reproduces it. Raw output in `findings/wild.json`.

`!important` is a blunt instrument and it is applied here with a scalpel: only
where a measurement showed the declaration lost, never pre-emptively. On the
three pages where nothing lost, the output is byte-for-byte what `exportCss`
produces.

It does not always win, and it says so. A rule that is both `!important` **and**
more specific than anything the export can generate cannot be beaten, and those
are reported in `check.lost` rather than counted as corrected.

### What it costs

An honest baseline grid quantises your leading and the space between your blocks.
`mode: "full"` snaps `line-height` up to a multiple of the pitch, because a
block's second line sits one line-height below its first, and if that distance is
not a whole number of grid rows then line one is seated and line five has drifted
visibly.

This is exactly what InDesign does when you tick "align to baseline grid", and it
is why that checkbox changes your leading when you turn it on. It is a trade print
made deliberately. `mode: "first-line"` skips it if you would rather keep your
type scale and accept internal drift.

### Do not ship the JavaScript

`exportCss()` exists because correcting layout at runtime means the reader watches
the text jump into place after first paint. Measure in the browser during
development, export the stylesheet, paste it in, delete the script. The browser is
where the font metrics live, so that is where the measuring has to happen. It is
not where the fix has to ship.

---

## What it can see, and what it says it cannot

A measuring tool that skips a region and does not mention it reports a number
worse than no number. Three regions are genuinely hard, and each is handled
rather than ignored.

**Shadow roots are walked.** A `TreeWalker` does not cross a shadow boundary, and
the first version of this used one. On the torture fixture it found 332 blocks,
seated all 332, and called the page 100% correct while two paragraphs inside an
open shadow root sat off the grid, unmeasured and unmentioned. The walk now
descends into open roots. Closed ones are counted in `closedShadowRoots`, because
there is no way in from outside and the text is still there.

A block inside a shadow root can be **seated at runtime** and **cannot be carried
by an exported stylesheet**: a document stylesheet does not reach in, `::part()`
exposes only what the component chose to expose, and the piercing combinator was
removed from the platform years ago. So `uniqueSelector()` returns null for them
and they are counted separately in `result.inShadow`. The fix belongs inside the
component.

**Frames are counted, not walked.** A frame's content is a different document
with its own layout origin, so a grid measured out here does not describe it.
Point the tool at the frame's own URL.

**Nodes under a transform are excluded and counted.** `getBoundingClientRect`
reports the transformed box while `line-height` stays in untransformed px, so the
two are in different coordinate spaces and a drift computed from them is not a
drift. Reported in `skippedTransformed`. Pass `includeTransformed: true` if you
want them anyway.

**Vertical writing modes are skipped.** They have a baseline and it runs the
other way. A horizontal grid has nothing to say about it.

---

## Solving instead of correcting

Everything above is remedial. It measures a page that is off the grid and pushes
each block into place, which works and leaves you regenerating a stylesheet every
time the copy changes.

There is a constructive answer, and for new work it makes the corrector
unnecessary.

A block's phase, meaning where its first baseline sits inside its own line box, is

```
phase(S, L) = (L - (ascent + descent)) / 2 + ascent
            = L/2 + S(A - D)/2
```

with `A` and `D` the font's per-em ascent and descent. **If every size-and-leading
pair on a page produces the same phase, one grid origin seats the whole page and
there is nothing left to correct.** The phase is identical, so the correction
would be identical, so it folds into where the grid starts.

```bash
npx quoin scale --font "EB Garamond" --sizes 16,28,44
```

```
  EB Garamond
  8px grid, shared phase 2.5px, solved sizes about 11.27px apart

  wanted    size      leading   ratio   rows   off by
  16px      17.5px    24px      1.37    3      +1.5
  28px      28.5px    48px      1.68    6      +0.5
  44px      42px      56px      1.33    7      -2
```

Set those, keep every vertical distance a whole number of rows, put the grid
origin at 2.5px, and the page is on the grid with **no per-element rules at
all**. `test/browser/scale.spec.ts` builds a page from a solved scale and asserts
the seater finds nothing to do.

### What it costs, and it is a real cost

Solved sizes are spaced `pitch / (A − D)` apart, which is 11 to 12px for a text
face on an 8px grid. You take the nearest solved size rather than the round
number you had in mind, and **two targets closer together than that spacing
cannot both be met**. Ask for 16 and 20 and it gives you one and says why:

```
  no solved size within 3px of: 20
```

Refusing is the point. The first version of the solver answered 17px and 17.5px,
which satisfies both requests and is one step and a rounding error.

The spacing is a property of the typeface, so it differs:

| | spacing | phase | a solved scale |
|---|---|---|---|
| Georgia | 11.47px | 2.0px | 17 / 28 / 40.5 |
| Arial | 11.55px | 2.0px | 16.5 / 28.5 / 41 |
| Times New Roman | 11.90px | 1.5px | 16 / 28 / 40.5 |
| EB Garamond | 11.27px | 2.5px | 17.5 / 28.5 / 42 |
| JetBrains Mono | 11.11px | 2.5px | 17.5 / 28 / 40.5 |

This is the trade print has always made. It is why the checkbox in InDesign
changes your leading when you tick it.

### It checks the font actually loaded

A scale solved against a font that did not render describes a typeface nobody is
going to set in, and the obvious check does not work: `ctx.font` reads back the
family you **asked for**, so a font nobody has installed hands its own name
straight back while the measurement comes off the fallback.

Solving for Inter on a page that never loaded it produced numbers identical to
Times New Roman, down to the last step, with the shorthand saying "Inter"
throughout. `GridScale.resolved` now settles it by probing widths against two
different fallbacks, and the emitted CSS carries a warning rather than quietly
lying.

---

## Finding: you cannot do this in CSS instead

Worth knowing before you reach for any of it.

Quantising your CSS gives you rhythm exactly. Fix the spacing scale to pitch
multiples and snap the leading, which `round()` does in one line per token
because it *is* `snapLineHeight`:

```css
--leading-relaxed: round(up, calc(1.7 * 1em), var(--pitch));
```

It gives you nothing for phase. Phase is half-leading plus ascent, and ascent
belongs to the typeface at its rendered size, so every font-and-size pair starts
at its own offset. Quantising everything moved one homepage from 13 of 232 on
grid to 46 of 233 and stopped. Sweeping the grid origin across every sub-pixel
position peaked at **29%**: there is no single offset to find, because there is
no single phase.

**So: CSS for the rhythm, this for the phase.**

---

## Finding: cap height travels now, and it did not before

`text-box-trim` reached its third engine in August 2026. That changes the answer
to a question this tool had previously answered "no".

**Reproduce:** `npm run fonts && npx playwright test test/browser/cap-height.spec.ts`.
Raw output in `findings/cap-height.json`.

### The method, because the method is most of it

The corpus is **24 fonts loaded as webfonts**, which is the only way to hold the
font still. Measuring `serif` or `system-ui` across engines measures font
substitution: a generic keyword is a promise that something will be found, not a
statement about what. On this machine Chromium's `monospace` and WebKit's differ
by 27px across thirty glyphs. They are not disagreeing about a measurement, they
are measuring different objects.

Twenty-one are real, chosen for metric variety rather than for looking nice: 1000,
2000 and 2048 units per em, OS/2 versions 3 and 4, static and variable, Latin,
CJK, Arabic, Devanagari and Thai, an all-caps face, a script face, and Anton,
whose capitals are 86% of its em box.

Three are manufactured, and one of those settles the whole thing.

### The deciding case had to be built

Every real font in the corpus sets `sCapHeight` to the height of its own capital
H. So "the engine reads the declared metric" and "the engine measures the drawn
glyph" predict the **same number for all 21 of them**, and no quantity of
additional real fonts would separate the two. Scale does not disambiguate
hypotheses the data cannot distinguish.

So: a copy of Space Mono declaring `sCapHeight: 600` where its own H is 700. A
plausible number, well inside the em box, and simply not what the letters do.
Same again on Lato, 1433 down to 1200, on a different units-per-em.

At 18px all three engines report the declared value:

| | declares | Chromium | Firefox 154 | WebKit | the actual glyph |
|---|---|---|---|---|---|
| AwkwardLies | 10.8 | 10.797 | 10.800 | 10.797 | 12.6 |
| AwkwardLiesLato | 10.8 | 10.797 | 10.800 | 10.797 | 12.9 |

They read the table.

The other two manufactured fonts take the metric away instead: OS/2 dropped to
version 1 so the field does not exist, and `sCapHeight` set to 0. A third
declares 1400 on a 1000-unit em, which is taller than the em box. All three
engines fall back to the outline in every case, and agree with each other on the
fallback to within 0.016px.

### The result

Over 130 comparable font-and-size rows, at 12, 16, 18, 24 and 48px, in three
engines:

| | agree within 0.5px | worst spread |
|---|---|---|
| Cap height via `text-box-edge: cap` | **130 / 130** | **0.022px** |
| Cap height via canvas `actualBoundingBoxAscent` | 90 / 130 | 0.864px |

0.022px is under 1/32 of a pixel, which is layout-unit quantisation rather than
disagreement. And where the font declares a usable `sCapHeight`, all 115 rows
match `sCapHeight / unitsPerEm × size` to within **0.02px**, computed in Node
straight out of the binary with no browser involved.

The same suite on a Linux CI runner, where Playwright's bundled Firefox predates
`text-box-trim` so the font-table column is Chromium and WebKit only: 111 of 111
within 0.5px, worst spread 0.016px, against 87 of 111 and **2px** for the canvas
route. The gap between the two routes is wider there, not narrower. Agreeing with each other
would only prove the engines are consistent. Agreeing with the file proves they
are reading it.

### It has to be `trim-both`, and that is the subtlety

Trimming only the **start** edge leaves the bottom half-leading in the box, and
the engines do not split leading identically. Same Georgia, same size, line-height
28px: Chromium's start-trimmed box is 20.469px and WebKit's is 19.969px. Half a
pixel apart, and the half pixel is the leading split rather than the font.

Trim **both** edges to `cap alphabetic` and what is left is exactly baseline to
cap height. They agree to 12.46875, at every line-height from 26.5px to 40px.
Which also means the answer does not depend on line-height at all, so
`capHeightFromFontTable()` takes only a font.

### What this means for the old finding

The original divergence was never about the font. It was about hinting.

Chromium and WebKit's canvas reports the glyph **rasterised** onto the pixel grid,
which is why it lands on whole pixels 49 times out of 49. Firefox's reports the
**scaled outline**, which never does. `text-box-edge: cap` routes around the
rasteriser, and the value Chromium and WebKit then report matches what Firefox's
canvas was reporting all along, to within 0.02px on all 21 real fonts.

They coincide because real fonts declare what they draw. They come apart on a
font that lies, which is why one had to be built to find out.

**In practice.** Use `measureFontWithCap()` and read `capSource`. On
`"font-table"` the number travels. On `"raster"` it belongs to the browser that
produced it: compute and apply in the same browser, never ship the number.

*Two caveats, because they matter. Playwright's WebKit is not Safari: same engine,
without Apple's font stack or CoreText rasterisation, so this is good evidence
about the engine and weak evidence about the browser. And Playwright bundles
Firefox 153, one release short of `text-box-trim`, so the suite drives the
machine's own Firefox over WebDriver BiDi where one is installed and says in its
output when it could not.*

---

## Finding: `fontBoundingBox` travels, and the exceptions are not exceptions

The corrections rest on an assumption: that the measurement gives the same answer
everywhere. If it does not, a grid computed in Chrome is wrong in Firefox and the
whole thing is decoration.

Across Chromium, Firefox and WebKit, `fontBoundingBoxAscent` and
`fontBoundingBoxDescent` agreed **exactly, in every case where the three engines
resolved the same typeface**. Five of five.

It disagreed on two rows, by a whole pixel each: `monospace` and `system-ui`.
Those are the two rows where the engines resolved **different typefaces**, and
the width of thirty glyphs says so: 27.16px and 14.14px apart, against 0.04px for
every font that matched. The test computes that width signature rather than
taking the family name on trust, because `ctx.font` reads back the family you
asked for and not the one the engine found.

`system-ui` is a promise, not a typeface. So, it turns out, is `monospace`.

The maths the seater uses is portable. That was the result I did not expect to
get.

---

## Finding: WebKit does not apply automatic optical sizing

Fell out of the corpus study as two fonts that kept failing a validity check, and
they turned out to be the only two in the corpus with an `opsz` axis.

Advance width of a thirty-glyph probe at 48px, `font-optical-sizing: auto`, which
is the default:

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Inter | 460.88 | 460.88 | **483.59** |
| Merriweather | 489.17 | 489.12 | **497.98** |

Set `font-optical-sizing: none` and all three agree to 0.03px. At 12px there is
no divergence at all, because the default optical size sits near there.

So a variable font with an `opsz` axis is a **different instance** in WebKit at
display sizes, which means different vertical metrics, which means a grid
computed in one engine does not describe the other. Not a measurement problem. A
different font.

It lands on display type, which is where this tool already declines to work.

---

## Finding: Chromium rounds advance widths too, on Linux

Fell out of CI, as a validity check rejecting three quarters of a font corpus
that had loaded perfectly well.

Advance width looked like the obvious way to ask whether the same font had loaded
in every engine. On the Linux runner, measuring a fifteen-glyph probe across 24
webfonts at five sizes:

| | readings landing on a whole pixel |
|---|---|
| Chromium | **130 of 130** |
| Firefox | 9 of 130 |
| WebKit | 8 of 130 |

Every Chromium width is an integer: 120, 158, 178, 238, 476. It is the same
behaviour as the cap heights, in the other axis, and it is not present in
Chromium on Windows, where subpixel text positioning is on.

Two consequences, and the second is the one that cost the afternoon.

A correctly loaded font looks like a substitution, because its widths differ from
the other engines' by up to 1%. And a genuine substitution can look like a match,
because **metric-compatible substitutes exist on purpose**: Liberation Sans is
built to reproduce Arial's advance widths exactly, so on a machine without Arial
the widths agree perfectly and the vertical metrics do not. Width cannot detect
the substitution that matters most.

So font identity is fingerprinted on `fontBoundingBox` ascent and descent
instead: off the font's own tables, unhinted, and independent of the cap height
being measured. On Windows that also recovers Inter and Merriweather, whose
widths differ because WebKit picks a different optical size and whose vertical
metrics do not.

**The general lesson, which is not about fonts.** A validity check that shares a
failure mode with the thing under test will quietly delete the evidence. This one
used hinted measurements to decide which unhinted measurements were trustworthy.

---

## Finding: nobody has a baseline grid

The tool bundles to 24 kB with no dependencies, so it can be dropped into any
page. Pointed at 212 sites, homepages at 1280px, half-pixel tolerance, with the
grid origin solved from each page rather than pinned to zero:

| Category | Sites | On an 8px grid | Pinned to origin 0 | Rhythm | Distinct drifts |
|---|---|---|---|---|---|
| Institutions | 9 | 32.0% | 13.6% | 2.2% | 22 |
| Type foundries | 15 | 31.9% | 13.3% | 3.7% | 21 |
| Academic | 6 | 30.9% | 12.8% | 12.6% | 34.5 |
| Design systems | 27 | 30.8% | 14.4% | **29.5%** | 21 |
| Documentation | 39 | 29.3% | 12.8% | 20.9% | 22 |
| Studios | 11 | 25.7% | 10.9% | 8.1% | 28 |
| Editorial | 20 | 25.0% | 12.2% | 18.8% | 46 |
| Product | 25 | 25.0% | 11.8% | 25.4% | 43 |

Medians, not means: one site at 4% drags an average and tells you nothing about
the category. 152 sites scored, 60 dropped. `npm run corpus` reproduces it; the
full table is in `findings/corpus.md` and the raw readings in
`findings/corpus.json`.

These are the figures from the committed run. A fresh one moves them by a few
tenths, because it measures live sites and those sites deploy: a run a day later
scored 152 rather than 153, and every median moved by less than a point. The
survey is stable; the web is not.

**None of these sites claims a baseline grid, so being off one is not a defect.**
The table describes the medium rather than the teams: a convention print has had
since metal type, which nothing on the web has.

**Not one site in 212 reaches 90%.** The best is Fonts In Use at 89.2%, then a
long gap to Svelte at 60.7%, tRPC at 51.5% and Future Fonts at exactly 50. Six
sites clear 50%. The median is 28.6%.

An earlier version of this paragraph put Bureau Borsche second at 82.1%. It was
never second: the site renders 39 text nodes, which is under the floor for
characterising a page, so it is dropped as thin and has no score at all. The
figure had been sitting there through eighteen releases with nothing able to
check it, which is what the gate below now exists for.

### The categories are the same, and that is the finding

The spread from best to worst category is 32.0% to 24.4%. Type foundries, whose
entire trade is typography and who sell the fonts everyone else sets, land at
31.3%, which is not distinguishable from documentation sites at 30.5%. Knowing
more about type does not put a web page on a grid, because the thing standing in
the way is not knowledge.

### Except in one column, where design systems are eight times better

Rhythm is whether each box is a whole number of grid rows tall. Design systems
median **29.5%**, against 3.7% for type foundries and 2.2% for institutions.
That is the largest gap anywhere in the study, and it is exactly what a design
system is for: an 8px spacing scale, quantised leading, tokens that are multiples
of a base unit. It works. It shows up in the measurement.

And it buys them nothing in the other column. Design systems sit at 30.8% on
phase, in the middle of the table, behind two categories with almost no rhythm at
all.

**That gap is the entire argument of this library.** Quantising your CSS gives
you rhythm, and rhythm is not phase. Phase is `L/2 + S(A - D)/2`, and the ascent
in it belongs to the typeface rather than to your spacing scale, so no amount of
tidy tokens reaches it. The teams doing the most disciplined vertical spacing on
the web are doing it correctly and still landing where everyone else lands, and
the only reason to build this was that the missing half is invisible without
measuring.

### Solving for the origin is worth 14.9 points

Every site was measured twice. Pinned to an origin of zero the median is 12.8%;
solved from the page it is 28.6%. Zero asks whether baselines sit on multiples of
the pitch from the top of the document, and a page with a header answers no
however carefully it is set, because everything below the header moved by the
same amount. The Met reads 0.8% against zero and 48.8% against its own origin.
Salesforce Lightning reads 1.8% and 32.7%.

That measurement is why `origin` defaults to `auto` everywhere. An earlier
version of this table was taken against zero and understated every row in it.

### Leading is the cause, on two sites in three

Of the 152 sites scored, the commonest rhythm defect on 104 of them is leading:
a `line-height` that is a ratio rather than a number of rows. `1.5` on 17px is
25.5px, and every extra line in the paragraph carries the half pixel down the
page. After that, 30 sites are led by replaced elements with no quantised height,
9 by padding, 6 by borders and 3 by a collapsed table border, which is a cause
the survey could not name the first time it ran because the tool could not see it.

It is the least visible defect available. `line-height: 1.5` looks like a
decision. It is a decision, and it is also 25.5px.

**Read the last column too.** Percentages say how far off a page is; distinct
drift values say whether it is off in an *orderly* way. Twenty across a homepage
means the type scale and the spacing scale agree with each other. Forty-six, the
editorial median, means they are having different conversations.

craighawkes.dev sat at **ninety** distinct drifts when the survey first ran, last
in the table by three times, on the one measurement it had built the instrument
for. Three causes, all found by measuring: a media query in another file
restoring a unitless `--leading-normal` at every desktop width, twenty-one 1px
hairlines each adding a pixel of layout, and a fluid type scale whose fractional
sizes give fractional ascents. It now sits at 20 distinct drifts with the highest
rhythm in the corpus at 44.5%, and at 22.1% on phase, which is below the median.
Being the surveyor is not the same as being finished.

### What the 60 dropped rows say about the method

28 sites render fewer than 25 blocks of text at load, which is too thin for a
percentage to mean anything. 19 were behind a consent dialog, which is a
different page: measuring it and calling the result somebody's design system
would be worse than not measuring at all. 12 failed to load in time or refused
the injected script, which for Stripe and Figma is a correct content security
policy and a real limit on this method rather than a fault in theirs.

Dismissing 19 consent dialogs automatically would have grown the sample and
spoiled it, so the dialogs stand and the count is reported instead.

---

## Finding: this works outside Latin, and the reason is not the obvious one

Cap height is a Latin idea. Everything here defaults to
`text-box-edge: cap alphabetic`, which was an assumption the tool made without
ever saying so, and the obvious worry is that a Japanese or Devanagari page is
being gridded to a metric that means nothing in it.

**It works, and it works because a trimmed box is a property of the font rather
than of the glyphs in it.** Japanese text in Noto Sans JP trims to exactly the
same height as Latin text in the same face, 0.7330 em for both, and so does a
line mixing the two. The engines lay all of them out against the alphabetic
baseline in horizontal writing, so a grid built on it is a real grid whatever the
script.

Measured across five scripts, each set in the face it is for, at two sizes:

```
Japanese, Arabic, Devanagari, Thai and Latin
cap alphabetic:  360px 15/15  480px 15/15  640px 15/15  900px 15/15  1280px 15/15
ex alphabetic:   360px 15/15  480px 15/15  640px 15/15  900px 15/15  1280px 15/15
```

### The edge is an option now, and a smaller one than it should be

A Japanese typesetter grids to the ideographic em rather than to a cap height, so
`text-box-edge` ought to be the answer. It is not, yet:

| edge | Chromium | WebKit |
|---|---|---|
| `cap alphabetic` | 0.6621 | 0.6621 |
| `ex alphabetic` | 0.4473 | 0.4473 |
| `text alphabetic` | 0.8910 | 0.8910 |
| `cap` | refused | 0.8781 |
| `ideographic ideographic` | **refused** | 1.1070, the same as `text` |

**There is no working ideographic edge on the web today.** Chromium refuses every
ideographic form outright; WebKit accepts them and hands back the plain text box,
which is to say it has not implemented the metric either. The engines also
disagree about the single-keyword forms: `cap` on its own is a parse error in one
and 0.8781 em in the other.

So `--edge` takes any of them and the measurement is checked rather than assumed.
An edge an engine refuses comes back as `null`, and nothing is fitted, rather
than a number being produced from the wrong box.

That last part is not defensive programming for its own sake. An earlier draft of
this section reported 1.448 em for the ideographic edge as though it were a real
measurement. It was the untrimmed box: the property had been rejected, the
element kept its previous value, and the probe measured that instead and reported
it confidently. The check is there because the mistake had already been made
once.

`fitFromFiles` only does `cap alphabetic` and refuses anything else with a
message, because the OS/2 table declares a cap height and does not declare the
others.

---

## Finding: columns, which is what a baseline grid is famous for

Everything above this line is one column deep. A print baseline grid sits inside
a column grid, and the thing it is celebrated for is that a line in the left
column and a line in the right column sit on the same rule. This had never looked
at it.

Two things go wrong.

**One: a margin at the top of a column is truncated, in both engines, always.**
css-break-3 truncates it at an unforced break, which is every break the browser
chooses for itself. The first column keeps its space because the top of the flow
is not a break; every column after it loses it. Forcing a break with
`break-before: column` preserves the margin, which is the spec's own distinction
and confirms the mechanism from the other side.

The engines differ only in what they line up with the top of the column. Chromium
puts the block's border box there, WebKit its first line box, and under
`text-box-trim` those sit 3.73px apart:

```
                        column 1    column 2    space
Chromium                20.75px      0.00px    20.75px
WebKit                  20.75px      3.73px    20.75px
```

What it costs you is a coin flip. The gap left behind is the space minus that
overhang, and whether that happens to be a whole number of rows is a property of
the font's cap height. Sometimes it lands in phase and the page scores perfectly
with the bug still in it. That is not a hypothetical: the same page read 6 of 14
on Windows and 14 of 14 on Linux, same engine, same version. On Linux the space
was 27.61px and the overhang 3.61px, and the difference is 24, which is three
rows exactly.

So the useful claim is not that columns score badly. It is that with a margin,
whether they score badly is out of your hands. `padding-top` is not truncated and
takes the coin flip out.

**Two: a paragraph split across the boundary starts its continuation out of
phase, in both engines.** Chromium by 1px, WebKit by 1.5px. Padding does not
help, because padding is not the problem. Not splitting the paragraph is, and
`break-inside: avoid` is how.

### The recipe

Both halves, always:

```bash
npx quoin fit --design design.json --columns
```

`--columns` implies `--space padding`, because `break-inside` on its own does not
stop the margin being truncated and half a recipe is worse than none.

```
                                  2 columns   3 columns   4 columns
margin, split allowed               6/14        4/14        6/14
padding, split allowed             14/16       14/17       14/16
padding, avoid split               perfect     perfect     perfect
```

Swept across four widths and three column counts in both engines, padding plus
`break-inside: avoid` is perfect in all twelve. A block taller than its column
will still be split, because `break-inside: avoid` is a preference the browser
drops when it cannot be honoured, and a split is off the grid however it happens.

### Two corrections this section has already needed

**It said WebKit could not do columns at all.** Wrong. That came from a page
whose breaks the browser was free to place, where WebKit happened to break
mid-paragraph and was failing for the second reason while being read as failing
for the first.

**It said padding alone was enough in Chromium.** Also wrong, and this one was a
defect in the tool rather than in the reading. `verifyGrid` measured one first
baseline per block, and a block split across a column boundary has one, so every
continuation was invisible to it. A page could report perfect with half a
paragraph off the grid. It reads every fragment now, and Chromium's score for
padding alone went from twelve layouts perfect to six.

That is the argument for testing against a real engine rather than a model of
one, and for the discipline that a check must not share a failure mode with the
thing it checks. Here it did, and for a while the tool agreed with itself about
something that was not true.

`margin` stays the default, and `break-inside: avoid` is off unless asked for. On
a block with a background or a border margin and padding are not interchangeable,
and `break-inside` changes how a page prints whether or not it has columns.
Neither is a thing to change quietly. The emitted CSS points at this when it
writes a margin.

### What does not break it

Columns turned out to be a blind spot, so the other places the browser does
baseline work of its own were checked too, and none of them is a problem. Flex
and grid with `align-items: baseline` shift items to line their baselines up, a
table row aligns its cells, and a list marker sits on the first line. All of them
move things and none of them moves anything off a grid it was already on.

A negative result, kept because it is the difference between never having looked
and having looked.

While there: `initial-letter` does nothing. Chromium reports
`CSS.supports("initial-letter", "3")` as true and the layout ignores it, so a
paragraph with a sunk capital is exactly the height of one without. Drop caps are
still a float and a hand-calculated line-height, which is the same answer as ten
years ago.

---

## Finding: a grid costs two pixels a size

The corpus says the median site is at 28% on an 8px grid. That describes the
medium and it does not answer the question this library is now about, which is
what those sites would have to give up to be on one.

So each site's design was read off its own rendered page and fitted. No size ever
changes, so the entire cost is leading. 175 of the 212 rendered enough to read.

```
Category         Sites   leading to move   sizes   in rhythm
studio           13      11px              5       12.8%
academic         11      11.3px            7       9.7%
institution      14      11.61px           6       5.4%
design-system    29      12.56px           7       27.8%
type-foundry     17      13.2px            6       6.1%
documentation    40      17.26px           9       21.3%
editorial        24      20.75px           10.5    19.3%
product          26      21.38px           12.5    25.3%
```

**The median site would move 15.6px of leading across 8 sizes**, which is
1.95px per size. **The largest single change is 4px**, and that figure is the
median of the worst change on each site rather than the best case: no site in
175 would have to move any one leading by more than about four pixels.

### The cost is the number of sizes, not the size of the change

Look at the two ends of it.

```
Rollup                    0px across 5 sizes,  worst 0
Sagmeister & Walsh     0.77px across 1 size,   worst 0.77
Bureau Borsche          0.8px across 1 size,   worst 0.8

Deno                  67.31px across 29 sizes, worst 4
Bun                   59.52px across 31 sizes, worst 3.84
Raycast               52.06px across 29 sizes, worst 4
```

Deno costs sixty-seven pixels and Rollup costs nothing, and the difference is not
that Deno's typography is worse. Deno has twenty-nine distinct size-and-leading
combinations on one page and Rollup has five. Every one of Deno's changes is
under four pixels, the same as everybody else's; there are simply twenty-nine of
them.

Which reframes what the grid is asking for. It is not asking you to accept type
that looks different. It is asking how many sizes you actually needed.

Rollup is the one site in the corpus that could be fitted for nothing at all. Its
leadings are already whole numbers of rows, which means somebody chose them.

### The other obstacle, which this does not remove

The median site is 28.6% on the grid and **18.6% in rhythm**, and the second
number is the one a type fit does not touch. Fitting sets sizes, leadings and the
space between blocks. It cannot make a container with thirteen pixels of padding,
or an image a hundred and thirty-seven pixels tall, into a whole number of rows,
and everything below one of those is pushed off whatever the type is doing.

**This study does not retrofit anybody's site**, and an earlier version of it
claimed to. That version walked each page setting `margin-top` on every text
block, and the numbers it produced were nonsense in both directions: the site
with the best rhythm in the sample got worse and the one with the worst improved
by fifty points. A real site's vertical spacing lives on its containers rather
than on its paragraphs, so overwriting every block's margins measures the
demolition and not the fit.

Fitting a page is something you do when you build it. That claim is tested
against pages built from a fit, at nine widths, in `fit.spec.ts` and
`every-width.spec.ts`. What is measured here is the price of the ticket.

`npm run fittable` reproduces it. 37 sites dropped: 14 render too little text to
read a design from, 10 refuse injected scripts, 5 did not load, 8 for other
reasons.

---

## Finding what to correct

The seater has to know which lines missed, so the same walk is available on its
own. It runs in the page rather than over the source for the same reason
everything else here does: the source says what was intended, the DOM says what
happened, and between them sit inherited line-heights, a component library's
reset, a webfont that failed to load, and one heading with a `clamp()` that
resolves to something the type scale never anticipated.

```ts
import { verifyGrid } from "quoin"

const { report, skippedTransformed, closedShadowRoots, frames } = verifyGrid({ pitch: 8 })
console.log(`${report.onGrid} of ${report.total} on grid`)
console.log(`${report.distinctDrifts} distinct drift values`)
if (report.systematic) console.log("one shared offset: check your origin")
```

### `distinctDrifts` is the field to read first

One shared offset across every off-grid node is a wrong origin or a single
un-snapped line-height, and it is a one-line fix. Scattered drift means your type
scale and your spacing scale disagree, which is a design problem wearing a CSS
costume. The two look identical in a screenshot and want completely different
responses.

---

## Rhythm, the other half

Phase is where a baseline sits inside its own line box, and most of this library
is about phase. Rhythm is whether each box is a whole number of grid rows tall,
and it is the half that decides whether a correction survives anything changing.

A block whose height is not a multiple of the pitch shifts every block after it
by the remainder. That is why one un-quantised box near the top of a page costs
the whole page, and it is why static corrections stop holding when the viewport
moves: a block that reflows to a different number of lines changes height by a
multiple of its leading, which is only harmless if the leading is a whole number
of rows.

```bash
npx quoin rhythm https://example.com
```

```
  179/402 boxes are a whole number of rows

  header.hero            5px past a row, moves 274 blocks
    3px of border on an 8px grid
    Subtract the border from this box's own padding: padding 50px instead of
    53px keeps the rule and the rhythm.

  p.kicker               4px past a row, moves 273 blocks
    line-height 27.2px is not a whole number of 8px rows
    Set line-height to 32px. A block's height is its line count times its
    leading, so leading off the grid puts every extra line off it too.
```

Three things it does that a height check does not.

**It says which part of the box is wrong.** Height is border plus padding plus
content, and each is checked separately, in the order somebody can act on: a
border is one line of CSS, padding is one line, leading is a decision about the
type scale, and content taller than its own lines is something further in.

**It only blames leading on a box that owns text.** `line-height` inherits, so a
wrapper with no words of its own still reports whatever the body set. Blaming
that is worse than saying nothing, because the wrapper's height is its
children's and changing its leading changes nothing at all. The first version did
exactly that.

**It ranks by blocks moved, not by pixels.** Three pixels at the top of a page
moves everything; seven at the bottom moves nothing. A report sorted by size puts
the harmless one first. `accumulated` counts only the fractions a box introduces
itself, because a wrapper that is fractional because its child is has introduced
nothing, and counting both reports the same pixel twice. On one page a naive sum
came to 3617px across 1453 boxes, most of it containers inheriting the same
7.28px from the one inside them, nine levels deep.

---

## Solving for the origin

An origin of zero asks whether baselines sit on multiples of the pitch measured
from the top of the document. Almost no real page answers yes, and not because
it is badly set: a header with a border, a body padding of 20, anything at all
above the first paragraph moves every baseline by the same amount. Such a page
**is** on a grid. It is on a grid whose origin is 3, and measuring it against
zero reports nothing on the grid at all.

So `origin` defaults to `auto` and the origin is solved from the page. Each
baseline gives a residue mod pitch, and the question is which window of width
`2 x tolerance` covers the most residues on a circle of circumference `pitch`.
An optimal window can always be slid until its leading edge rests on a point, so
the candidates are the points themselves and a sorted two-pointer settles it.

It is worth 14.6 points of median across the corpus, and on individual sites far
more: The Met reads 0.8% against zero and 48.8% against its own origin.

What it deliberately does not do is flatter. A page with two type sizes has two
phases and no single origin serves both, so the count it returns is the best
available and the rest is a real defect. The candidate count is computed with
`checkBaseline`, the same arithmetic the report uses, rather than from the window
width: a span exactly two tolerances wide sits on a floating-point boundary where
the two disagree, and a solver that claims a block the report then calls off-grid
is a tool disagreeing with itself.

```js
bestOrigin([3, 11, 19, 27], { pitch: 8, tolerance: 0.5, origin: 0 })
// { origin: 3, onGrid: 4 }
```

Pass a number to pin it: `--origin 0` for the strict reading, or any value your
page is actually built on.

---

## Fitting a design, which is what this is actually for

Everything above this line is remedial. It measures a page that is off the grid
and pushes each block into place, and what you get back is a list of absolute
pixel corrections. That works, and it has a limit that no amount of care removes:
the corrections describe one arrangement of line breaks.

Measured across widths, the limit turns out to be sharper than "corrections are
per-layout". A page seated at 1280 and carried to 375 held at **100%** when only
the line breaks had moved, because `mode: "full"` snaps the leading to whole rows
and a page whose leadings are whole rows reflows in whole rows. The same page
collapsed to **0%** when a media query changed a container's padding by thirteen
pixels. Corrections survive reflow. They do not survive a layout change, and
every real site has one.

```
what changes between widths          carried from 1280 to 375
reflow only, leading snapped         100%
reflow only, leading not snapped      25%
a hairline border                    100%
an image with an odd height          100%
font-size changes at a breakpoint     75%
padding changes at a breakpoint        0%
```

So the corrections were never the right primitive.

### The arithmetic that removes the problem

Trim the boxes. Under `text-box-trim: trim-both` with
`text-box-edge: cap alphabetic`, a block's border box starts at its cap height
and ends at its baseline, so the distance from one baseline to the next across a
block boundary is

```
baseline(B) - baseline(A) = (lines(A) - 1) x leading(A) + space(B) + cap(B)
```

`lines(A)` is the only term that changes with the viewport, and it is multiplied
by a leading that is already a whole number of rows, so modulo the pitch it
contributes nothing. What is left is

```
space(B) + cap(B) = 0   (mod pitch)
```

and every term in that belongs to block B by itself. **There is no constraint
relating one size to another.** The sizes are free.

That took three wrong models to arrive at. The first was per-element corrections.
The second was `gridNativeScale`, which solves sizes whose phase agrees so one
origin serves the page, and charges about eleven pixels between usable sizes for
a text face on an 8px grid. The third was fitting several families to one shared
phase, which is worse again, because each family has its own cap height per em
and the compromises compound: an early version moved a 17px body to 20.5 and a
15px mono to 10.5, which is not fitting a design to a grid, it is replacing it.

### The box, which is the rest of that equation

The formula above is right for a block with no border and no padding, and for a
while it was the whole of what the fitter solved. It is not the whole equation.

Under `text-box-trim` a box begins at its first baseline's cap and ends at its
last baseline, so the full distance from one baseline to the next is

```
baseline(B) - baseline(A) =
      (lines(A) - 1) x leading(A)
    + paddingBottom(A) + borderBottom(A)
    + space(B)
    + borderTop(B) + paddingTop(B)
    + cap(B)
```

Four terms the fitter used to assume were zero. A fitted paragraph with a 1px
border-top read 2 of 3 on the grid; with 5px of padding-top, 1 of 3. Eight pixels
of padding read 3 of 3, and that is the tell: eight is a whole row, so it moved
everything by exactly one row, which is to say by nothing.

**This was found by pointing the tool at quoin.dev.** Its table cells set
`line-height: 31px` against a 1px border, deliberately, with a comment saying
`31 + 1px border = 32`. The fitter read that page and told it to use 32, which
would have made the box 33 and broken the rhythm the author had built by hand.
The tool was wrong and the site was right, which is a bad way round for a tool
whose entire argument is that measuring beats reading.

The two halves are not symmetrical, and the difference matters:

**The lead-in** is `borderTop + paddingTop`. It sits between the top of the box
and the first line, it belongs to the block being fitted, and so that block's own
space closes it along with its cap height:

```
space(B) + borderTop(B) + paddingTop(B) + cap(B) = 0   (mod pitch)
```

**The tail** is `borderBottom + paddingBottom`. It sits below the last baseline
and pushes the *next* block down, which makes it the one term in the equation
belonging to a block other than the one being fitted. A per-step design cannot
know what follows a block, so the tail is not absorbed into somebody else's
space. It is rounded up to a whole number of rows instead, by adding to the
block's own `padding-bottom`, which makes it contribute nothing:

```
paddingBottom(A) + borderBottom(A) = 0   (mod pitch)
```

Both terms then belong to one block alone, and the property the whole method
rests on survives: **no block has to agree with any other.**

A 1px border-bottom asks for 7px of padding under it. A border and padding that
already come to a whole row are left exactly as they are, and a design with
neither fits precisely as it did before any of this existed.

`inferDesign` reads all four off the page, and groups on them as well as on the
type, because two blocks at the same size with different borders need different
spaces.

### What it does instead

```bash
npx quoin fit --design design.json
```

```json
{
  "pitch": 8,
  "families": [
    { "role": "display", "font": "Georgia, serif", "steps": [
      { "name": "h1", "size": 44, "leading": 48, "space": 56 },
      { "name": "h2", "size": 27, "ratio": 1.2, "space": 32 }
    ]},
    { "role": "body", "font": "Helvetica, Arial, sans-serif", "steps": [
      { "name": "body", "size": 17, "ratio": 1.5, "space": 24 },
      { "name": "lead", "size": 21, "ratio": 1.45, "space": 24 }
    ]},
    { "role": "mono", "font": "monospace", "steps": [
      { "name": "code", "size": 15, "ratio": 1.6, "space": 24 }
    ]}
  ]
}
```

```
  8px grid, origin 0px
  3 families, 3.45px of leading moved, no size touched

  display  Georgia, serif
    name          size      leading   space     cap      moved
    h1            44px      48px      57.516px  30.484   exact
    h2            27px      32px      29.297px  18.703   leading -0.4

  body  Helvetica, Arial, sans-serif
    name          size      leading   space     cap      moved
    body          17px      24px      27.828px  12.172   leading -1.5
    lead          21px      32px      24.953px  15.047   leading +1.55

  mono  monospace
    name          size      leading   space     cap      moved
    code          15px      24px      22.422px  9.578    exact
```

**Every size is the size the design asked for.** Nothing was moved to make the
arithmetic work, because nothing needed to be. The one thing that changes is the
leading, snapped to the nearest whole number of rows, and it is reported to a
thousandth of a pixel so the decision to accept it belongs to whoever has to live
with it. That is also the compromise a typographer already makes: ticking "align
to baseline grid" in InDesign changes the leading and nothing else.

### It holds at every width

A page built from a fit, with headings that wrap at some widths and not others, a
list, a blockquote, and paragraphs reflowing from two lines to nine:

```
chromium: 320px 9/9  375px 9/9  414px 9/9  600px 9/9  768px 9/9  900px 9/9  1024px 9/9  1280px 9/9  1440px 9/9
webkit:   320px 9/9  375px 9/9  414px 9/9  600px 9/9  768px 9/9  900px 9/9  1024px 9/9  1280px 9/9  1440px 9/9
```

One stylesheet. No media queries, no corrections, nothing to regenerate when the
copy changes.

Two controls run beside it, because a suite that only builds pages out of the
fitter's own numbers proves the arithmetic is self-consistent and nothing else.
The identical page with the spacing left as the design wrote it, and the identical
page without the trim, both have to fall below 75%. Both do.

### Point it at a site you already have

Most people have a site rather than a design file, and the question they want
answered is what to change about the site they have.

```bash
npx quoin fit --from https://example.com
```

It walks the rendered page, groups every block of text by the family, size and
leading it actually resolved to, and fits that. Run against quoin.dev's own
build:

```
  236 text blocks, 233 covered by 2 families
  3 one-off combinations left out, which is usually
  a widget or a third party rather than the design
  nothing had to move
```

It gives you rules rather than tokens where it can. A step whose blocks are
matched exactly by one selector gets that selector, checked against the document
before it is written out; a step whose tag is shared with another size gets
nothing, because a selector that is nearly right styles the wrong blocks and
looks finished doing it. Pointed at quoin.dev it found two and refused eleven.

It reads what the browser resolved rather than what the stylesheet asked for, for
the same reason everything else here does. A page also has a long tail of sizes
used once, usually a widget or a third party, so anything appearing fewer than
twice is left out of the design and listed in `rare` instead, which makes it a
decision rather than a silent omission.

Code is not in it. `pre` and `code` are excluded from the walk, because
preformatted text is not prose and measuring it as though it were fills a report
with things nobody was ever going to seat. A design that needs its monospace
fitted should pass it explicitly with `--design`.

### For agents

An agent working from a Figma file or a screenshot has the same problem a person
does and nobody to ask. So the contract is data in, data out, and everything the
answer rests on is in the output rather than in the prose around it.

```bash
cat design.json | npx quoin fit --design - --json
```

**It takes the shape you already have.** A Figma export calls it `fontSize` and
`lineHeight`, in px strings; a token file is flat; a screenshot gives you a list
of measurements and no names. All of those are accepted:

```json
{
  "pitch": 8,
  "families": [{
    "role": "heading",
    "fontFamily": "Lato",
    "file": "./fonts/Lato.ttf",
    "sizes": [
      { "label": "Display/Large", "fontSize": "44px", "lineHeight": 1.1, "marginTop": "48px" },
      { "label": "Display/Small", "fontSize": "27pt", "lineHeight": "36px" },
      13.5
    ]
  }]
}
```

`font` / `fontFamily` / `family` / `stack`. `steps` / `sizes` / `scale` /
`tokens`. `size` / `fontSize`. `leading` / `lineHeight`. `space` / `spacing` /
`marginTop` / `gap`. `name` / `label` / `token`. A unitless line-height is read
as a ratio and a number of pixels is not, because CSS spells it that way and the
two stop overlapping at four. Points convert. Anything interpreted is reported on
stderr, so `--json` stays clean and the guess is still impossible to miss.

**It refuses what it cannot know.** A `rem` is 16px only if nothing changed the
root size, and a design saying `1.0625rem` against an 18px root means 19.125px.
Guessing there produces a fit that looks right, which is the one outcome worth
avoiding, so it is an error instead.

**Every error names the entry.** An agent cannot ask a follow-up question, so an
error that does not say which step was wrong and what was expected costs a round
trip and sometimes a confidently wrong answer:

```
design.families[0].steps[0].size: "1.0625rem" is relative. Give it in px,
because a rem depends on a root size this cannot see and guessing would
produce a fit that looks right

design.families[0]: no font. Give it as "font", with the CSS family exactly
as the page will set it

design: found steps but no font. Every family needs the CSS family it is set
in, because the cap height that decides the spacing belongs to the typeface
```

**What comes back.** Every size, unchanged. A leading, snapped, with
`leadingWas` and `leadingMoved` so the agent can decide whether a shift from
25.5 to 24 is acceptable and say so rather than guess. A space, with the `cap`
and `residue` it was derived from. And the CSS.

```json
{
  "grid": { "pitch": 8, "tolerance": 0.5, "origin": 0 },
  "origin": 0,
  "cost": 1.5,
  "unavailable": false,
  "families": [{
    "role": "body", "font": "Lato", "resolved": true,
    "steps": [{
      "name": "body", "size": 17,
      "leading": 24, "leadingWas": 25.5, "leadingMoved": -1.5, "rows": 3,
      "space": 27.819, "spaceWas": 24, "spaceMoved": 3.819,
      "cap": 12.181, "residue": 4.181
    }]
  }],
  "css": "..."
}
```

`cost` is the total leading movement across the design, and it is the number to
show a person: zero means the design was already on whole rows and nothing was
compromised at all.

**The three ways in.** `--design <file>` when there is a design.
`--design <file>` with a `file` on each family when there is no browser, which
runs in about 76ms. `--from <url>` when there is a site instead of a design, and
the design has to be read off the page first.

**What to do with the answer.** Set the sizes and leadings as given, and the
spaces as `margin-top`, never `margin-bottom`: the space closes the cap height of
the block it comes *before*. Add the trim the CSS carries. That is the whole
integration, and it holds at every width without media queries, so there is
nothing to regenerate when the copy changes.

### Fluid type, which this said was impossible

An earlier version of this file said `clamp()` could not be put on a grid. The
reasoning went: a block's phase is `size x capRatio`, so a size that varies
continuously has a phase that varies continuously, and lands on the grid only at
whichever widths happen to work. That is all true.

What it missed is that the space does not have to be a number. CSS Values 4 has
`mod()`, so the arithmetic the fitter does at build time can be done by the
browser at layout time instead:

```css
h1 {
  --size: clamp(28px, 5vw, 56px);
  --cap: calc(var(--size) * 0.6621);
  font-size: var(--size);
  line-height: 64px;
  margin-top: calc(6 * var(--pitch) - mod(var(--cap), var(--pitch)));
}
```

Measured at eleven widths from 320 to 1440, in Chromium and WebKit:

```
fixed spacing   320px 1/4  360px 1/4  400px 1/4  ...  1440px 1/4
space follows   320px 4/4  360px 4/4  400px 4/4  ...  1440px 4/4
```

The control runs first and has to fail, because if the unfitted page were
already on the grid the result below would be measuring nothing.

`mod()` and `text-box-trim` are supported in the same engines, which is
convenient and not a coincidence: both are recent additions to the same part of
the platform. There is a test asserting they stay together, so if one ever ships
without the other the fluid path grows a fallback rather than quietly breaking.

Give the fitter a `fluid` range and it emits the rule rather than making you
derive it:

```json
{ "name": "display", "size": 40, "leading": 64, "space": 48,
  "fluid": { "min": 28, "max": 56, "preferred": "5vw" } }
```

The nominal `size` is still required, because the leading is solved from it and
a report needs one number rather than a range. The leading cannot be fluid: it
has to be a whole number of rows, and there is no continuum of whole numbers. So
a fluid size takes a fixed leading across its range, which is what display type
usually wants anyway.

---

### Zoom, and what a reader can change

A fit is arithmetic in pixels, which is a suspicious thing to build an
accessibility story on, so both cases are measured rather than argued.

**Zoom holds.** It multiplies every length on the page including the pitch, so
the modular arithmetic is untouched: a space that closes a cap residue at 1x
closes the same residue scaled at 3x. Measured in Chromium and WebKit:

```
1x 5/5   1.25x 5/5   1.5x 5/5   2x 5/5   3x 5/5
```

WCAG 1.4.4 asks for 200%. This goes to 300% because measuring it costs nothing
and reasoning about it proves nothing.

**A forced minimum font size degrades it.** That one raises the sizes below its
threshold and leaves the rest, so those blocks' cap heights change while their
spacing stays where the fit put it. Overriding one size in a five-block page
took it from 5/5 to 3/5: the caption came off and so did the block below it,
because its height changed, and the three above it did not move.

Worth being plain about. It degrades rather than collapsing, and it breaks the
vertical rhythm of every px-based design ever shipped in exactly the same way,
which is an explanation and not a defence.

---

### In a build, with PostCSS or Vite

```js
// postcss.config.js
import quoin from "quoin/postcss";
export default {
  plugins: [quoin({ fonts: { Lato: "./fonts/Lato.ttf" }, defaultFont: "Lato" })],
};
```

Every rule declaring a pixel `font-size` and a `line-height` is read. The size is
never touched.

**It used to say it put your stylesheet on the grid. It did the opposite.** Run
against the stylesheet this site is built from, the plugin took the page from 38%
on the grid to 32%, and its rhythm from 350 of 374 to 299. Nothing caught it,
because the tests asserted that the output contained `text-box-trim` rather than
what the page did with it, which is the failure this repository is otherwise
written to avoid.

Three things came out of measuring it properly.

**The trim goes on with the space and never without it.** An untrimmed box begins
half a leading above its first ascent and a trimmed one begins at the cap, so
adding the trim moves a block's first baseline. The space is what puts it back on
a row. Written together they are one change; written apart, the first is a page
whose blocks have moved and whose spacing has not.

```
as written, no trim                   4 of 5 on the grid
trim alone                            2 of 5
trim and the spaces that go with it   5 of 5
```

**The leading is not always safe to snap.** A box is its leading plus its border
and padding, and an author who has made that sum a whole number of rows has done
the thing this tool is for, by a route it did not expect. This site's table cells
set a 31px leading against a 1px rule: neither is a whole row and 32 is. Snapping
the leading to 32 makes the box 33. It is left alone now, and reported.

**`var()` is resolved.** The plugin matched font files against the literal first
family in a rule, so every rule naming its face through a custom property was
skipped. Sixteen of eighteen skips on a real stylesheet were exactly that, which
is to say it did nothing to a stylesheet it reported having read.

### Which leaves a small tool, honestly described

The space before a block is what closes that block's cap height, and a rule that
does not declare `margin-top` has not told the plugin where its spacing lives.
Writing one onto every rule that sets a size is how the study further up produced
numbers that were nonsense in both directions.

So on a stylesheet whose vertical spacing lives on its containers rather than its
text rules, and most do, there is almost nothing here to write, and it now writes
almost nothing rather than writing harm. On this site's stylesheet it is exactly
neutral.

It earns its keep on a stylesheet that keeps its type and its spacing in the same
rules, which is what a design-system stylesheet usually looks like:

```css
/* in */                          /* out */
p {                               p {
  font-size: 17px;                  font-size: 17px;
  line-height: 1.5;                 line-height: 24px;
  margin-top: 24px;                 margin-top: 27.828px;
}                                   text-box-trim: trim-both;
                                    text-box-edge: cap alphabetic;
                                  }
```

For everything else, `quoin fit --from <url>` reads the rendered page and knows
what the CSS alone cannot.

`--quoin: skip` on a rule leaves it alone. Anything it cannot fit is reported
through `onSkip` with the reason: a `line-height: normal` resolves per font and
per engine, which is the one number a build cannot know, and a `rem` size depends
on a root it cannot see.

```js
// vite.config.js
import quoin from "quoin/vite";

export default {
  plugins: [
    quoin({
      design: "./design.json",
      css: { fonts: { Lato: "./fonts/Lato.ttf" }, defaultFont: "Lato" },
    }),
  ],
};
```

The Vite plugin does that, and one more thing: it serves the fitted tokens as a
module.

```js
import "quoin/tokens.css"
```

That half exists because most design systems keep their scale in tokens and
generate the CSS from them, so a plugin that could only read stylesheets would be
useless to exactly those projects. Both halves are independent, and when both run
there is a test asserting they produce the same numbers, because a page built
from a mixture of two disagreeing grids is on neither.

**No browser at any point.** Cap heights come from the OS/2 table, which is the
same number the engines use and agrees with them to eight thousandths of a pixel.
`postcss` and `vite` are optional peer dependencies; the package itself still has
none.

---

### Without a browser at all

Fitting a design is a build-time question, and needing Playwright to answer it
rules the tool out of every pipeline that does not already have one: a PostCSS
step, a Vite plugin, a token build, an agent with no display.

Give each family the font file it is set in and nothing launches:

```json
{
  "pitch": 8,
  "families": [
    { "role": "body", "font": "Lato", "file": "./fonts/Lato.ttf", "steps": [
      { "name": "body", "size": 17, "ratio": 1.5, "space": 24 }
    ]}
  ]
}
```

```
  8px grid, origin 0px, read from font files
  1 family, 1.5px of leading moved, no size touched

  No browser was used. Cap heights came from each font's OS/2 table,
  which is the same number the engines use for text-box-edge: cap.
```

Three families and five sizes in **76ms**, against roughly two seconds and a
browser install for the other route.

**Why this is allowed.** `text-box-edge: cap` is defined against the OS/2 table's
`sCapHeight`, so the number in the file is the number the engine will use. Across
nine fonts at five sizes, the file and the engine disagreed by at most **0.008px**.
It is the same reasoning that made the cap basis worth having, applied one step
further back.

**Why it is not always the better answer.** A browser tells you which font
actually rendered; a file tells you about the file. If the page ends up setting
something else, because a webfont failed or the stack fell through, a fit from
the file describes a typeface nobody saw. `fitScale` in a page is still the
better answer when there is a page. This is the answer when there is not one yet.

**WOFF2 is refused**, rather than half-parsed. It transforms the glyf and loca
tables rather than merely compressing them, so a partial parser would be wrong
quietly. TTF, OTF and WOFF are read directly. Point it at the file the WOFF2 was
built from.

---

## Finding: the engines check the cap height, and only sometimes

Building the file reader turned up a limit on trusting it, and the limit is a
narrow one worth stating precisely.

Three fonts were manufactured for the earlier metrics study, each lying about
itself in a different way. Loaded into Chromium and WebKit and measured through a
trim probe:

| font | declares | engine draws | |
|---|---|---|---|
| AwkwardLies | 0.60 em, real capitals 0.70 | **0.60 em** | trusted, though it is false |
| AwkwardLiesLato | 0.60 em | **0.60 em** | trusted |
| AwkwardHuge | 1.40 em | **0.70 em** | rejected, glyphs measured instead |
| Lato | 0.7165 em | 0.7165 em | |
| EB Garamond | 0.65 em | 0.65 em | |

Both engines behave identically. **The table is the authority whenever the table
is credible.** A font claiming its capitals are shorter than they are gets
believed, and `text-box-edge: cap` trims to the claim. A font claiming a cap
height taller than the em does not, and the engine falls back to measuring.

That is the whole reason reading a file works, and the whole reason it needs a
guard. `readFontMetrics` refuses a declaration taller than the em and says so, so
`fitFromFiles` declines rather than producing a stylesheet wrong by thirty pixels
at a display size. Declining to fit is recoverable; fitting wrongly is not.

It does not, and cannot, catch the credible lie. Nothing can, and nothing should:
the engine believes it too, so a fit built on it is correct about the page even
though the font is wrong about itself.

---

### What it needs, and what it does not do

It needs `text-box-trim`, which is Baseline as of Firefox 154 in August 2026. On
an older engine `fitScale` returns `unavailable: true` rather than quietly
answering from the line box, because the two give different numbers and a caller
who asked for one and silently got the other has a stylesheet that does not do
what they think.

It does not fit a leading fluidly, and that one is not a limitation of the tool.
A leading has to be a whole number of rows or the second line of every paragraph
is off the grid, and there is no continuum of whole numbers. Fluid sizes take a
fixed leading per range.

It does not fix boxes that are not whole rows. Borders, padding and image heights
still have to be multiples of the pitch, and `quoin rhythm` is what tells you
which ones are not.

---

---

## Finding: print, which is where this idea comes from

Everything above this line is measured in a browser, where a baseline is a number
the engine will hand you. A printed page is not a DOM. `getBoundingClientRect`
does not survive pagination, so every claim about how a fit behaves across pages
was reasoning rather than measurement, and reasoning is what this repository
exists to distrust.

A PDF will tell you, if you read it. Text is positioned by a matrix, the matrix
is in the content stream, and the stream is usually deflated. So `quoin print`
renders the page, walks the page tree, inflates each page's content, tracks the
transform stack and reports where every baseline landed.

```bash
npx quoin print https://example.com
```

```
  80 of 80 baselines on a 8px grid across 3 pages  (100%)

  page   baselines   on grid   first baseline
  1      28          28        80px
  2      28          28        80px
  3      24          24        80px
```

**A margin at the top of a page is truncated, exactly as it is at the top of a
column.** Page fragmentation and column fragmentation are the same rule in
css-break-3, and a fitted document behaves accordingly: page one starts at its
space and every page after it starts at the cap alone.

```
                        page 1   page 2   page 3
margin-top               32px     11px     11px
padding-top              32px     32px     32px
```

Read as a score that is 34 of 82 against 80 of 80. The fix is the one columns
already needed, and it is the same fix for the same reason.

**`break-inside: avoid` is not needed here, unlike columns.** A paragraph split
across a page keeps its phase in Chromium, where a paragraph split across a
column does not. Padding alone reads 80 of 80.

**The page box does not have to be a whole number of rows.** This is worth saying
plainly because it is the opposite of what a print designer would expect, and
believing otherwise makes people size their page around their grid for nothing.
Each page restarts its own grid at its own content edge, so nothing carries
across the break and the height of the box is not part of the arithmetic. A page
whose content is 125.33 rows tall holds exactly as well as one that is 96.

### What the reader is, and is not

It reads text positions and sizes. It is not a PDF renderer and does not try to
be: no fonts, no glyphs, no colour, no images. A grid check needs to know where
the baselines are, and that is all it takes out.

The origin is solved rather than asked for. Where a page's content starts depends
on the `@page` margin, which the tool does not know, and an early version
defaulted it to 24pt and then reported first baselines of -10px on a page that
set none, which is a tool blaming a document for the tool's own guess. One origin
is solved across every page at once instead: if the pages agree about where their
grid begins, one origin fits all of them, and if they do not then none does, and
the low score is the finding. `--print-margin` still takes a figure for anyone who
wants the absolute reading.

Chromium only, because that is the one engine Playwright will render a PDF with.
The finding is about css-break-3 rather than about Chromium, but the measurement
is Chromium's and the limitation is stated rather than buried.


---

## Finding: the other axis

Everything above this line is the vertical half. A baseline grid is a vertical
rhythm inside a column grid, and the column grid is the half a designer usually
means when they say "the grid". This had never looked at it either.

```bash
npx quoin columns https://example.com
npx quoin pitch   --design design.json --budget 6
```

The defect it finds has the same shape as the vertical one, and the same cause.
A leading of 25.5px cannot land on an 8px row. A module of 341.33px cannot land
on anything:

```
1104px container, 3 columns, 40px gutters

  module    (1104 - 80) / 3 = 341.333...
  column 1  starts at 0
  column 2  starts at 381.33
  column 3  starts at 762.67
```

Every division after the first sits on a fraction, and no care taken with the
markup moves it, because the arithmetic was decided by the container width before
any markup existed. So the report says which nearby widths divide rather than
telling somebody their edges are a third of a pixel out:

```
1104px does not divide by 3 with a 40px gutter.
These do: 1100px, 1103px, 1106px, 1109px
```

1103 gives a module of 341 exactly.

### Solved rather than asked for

The columns and the gutter are read off the page when they are not given, because
a report you can only produce for a site whose grid you already know is a report
for the person who needs it least. The gutter is the commonest gap between two
blocks sitting side by side. The column count is scored.

**Scored against chance, not by count.** Counting how many edges land on a
division always picks the most columns: sixteen divisions catch more edges than
three for the same reason a wider net catches more fish. The first version of this
read a three-column page as fifteen columns of 36.27px. What is scored now is how
far the hits exceed what that many divisions would catch from edges scattered at
random, and a page with no column structure comes out with no column structure,
which is the answer rather than a failure to produce one.

`--grid-columns` and `--gutter` state them instead, when you know.

### Two things that had to be got right first

**Edges are counted in whole pixels.** Subpixel layout produces 1104 and 1103.98
for the same edge constantly, and counted as written they are two edges used once
each rather than one used twice. A fixture on a 1104px container was read as a
722.66px container for exactly that: the real edge appeared twice and neither
spelling of it reached a count of two.

**A block parked off the page is not a block that is off the grid.** A skip link
at -10000px was the worst issue on quoin.dev by four thousand pixels, which is a
report about the tool rather than about the page.


---

## For agents, and for anybody working from a design

The receiving end of this has always been a JSON design, and until now the only
ways to produce one were to write it by hand or to point the tool at a site that
already existed. Neither is what somebody has when they are working from a
drawing, which is the case where fitting is worth most: a design fitted before
anybody writes CSS needs no corrections at all.

**[AGENTS.md](AGENTS.md)** is the whole of it, written for something that cannot
ask a follow-up question. The short version:

```bash
echo '<design json>' | npx quoin fit --design - --pitch 8
```

### From a Figma file

Hand it the JSON. It is detected, so there is no flag to get right.

```bash
curl -H "X-Figma-Token: $TOKEN"   "https://api.figma.com/v1/files/$KEY" > design.json
npx quoin fit --design design.json --pitch 8
```

The whole file response works, so does its `document`, so does a single frame
from `/nodes`. Text nodes become steps grouped by family, size and leading, and
the space comes from the gaps between bounding boxes, because a designer's
spacing lives in the layout rather than in the type styles.

Two decisions worth stating. **Hidden layers are skipped**, because a hidden
layer is a design somebody rejected. And **leading set to `INTRINSIC` is treated
as absent rather than as a decision**: Figma reports a resolved figure for it,
but that figure is whatever the font's metrics came to at that size, not
anything anybody chose, and fitting to it fits the page to an accident of the
typeface.

The minimum is one node, not two. On a page a combination used once is usually a
widget or a third party; in a design file it is a style somebody drew on purpose,
and a display size appears exactly once because there is one hero. An early
default of two quietly dropped the display and the standfirst from a five-style
design.

### From an image

There is no vision in this library and there should not be. The documentation
says what to measure and in what order, and refuses one thing in particular:
there is nowhere to put an estimated cap height, deliberately. It is measured
from the font, because a cap height guessed to within five per cent is a
baseline wrong by half a row.

---

## Finding: eight is the conventional pitch, not the right one

Everybody picks an 8px grid because everybody picks an 8px grid. Nothing has ever
told a designer what that convention costs them, and it is the one question about
a grid that can be answered before a font is chosen.

```bash
npx quoin pitch --design design.json --budget 6
```

The cost of a grid is entirely the leading it moves. A leading snaps to the
nearest whole number of rows without anybody needing to know what the type looks
like, and the space is not a cost at all: it is chosen rather than moved, and it
closes the cap height whatever the pitch is. So this needs no browser, no font
and no network. It is arithmetic, and it runs instantly.

```
  pitch    total    worst    already whole
  4px      5.3px    1.6px    0 of 5
  6px      9.5px    2.8px    0 of 5
  7px      5.3px    1.5px    0 of 5
  8px      10.7px   3.5px    0 of 5
  10px     8.1px    3.6px    0 of 5
```

Two things in that table are worth stopping on. **7px costs half what 8px costs**
for the same design. And **10px, which is coarser, costs less than 8px too**, so
this design could have had a grid that constrains more and compromises less.

**The relationship is not monotonic**, which is what makes it worth computing
rather than reasoning about. A finer grid has a smaller worst case, so it ought
to be cheaper, and usually is. But a major-third scale of six sizes costs 4.0px
at a 6px pitch and 6.4px at 4px, because where the leadings happen to fall
matters more than how far they can be from a row.

### What the convention costs, across 173 sites

The corpus was re-read for this: each site's design taken off the page with
`inferDesign`, then costed at every pitch. 173 of the 212 have a design of three
sizes or more that can be read.

```
  median cost at 8px         17.52px, across the sizes a site sets
  median cost at its best     6.00px
```

**A coarser grid than 8px would also have cost less on 80 of the 173.** That is
the number worth reporting, and the only one in this section that is not partly
an artefact of arithmetic. A finer grid has a smaller worst case, so of course
most sites cost less at 4px than at 8px, and "4px is cheapest on 144 of 173" is
close to a tautology: it is cheapest because it constrains least. But a *coarser*
grid costing less is a design paying twice, once in compromise and once in a grid
that holds the page together less than it could have.

It splits by what kind of site it is, and not in the direction you would guess:

```
  studio            10/11   91%
  type-foundry      12/15   80%
  institution       10/16   63%
  design-system     13/29   45%
  documentation     15/40   38%
  academic           4/11   36%
  product            8/24   33%
  editorial          8/27   30%
```

The sites that care most visibly about type are the ones most likely to be
paying for a finer grid than they need. That is the same finding as the rhythm
survey seen from the other side: a design system is disciplined about the grid
and sets four sizes on it, and a studio sets eleven expressive ones and takes
whatever pitch the convention handed them.

Slack pays 62.31px at 8px and 53.03px at 10px. Production Type pays 49.34px
against 37.16px. PatternFly pays 13px against 5px, which is to say it could have
had a grid a quarter coarser for a third of the compromise.

### Cheapest is the wrong question

A finer grid nearly always costs less, and a 1px grid costs nothing because it
constrains nothing. A grid is worth having because it is coarse. So the tool
reports the whole table and takes `--budget`, which asks the question with
something in it: **the coarsest grid you can afford.**

```
For 6px of leading, the coarsest grid you can have is 6px,
and it costs 4px across 6 sizes.
```

---

## Finding: an inline element takes its line off the grid

`<code>` in a paragraph. A `<small>`, a badge, a superscript. Half-leading is
(line-height minus content height) over two, and content height comes from the
font at its rendered size, so an inline at a different size sits its baseline
elsewhere inside its own leading box. Align the two baselines and the line comes
out taller than its line-height, and every declaration involved is defensible.

**The engines disagree about what triggers it**, which is the part worth
knowing:

```
                                    Chromium   WebKit
inline, same family and size            -          -
inline, other family                    -       +1.5
other family, smaller size            +1        +2.5
other family, inline-block              -       +1.5
other family, line-height 0             -          -
```

Chromium needs a different size and a different family alone is harmless. WebKit
needs only the family, a size makes it worse, and `inline-block` does not help.

```css
code, small, sub, sup { line-height: 0 }
```

That fixes every case in both, because an inline with no leading contributes no
box, the parent's strut governs the line, and the glyphs draw where they did.
`quoin rhythm` names the element, its size, and what to set.

### How far it reaches

**It does not propagate.** `text-box-trim` ends a box at its last baseline, so a
line that grew inside a block is cut away at both edges and the next block starts
where the arithmetic said it would. What the trim cannot protect is the block's
own first baseline when the inline lands on the first line: that one moves, by
1.5px in the case measured, and it stops there.

Which is worth stating plainly as a limit of the method rather than leaving to be
discovered. A defect contained to one block is a blemish. One that moves
everything below it would be the thing this library exists to stop, and it is
not that.

**On quoin.dev it was eighteen of the nineteen paragraphs off the rhythm, against
two of the forty-six on it**, and all of it was `code` set at 0.82em. One line of
CSS took the page from 77% to 93.6%.

## Finding: vertically the problem does not exist

Everything above assumes lines stack downwards and baselines are horizontal
rules. In `writing-mode: vertical-rl`, which is how Japanese and Chinese and
Korean have been set for most of their history and how they are still set in
novels and newspapers and manga, the block axis runs across the page and lines
stack sideways. The question is whether the same correction applies, turned
ninety degrees.

It does not, and the reason is better than the answer.

Horizontally the alphabetic baseline sits at half the leading plus the ascent.
Half the leading is a number the designer wrote down; the ascent belongs to the
typeface, and comes out of a table inside a font file that the designer has
never opened. The sum lands wherever that asymmetry puts it, which is the whole
reason this library exists.

Vertically the dominant baseline is the central one, and central means centred.
Measured with a zero-sized inline box aligned to the baseline, which is the one
probe that reports the dominant baseline in whichever mode it is in:

```
mode              leading   baseline at   off centre
horizontal            32         23            7
horizontal            30         22            7
vertical              32         16         centred
vertical              30         15         centred
```

There is no ascent in it. The asymmetry is not reduced or easier to correct; it
is absent, because the baseline the browser aligns to vertically is the one
defined as the middle of the em.

**With one exception, found late and worth stating precisely.** Firefox honours
a CJK font's own vertical metrics, and a face that does not declare a centred
vertical origin is not centred there. Noto Sans JP sits 0.9px off in Firefox and
exactly centred in the other two; Inter and EB Garamond are centred in all
three.

The offset is constant across every leading, which is the property that matters.
A constant shifts every baseline on the page by the same amount, and solving the
origin absorbs it, which is why a fitted page still reads 29 of 29 in the engine
that is not centring it. What it costs is one real limit: **two faces on one
vertical page, where one declares vertical metrics and the other does not, do
not share a grid in Firefox.**

That exception was invisible for a while, and the reason is the more useful
lesson. Every probe behind the original claim loaded its fixture font with a
root-relative URL from a page created by `setContent`, which leaves the document
on `about:blank`. A relative URL resolves to nothing there, no request is made,
the interceptor never fires, and the browser falls back in silence. Every
measurement said Noto Sans JP and every measurement was Times New Roman, whose
ascent and descent sum to 1.107 em against Noto's 1.448. The tests now assert
that the face which arrived is the face that was asked for, because a test that
measures the wrong font and passes is worse than one that fails.

So the vertical rule has no font in it at all:

1. every leading a whole number of rows,
2. every leading the same parity in rows,
3. every space a whole number of rows.

**No cap height, no OS/2 table, no rasteriser probe, no `text-box-trim` and no
browser.** `quoin fit --vertical` reads a design and returns it fitted without
opening a font file, because there is nothing in the arithmetic that depends on
one.

### The parity, which the first prediction got wrong

Between one block's last baseline and the next block's first lies
`leadingA/2 + space + leadingB/2`. The obvious reading is that each half must be
a whole number of rows, so each leading must be an even number of them, and that
is what was predicted here and written into a probe as the expected result.

The probe disagreed. All-odd holds too, and it holds in all three engines. Two
odd leadings leave half a row on each side and the two halves sum to a whole
one. What fails is a mix, which is exactly what the horizontal method's
composability is for: any two blocks in the design must be able to meet without
consulting each other. So the condition is parity rather than evenness, and the
fitter solves both parities, costs each in pixels moved, and takes the cheaper.
Ties go to even, because even leadings also put every half-line on a row and
that is worth having for nothing.

The test that carries this records the wrong prediction in its name, so the
correction cannot be quietly lost the next time somebody reasons about it from
first principles and reaches the same wrong place.

### The engine that cannot run the horizontal suite runs this one

The Firefox this repository can test against is the one Playwright ships, which
is 153: one release short of `text-box-trim`. Every horizontal browser test here
skips it for that reason, and the skips are real rather than defensive. Shipped
Firefox has had trim since 154 in August 2026, so this is a gap in what the
suite can verify rather than a gap in what Firefox can do.

The vertical tests do not skip it, and it passes all of them. A fitted page
reads the same in all three engines:

```
chromium   odd parity, rows 3/3/5, 29 of 29 baselines on the grid
firefox    odd parity, rows 3/3/5, 29 of 29
webkit     odd parity, rows 3/3/5, 29 of 29
```

Which follows from the rest of it rather than being a separate piece of luck,
and it is the useful form of the finding. The horizontal method needs a CSS
property that reached Baseline three weeks ago and is absent from every browser
older than that. The vertical method asks the engine for nothing except that it
centre a line box and put the dominant baseline in the middle, which every
engine has done since long before any of this existed. Vertical text can be put
on a grid in a browser from 2019.

### Checking one, which is the other half

`quoin check --vertical` measures a vertical page the same way: half the
leading in from the block-start edge, no font read. It reports the parity split
as well as the percentage, because mixed parity is the one thing that breaks
such a page and a percentage does not say which leading is at fault.

The round trip, on a page written by hand in a system font with no font file
anywhere in it:

```
  4 text blocks, leadings 41 / 27 / 17.5 on an 8px grid
  2 of 4 on the grid  (50%)     leadings: 0 even, 0 odd, 3 not a whole number of rows

  quoin fit --vertical  ->  40 / 24 / 24, all odd

  4 of 4 on the grid  (100%)    worst drift 0.00px
```

Pointed at a horizontal page it says so and counts the blocks it did not
measure, rather than returning a percentage over an empty set. That failure was
available and is the one this project keeps finding in itself.

### Ruby, which puts the font back

Furigana is ordinary in Japanese vertical setting, so a tool that claims to fit
vertical Japanese has to survive it. The 1.24.0 README named ruby as the thing
to be suspicious of and left it untested. It was right to be suspicious.

An annotation is a second, smaller run of type beside the base text. If the
leading cannot hold both, every engine reserves the difference at the
block-start edge: the first baseline moves in, and the block grows by the same
amount. Horizontally `text-box-trim` cuts exactly that away and the damage stops
at the block. Vertically there is no trim, so it reaches everything below.

No CSS fixes it. `line-height: 0` on `rt`, on `ruby`, on both, and
`ruby-position: inter-character` all leave it precisely where it was. Only
`rt { display: none }` restores the grid, and that is deleting the content
rather than fitting it.

Give the line enough leading and the reservation is exactly zero in all three
engines:

```
leading >= (size + 2 x ruby) x (ascent + descent) / em
```

Measured across sixteen size pairs, then checked at ten more it had never seen,
in three engines: 58 of 60 held, the other two short by half a pixel, so the
fitter adds one.

**And that ratio is a font metric, which is the whole point.** The vertical
baseline is font-free and stays font-free. An annotation is not a baseline, it
is a box, and a box is font-sized. Ruby puts back exactly the dependence that
vertical writing takes away, and only for the designs that carry it.

So `fitVertical` takes `ruby` and `emRatio` together on a step. Given `ruby`
without `emRatio` it reports the step as `rubyUnmet` and leaves the leading
alone, the same refusal as a font that declares no cap height: a guess would put
every baseline on the wrong row while looking like it worked.

### Two wrong answers on the way to that one

Both were nearly published, and both are in the tests by name.

**The first floor was a constant.** `1.15 x (size + 2 x ruby)`, fitted across
three faces that gave identical readings, from which the conclusion was drawn
that the floor does not depend on the typeface. The three faces were the same
fallback font. The probe served them from a page on `about:blank`, where the
`@font-face` could not load and the request interceptor never fired. Eight faces
later reporting an identical ascent-plus-descent of 1.107 em was the tell, and
1.107 is Times New Roman. The conclusion was the exact opposite of the truth,
and it was reached by a control that could not fail.

**The second was a half pixel.** Four held-out cases looked like the real floor
failing, and every one of them was at an odd leading. Plain vertical text with
no ruby anywhere on the page shows the same half pixel at the same leadings in
Chromium. It is baseline rounding, not ruby, and a fitted design on an even
pitch never has an odd leading.

### Still not covered

`text-orientation: upright` and `vertical-lr` are measured and hold. Ruby is
measured and holds under the floor above. What has not been tried is ruby in
`vertical-lr`, ruby with `ruby-align` other than the default, and any of this
against a real Japanese publication's setting rather than a fixture.


## The command line

```bash
npx quoin check  https://example.com
npx quoin check  https://example.com --pitch 4 --min 90   # exits 1 below the floor
npx quoin seat   https://example.com -o baseline.css
npx quoin rhythm https://example.com
npx quoin scale  --font "EB Garamond" --sizes 16,28,44
npx quoin fit    --design design.json
npx quoin print  https://example.com
npx quoin columns https://example.com
npx quoin engine --browser firefox
```

`check` walks a page and reports, and takes `--vertical` for a page set in a
vertical writing mode. `seat` corrects it and prints the stylesheet.
`rhythm` says which boxes are not a whole number of rows and why. `scale` solves
a type scale that needs no correction at all. `fit` takes a design and returns it
unchanged with the spacing that puts it on the grid at every width. `engine` tells
you whether this browser's cap heights come off the rasteriser. `print` renders
the page to PDF and reads the baselines back out of the file. `columns` measures
the other axis, and says whether the column module divides. `pitch` says which
grid a design can afford, before a font is chosen.

### The flags

The grid itself:

```bash
--pitch <px>          the row height (default 8)
--origin <px|auto>    where the grid starts (default auto)
--tolerance <px>      how far off a baseline may be and still count (default 0.5)
--edge <text-box-edge>   default "cap alphabetic"; ex and text also work
```

Reading a page:

```bash
--viewport <w>x<h>    the size to measure at, repeatable for several
--wait <ms>           how long to give the page after load
--ignore <selector>   blocks to leave out, repeatable
--browser <name>      chromium, firefox or webkit
```

Writing the correction:

```bash
--out, -o <file>      write to a file instead of stdout
--mode <class|attr>   how seat addresses the blocks it corrects
--important           add !important, for correcting past a stylesheet you do not own
--space <margin|padding>   which property carries the space (default margin)
--columns             emit break-inside: avoid too, for a page in columns
```

Solving a design:

```bash
--design <file|->     a design as JSON. Use - for stdin
--from <url>          read the design off a page instead
--font <family>       the family to solve for, for scale
--sizes <a,b,c>       the sizes to solve, for scale
--near <px>           how far from those is acceptable (default 3)
--vertical            fit for vertical-rl, which needs no font
--parity <even|odd>   force the vertical parity. Solved when omitted
```

Reporting:

```bash
--min <percent>       exit 1 below this, for CI
--print-margin <pt>   the @page margin, for print. Solved when omitted
--grid-columns <n>    columns for the horizontal check. Solved when omitted
--gutter <px>         the gutter between them. Solved when omitted
--figma               read --design as a Figma export. Usually detected
--figma-minimum <n>   nodes a combination needs to count as a step (default 1)
--budget <px>         leading you are willing to spend, for pitch
--json                machine-readable output
```

`--origin` takes a number or `auto`, and `auto` is the default.

The library has no dependencies. The CLI drives a real browser, so it needs
Playwright, and says so plainly if you have not got it.

---

## The site

> Not deployed anywhere yet, and the obvious domain is taken: `quoin.dev` is
> the login page of Quoin Systems Limited, an unrelated company. Everything
> below that names quoin.dev means the page in `site/`, which is where every
> figure quoted from it was measured. Nothing here has ever been served from
> that domain.

The site in `site/` is built out of this repository with
`npm run build:site`, and the last thing that build does is point Quoin at the
page and write the corrections to `baseline.css`. The claim in its footer is
true by construction rather than by assertion, and the build fails if seating
the page drops below 95% at any breakpoint.

Two things that came out of building it, both of which are in the tool now.

**Every hairline is a pixel in the flow.** Six section borders and seventeen
table rows at 32+1 put twenty-three pixels of accumulated offset into the page,
and everything below them drifted by exactly that. The site now subtracts each
border from its own padding, so a bordered box is still a whole number of grid
rows. This is the same cause the corpus survey found on craighawkes.dev.

**The site is seated once per breakpoint, and it should not have to be.** That
arrangement predates the fitter and is the clearest demonstration of why the
fitter exists: quoin.dev changes its layout at six ranges, not merely its line
breaks, so a correction taken in one range is describing a different page in the
next. Measured properly, corrections carry across reflow perfectly well and fail
on a layout change, which is the table further up.

A design fitted rather than corrected needs none of it, because there is nothing
to carry. Rebuilding the site on a fit is the obvious next thing and is not done
yet, so this paragraph is a description of the site rather than a recommendation.

---

## The browser extension

The console one-liner works everywhere, and typing it on every page you want to
look at gets old. The extension is the same 26 kB with a panel on it.

```bash
npm run build:extension     # then load ./dist-extension unpacked
```

It measures the page you are on, draws the grid over it, seats it, and hands you
the verified stylesheet. The panel reports what it could not reach as plainly as
what it could: closed shadow roots, frames, and nodes under a transform are
named rather than quietly dropped out of the denominator.

**It asks for `activeTab`, not host permissions.** That is the difference between
an install prompt saying "read your data on the site you are on" and one saying
"read your data on all websites". A measuring tool has no business asking for the
second, and the cost is real: `activeTab` is granted by a click on the toolbar
icon, so the extension cannot be driven from outside without a second build. The
test suite uses one, scoped to `127.0.0.1`, and it differs from the shipped
extension by exactly that one line.

**Why an extension rather than a hosted "paste your URL" page.** A page's
Content-Security-Policy governs script tags injected from outside, and a hosted
service has no other way in. Measured across four sites:

| | Stripe | GitHub | Klim | Linear |
|---|---|---|---|---|
| a `<script>` tag, which a hosted service must use | no | no | yes | yes |
| `chrome.scripting`, which the extension uses | yes | yes | yes | yes |

The two most famous URLs anyone would paste into a playground are the two it
could not measure. The extension injects in a world the page's policy does not
govern, so it works everywhere the console does.

---

## The GitHub Action

```yaml
- uses: hawkbass/quoin@v1
  with:
    urls: |
      /index.html
      /about
    directory: ./dist
    widths: "1280,900,375"
    ignore: "h1,.hero"
```

It serves the built directory, measures every page at every width, compares
against a committed `.quoin-baseline.json`, and leaves one comment on the pull
request, edited in place rather than added to on every push.

**The gate is a regression, not a floor.** `--min 90` is the obvious CI gate and
it is the wrong primitive: almost no real page is at 90, so the number a team can
actually set is the number they are already at, and then the gate does nothing
until somebody edits it. The corpus says the median page is at 28%. So the first
run records where you are and every run after that fails if you go backwards.
Improvements land freely. An absolute floor is still available through `min`,
off by default, and it applies on the first run too.

**The delta is in blocks, not percent.** A percentage moves when the page gains
a paragraph, and a tool that blocks a pull request because somebody added copy is
a tool that gets removed. A change in the denominator is reported next to the
count rather than folded into the verdict.

**Rhythm is a gate as well as phase**, and it has to be. A hairline border moves
every block below it by one pixel, so the page splits into two phases a pixel
apart; on an 8px grid with half a pixel of tolerance an origin sitting between
those halves is within tolerance of both, and the phase count does not move at
all. The first version gated on phase alone and waved through the commonest
defect there is. The test that catches it is in `test/browser/action.spec.ts`,
and it asserts the rhythm regression specifically, because writing it the other
way round is how it passed while being wrong.

```
### Quoin

**1 reading came off the grid.**

| | Page | Width | On grid | | Δ | Rhythm |
|---|---|---|---|---|---|---|
| 🔻 | `index.html` | 1280px | 275/275 | 100% | | 5/7 -2 |

**Where the drift comes from**

- `index.html` html > body > header.hero is 5px past a row, which moves 274
  blocks. Subtract the border from this box's own padding: padding 50px instead
  of 53px keeps the rule and the rhythm.

Phase held and rhythm did not. A box that is not a whole number of rows shifts
everything after it, and it shifts it by a different amount at every viewport,
so no correction above it survives a reflow.
```

`widths` takes a list and each width is its own reading, because a page can be on
the grid at one width and off it at another and a single-width gate would not
know. That is true of a corrected page whose layout changes at a breakpoint, and
it is worth measuring even on a fitted one: fitting guarantees the type holds at
every width, and it guarantees nothing about a container whose padding stops
being a whole number of rows below 700px.

The action is plain Node against the built bundle, with no dependency tree of its
own: an action that pulls one is an action that breaks on somebody else's
release.

---

## API

| | |
|---|---|
| `seatPage(options)` | seat the whole page, returns an undo |
| `exportCss(result, options?)` | the corrections as a stylesheet with real selectors |
| `exportCssVerified(result, options?)` | the same, applied and re-measured, escalating only what lost |
| `checkExport(result, css)` | which declarations the page's own CSS overrules |
| `verifyGrid(options)` | walk a rendered page, report every line |
| `verifyRhythm(options)` | which boxes are not a whole number of rows, and why |
| `bestOrigin(baselines, grid)` | the grid origin that seats the most of them |
| `walk(root, options?)` | every element owning words, plus what could not be entered |
| `textBlocks(root, ignore)` | the same, blocks only |
| `measureFont(shorthand, size?)` | ascent, descent, cap height, x height |
| `measureFontWithCap(shorthand)` | the same, with a cap height that travels. Check `capSource` |
| `capHeightFromFontTable(shorthand)` | the font's own `sCapHeight`, via CSS. **Portable** |
| `canReadFontTableCapHeight()` | whether this engine can do the above |
| `capHeightIsRasterised(family?)` | whether this engine rounds cap heights to whole pixels |
| `baselineWithinLineBox(metrics, lh)` | where the baseline sits in the box. **Portable** |
| `capOvershoot(metrics, lh)` | the gap `text-box-trim: cap` removes |
| `checkBaseline(position, grid)` | signed drift against the grid |
| `snapLineHeight(preferred, grid)` | nearest line-height that keeps the rhythm |
| `seatingShift(drift, grid)` | how far down to push a baseline to seat it |
| `seatingPadding(within, blockTop, grid)` | top and bottom padding that sum to one grid row |
| `gridNativeScale(font, options)` | solve a type scale that needs no correction |
| `fitScale(families, options)` | fit a design to the grid, keeping every size it asked for |
| `inferDesign(options)` | read a design off a rendered page, in the shape `fitScale` takes |
| `fitFromFiles(families, files, options)` | the same fit from font files, with no browser |
| `readFontMetrics(bytes)` | units per em and cap height from a TTF, OTF or WOFF |
| `boxHeightForEdge(font, edge)` | the height of a trimmed box for any `text-box-edge`, or null |
| `normaliseDesign(input)` | a design in whatever shape you have it, in the shape `fitScale` wants |
| `fittedScaleToCss(fitted)` | that fit as CSS, with the trim it depends on |
| `scaleToCss(scale)` | that scale as custom properties, with its origin |
| `uniqueSelector(el)` | a selector verified to match exactly that element, or null |
| `inShadowRoot(el)` | whether a stylesheet can reach it at all |
| `gridConfig(options)` | validate a grid, or throw |
| `makeBaseline(entries, version, when)` | a committed record of where a page stands |
| `compareToBaseline(baseline, fresh, allowed?)` | what moved, in blocks rather than percent |

Drift is signed rather than absolute, on purpose. A page where everything is 3px
low has one systematic error and one fix. A page where drift alternates has a
different problem, and collapsing the sign hides which one you have.

`gridConfig` refuses a pitch of zero and a tolerance of half the pitch or more.
Both would report every baseline on the page as perfect, which is the worst
possible failure for a measuring tool: silent, and flattering.

---

## What it will not do

**It will not snap your headlines.** Body text is the job. A headline at 4rem with
tight leading is a shape rather than a line of reading, and forcing one onto an
8px rhythm makes it worse, so display type opts out by selector. A grid you cannot
opt out of gets switched off entirely, and then you have no grid at all.

**It will not fail on half a pixel.** Sub-pixel layout, fractional line-heights
and device pixel ratios land baselines a fraction off constantly. A tool that goes
red on 0.02px is a tool you uninstall on the second day.

**It will not claim a correction it did not make.** Every seat is re-measured, and
blocks it could not move are reported as missed rather than counted as fixed.
Blocks it moved but could not build a selector for are reported separately.
Declarations the page's own CSS overrules are reported rather than assumed to
have taken.

**It will not pretend it saw everything.** Closed shadow roots, frames and
transformed subtrees are counted and named rather than dropped out of a
percentage.

**It will not tell you your site is fine.** Pointed at the site that ships it, it
reports 22.2% of text on grid before it runs.

**It will not work on a page that refuses injected scripts.** That is a correct
content security policy, and there is no way around it from outside the page.

---

## Install

```bash
npm install quoin
```

Or drop the single file into any page, including one that is not yours:

```html
<script src="https://unpkg.com/quoin/dist/quoin.global.js"></script>
```

Then `quoin.check()` in the console.

---

## Tests

```bash
npm test              # 180 unit tests: the arithmetic and the plugins, in Node
npm run test:browser  # 340 browser tests across Chromium, Firefox and WebKit
npm run test:linux    # the browser suite in the image CI uses, needs Docker
npm run fonts         # download the 24-font corpus
npm run corpus        # measure 212 live sites and write findings/corpus.md
npm run fittable      # what a grid would cost each of them, in leading
npm run wild          # seat five of them and check the exported CSS holds
npm run build:extension:test && npx playwright test test/browser/extension.spec.ts
```

The unit tests cover the pure maths against hand-computed cases, including the
properties rather than the examples: that a seating shift never moves text
upward, never exceeds one pitch, and always lands the baseline on the grid, swept
across every sub-pixel drift in a whole row.

That paragraph was in this README for four months before the file existed. It is
worth saying which way round that happened.

The browser tests run against fixtures built to reproduce the cases the seater
exists for: a flex row that defeats padding, a page with two phases and a page
with one, a component framework's scoped selectors outranking the export, and a
torture page with shadow roots, frames, multi-column, drop capitals, tables,
right-to-left text, vertical writing, `display: contents`, `content-visibility`,
fourteen levels of nesting and three hundred generated paragraphs.

The CLI, the extension and the GitHub Action are tested through their real entry
points rather than by importing a function out of them: the action runs as a
subprocess with its inputs arriving as environment variables and its outputs read
back out of a `GITHUB_OUTPUT` file, because that is the only interface a workflow
has. Two bugs were found that way and neither was reachable from the inside. The
static server wrote its 200 header before reading the file, so a missing page
crashed the run instead of reporting a 404, and the absolute floor was skipped
entirely on the first run, so a page below a floor somebody had deliberately set
went green.

---

## Status

**1.4.** The arithmetic is tested, the seater and the CSS export are tested
against fixtures that reproduce the cases they exist for and against five live
design systems, and the cross-engine findings are regenerated from real browsers
rather than replayed from a recording. 83 unit tests, 303 browser tests across
three engines, and a 212-site study that reproduces with one command.

The library, the command line, the browser extension and the GitHub Action are
each tested through the interface somebody actually uses.

Not published to npm.
