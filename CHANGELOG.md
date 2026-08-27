# Changelog

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
