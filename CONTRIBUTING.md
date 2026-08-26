# Contributing

```bash
npm install
npm run build
npm test                 # the arithmetic, in Node
npm run test:browser     # three engines, against fixtures
```

For the font findings you also need the corpus, which is downloaded rather than
committed because it is 30MB of other people's fonts:

```bash
npm run fonts
npx playwright test test/browser/cap-height.spec.ts
```

---

## Three rules, and the reason for each

**Assert the effect, not the artefact.** If a change produces output that
somebody is meant to *use*, the test has to consume that output the way a user
would. The CSS export shipped for four months with a test asserting the generated
stylesheet contained `padding-top` declarations. It did, and the stylesheet did
nothing at all, because it was keyed on an attribute that only exists while the
script is running. `test/browser/export-css.spec.ts` now seats the page, exports,
undoes everything, injects the stylesheet on its own and re-measures.

**Check the correction rather than trusting it.** This runs through the whole
library and it is not a style preference. The seater applies a correction,
measures again, and reverts if the text did not land where it was sent. The
export builds a selector and runs it against the document before writing it out.
A correction you did not verify is a claim, and a tool that makes unverified
claims about a page is worse than no tool, because it is confidently wrong in a
domain where the reader cannot easily check.

**Say what you could not do.** Blocks neither lever could move are reported as
`lever: "none"`. Blocks with no unique selector are counted in `unexportable` and
named in the stylesheet. Nodes under a transform are excluded and counted rather
than folded into a percentage they cannot be part of. Never let a failure round
down into a success.

---

## Measurement work

If you are adding to the findings, three things have bitten this repository and
will bite again.

**Hold the font still.** Measuring `serif` or `system-ui` across engines measures
font substitution: a generic keyword is a promise that something will be found,
not a statement about what. Use webfonts loaded from the same bytes, and verify
identity by width signature rather than by family name, because `ctx.font` reads
back the family you asked for and not the one the engine found.

**Name the competing hypothesis.** Before drawing a conclusion, ask which input
in the corpus distinguishes it from the obvious alternative. If none does, build
one. Twenty-one real fonts could not tell "reads the declared cap height" from
"measures the drawn glyph", because every real font makes them agree. One
manufactured font that lies settled it in a single measurement. Scale does not
disambiguate hypotheses the data cannot separate.

**Characterise your exclusions.** Rows that fail a validity filter are a sample
selected by that filter. If they share a property the included rows do not, the
filter found a pattern rather than a fault. Two fonts kept failing a check here,
and they were the only two in the corpus with an `opsz` axis.

---

## Voice

No em-dashes or en-dashes, in prose or in comments. Gated by
`npm run voice:check`, which fails the build. British spelling.

Comments explain why, not what. A comment restating the line below it is noise;
a comment recording the thing that was tried and did not work is the most useful
line in the file.

---

## Releasing

1. `npm run test:all`
2. `npm run fonts && npx playwright test test/browser/cap-height.spec.ts`, and
   update any figure in the README that moved.
3. `npm run corpus` if the survey is being republished. Its numbers are not
   comparable across versions that changed what the walk counts, so re-run
   rather than reconcile.
4. Bump the version in `package.json` and in `src/version.ts`. A unit test
   fails if the two disagree, so this cannot be half-done.
5. Write the changelog entry before tagging, including what was found to be
   wrong. A changelog that lists only additions is a marketing document.
