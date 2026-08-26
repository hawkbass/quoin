# Quoin

**It puts a web page on a baseline grid.**

A quoin is the wedge a printer hammers into the chase to lock the type so
nothing shifts on the press. Same job.

```js
quoin.check()   // how much of this page is off the grid
quoin.seat()    // put it on. Call again to lift it back off.
quoin.css()     // the corrections as a stylesheet you can ship
```

MIT. No dependencies. 14 kB.

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
import { seatPage, exportCss } from "quoin"

const seated = seatPage({
  pitch: 8,
  ignore: [".display"],   // headlines are shapes, not lines of reading
  mode: "full",           // also snap leading, so line two lands as well as line one
})

console.log(`${seated.passes} sweeps, ${seated.missed} could not be moved`)
console.log(exportCss(seated))   // ship this, delete the JavaScript
seated.undo()                    // put it back
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
against the document** before writing it out, the same way the seater verifies
its own corrections. Blocks it cannot address uniquely are counted in
`result.unexportable` and named in a comment at the top of the stylesheet, rather
than emitted as a rule that matches something else.

The test that replaced the old one seats the page, exports, **undoes everything**,
injects the stylesheet on its own, and re-measures. If the CSS does not reproduce
the seating without the JavaScript, it fails.

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
to a question this tool had previously answered "no", and the change is the
useful kind, so here is the whole thing.

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

At 18px, both Chromium and WebKit report **10.797px**, which is the declared
value. The glyph is 12.6px. They read the table.

The other two manufactured fonts take the metric away instead: OS/2 dropped to
version 1 so the field does not exist, and `sCapHeight` set to 0. Both engines
fall back to the outline, and agree with each other on the fallback.

### The result

Over 124 comparable font-and-size rows, at 12, 16, 18, 24 and 48px:

| | agree within 0.5px | worst spread |
|---|---|---|
| Cap height via `text-box-edge: cap` | **124 / 124** | **0.016px** |
| Cap height via canvas `actualBoundingBoxAscent` | 85 / 124 | 0.864px |

0.016px is 1/64 of a pixel, which is layout-unit quantisation rather than
disagreement. And where the font declares a usable `sCapHeight`, all 109 rows
match `sCapHeight / unitsPerEm × size` to within **0.02px**, computed in Node
straight out of the binary with no browser involved. Agreeing with each other
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

*Caveat, because it matters: Playwright's WebKit is not Safari. Same engine,
without Apple's font stack or CoreText rasterisation. Good evidence about the
engine, weak evidence about the browser. Playwright currently bundles Firefox
153, which is one release short of `text-box-trim`, so Firefox's column in the
font-table table is measured by inference from its canvas rather than directly.*

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

## Finding: nobody has a baseline grid

The tool bundles to 14 kB with no dependencies, so it can be dropped into any
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
import { verifyGrid, offGrid } from "quoin"

const { results, report, skippedTransformed } = verifyGrid({ pitch: 8 })
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

### Nodes under a transform are excluded, and counted

`getBoundingClientRect` reports the transformed box while `line-height` stays in
untransformed px, so the two are in different coordinate spaces and a drift
computed from them is not a drift. Those nodes are reported in
`skippedTransformed` rather than folded into a percentage they cannot be part of.
Pass `includeTransformed: true` if you want them anyway.

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

## API

| | |
|---|---|
| `seatPage(options)` | seat the whole page, returns an undo |
| `exportCss(result, options?)` | the corrections as a stylesheet with real selectors |
| `verifyGrid(options)` | walk a rendered page, report every line |
| `textBlocks(root, ignore)` | every element that owns rendered words, in document order |
| `measureFont(shorthand, size?)` | ascent, descent, cap height, x height |
| `measureFontWithCap(shorthand, lh)` | the same, with a cap height that travels. Check `capSource` |
| `capHeightFromFontTable(shorthand)` | the font's own `sCapHeight`, via CSS. **Portable** |
| `canReadFontTableCapHeight()` | whether this engine can do the above |
| `capHeightIsRasterised(family?)` | whether this engine rounds cap heights to whole pixels |
| `baselineWithinLineBox(metrics, lh)` | where the baseline sits in the box. **Portable** |
| `capOvershoot(metrics, lh)` | the gap `text-box-trim: cap` removes |
| `checkBaseline(position, grid)` | signed drift against the grid |
| `snapLineHeight(preferred, grid)` | nearest line-height that keeps the rhythm |
| `seatingShift(drift, grid)` | how far down to push a baseline to seat it |
| `seatingPadding(within, blockTop, grid)` | top and bottom padding that sum to one grid row |
| `uniqueSelector(el)` | a selector verified to match exactly that element |
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
Blocks it moved but could not build a selector for are reported separately, and
named in the stylesheet.

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
npm test              # the arithmetic, in Node, no browser
npm run test:browser  # the walk, the seater, the CSS export, three engines
npm run fonts         # download the 24-font corpus
npm run corpus        # measure twelve live design systems
```

The unit tests cover the pure maths against hand-computed cases, including the
properties rather than the examples: that a shift never moves text upward, never
exceeds one pitch, and always lands the baseline on the grid, swept across every
sub-pixel drift in a whole row.

That paragraph was in this README for four months before the file existed. It is
worth saying which way round that happened.

---

## Status

**0.9.** The arithmetic is tested, the seater and the CSS export are tested
against fixtures that reproduce the cases they exist for, and the cross-engine
findings are regenerated from live browsers rather than replayed from a
recording.

Not published to npm. When it is, this line will say so, and not before.
