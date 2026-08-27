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

MIT. No dependencies. 17 kB.

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

The tool bundles to 17 kB with no dependencies, so it can be dropped into any
page. Pointed at the reference design systems, homepages at 1280px, half-pixel
tolerance:

| Design system | Nodes | On a 4px grid | On an 8px grid | Distinct drifts |
|---|---|---|---|---|
| Shopify Polaris | 56 | 50.0% | 30.4% | 4 |
| Atlassian Design | 70 | 47.1% | 14.3% | 16 |
| Ant Design | 222 | 36.5% | 19.8% | 19 |
| GOV.UK Design System | 76 | 30.3% | 19.7% | 5 |
| Material Design 3 | 130 | 30.0% | 16.2% | 5 |
| **craighawkes.dev** | 108 | 22.2% | 6.5% | **11** |
| Tailwind CSS | 193 | 19.7% | 11.4% | 18 |
| IBM Carbon | 52 | 19.2% | 15.4% | 23 |
| Salesforce Lightning | 58 | 17.2% | 3.4% | 23 |

`npm run corpus` reproduces it. Raw output in `findings/corpus.json`.

**None of these sites claims a baseline grid, so being off one is not a defect.**
The table describes the medium rather than the teams: a convention print has had
since metal type, which the best resourced design systems in the industry do not
have either.

**Read the last column first.** Percentages say how far off a page is. Distinct
drift values say whether it is off in an *orderly* way. Four or five across a
whole homepage means the type scale and the spacing scale agree with each other.
Twenty-three means they are having different conversations.

craighawkes.dev sat at **ninety** distinct drifts when the survey first ran, last
in the table by three times, on the one measurement it had built the instrument
for. Three causes, all found by measuring: a media query in another file
restoring a unitless `--leading-normal` at every desktop width, twenty-one 1px
hairlines each adding a pixel of layout, and a fluid type scale whose fractional
sizes give fractional ascents.

Dropped rather than scored: Adobe Spectrum (21 text nodes) and GitHub Primer (36)
render too little at load to characterise. Stripe refuses injected scripts, which
is a correct content security policy and a real limit on the method.

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

## The command line

```bash
npx quoin check https://example.com
npx quoin check https://example.com --pitch 4 --min 90    # exits 1 below the floor
npx quoin seat  https://example.com -o baseline.css
npx quoin engine --browser firefox
```

`check` walks a page and reports. `seat` corrects it and prints the stylesheet.
`engine` tells you whether this browser's cap heights come off the rasteriser.

The library has no dependencies. The CLI drives a real browser, so it needs
Playwright, and says so plainly if you have not got it.

---

## The browser extension

The console one-liner works everywhere, and typing it on every page you want to
look at gets old. The extension is the same 17 kB with a panel on it.

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

## API

| | |
|---|---|
| `seatPage(options)` | seat the whole page, returns an undo |
| `exportCss(result, options?)` | the corrections as a stylesheet with real selectors |
| `exportCssVerified(result, options?)` | the same, applied and re-measured, escalating only what lost |
| `checkExport(result, css)` | which declarations the page's own CSS overrules |
| `verifyGrid(options)` | walk a rendered page, report every line |
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
| `uniqueSelector(el)` | a selector verified to match exactly that element, or null |
| `inShadowRoot(el)` | whether a stylesheet can reach it at all |
| `gridConfig(options)` | validate a grid, or throw |

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
npm test              # 43 unit tests: the arithmetic, in Node, no browser
npm run test:browser  # 132 browser tests across Chromium, Firefox and WebKit
npm run fonts         # download the 24-font corpus
npm run corpus        # measure twelve live design systems
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

---

## Status

**1.0.** The arithmetic is tested, the seater and the CSS export are tested
against fixtures that reproduce the cases they exist for and against five live
design systems, and the cross-engine findings are regenerated from real browsers
rather than replayed from a recording.

Not published to npm.
