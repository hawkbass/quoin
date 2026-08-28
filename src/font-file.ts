/* Reading the metrics Quoin needs straight out of a font file.

   Everything else in this library measures the font the browser resolved, and
   that is the right thing when there is a browser: metrics read from a file
   describe the font that was asked for rather than the one that loaded, and
   those come apart precisely when it matters, which is when a webfont has
   failed.

   There is not always a browser. Fitting a design is a build-time question, and
   requiring Playwright to answer it rules the tool out of every pipeline that
   does not already have one. So this reads the same numbers from the file.

   It is safe to do here and only here, because of what the cap-height study
   found: `text-box-edge: cap` is defined against the OS/2 table's `sCapHeight`,
   and across 130 fonts the browsers agreed with the file to a worst case of
   0.022px. The number in the file is the number the engine will use. That is
   not true of the canvas measurement, which is rasterised and disagreed on 40 of
   the same 130, and it is why nothing else in this library reads a file.

   Deliberately small. It parses the table directory and three tables, because
   those are the ones the arithmetic needs, and a font parser that grows to
   handle glyphs is a dependency wearing a different hat. */

export interface FontFileMetrics {
  /** Font design units per em. Every other figure here is in those units. */
  unitsPerEm: number;
  /** OS/2 table version, or null when there is no OS/2 table at all. */
  os2Version: number | null;
  /**
   * The declared cap height, in design units, or null.
   *
   * Null means the font predates OS/2 version 2 or omits the table. Reading it
   * anyway returns whatever bytes happen to follow, which is exactly the kind of
   * number that looks plausible and is not, so it is refused instead.
   */
  capHeight: number | null;
  xHeight: number | null;
  /**
   * Set when the file declares a cap height that cannot be one.
   *
   * `capHeight` is null in that case rather than carrying the declared value,
   * because the engines do the same thing: a declaration taller than the em is
   * rejected and the glyphs are measured instead. A font declaring 1.4 em was
   * drawn at 0.7 in both Chromium and WebKit, so trusting the file there would
   * have produced a stylesheet wrong by thirty pixels at a display size.
   *
   * Note what this does not cover. A declaration that is merely false but
   * plausible is used by the engine exactly as declared: a font claiming 0.6 em
   * whose capitals are really 0.7 was drawn at 0.6. The table is the authority
   * whenever the table is credible, which is the whole reason reading the file
   * works at all.
   */
  capHeightImplausible: boolean;
  typoAscender: number | null;
  typoDescender: number | null;
  hheaAscender: number | null;
  hheaDescender: number | null;
  /** True for a variable font, whose metrics move with its axes. */
  variable: boolean;
  outlines: "truetype" | "cff";
}

export class FontFileError extends Error {}

/** Inflate a zlib stream. Needed only for WOFF, which compresses each table. */
export type Inflate = (compressed: Uint8Array) => Uint8Array;

const TAG_TTF = 0x00010000;
const TAG_OTTO = 0x4f54544f; /* 'OTTO' */
const TAG_TTCF = 0x74746366; /* 'ttcf' */
const TAG_WOFF = 0x774f4646; /* 'wOFF' */
const TAG_WOFF2 = 0x774f4632; /* 'wOF2' */

interface Table {
  offset: number;
  length: number;
  /** For WOFF, the compressed length in the file. */
  compressed?: number;
}

function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  );
}

/**
 * Read the metrics from a TrueType, OpenType or WOFF font.
 *
 * WOFF2 is refused rather than half-parsed. It is not merely Brotli around the
 * same bytes: the specification transforms the glyf and loca tables and rewrites
 * the directory, and a parser that guessed at it would be wrong quietly. Point
 * this at the TTF or OTF the WOFF2 was built from.
 */
export function readFontMetrics(bytes: Uint8Array, inflate?: Inflate): FontFileMetrics {
  if (bytes.byteLength < 12) throw new FontFileError("not a font: fewer than 12 bytes");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);

  if (signature === TAG_TTCF) {
    throw new FontFileError(
      "this is a font collection (.ttc) rather than a single font. Extract the face you want."
    );
  }
  if (signature === TAG_WOFF2) {
    throw new FontFileError(
      "WOFF2 is not supported. It transforms the glyf and loca tables rather than " +
        "merely compressing them, so a partial parser would be wrong quietly. " +
        "Point this at the TTF or OTF it was built from."
    );
  }

  let tables: Record<string, Table>;
  let read: (table: Table) => DataView;
  let outlines: "truetype" | "cff";

  if (signature === TAG_WOFF) {
    const flavour = view.getUint32(4);
    outlines = flavour === TAG_OTTO ? "cff" : "truetype";
    const numTables = view.getUint16(12);

    tables = {};
    for (let i = 0; i < numTables; i++) {
      const base = 44 + i * 20;
      if (base + 20 > bytes.byteLength) throw new FontFileError("truncated WOFF directory");
      tables[tagAt(view, base)] = {
        offset: view.getUint32(base + 4),
        compressed: view.getUint32(base + 8),
        length: view.getUint32(base + 12),
      };
    }

    read = (table) => {
      const raw = bytes.subarray(table.offset, table.offset + (table.compressed ?? table.length));
      /* A table whose compressed length equals its original length is stored
         uncompressed, which the specification allows and which fonts do use. */
      if ((table.compressed ?? table.length) === table.length) {
        return new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      }
      if (!inflate) {
        throw new FontFileError(
          "this WOFF compresses its tables and no inflate function was supplied"
        );
      }
      const out = inflate(raw);
      return new DataView(out.buffer, out.byteOffset, out.byteLength);
    };
  } else if (signature === TAG_TTF || signature === TAG_OTTO) {
    outlines = signature === TAG_OTTO ? "cff" : "truetype";
    const numTables = view.getUint16(4);

    tables = {};
    for (let i = 0; i < numTables; i++) {
      const base = 12 + i * 16;
      if (base + 16 > bytes.byteLength) throw new FontFileError("truncated table directory");
      tables[tagAt(view, base)] = {
        offset: view.getUint32(base + 8),
        length: view.getUint32(base + 12),
      };
    }

    read = (table) => {
      if (table.offset + table.length > bytes.byteLength) {
        throw new FontFileError("a table points past the end of the file");
      }
      return new DataView(bytes.buffer, bytes.byteOffset + table.offset, table.length);
    };
  } else {
    throw new FontFileError(
      `not a font this can read: signature 0x${signature.toString(16).padStart(8, "0")}`
    );
  }

  const head = tables.head;
  if (!head) throw new FontFileError("no head table, so there is no units per em");
  const headView = read(head);
  if (headView.byteLength < 20) throw new FontFileError("head table is too short");
  const unitsPerEm = headView.getUint16(18);
  if (!unitsPerEm) throw new FontFileError("units per em is zero");

  const result: FontFileMetrics = {
    unitsPerEm,
    os2Version: null,
    capHeight: null,
    xHeight: null,
    capHeightImplausible: false,
    typoAscender: null,
    typoDescender: null,
    hheaAscender: null,
    hheaDescender: null,
    variable: Boolean(tables.fvar),
    outlines,
  };

  if (tables.hhea) {
    const hhea = read(tables.hhea);
    if (hhea.byteLength >= 8) {
      result.hheaAscender = hhea.getInt16(4);
      result.hheaDescender = hhea.getInt16(6);
    }
  }

  const os2Table = tables["OS/2"];
  if (os2Table) {
    const os2 = read(os2Table);
    if (os2.byteLength >= 72) {
      result.os2Version = os2.getUint16(0);
      result.typoAscender = os2.getInt16(68);
      result.typoDescender = os2.getInt16(70);
    }
    /*
       sxHeight and sCapHeight only exist from version 2 onward. Reading them out
       of a version 1 table returns whatever bytes happen to follow, and the
       length check is not enough on its own because a version 1 table can be
       padded. Both conditions, or neither figure.
    */
    if ((result.os2Version ?? 0) >= 2 && os2.byteLength >= 96) {
      const xHeight = os2.getInt16(86);
      const capHeight = os2.getInt16(88);
      /* Zero is the value a font uses to say "not computed", and a cap height
         of zero would put every baseline on the row above. */
      result.xHeight = xHeight > 0 ? xHeight : null;

      /*
         A cap height cannot be taller than the em, and a file saying otherwise
         is one the engines refuse: they measure the glyphs instead. Refusing it
         here too keeps the file and the engine saying the same thing, and errs
         in the safe direction, because declining to fit a font is recoverable
         and fitting it wrongly is not.
      */
      if (capHeight > unitsPerEm) {
        result.capHeightImplausible = true;
      } else if (capHeight > 0) {
        result.capHeight = capHeight;
      }
    }
  }

  return result;
}

/**
 * The cap height at a given size, in px, or null when the file does not declare
 * one.
 *
 * Linear in the size, because that is what the engines do: the trimmed box at
 * 32px measured 21.188 against a file declaring 0.662 per em, and at 17px it
 * measured 11.25 against the same ratio.
 */
export function capHeightAt(metrics: FontFileMetrics, size: number): number | null {
  if (metrics.capHeight === null) return null;
  return (metrics.capHeight / metrics.unitsPerEm) * size;
}
