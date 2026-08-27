/* Selectors that address the page as authored.

   This is the module the CSS export failed for four months without: rules keyed
   on a runtime attribute matched nothing once the script was removed, which was
   the documented way to use them. Every selector built here is checked against
   the document before it is returned, so a null is a real answer and never a
   rule that matches the wrong element. */

import { test, expect } from "@playwright/test";
import { load } from "./harness.ts";

/* A page assembled in the test rather than a fixture file, because each case is
   one line of markup and reading them next to their assertions is the point. */
async function withMarkup(page: import("@playwright/test").Page, html: string) {
  await load(page, "prose.html");
  await page.evaluate((markup) => {
    const host = document.createElement("div");
    host.id = "selector-cases";
    host.innerHTML = markup;
    document.body.appendChild(host);
  }, html);
}

test("an id is used when it is unique and addressable", async ({ page }) => {
  await withMarkup(page, `<p id="lede">Text.</p>`);
  const selector = await page.evaluate(() =>
    window.quoin.uniqueSelector(document.getElementById("lede")!)
  );
  expect(selector).toBe("#lede");
});

test("a duplicate id is rejected rather than trusted", async ({ page }) => {
  /* Duplicate ids are invalid HTML and also completely normal. */
  await withMarkup(page, `<p id="dupe">One.</p><p id="dupe">Two.</p>`);

  const result = await page.evaluate(() => {
    const both = document.querySelectorAll("#dupe");
    const second = both[1] as Element;
    const selector = window.quoin.uniqueSelector(second);
    return {
      count: both.length,
      selector,
      resolvesToTheRightOne: selector
        ? document.querySelectorAll(selector).length === 1 &&
          document.querySelector(selector) === second
        : false,
    };
  });

  expect(result.count).toBe(2);
  expect(result.selector, "it did not just return #dupe").not.toBe("#dupe");
  expect(result.resolvesToTheRightOne, "and what it returned is exact").toBe(true);
});

test("classes needing escaping are escaped", async ({ page }) => {
  /* Utility-class markup is full of these, and an unescaped colon throws rather
     than returning nothing, which takes out the rest of the stylesheet. */
  await withMarkup(
    page,
    `<p class="md:text-lg lg:leading-7 w-1/2 hover:bg-[#fff]">Utility classes.</p>`
  );

  const result = await page.evaluate(() => {
    const el = document.querySelector(".w-1\\/2") as Element;
    const selector = window.quoin.uniqueSelector(el);
    if (!selector) return { selector: null, valid: false, exact: false };
    let valid = true;
    let exact = false;
    try {
      exact = document.querySelectorAll(selector).length === 1;
    } catch {
      valid = false;
    }
    return { selector, valid, exact };
  });

  expect(result.valid, `"${result.selector}" parses`).toBe(true);
  expect(result.exact, "and matches exactly one element").toBe(true);
});

test("identical siblings get structural selectors that tell them apart", async ({
  page,
}) => {
  await withMarkup(
    page,
    `<div class="row"><p class="cell">One.</p><p class="cell">Two.</p><p class="cell">Three.</p></div>`
  );

  const result = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("#selector-cases .cell")];
    const selectors = cells.map((el) => window.quoin.uniqueSelector(el));
    return {
      selectors,
      allBuilt: selectors.every((s) => s !== null),
      allDistinct: new Set(selectors).size === selectors.length,
      allExact: selectors.every((s, i) => {
        if (!s) return false;
        const found = document.querySelectorAll(s);
        return found.length === 1 && found[0] === cells[i];
      }),
    };
  });

  expect(result.allBuilt, `built: ${JSON.stringify(result.selectors)}`).toBe(true);
  expect(result.allDistinct, "and they are not the same selector three times").toBe(true);
  expect(result.allExact, "and each hits its own element").toBe(true);
});

test("an element with no classes and no id still gets addressed", async ({ page }) => {
  await withMarkup(page, `<div><div><p>Deep and anonymous.</p></div></div>`);

  const exact = await page.evaluate(() => {
    const el = document.querySelector("#selector-cases p") as Element;
    const selector = window.quoin.uniqueSelector(el);
    if (!selector) return false;
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  });

  expect(exact).toBe(true);
});

test("a detached element gets null, not a selector that matches something else", async ({
  page,
}) => {
  await load(page, "prose.html");
  const selector = await page.evaluate(() => {
    const el = document.createElement("p");
    el.className = "intro";
    el.textContent = "Never added to the document.";
    return window.quoin.uniqueSelector(el);
  });
  expect(selector).toBeNull();
});

test("an element inside a shadow root gets null", async ({ page }) => {
  /*
     A document stylesheet does not reach inside a shadow root. `::part()`
     exposes only what the component chose to expose, and the piercing
     combinator was removed from the platform years ago. Returning a selector
     that looks plausible and matches nothing is the failure this module exists
     to prevent, so the honest answer is null.
  */
  await load(page, "torture.html");

  const result = await page.evaluate(() => {
    const host = document.getElementById("shadow-host")!;
    const inside = host.shadowRoot!.querySelector("p")!;
    return {
      selector: window.quoin.uniqueSelector(inside),
      isInShadow: window.quoin.inShadowRoot(inside),
      hasText: Boolean(inside.textContent?.trim()),
    };
  });

  expect(result.hasText, "the element is real and has text").toBe(true);
  expect(result.isInShadow).toBe(true);
  expect(result.selector, "and no selector is claimed for it").toBeNull();
});

test("matchesOnly refuses an unparseable selector instead of throwing", async ({
  page,
}) => {
  await load(page, "prose.html");
  const result = await page.evaluate(() => {
    const el = document.querySelector("p") as Element;
    try {
      return { value: window.quoin.matchesOnly("!!! not a selector", el), threw: false };
    } catch {
      return { value: null, threw: true };
    }
  });
  expect(result.threw).toBe(false);
  expect(result.value).toBe(false);
});

test("every selector the export builds on the torture page is exact", async ({
  page,
}) => {
  /* The end-to-end version of all of the above, against a page with utility
     classes, generated content, deep nesting and three hundred siblings. */
  await load(page, "torture.html");

  const bad = await page.evaluate(() => {
    const seated = window.quoin.seatPage({ pitch: 8 });
    const problems: unknown[] = [];

    for (const block of seated.blocks) {
      if (!block.selector) continue;
      let found: NodeListOf<Element> | null = null;
      try {
        found = document.querySelectorAll(block.selector);
      } catch (error) {
        problems.push({ selector: block.selector, error: String(error) });
        continue;
      }
      if (found.length !== 1) {
        problems.push({ selector: block.selector, matched: found.length });
      }
    }
    return { problems: problems.slice(0, 5), count: problems.length, blocks: seated.blocks.length };
  });

  expect(bad.blocks, "it walked the whole page").toBeGreaterThan(300);
  expect(bad.count, `selectors that were not exact: ${JSON.stringify(bad.problems)}`).toBe(0);
});
