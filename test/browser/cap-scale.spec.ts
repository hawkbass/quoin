/* The cap basis, which is the better half of the scale solver.

   Everything else in this library measures where a baseline sits inside its own
   line box, and that measurement rests on `fontBoundingBox`, which every engine
   rounds to whole pixels before it hands it over. `text-box-trim: trim-both`
   with `text-box-edge: cap alphabetic` removes the line box from the question
   entirely: the border box is trimmed to the cap height at the top and to the
   baseline at the bottom, so a single-line block's height is the cap height and
   its bottom edge is the baseline.

   Two things follow from that and both of them are improvements. The phase stops
   depending on the leading, because there is no leading left in the arithmetic,
   which means any solved size works with any leading that is a whole number of
   rows instead of only the two or three that happened to land. And the phase is
   read out of the font file rather than off the rasteriser, which matters
   because the study in this repository found font-table cap height agreeing
   across engines on 130 fonts out of 130 with a worst case of 0.022px, where the
   canvas measurement of the same fonts managed 90.

   These tests assert the measurement the whole basis rests on, rather than
   inferring it from a scale that happens to come out right. */

import { test, expect } from "@playwright/test";
import { load } from "./harness.ts";

/** Whether this engine can be asked the question at all. */
async function trimSupported(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => CSS.supports("text-box-trim", "trim-both"));
}

test("a trimmed block's box is the cap height, which is the whole basis", async ({
  page,
}) => {
  await load(page, "prose.html");

  if (!(await trimSupported(page))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const measured = await page.evaluate(() => {
    const el = document.createElement("p");
    el.style.cssText =
      "font-size:32px;line-height:56px;margin:0;" +
      "text-box-trim:trim-both;text-box-edge:cap alphabetic";
    el.textContent = "Handgloves";
    document.body.appendChild(el);

    const height = el.getBoundingClientRect().height;
    const family = getComputedStyle(el).fontFamily;
    el.remove();

    return { height, declared: window.quoin.capHeightFromFontTable("32px " + family) };
  });

  expect(measured.declared, "the font table could be read").not.toBeNull();
  expect(
    Math.abs(measured.height - measured.declared!),
    `trimmed box measured ${measured.height} against a declared cap height of ${measured.declared}`
  ).toBeLessThan(0.05);
});

test("the leading drops out of the phase, which is the point of the cap basis", async ({
  page,
}) => {
  /*
     In the untrimmed basis, size and leading are coupled: a size sits on the
     shared phase only at the leadings that put it there. Trimmed, the height of
     a wrapped block is `(lines - 1) x leading + capHeight` at every leading, so
     the residue never moves and the size is free to take any leading that is a
     whole number of rows.
  */
  await load(page, "prose.html");

  if (!(await trimSupported(page))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const result = await page.evaluate(() => {
    const make = (leading: number) => {
      const el = document.createElement("p");
      el.style.cssText =
        "font-size:17px;line-height:" + leading + "px;margin:0;max-width:220px;" +
        "text-box-trim:trim-both;text-box-edge:cap alphabetic";
      el.textContent =
        "Handgloves and enough words after them to wrap this onto several " +
        "separate lines at the width it has been given here";
      document.body.appendChild(el);
      const height = el.getBoundingClientRect().height;
      el.remove();
      return height;
    };

    return {
      cap: window.quoin.capHeightFromFontTable("17px serif"),
      heights: [24, 32, 40].map((leading) => ({ leading, height: make(leading) })),
    };
  });

  expect(result.cap).not.toBeNull();

  for (const { leading, height } of result.heights) {
    const lines = Math.round((height - result.cap!) / leading) + 1;
    expect(
      Math.abs(height - ((lines - 1) * leading + result.cap!)),
      `at ${leading}px leading the box was ${height}, which is not ${lines - 1} leadings plus a cap height`
    ).toBeLessThan(0.05);
  }
});

test("a cap-solved scale is solved, and says which basis it used", async ({ page }) => {
  await load(page, "prose.html");

  const scale = await page.evaluate(() =>
    window.quoinFit.gridNativeScale("serif", {
      pitch: 8,
      targets: [16, 28, 44],
      basis: "cap",
      near: 4,
    })
  );
  const supported = await page.evaluate(() => window.quoin.canReadFontTableCapHeight());

  expect(scale.basis).toBe("cap");

  if (!supported) {
    /* Reported rather than quietly answered from the line box. The two bases
       give different sizes, so a caller who asked for one and silently got the
       other has a scale that does not do what they think it does. */
    expect(scale.basisUnavailable, "it says the basis was unavailable").toBe(true);
    expect(scale.steps, "and solves nothing rather than guessing").toHaveLength(0);
    return;
  }

  expect(scale.basisUnavailable).toBe(false);
  expect(scale.steps.length, "it found sizes").toBeGreaterThan(1);
  expect(scale.spacing, "and reports what they cost").toBeGreaterThan(0);

  for (let i = 1; i < scale.steps.length; i++) {
    expect(
      scale.steps[i]!.size,
      "steps ascend and are distinct, same rule as the other basis"
    ).toBeGreaterThan(scale.steps[i - 1]!.size);
  }
});

test("a page built from a cap-solved scale seats at one origin with no corrections", async ({
  page,
}) => {
  /*
     The end-to-end claim, in the same shape as the test that proves it for the
     line-box basis: build a page out of the solved sizes, apply the trim, and
     the measurement should find every block already on the grid with nothing
     left to correct.
  */
  await load(page, "prose.html");

  if (!(await page.evaluate(() => window.quoin.canReadFontTableCapHeight()))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const result = await page.evaluate(() => {
    const scale = window.quoinFit.gridNativeScale("serif", {
      pitch: 8,
      targets: [16, 28, 44],
      basis: "cap",
      near: 4,
    });

    const root = document.createElement("div");
    root.id = "capscale";
    root.style.cssText = "font-family:serif;margin:0;padding:0";

    scale.steps.forEach((step, i) => {
      for (let n = 0; n < 3; n++) {
        const el = document.createElement("p");
        el.style.cssText =
          "font-size:" + step.size + "px;line-height:" + step.leading + "px;" +
          "margin:" + step.space + "px 0 0;" +
          "text-box-trim:trim-both;text-box-edge:cap alphabetic";
        el.textContent = "Step " + (i + 1) + ", paragraph " + (n + 1) + ", handgloves and quartz.";
        root.appendChild(el);
      }
    });

    document.body.replaceChildren(root);

    const measured = window.quoin.verifyGrid({ pitch: 8, origin: "auto", root });

    return {
      sizes: scale.steps.map((s) => s.size),
      leadings: scale.steps.map((s) => s.leading),
      onGrid: measured.report.onGrid,
      total: measured.report.total,
      distinctDrifts: measured.report.distinctDrifts,
    };
  });

  expect(result.total, "the page was built").toBeGreaterThan(5);
  expect(
    result.onGrid,
    `${result.onGrid}/${result.total} on the grid, from sizes ${result.sizes.join(", ")} ` +
      `at leadings ${result.leadings.join(", ")}, ${result.distinctDrifts} distinct drifts`
  ).toBe(result.total);
});

test("the same sizes seat at a leading the solver never picked", async ({ page }) => {
  /*
     The freedom claim, made to earn its place rather than asserted. Take the
     solved sizes, set every one of them to a leading the solver did not choose,
     and the page should still land on a single origin, because the leading was
     never in the phase to begin with.
  */
  await load(page, "prose.html");

  if (!(await page.evaluate(() => window.quoin.canReadFontTableCapHeight()))) {
    test.skip(true, "this engine has no text-box-trim");
    return;
  }

  const result = await page.evaluate(() => {
    const scale = window.quoinFit.gridNativeScale("serif", {
      pitch: 8,
      targets: [16, 28],
      basis: "cap",
      near: 4,
    });

    const root = document.createElement("div");
    root.style.cssText = "font-family:serif;margin:0;padding:0";

    /* 64px is a whole number of rows and is not a leading the solver would
       have chosen for either size: the ratios are far outside its window. */
    for (const step of scale.steps) {
      for (let n = 0; n < 3; n++) {
        const el = document.createElement("p");
        el.style.cssText =
          "font-size:" + step.size + "px;line-height:64px;margin:" + step.space + "px 0 0;" +
          "text-box-trim:trim-both;text-box-edge:cap alphabetic";
        el.textContent = "Handgloves and quartz, at a leading nobody solved for.";
        root.appendChild(el);
      }
    }

    document.body.replaceChildren(root);
    const measured = window.quoin.verifyGrid({ pitch: 8, origin: "auto", root });
    return { onGrid: measured.report.onGrid, total: measured.report.total };
  });

  expect(result.total).toBeGreaterThan(3);
  expect(
    result.onGrid,
    `${result.onGrid}/${result.total} at a leading the solver never picked`
  ).toBe(result.total);
});

test("the emitted CSS carries the trim, because without it the scale is wrong", async ({
  page,
}) => {
  await load(page, "prose.html");

  const css = await page.evaluate(() =>
    window.quoinFit.scaleToCss(
      window.quoinFit.gridNativeScale("serif", { pitch: 8, targets: [16, 28], basis: "cap" })
    )
  );

  expect(css).toContain("text-box-trim: trim-both");
  expect(css).toContain("text-box-edge: cap alphabetic");
  expect(css, "and says why it is not optional").toMatch(/Required|trimmed box/);
});

test("the line-box basis is untouched by any of this", async ({ page }) => {
  /* Pages are already built on the default, so it has to keep behaving exactly
     as it did before the second basis existed. */
  await load(page, "prose.html");

  const scale = await page.evaluate(() =>
    window.quoinFit.gridNativeScale("serif", { pitch: 8, targets: [16, 28, 44] })
  );

  expect(scale.basis).toBe("line-box");
  expect(scale.basisUnavailable).toBe(false);
  expect(scale.steps.length).toBeGreaterThan(1);
});
