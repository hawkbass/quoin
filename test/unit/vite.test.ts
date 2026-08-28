/* The Vite plugin, run through a real Vite build.

   Same reason the PostCSS tests go through PostCSS: a plugin checked against a
   mock is a plugin that has never been loaded by the thing it is for. These
   build a tiny project in a temporary directory and assert on the CSS Vite
   writes out.

   Two jobs to check, and they are separable on purpose. Serving the fitted
   tokens as a module, for a design that lives in a JSON file rather than in the
   stylesheet, and running the PostCSS plugin over the project's own CSS. Most
   design systems keep their scale in tokens and generate the CSS, so a plugin
   that could only do the second would be useless to exactly those projects. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "vite";

import { quoinVite } from "../../src/vite.ts";
import { buildFont, capAt } from "./make-font.ts";

/*
   A font built here rather than one downloaded.

   The corpus is not in CI, so a test that reaches for a real font skips in the
   one place skipping matters, and these plugins are the part somebody's build
   depends on. 0.7165 per em is Lato's own ratio, so the numbers are the ones a
   real text face produces.
*/
const RATIO = 0.7165;
const UNITS = 2000;
const FONT = { unitsPerEm: UNITS, capHeight: Math.round(UNITS * RATIO) };
const FONT_DIR = mkdtempSync(join(tmpdir(), "quoin-font-"));
const LATO = join(FONT_DIR, "Built.ttf");
writeFileSync(LATO, buildFont(FONT));
const have = true;

/* 17px at that ratio. */
const CAP_17 = capAt(17, FONT);



interface Built {
  css: string;
  dir: string;
}

async function buildWith(
  files: Record<string, string>,
  options: Parameters<typeof quoinVite>[0]
): Promise<Built> {
  const dir = mkdtempSync(join(tmpdir(), "quoin-vite-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }

  await build({
    root: dir,
    logLevel: "silent",
    plugins: [quoinVite(options) as never],
    build: {
      outDir: join(dir, "out"),
      rollupOptions: { input: join(dir, "main.js") },
      /* Unminified, so the assertions are about the CSS rather than about how
         well esbuild compressed it. */
      minify: false,
      cssMinify: false,
    },
  });

  const assets = join(dir, "out", "assets");
  const cssFile = existsSync(assets)
    ? readdirSync(assets).find((f) => f.endsWith(".css"))
    : undefined;

  return { css: cssFile ? readFileSync(join(assets, cssFile), "utf8") : "", dir };
}

test("it serves the fitted tokens as a module you can import", { skip: !have }, async () => {
  const design = {
    pitch: 8,
    families: [
      {
        role: "body",
        font: "Built",
        file: LATO,
        steps: [{ name: "body", size: 17, ratio: 1.5, space: 24 }],
      },
    ],
  };

  const built = await buildWith(
    {
      "main.js": 'import "quoin/tokens.css";',
      "design.json": JSON.stringify(design),
    },
    { design: join("design.json") }
  );

  try {
    assert.match(built.css, /--size-body:\s*17px/, "the size comes through unchanged");
    assert.match(built.css, /--leading-body:\s*24px/, "and the leading is snapped");

    const space = /--space-body:\s*([\d.]+)px/.exec(built.css);
    assert.ok(space, `no space token: ${built.css}`);
    const closes = (Number.parseFloat(space![1]!) + CAP_17) % 8;
    assert.ok(
      Math.min(closes, 8 - closes) < 0.01,
      `the space does not close the cap: ${space![1]}`
    );

    assert.match(built.css, /text-box-trim:\s*trim-both/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("a design given inline works as well as one in a file", { skip: !have }, async () => {
  const built = await buildWith(
    { "main.js": 'import "quoin/tokens.css";' },
    {
      design: {
        pitch: 8,
        families: [
          {
            role: "body",
            font: "Built",
            file: LATO,
            steps: [{ name: "lead", size: 21, ratio: 1.45 }],
          },
        ],
      },
    }
  );

  try {
    assert.match(built.css, /--size-lead:\s*21px/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("it takes a design in whatever shape the project has it", { skip: !have }, async () => {
  /* The same normalising the CLI does, so a Figma export works here too rather
     than only at the command line. */
  const built = await buildWith(
    { "main.js": 'import "quoin/tokens.css";' },
    {
      design: {
        pitch: 8,
        families: [
          {
            role: "body",
            fontFamily: "Built",
            file: LATO,
            sizes: [{ label: "copy", fontSize: "17px", lineHeight: 1.5 }],
          },
        ],
      } as never,
    }
  );

  try {
    assert.match(built.css, /--size-copy:\s*17px/);
    assert.match(built.css, /--leading-copy:\s*24px/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("importing the tokens without a design says so rather than breaking the build", async () => {
  /*
     A mistake worth naming and not worth failing over: the comment says what
     happened and the page still loads. A build that dies because somebody
     imported a stylesheet before configuring it is a build nobody debugs
     quickly.
  */
  const built = await buildWith({ "main.js": 'import "quoin/tokens.css";' }, {});

  try {
    assert.match(built.css, /no design was given/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("it fits the project's own CSS through PostCSS", { skip: !have }, async () => {
  const built = await buildWith(
    {
      "main.js": 'import "./style.css";',
      "style.css": "p { font-size: 17px; line-height: 1.5; margin-top: 24px }",
    },
    { css: { fonts: { Built: LATO }, defaultFont: "Built" } }
  );

  try {
    assert.match(built.css, /font-size:\s*17px/, "the size is untouched");
    assert.match(built.css, /line-height:\s*24px/, "the leading is snapped");
    assert.match(built.css, /text-box-trim:\s*trim-both/);

    const space = /margin-top:\s*([\d.]+)px/.exec(built.css);
    assert.ok(space, `margin-top was not rewritten: ${built.css}`);
    const closes = (Number.parseFloat(space![1]!) + CAP_17) % 8;
    assert.ok(Math.min(closes, 8 - closes) < 0.01);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("the CSS half is off unless asked for", { skip: !have }, async () => {
  /* Reading a stylesheet tells you the family a rule sets and not where that
     family's file is, so it cannot be on by default without guessing. */
  const built = await buildWith(
    {
      "main.js": 'import "./style.css";',
      "style.css": "p { font-size: 17px; line-height: 1.5 }",
    },
    {}
  );

  try {
    assert.match(built.css, /line-height:\s*1\.5/, "untouched");
    assert.doesNotMatch(built.css, /text-box-trim/);
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});

test("both halves run together, and the tokens are the same numbers", {
  skip: !have,
}, async () => {
  /*
     A project doing both would have a stylesheet fitted by PostCSS and tokens
     fitted from the design file, and the two have to agree or a page built from
     a mixture of them is on two different grids.
  */
  const built = await buildWith(
    {
      "main.js": 'import "quoin/tokens.css";\nimport "./style.css";',
      "style.css": "p { font-size: 17px; line-height: 1.5; margin-top: 24px }",
    },
    {
      design: {
        pitch: 8,
        families: [
          {
            role: "body",
            font: "Built",
            file: LATO,
            steps: [{ name: "body", size: 17, ratio: 1.5, space: 24 }],
          },
        ],
      },
      css: { fonts: { Built: LATO }, defaultFont: "Built" },
    }
  );

  try {
    const token = /--space-body:\s*([\d.]+)px/.exec(built.css);
    const written = /margin-top:\s*([\d.]+)px/.exec(built.css);
    assert.ok(token, "the token is there");
    assert.ok(written, "the rewritten margin is there");

    assert.equal(
      Number.parseFloat(token![1]!),
      Number.parseFloat(written![1]!),
      "the two halves disagree, so a page using both is on two grids"
    );
  } finally {
    rmSync(built.dir, { recursive: true, force: true });
  }
});
