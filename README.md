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
| Type foundries | 15 | 31.3% | 11.9% | 3.7% | 21 |
| Design systems | 27 | 30.8% | 14.3% | **29.5%** | 21 |
| Documentation | 39 | 30.5% | 12.8% | 20.9% | 22 |
| Academic | 7 | 26.9% | 11.5% | 10.0% | 37 |
| Studios | 11 | 26.5% | 9.1% | 8.1% | 28 |
| Product | 24 | 25.2% | 10.6% | 27.5% | 40.5 |
| Editorial | 20 | 24.4% | 10.6% | 18.8% | 47 |

Medians, not means: one site at 4% drags an average and tells you nothing about
the category. 153 sites scored, 59 dropped. `npm run corpus` reproduces it; the
full table is in `findings/corpus.md` and the raw readings in
`findings/corpus.json`.

These are the figures from the committed run. A fresh one moves them by a few
tenths, because it measures live sites and those sites deploy: two runs an hour
apart scored the same 153, and every median moved by less than half a point.

**None of these sites claims a baseline grid, so being off one is not a defect.**
The table describes the medium rather than the teams: a convention print has had
since metal type, which nothing on the web has.

**Not one site in 212 reaches 90%.** The best is Fonts In Use at 89.2%, then
Bureau Borsche at 82.1%, then a gap to Svelte at 60.7%. Seven sites clear 50%.
The median is 28.2%.

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

Every site was measured twice. Pinned to an origin of zero the median is 11.9%;
solved from the page it is 28.2%. Zero asks whether baselines sit on multiples of
the pitch from the top of the document, and a page with a header answers no
however carefully it is set, because everything below the header moved by the
same amount. The Met reads 0.8% against zero and 48.8% against its own origin.
Salesforce Lightning reads 1.8% and 32.7%.

That measurement is why `origin` defaults to `auto` everywhere. An earlier
version of this table was taken against zero and understated every row in it.

### Leading is the cause, on two sites in three

Of the 153 sites scored, the commonest rhythm defect on 106 of them is leading:
a `line-height` that is a ratio rather than a number of rows. `1.5` on 17px is
25.5px, and every extra line in the paragraph carries the half pixel down the
page. After that, 30 sites are led by replaced elements with no quantised height,
9 by padding and 8 by borders.

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

### What the 59 dropped rows say about the method

28 sites render fewer than 25 blocks of text at load, which is too thin for a
percentage to mean anything. 19 were behind a consent dialog, which is a
different page: measuring it and calling the result somebody's design system
would be worse than not measuring at all. 12 failed to load in time or refused
the injected script, which for Stripe and Figma is a correct content security
policy and a real limit on this method rather than a fault in theirs.

Dismissing 19 consent dialogs automatically would have grown the sample and
spoiled it, so the dialogs stand and the count is reported instead.

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

`quoin fit --design - --json` reads a design on stdin and writes the whole result
as JSON, including `leadingWas`, `leadingMoved` and the cap height every figure
was derived from. An agent working from a Figma file or a screenshot has the same
problem a person does and no one to ask, so everything the answer rests on is in
the output rather than in the prose around it.

The contract is small on purpose. Give it a family, a font stack and a list of
sizes; get back those sizes, a leading, a space, and a record of what moved.
Seating type to a grid stops being a matter of taste once the pitch is fixed and
becomes arithmetic, and this is the arithmetic.

```bash
cat design.json | npx quoin fit --design - --json
```

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

It does not make fluid type work. `clamp()` varies the size continuously, and
only discrete sizes have a known cap height, so a fluid scale is off the grid
between its endpoints by construction. Set the sizes at breakpoints instead;
each one is fitted independently and they do not have to agree with each other.

It does not fix boxes that are not whole rows. Borders, padding and image heights
still have to be multiples of the pitch, and `quoin rhythm` is what tells you
which ones are not.

---

## The command line

```bash
npx quoin check  https://example.com
npx quoin check  https://example.com --pitch 4 --min 90   # exits 1 below the floor
npx quoin seat   https://example.com -o baseline.css
npx quoin rhythm https://example.com
npx quoin scale  --font "EB Garamond" --sizes 16,28,44
npx quoin fit    --design design.json
npx quoin engine --browser firefox
```

`check` walks a page and reports. `seat` corrects it and prints the stylesheet.
`rhythm` says which boxes are not a whole number of rows and why. `scale` solves
a type scale that needs no correction at all. `fit` takes a design and returns it
unchanged with the spacing that puts it on the grid at every width. `engine` tells you whether this
browser's cap heights come off the rasteriser.

`--origin` takes a number or `auto`, and `auto` is the default.

The library has no dependencies. The CLI drives a real browser, so it needs
Playwright, and says so plainly if you have not got it.

---

## The site

[quoin.dev](https://quoin.dev) is built out of this repository with
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
npm test              # 83 unit tests: the arithmetic, in Node, no browser
npm run test:browser  # 303 browser tests across Chromium, Firefox and WebKit
npm run fonts         # download the 24-font corpus
npm run corpus        # measure 212 live sites and write findings/corpus.md
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
