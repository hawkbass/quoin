/* Fetch a font corpus for the cross-engine study.

   The first version of that study measured `serif`, `monospace`, `system-ui`,
   Georgia, Arial and Times. Two of those are generic keywords that resolve to a
   different typeface in each engine. The width of thirty glyphs put Chromium's
   monospace 27px from WebKit's, so the experiment was partly measuring font
   substitution and reporting it as engine divergence. And three system fonts
   from one vendor is not a corpus.

   To ask whether a metric travels between engines you have to hold the font
   still. That means webfonts: the same bytes, loaded from the same file, in all
   three. And it means enough of them to cover the cases where the answer could
   plausibly differ: fonts whose OS/2 table declares a cap height and fonts
   whose does not, different units per em, variable and static, Latin and not,
   and a couple of extremes.

   Downloaded rather than committed: these are 30MB of other people's fonts and
   the repository does not need them. Everything here is OFL or Apache-2.0. */

import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "test/browser/fixtures/fonts";
const RAW = "https://raw.githubusercontent.com/google/fonts/main";

/*
   Chosen for metric variety, not for looking nice. The `why` is what each one
   is in the corpus to test.
*/
const CORPUS = [
  // --- mainstream Latin, modern OS/2 tables ------------------------------
  { file: "Inter.ttf",         url: `${RAW}/ofl/inter/Inter%5Bopsz,wght%5D.ttf`,         why: "variable, two axes, modern metrics" },
  { file: "Roboto.ttf",        url: `${RAW}/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf`,       why: "2048 units per em, variable" },
  { file: "OpenSans.ttf",      url: `${RAW}/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf`,   why: "large x-height, very widely deployed" },
  { file: "Lato.ttf",          url: `${RAW}/ofl/lato/Lato-Regular.ttf`,                  why: "static, humanist" },
  { file: "IBMPlexSans.ttf",   url: `${RAW}/ofl/ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf`, why: "a design system's own face" },

  // --- serifs, where cap height and ascent diverge most -------------------
  { file: "Lora.ttf",          url: `${RAW}/ofl/lora/Lora%5Bwght%5D.ttf`,                why: "serif, moderate contrast" },
  { file: "PlayfairDisplay.ttf", url: `${RAW}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf`, why: "very high contrast, tall caps, short descenders" },
  { file: "EBGaramond.ttf",    url: `${RAW}/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf`,    why: "old-style, small cap height relative to the em" },
  { file: "Merriweather.ttf",  url: `${RAW}/ofl/merriweather/Merriweather%5Bopsz,wdth,wght%5D.ttf`, why: "large x-height serif, three axes" },

  // --- monospace ---------------------------------------------------------
  { file: "JetBrainsMono.ttf", url: `${RAW}/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf`, why: "monospace, tall ascenders" },
  { file: "SpaceMono.ttf",     url: `${RAW}/ofl/spacemono/SpaceMono-Regular.ttf`,        why: "monospace, static, older build" },

  // --- extremes and awkward cases ----------------------------------------
  { file: "Cinzel.ttf",        url: `${RAW}/ofl/cinzel/Cinzel%5Bwght%5D.ttf`,            why: "all-caps face: cap height IS the x-height" },
  { file: "Bungee.ttf",        url: `${RAW}/ofl/bungee/Bungee-Regular.ttf`,              why: "display, extreme vertical metrics" },
  { file: "Sacramento.ttf",    url: `${RAW}/ofl/sacramento/Sacramento-Regular.ttf`,      why: "script face, enormous ascenders and descenders" },
  { file: "Anton.ttf",         url: `${RAW}/ofl/anton/Anton-Regular.ttf`,                why: "condensed display, very tall caps" },

  // --- non-Latin, where cap height is not a meaningful idea ---------------
  { file: "NotoSansJP.ttf",    url: `${RAW}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf`,    why: "CJK: no capitals, so what does cap height mean?" },
  { file: "NotoSansArabic.ttf", url: `${RAW}/ofl/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf`, why: "Arabic: no capitals, tall marks" },
  { file: "NotoSansDevanagari.ttf", url: `${RAW}/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf`, why: "Devanagari: headline above the letters" },
  { file: "NotoSerifThai.ttf", url: `${RAW}/ofl/notoserifthai/NotoSerifThai%5Bwdth,wght%5D.ttf`, why: "Thai: stacked marks above and below" },

  // --- older builds, likelier to predate OS/2 version 2 -------------------
  { file: "PTSans.ttf",        url: `${RAW}/ofl/ptsans/PT_Sans-Web-Regular.ttf`,         why: "older build, may lack sCapHeight" },
  { file: "Ubuntu.ttf",        url: `${RAW}/ufl/ubuntu/Ubuntu-Regular.ttf`,              why: "UFL licence, 2010-era build" },
  { file: "DejaVuSans.ttf",    url: `${RAW}/apache/opensans/OpenSans%5Bwdth,wght%5D.ttf`, why: "duplicate guard: same family from a second path" },
];

mkdirSync(DIR, { recursive: true });

/* ------------------------------------------------------------------ *
   Just enough OpenType to read the metrics the browser claims to use
 * ------------------------------------------------------------------ */

/**
 * `head.unitsPerEm`, and the OS/2 table's version, sCapHeight and sxHeight.
 *
 * This is the ground truth the experiment needs. `text-box-edge: cap` is
 * defined against `sCapHeight`, so if the browsers agree with each other AND
 * with this number, they are reading the table. If they agree with each other
 * but not with this, they are agreeing on a synthesis. Those are different
 * findings and only the file can tell them apart.
 */
export function readMetrics(buffer) {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  const tag = view.getUint32(0);
  /* 0x00010000 = TrueType outlines, 'OTTO' = CFF, 'ttcf' = a collection. */
  if (tag === 0x74746366) throw new Error("font collection, not a single font");

  const numTables = view.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const name = String.fromCharCode(
      view.getUint8(base), view.getUint8(base + 1),
      view.getUint8(base + 2), view.getUint8(base + 3)
    );
    tables[name] = { offset: view.getUint32(base + 8), length: view.getUint32(base + 12) };
  }

  if (!tables.head) throw new Error("no head table");
  const unitsPerEm = view.getUint16(tables.head.offset + 18);

  const result = {
    unitsPerEm,
    os2Version: null,
    sCapHeight: null,
    sxHeight: null,
    typoAscender: null,
    typoDescender: null,
    hheaAscender: null,
    hheaDescender: null,
    hasFvar: Boolean(tables.fvar),
    outlines: tag === 0x4f54544f ? "cff" : "truetype",
  };

  if (tables.hhea) {
    result.hheaAscender = view.getInt16(tables.hhea.offset + 4);
    result.hheaDescender = view.getInt16(tables.hhea.offset + 6);
  }

  const os2 = tables["OS/2"];
  if (os2) {
    result.os2Version = view.getUint16(os2.offset);
    result.typoAscender = view.getInt16(os2.offset + 68);
    result.typoDescender = view.getInt16(os2.offset + 70);
    /* sxHeight and sCapHeight only exist from version 2 onward, and reading
       them out of a version 1 table returns whatever bytes happen to follow,
       which is exactly the kind of number that looks plausible and is not. */
    if (result.os2Version >= 2 && os2.length >= 96) {
      result.sxHeight = view.getInt16(os2.offset + 86);
      result.sCapHeight = view.getInt16(os2.offset + 88);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
    process.argv[1]?.endsWith("fetch-fonts.mjs")) {
  const manifest = [];
  let downloaded = 0;
  let failed = 0;

  for (const entry of CORPUS) {
    const path = join(DIR, entry.file);

    if (!existsSync(path) || statSync(path).size < 1024) {
      process.stdout.write(`  ${entry.file.padEnd(26)}`);
      try {
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        writeFileSync(path, bytes);
        downloaded++;
        process.stdout.write(`${(bytes.length / 1024).toFixed(0)} kB\n`);
      } catch (error) {
        failed++;
        process.stdout.write(`FAILED: ${error.message}\n`);
        continue;
      }
    }

    try {
      const metrics = readMetrics(readFileSync(path));
      manifest.push({
        family: entry.file.replace(/\.ttf$/, ""),
        file: entry.file,
        why: entry.why,
        source: entry.url,
        ...metrics,
      });
    } catch (error) {
      failed++;
      console.log(`  ${entry.file.padEnd(26)}unreadable: ${error.message}`);
    }
  }

  writeFileSync(join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n  ${manifest.length} fonts in the corpus, ${downloaded} newly downloaded, ${failed} failed\n`);
  console.log(`  family                 upem  OS/2  sCapHeight  sxHeight  var  outlines`);
  for (const font of manifest) {
    console.log(
      `  ${font.family.padEnd(22)}${String(font.unitsPerEm).padEnd(6)}` +
        `${String(font.os2Version ?? "--").padEnd(6)}` +
        `${String(font.sCapHeight ?? "ABSENT").padEnd(12)}` +
        `${String(font.sxHeight ?? "ABSENT").padEnd(10)}` +
        `${font.hasFvar ? "yes" : "no "}  ${font.outlines}`
    );
  }

  const missing = manifest.filter((f) => f.sCapHeight === null || f.sCapHeight === 0);
  console.log(
    `\n  ${missing.length} of ${manifest.length} declare no usable sCapHeight` +
      (missing.length ? `: ${missing.map((f) => f.family).join(", ")}` : "") +
      `\n  Those are the ones where the engines have to synthesise, and where a` +
      `\n  portability claim is most likely to fall over.\n`
  );
}
