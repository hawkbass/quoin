/* A PDF, built byte by byte, so the reader can be tested without a browser.

   The same argument as `make-font.ts`. A parser tested only against files
   produced by one engine is a parser that has learned that engine's habits, and
   the cases worth testing are the ones Chromium never emits: an indirect
   `/Length`, several content streams on a page, a page tree with a level in it,
   `Td` and `T*` instead of a matrix per line. */

import { deflateSync } from "node:zlib";

export interface TextAt {
  x: number;
  y: number;
  size?: number;
  /** Written with Td relative to the previous line rather than an absolute Tm. */
  relative?: boolean;
}

export interface PdfOptions {
  width?: number;
  height?: number;
  /** Deflate the content streams, as a real one almost always is. */
  compress?: boolean;
  /** Write /Length as an indirect reference, which is legal and less common. */
  indirectLength?: boolean;
  /** Split the content across two streams, which a page is allowed to do. */
  splitContent?: boolean;
  /** Put the page one level down, so the tree has to be walked. */
  nested?: boolean;
}

/** The content stream for one page's worth of text. */
function contentFor(runs: TextAt[]): string {
  const parts: string[] = [];
  let previous: TextAt | null = null;

  for (const run of runs) {
    const size = run.size ?? 12;
    if (run.relative && previous) {
      parts.push(
        `BT /F1 ${size} Tf 1 0 0 1 ${previous.x} ${previous.y} Tm ` +
          `${run.x - previous.x} ${run.y - previous.y} Td (text) Tj ET`
      );
    } else {
      parts.push(`BT /F1 ${size} Tf 1 0 0 1 ${run.x} ${run.y} Tm (text) Tj ET`);
    }
    previous = run;
  }

  return parts.join("\n") + "\n";
}

/**
 * A one-page PDF with text at the positions given, in PDF user space.
 *
 * Returns bytes, not a string, because the offsets a reader computes have to
 * index a buffer and building the fixture as a string would hide an encoding
 * bug in the thing under test.
 */
export function buildPdf(runs: TextAt[], options: PdfOptions = {}): Uint8Array {
  const width = options.width ?? 400;
  const height = options.height ?? 300;

  const streams = options.splitContent
    ? [contentFor(runs.slice(0, Math.ceil(runs.length / 2))),
       contentFor(runs.slice(Math.ceil(runs.length / 2)))]
    : [contentFor(runs)];

  const chunks: Buffer[] = [];
  const push = (text: string) => chunks.push(Buffer.from(text, "latin1"));
  const pushBytes = (bytes: Uint8Array) => chunks.push(Buffer.from(bytes));

  push("%PDF-1.4\n");

  /* 1 catalog, 2 pages, 3 page (or 3 pages + 4 page when nested), then the
     content streams, then any indirect lengths. */
  const pageNumber = options.nested ? 4 : 3;
  const firstStream = pageNumber + 1;
  const contentRefs = streams.map((_, i) => firstStream + i);
  const lengthRefs = contentRefs.map((n) => n + streams.length);

  push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n`);

  if (options.nested) {
    push(`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n`);
    push(`3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj\n`);
  } else {
    push(`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n`);
  }

  const contents =
    contentRefs.length === 1
      ? `${contentRefs[0]} 0 R`
      : `[${contentRefs.map((n) => `${n} 0 R`).join(" ")}]`;

  push(
    `${pageNumber} 0 obj << /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${width} ${height}] /Contents ${contents} >> endobj\n`
  );

  streams.forEach((body, index) => {
    const raw = Buffer.from(body, "latin1");
    const data = options.compress ? deflateSync(raw) : raw;
    const filter = options.compress ? " /Filter /FlateDecode" : "";
    const length = options.indirectLength
      ? `${lengthRefs[index]} 0 R`
      : String(data.length);

    push(`${contentRefs[index]} 0 obj << /Length ${length}${filter} >>\nstream\n`);
    pushBytes(data);
    push("\nendstream endobj\n");
  });

  if (options.indirectLength) {
    streams.forEach((body, index) => {
      const raw = Buffer.from(body, "latin1");
      const data = options.compress ? deflateSync(raw) : raw;
      push(`${lengthRefs[index]} 0 obj ${data.length} endobj\n`);
    });
  }

  push("trailer << /Root 1 0 R /Size 12 >>\n%%EOF\n");

  return Uint8Array.from(Buffer.concat(chunks));
}
