/* Reading a design off a page that already exists.

   Most people have a site rather than a design file, and the question they want
   answered is what to change about the site they have. `inferDesign` walks a
   rendered page, groups every block of text by the family, size and leading it
   actually resolved to, and hands the result back in the shape `fitScale` takes,
   so `quoin fit --from <url>` is the two of them joined up.

   It reads what the browser resolved rather than what the stylesheet asked for,
   which is the whole reason this library runs in the page. Between the two sit
   an inherited line-height, a component library's reset, a webfont that failed
   to load, and a heading with a `clamp()` that resolved to something the type
   scale never anticipated. */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIT_BUNDLE = readFileSync(resolve("dist/quoin.fit.js"), "utf8");
const BUNDLE = readFileSync(resolve("dist/quoin.global.js"), "utf8");

interface Inferred {
  families: {
    role: string;
    font: string;
    steps: { name: string; size: number; leading: number; space: number }[];
  }[];
  rare: { font: string; size: number; leading: number; blocks: number }[];
  blocks: number;
  covered: number;
}

const PAGE = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; font-family: serif }
  main { width: 92%; max-width: 700px; margin: 0 auto }
  h1 { font-size: 40px; line-height: 44px; margin: 0 }
  h2 { font-size: 26px; line-height: 32px; margin: 0 }
  p  { font-size: 17px; line-height: 25.5px; margin: 0 }
  .mono { font-family: monospace; font-size: 14px; line-height: 24px }
  .oneoff { font-size: 9px; line-height: 11px }
</style>
<main>
  <h1>A heading</h1>
  <h1>A second heading, because one block is a one-off</h1>
  <h2>A subheading</h2>
  <h2>Another subheading</h2>
  <p>A paragraph of body text.</p>
  <p>A second paragraph.</p>
  <p>A third paragraph.</p>
  <p class="mono">a line of code</p>
  <p class="mono">another line of code</p>
  <p class="oneoff">A single one-off size nobody else uses.</p>
</main>`;

async function infer(
  browser: import("@playwright/test").Browser,
  html = PAGE,
  options: Record<string, unknown> = {}
): Promise<Inferred> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: FIT_BUNDLE });
  const result = await page.evaluate(
    (o) =>
      (window as unknown as { quoinFit: { inferDesign: (o: unknown) => Inferred } })
        .quoinFit.inferDesign(o),
    options
  );
  await page.close();
  return result;
}

test("it groups blocks by what the browser resolved, not by selector", async ({
  browser,
}) => {
  const design = await infer(browser);

  /* Two families: the serif everything inherits, and the monospace on the code
     blocks. Grouping by selector would have produced five. */
  expect(design.families).toHaveLength(2);

  const fonts = design.families.map((f) => f.font);
  expect(fonts.some((f) => /monospace/.test(f)), "the code blocks are their own family").toBe(
    true
  );
});

test("the commonest family is the one called body", async ({ browser }) => {
  /* Whichever family carries the page's reading is the one somebody looks at
     first, so it is named for what it is rather than by the order the walk
     happened to find it in. */
  const design = await infer(browser);
  expect(design.families[0]!.role).toBe("body");
  expect(design.families[0]!.font).toMatch(/serif/);
});

test("steps carry the sizes the page actually sets, in order", async ({ browser }) => {
  const design = await infer(browser);
  const serif = design.families.find((f) => /serif/.test(f.font))!;

  expect(serif.steps.map((s) => s.size)).toEqual([17, 26, 40]);
  /* The leading comes back as resolved, including the one that is not a whole
     number of rows: 1.5 on 17px is 25.5, and reporting it as 24 here would be
     the inference doing the fitter's job and hiding the finding. */
  expect(serif.steps.find((s) => s.size === 17)!.leading).toBe(25.5);
});

test("steps are named for whatever tag uses them most", async ({ browser }) => {
  const design = await infer(browser);
  const serif = design.families.find((f) => /serif/.test(f.font))!;
  const names = serif.steps.map((s) => s.name);

  expect(names).toContain("p");
  expect(names).toContain("h1");
  expect(names).toContain("h2");
});

test("a one-off size is left out and reported rather than silently dropped", async ({
  browser,
}) => {
  /*
     A page has a long tail of sizes used once, usually a widget or a third
     party, and fitting them produces a stylesheet with forty entries nobody
     asked for. Leaving them out is right; leaving them out quietly is not.
  */
  const design = await infer(browser);

  const sizes = design.families.flatMap((f) => f.steps.map((s) => s.size));
  expect(sizes, "the 9px one-off is not in the design").not.toContain(9);

  expect(design.rare.length, "and it is reported").toBeGreaterThan(0);
  expect(design.rare.some((r) => r.size === 9)).toBe(true);
  expect(design.covered).toBeLessThan(design.blocks);
});

test("minimumBlocks of one keeps everything, which is the escape hatch", async ({
  browser,
}) => {
  const design = await infer(browser, PAGE, { minimumBlocks: 1 });
  const sizes = design.families.flatMap((f) => f.steps.map((s) => s.size));

  expect(sizes).toContain(9);
  expect(design.rare).toHaveLength(0);
  expect(design.covered).toBe(design.blocks);
});

test("ignored selectors do not reach the design", async ({ browser }) => {
  const design = await infer(browser, PAGE, { ignore: [".mono"] });
  const fonts = design.families.map((f) => f.font);

  expect(fonts.some((f) => /monospace/.test(f)), "the code blocks were ignored").toBe(
    false
  );
});

test("a page read and then fitted is on the grid at every width", async ({
  browser,
  browserName,
}) => {
  /*
     The whole point of `--from`, end to end: read a page's own design, fit it,
     apply the result to the same page, and it holds at every width. The page
     here starts with a 25.5px leading, so the fit has real work to do rather
     than confirming an already-correct page.
  */
  const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await setup.setContent(PAGE);
  await setup.evaluate(() => document.fonts?.ready);
  await setup.addScriptTag({ content: FIT_BUNDLE });

  const fitted = await setup.evaluate(() => {
    const api = (window as unknown as {
      quoinFit: {
        inferDesign: (o: unknown) => Inferred;
        fitScale: (f: unknown, o: unknown) => {
          unavailable: boolean;
          cost: number;
          families: {
            font: string;
            steps: { name: string; size: number; leading: number; space: number }[];
          }[];
        };
      };
    }).quoinFit;
    const design = api.inferDesign({ minimumBlocks: 2 });
    return api.fitScale(design.families, { pitch: 8 });
  });
  await setup.close();

  if (fitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  expect(fitted.cost, "the 25.5px leading had to move, so this is a real fit").toBeGreaterThan(
    0
  );

  /* Rebuild the page from what the fit returned. Sizes unchanged, leadings
     snapped, spaces applied as margin-top, trim on. */
  const rules = fitted.families
    .flatMap((family) =>
      family.steps.map(
        (step) =>
          `.fit-${step.name} { font-family:${family.font}; font-size:${step.size}px; ` +
          `line-height:${step.leading}px; margin:${step.space}px 0 0 }`
      )
    )
    .join("\n");

  /* The markup is generated from the fit's own step names rather than
     hardcoded, so a name the fitter deduped cannot silently match no rule at
     all. An earlier version of this test wrote `.fit-mono` by hand while the
     fitter had named that step `p-14`, and four of six blocks were unstyled. */
  const markup = fitted.families
    .flatMap((family) =>
      family.steps.flatMap((step) => [
        `<p class="fit-${step.name}">Handgloves and quartz set at ${step.size}px, ` +
          `written at enough length that it reflows several times across the ` +
          `widths under test here.</p>`,
        `<p class="fit-${step.name}">A second block at the same size, so every ` +
          `step has something below it that moves.</p>`,
      ])
    )
    .join("\n");

  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0 } main { width: 92%; max-width: 700px; margin: 0 auto }
    p { text-box-trim: trim-both; text-box-edge: cap alphabetic }
    ${rules}
  </style><main>${markup}</main>`;

  for (const width of [320, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready);
    await page.addScriptTag({ content: BUNDLE });
    const report = await page.evaluate(() => {
      const measured = window.quoin.verifyGrid({ pitch: 8, origin: "auto" });
      return {
        onGrid: measured.report.onGrid,
        total: measured.report.total,
        worst: measured.results
          .filter((r) => !r.onGrid)
          .slice(0, 3)
          .map((r) => `${r.path} ${Math.round(r.drift * 100) / 100}px`),
      };
    });
    await page.close();

    expect(
      report.onGrid,
      `read, fitted and rebuilt, at ${width}px: ${report.onGrid}/${report.total}, ` +
        `worst ${JSON.stringify(report.worst)}`
    ).toBe(report.total);
  }
});

test("a page with no text infers nothing rather than throwing", async ({ browser }) => {
  const design = await infer(
    browser,
    '<!doctype html><meta charset="utf-8"><main><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main>'
  );

  expect(design.families).toHaveLength(0);
  expect(design.blocks).toBe(0);
  expect(design.covered).toBe(0);
});

/* ------------------------------------------------------------------ *
   Selectors, which turn tokens into rules
 * ------------------------------------------------------------------ */

test("a step gets a selector when one matches it exactly", async ({ browser }) => {
  /*
     Reading a design off a page and then handing back custom properties for
     somebody to wire up is a strange thing to do when the tool is holding the
     very elements it read them from. So it returns a selector when it can find
     one and check it.
  */
  const design = await infer(
    browser,
    `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; font-family: serif }
      h2 { font-size: 26px; line-height: 32px }
      .note { font-size: 13px; line-height: 16px }
      p { font-size: 17px; line-height: 24px }
    </style>
    <main>
      <h2>A heading</h2>
      <h2>Another heading</h2>
      <p>A paragraph.</p>
      <p>Another paragraph.</p>
      <p class="note">A note.</p>
      <p class="note">Another note.</p>
    </main>`
  );

  const steps = design.families.flatMap((f) => f.steps) as unknown as {
    name: string;
    size: number;
    selector: string | null;
  }[];

  const h2 = steps.find((s) => s.size === 26)!;
  const note = steps.find((s) => s.size === 13)!;

  expect(h2.selector, "a tag that is used at only one size is enough").toBe("h2");
  expect(
    note.selector,
    "a tag shared with another size needs the class as well"
  ).toMatch(/\.note$/);
});

test("no selector is offered when none matches exactly", async ({ browser }) => {
  /*
     The important half. A selector that is nearly right silently styles the
     wrong blocks, which is worse than no selector at all because the stylesheet
     looks finished. Two groups of plain paragraphs with nothing to tell them
     apart: `p` matches both, so neither gets it.
  */
  const design = await infer(
    browser,
    `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; font-family: serif }
      p { font-size: 17px; line-height: 24px }
      main > p:nth-child(n+3) { font-size: 21px; line-height: 32px }
    </style>
    <main>
      <p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>
    </main>`
  );

  const steps = design.families.flatMap((f) => f.steps) as unknown as {
    size: number;
    selector: string | null;
  }[];

  expect(steps.length, "both sizes were found").toBe(2);
  for (const step of steps) {
    expect(
      step.selector,
      `${step.size}px was given the selector ${step.selector}, which also matches the other size`
    ).toBeNull();
  }
});

test("a selector with characters CSS cannot carry raw is escaped", async ({ browser }) => {
  /* Utility-first class names are full of them, and an unescaped one is not a
     selector that fails, it is a selector that throws. The sizes are set inline
     here so the test is about the selector rather than about escaping a rule. */
  const design = await infer(
    browser,
    '<!doctype html><meta charset="utf-8"><style>body { margin: 0; font-family: serif }</style>' +
      '<main>' +
      '<p style="font-size:17px;line-height:24px">One.</p>' +
      '<p style="font-size:17px;line-height:24px">Two.</p>' +
      '<p class="text-[13px]" style="font-size:13px;line-height:16px">Small.</p>' +
      '<p class="text-[13px]" style="font-size:13px;line-height:16px">Also small.</p>' +
      '</main>'
  );

  const steps = design.families.flatMap((f) => f.steps) as unknown as {
    size: number;
    selector: string | null;
  }[];
  const small = steps.find((s) => s.size === 13)!;

  expect(small.selector, "a class needing an escape still produces one").not.toBeNull();
  expect(small.selector!, "and the bracket is escaped").toContain("13px");

  /* And the escaped form is a selector a document accepts rather than throws
     on, which is the whole reason to escape it. */
  const page = await browser.newPage();
  await page.setContent(
    '<p class="text-[13px]">x</p><p class="text-[13px]">y</p><p>z</p>'
  );
  const matches = await page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    small.selector!
  );
  await page.close();

  expect(matches, "it matches exactly the two it was built from").toBe(2);
});

test("the emitted CSS is rules when there are selectors, and tokens when not", async ({
  browser,
  browserName,
}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; font-family: serif }
      h2 { font-size: 26px; line-height: 32px }
      p { font-size: 17px; line-height: 24px }
    </style>
    <main><h2>A</h2><h2>B</h2><p>C</p><p>D</p></main>`
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.addScriptTag({ content: FIT_BUNDLE });

  const emitted = await page.evaluate(() => {
    const api = (window as unknown as {
      quoinFit: {
        inferDesign: (o: unknown) => Inferred;
        fitScale: (f: unknown, o: unknown) => { unavailable: boolean };
        fittedScaleToCss: (f: unknown) => string;
      };
    }).quoinFit;
    const design = api.inferDesign({ minimumBlocks: 2 });
    const fitted = api.fitScale(design.families, { pitch: 8 });
    return { css: api.fittedScaleToCss(fitted), unavailable: fitted.unavailable };
  });
  await page.close();

  if (emitted.unavailable) {
    test.skip(true, `${browserName} has no text-box-trim`);
    return;
  }

  /* Both tags are unambiguous here, so both become rules that use their own
     tokens rather than a blanket `:is(...)` and a wiring exercise. */
  expect(emitted.css).toMatch(/^h2 \{$/m);
  expect(emitted.css).toMatch(/^p \{$/m);
  expect(emitted.css).toContain("font-size: var(--size-h2);");
  expect(emitted.css).toContain("margin-top: var(--space-p);");
  expect(emitted.css, "and the blanket rule is not also emitted").not.toContain(
    ":is(p, h1, h2"
  );
});
