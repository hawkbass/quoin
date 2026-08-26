/* Manufacture the cases the corpus could not supply.

   Twenty-one real fonts were downloaded to ask whether `text-box-edge: cap` is
   portable, and every one of them declares an `sCapHeight` in its OS/2 table.
   That is good news about modern fonts and it leaves the interesting question
   untested, because the specification says a UA facing a font WITHOUT that
   metric "must synthesize" one, and three engines synthesising independently
   is precisely where a portability claim would fall over.

   You cannot find that case reliably in the wild on demand, so it gets built:
   take a font that has the metric and take it away, two different ways.

   `absent`    OS/2 version dropped to 1, which predates the sCapHeight field
               entirely. The metric is not there to read.
   `zeroed`    OS/2 left at its own version with sCapHeight set to 0, which is
               present, readable, and useless. Whether an engine treats that as
               "no cap height" or as "a cap height of zero" is a real question
               with two defensible answers.

   Both are two-byte edits. TrueType carries table checksums and a
   `head.checkSumAdjustment` over the whole file; these are recomputed rather
   than left stale, because a font that fails to load teaches you nothing and
   looks identical to a font whose metrics the engine declined to use. */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = "test/browser/fixtures/fonts";

function tableDirectory(view) {
  const numTables = view.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const name = String.fromCharCode(
      view.getUint8(base), view.getUint8(base + 1),
      view.getUint8(base + 2), view.getUint8(base + 3)
    );
    tables[name] = {
      entry: base,
      checksumAt: base + 4,
      offset: view.getUint32(base + 8),
      length: view.getUint32(base + 12),
    };
  }
  return tables;
}

/* Sum of uint32s over the table, zero-padded to a four-byte boundary. */
function checksum(view, offset, length) {
  let sum = 0;
  const words = Math.ceil(length / 4);
  for (let i = 0; i < words; i++) {
    const at = offset + i * 4;
    let word = 0;
    for (let b = 0; b < 4; b++) {
      word = (word << 8) | (at + b < offset + length ? view.getUint8(at + b) : 0);
    }
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function repair(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tables = tableDirectory(view);

  /* Every table's own checksum, except head, whose checksum is computed with
     its adjustment field zeroed. */
  for (const [name, table] of Object.entries(tables)) {
    if (name === "head") continue;
    view.setUint32(table.checksumAt, checksum(view, table.offset, table.length));
  }

  const head = tables.head;
  if (head) {
    view.setUint32(head.offset + 8, 0);
    view.setUint32(head.checksumAt, checksum(view, head.offset, head.length));
    /* 0xB1B0AFBA minus the checksum of the whole file. */
    const whole = checksum(view, 0, buffer.byteLength);
    view.setUint32(head.offset + 8, (0xb1b0afba - whole) >>> 0);
  }

  return buffer;
}

function variant(sourceFile, targetFile, mutate) {
  const source = join(DIR, sourceFile);
  if (!existsSync(source)) {
    console.log(`  ${targetFile.padEnd(28)}skipped: ${sourceFile} is not downloaded`);
    return null;
  }

  const buffer = Buffer.from(readFileSync(source));
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const os2 = tableDirectory(view)["OS/2"];
  if (!os2) {
    console.log(`  ${targetFile.padEnd(28)}skipped: ${sourceFile} has no OS/2 table`);
    return null;
  }

  const before = {
    version: view.getUint16(os2.offset),
    sCapHeight: view.getInt16(os2.offset + 88),
  };

  mutate(view, os2);
  repair(buffer);
  writeFileSync(join(DIR, targetFile), buffer);

  const after = {
    version: view.getUint16(os2.offset),
    sCapHeight: view.getInt16(os2.offset + 88),
  };

  console.log(
    `  ${targetFile.padEnd(28)}from ${sourceFile}: ` +
      `OS/2 v${before.version} sCapHeight ${before.sCapHeight}  ->  ` +
      `v${after.version} sCapHeight ${after.sCapHeight}`
  );
  return targetFile;
}

console.log("");

variant("Lato.ttf", "AwkwardAbsent.ttf", (view, os2) => {
  /* Version 1 predates sCapHeight, so a conforming reader stops before it. */
  view.setUint16(os2.offset, 1);
});

variant("Lato.ttf", "AwkwardZeroed.ttf", (view, os2) => {
  /* Present, readable, and useless. */
  view.setInt16(os2.offset + 88, 0);
});

variant("SpaceMono.ttf", "AwkwardHuge.ttf", (view, os2) => {
  /* A cap height larger than the em box. Nonsense, and nothing stops a font
     from shipping it, so the question is what each engine does about it. */
  view.setInt16(os2.offset + 88, 1400);
});

variant("SpaceMono.ttf", "AwkwardLies.ttf", (view, os2) => {
  /*
     The decisive one.

     Every real font in the corpus sets sCapHeight to the height of its own
     capital H, so a browser reading the table and a browser measuring the
     outline produce the same number and the corpus cannot tell them apart.
     This font declares 600 where its H is 700: a value that is entirely
     plausible, well inside the em box, and wrong.

     Report 10.8px at 18px and the engine read the table. Report 12.6px and it
     measured the glyph and never looked. */
  view.setInt16(os2.offset + 88, 600);
});

variant("Lato.ttf", "AwkwardLiesLato.ttf", (view, os2) => {
  /* The same question asked of a proportional face with a 2000-unit em, in
     case the answer is implementation-specific to one of those. 1433 -> 1200,
     which should read as 10.8px at 18px. */
  view.setInt16(os2.offset + 88, 1200);
});

console.log("");
