# Seating type with Quoin, for agents

You are looking at a design and you have to produce CSS that sets it on a
baseline grid. This is what to do.

The short version: **do not correct the page afterwards. Fit the design first.**
A correction is a repair applied to something already wrong, it is absolute
pixel values for one layout, and it stops being true the moment the viewport
moves. A fitted design needs no corrections at any width, and the sizes come out
the same as they went in.

## The pipeline

```bash
echo '<design json>' | npx quoin fit --design - --pitch 8
```

That prints the CSS. There is no API key, no service, no account. It runs a
browser to read the font's cap height, or reads it out of the font file if you
give it one, and it exits non-zero with a message naming the entry if the design
is wrong.

## Choosing the grid, before you fit to it

If nobody has already committed to a pitch, ask what each one costs before you
pick. It is arithmetic, so it is instant and needs no font:

```bash
npx quoin pitch --design design.json --budget 6
```

Eight is the conventional pitch, not a derived one, and it is often not the
cheapest. A design can cost twice as much at 8px as at 7px, and a *coarser* grid
than eight is sometimes cheaper as well, which means a grid that constrains more
and compromises less.

Do not ask for the cheapest and stop there. A finer grid nearly always costs
less, and a 1px grid costs nothing because it constrains nothing. `--budget` asks
the question that has something in it: the coarsest grid you can afford.

## The design you hand it

Everything is optional except `size`.

```json
{
  "pitch": 8,
  "families": [
    {
      "role": "body",
      "font": "Söhne, system-ui, sans-serif",
      "file": "./fonts/soehne.woff",
      "steps": [
        { "name": "body",    "size": 17, "leading": 27.2, "space": 32 },
        { "name": "heading", "size": 34, "leading": 40.8, "space": 56 }
      ]
    }
  ]
}
```

- `size` is in px and is **never changed**. If a tool tells you to change a
  size to fit a grid, it is the wrong tool.
- `leading` is in px. Snapped to a whole number of rows, which is the only
  thing that moves, usually by a pixel or two.
- `space` is what you want above a block. The fitter returns the nearest value
  that also closes the block's cap height.
- `file` is a font file, relative to the design. Give it one and nothing has to
  launch a browser, which matters in CI.

Spellings are normalised, so `fontSize`, `font-size`, `lineHeight` and
`line-height` all work, as do `sizes`, `scale` and `tokens` for `steps`. Points
are converted. `rem`, `em` and `%` are refused rather than guessed at, because
the value depends on a root size the design has not told you.

If a block has a **border or padding above its first line**, say so. They move
the first baseline by their sum, and the fitter closes them with the space:

```json
{ "size": 17, "leading": 24, "space": 32, "borderTop": 1, "paddingTop": 7 }
```

Same for `borderBottom` and `paddingBottom`, which sit below the last baseline
and push the next block down.

## From a Figma file

Hand it the JSON. It is detected, so no flag is needed.

```bash
curl -H "X-Figma-Token: $TOKEN" \
  "https://api.figma.com/v1/files/$KEY" > design.json
npx quoin fit --design design.json --pitch 8
```

The whole file response works, so does its `document`, so does a single frame
from `/nodes`. Text nodes become steps grouped by family, size and leading, and
the space is taken from the gaps between bounding boxes, because a designer's
spacing lives in the layout rather than in the type styles.

Two things it does on purpose. Hidden layers are skipped, because a hidden layer
is a design somebody rejected. And leading set to `INTRINSIC` is treated as
absent rather than as a decision: Figma reports a resolved figure for it, but
that figure is whatever the font's metrics came to, not anything anybody chose.

## From an image or a screenshot

There is no vision in this library and there should not be. You have vision.
Measure the design and write the JSON:

1. **Sizes**, in px. Cap height to cap height is easier to measure off a
   screenshot than the em box, and if that is what you have, say so: cap height
   is roughly 0.7 of the size for most text faces, so divide.
2. **Leading**, baseline to baseline within a paragraph. This is the reliable
   one: it is a repeated distance, so measure across several lines and divide.
3. **Space**, from the last baseline of one block to the first of the next,
   minus the leading. Or just give the gap you see and let the fitter take the
   nearest value that works.
4. **The family**, by name if you can read it and by its CSS stack if you
   cannot. If you are wrong about the family the cap height is wrong and the
   whole fit is wrong, so `file` is better than a guess.

Do not estimate a cap height and put it in the design. There is nowhere to put
it, deliberately. It is measured from the font, because a cap height guessed to
within five per cent is a baseline wrong by half a row.

## What to do with the output

The CSS sets custom properties per step and rules for any block it could address
by a verified selector. Apply the spaces as `margin-top`, **before** the block
rather than after, because the space closes the cap height of the block it comes
before.

Three cases where that is not enough, all of them measured:

- **Columns.** Use `padding-top` instead, and add `break-inside: avoid`. A
  margin at the top of a column fragment is truncated; padding is not. Pass
  `--columns` and the fitter emits both.
- **Print.** Use `padding-top`, for the same reason: a page box is a
  fragmentainer too. `break-inside: avoid` is not needed there.
- **A block with a background or a border.** Margin and padding are not
  interchangeable on one, so decide rather than swap.


## The one thing that will catch you out

**An inline element in a different size or family takes its line off the grid.**
`<code>` in prose, a `<small>`, a badge, a superscript. Half-leading is
(line-height minus content height) over two, content height comes from the font
at its rendered size, so an inline at a different size sits its baseline
elsewhere inside its own leading box. Align the two baselines and the line comes
out taller than its line-height. Nothing about the CSS looks wrong.

```css
code, small, sub, sup { line-height: 0 }
```

An inline with no leading contributes no box of its own, the parent's strut
governs the line, and the glyphs draw exactly where they did. Verify it rather
than trust it: `quoin rhythm` names the element, its size and what to set.

Two things worth knowing about how far it reaches. It **does not propagate**:
`text-box-trim` ends a box at its last baseline, so a line that grew inside a
block is cut away at the edges and every block below it is unaffected. And the
engines disagree about what triggers it, so test in both if you can: Chromium
needs a different size, WebKit needs only a different family.

On quoin.dev this was eighteen of the nineteen paragraphs off the rhythm against
two of the forty-six on it, and one line of CSS moved the page from 77% to 93.6%.

## Checking your work

```bash
npx quoin check https://your-site.example     # phase: baselines on rows
npx quoin rhythm https://your-site.example    # boxes that are not whole rows
npx quoin columns https://your-site.example   # the horizontal module
npx quoin print https://your-site.example     # every page of the PDF
```

`check` is the one that answers "did this work". If a fitted page reads below
about 95%, something on it is not what the design said, and `rhythm` usually
names it: a border, a padding, or an image with no height.

## Things that will waste your time

**`text-box-trim` is required.** The arithmetic assumes the box is trimmed to
the cap height. Without it the emitted CSS is wrong rather than approximate.
Baseline since Firefox 154, August 2026.

**Do not synthesise a cap height from the ascender.** A font that predates OS/2
version 2 declares none, and the fitter leaves that size out rather than guess.
A guess puts every baseline on the wrong row while looking like it worked.

**Do not fit display type.** A headline is a shape. Snapping its leading to a
row is the one place this method costs something visible, and the tool ignores
it if you tell it to.

**Do not run `seat` and ship the output as a permanent stylesheet.** It is
absolute pixel values for one layout at one width. It is a diagnostic and a
demonstration. `fit` is the answer.
