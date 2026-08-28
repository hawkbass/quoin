/* Where the baselines are on a printed page.

   Everything else in this library measures a page in a browser, where a baseline
   is a number the engine will hand you. Print is the case a baseline grid comes
   from, and it was the one case this could say nothing about: a paginated
   rendering is not a DOM, `getBoundingClientRect` does not survive it, and every
   claim about how a fit behaves across pages was reasoning rather than
   measurement.

   A PDF will tell you, if you read it. Text is positioned by a matrix, the
   matrix is in the content stream, and the content stream is usually deflated.
   So this walks the page tree, inflates each page's content, tracks the
   transform stack, and reports the device-space position of every text run. It
   is not a PDF renderer and does not try to be: it reads positions and sizes and
   ignores everything else, which is all a grid check needs.

   Zero dependencies, like the rest. Inflate is passed in, the same way
   `readFontMetrics` takes it, because `node:zlib` has one and a browser has
   `DecompressionStream` and this file should not care which. */

export class PdfError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PdfError";
    this.code = code;
  }
}

/** One run of text, positioned. */
export interface PdfTextRun {
  /** Device space, in points, origin at the bottom left of the page. */
  x: number;
  y: number;
  /** The size the text was set at, in points, after the transform. */
  size: number;
}

export interface PdfPage {
  /** Page box, in points. */
  width: number;
  height: number;
  runs: PdfTextRun[];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/* a b c d e f, the PDF order. Row-vector convention: [x y 1] x M. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/* The vertical scale a matrix applies, for reporting the size a run was set at.
   The determinant's root rather than `d`, because a flipped or rotated matrix
   has a negative or split scale and the magnitude is what is wanted. */
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/*
   Bytes as latin1, which is how a PDF's structure is meant to be read.

   The file is a mix of ASCII syntax and binary streams, and latin1 is the one
   encoding that round-trips every byte to a character and back. Reading it as
   utf8 corrupts any byte above 0x7F, which is most of a deflated stream, and the
   offsets then point at the wrong places.
*/
function latin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

interface RawObject {
  /** The dictionary source, between `<<` and its matching `>>`. */
  dict: string;
  /** Byte range of the stream body, when the object has one. */
  stream: { start: number; end: number } | null;
}

/* Every `N G obj ... endobj` in the file, by object number. */
function readObjects(bytes: Uint8Array, source: string): Map<number, RawObject> {
  const objects = new Map<number, RawObject>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    const number = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const end = source.indexOf("endobj", bodyStart);
    if (end < 0) continue;

    const body = source.slice(bodyStart, end);

    /* The dictionary, if there is one. Nested `<<` are counted rather than
       matched with a regex, because a page dictionary contains several. */
    let dict = "";
    const open = body.indexOf("<<");
    if (open >= 0) {
      let depth = 0;
      let i = open;
      for (; i < body.length - 1; i++) {
        if (body[i] === "<" && body[i + 1] === "<") {
          depth++;
          i++;
        } else if (body[i] === ">" && body[i + 1] === ">") {
          depth--;
          i++;
          if (depth === 0) break;
        }
      }
      dict = body.slice(open, i + 1);
    }

    /*
       The stream body, located in bytes rather than in the string, because the
       offsets have to index the original buffer.

       `/Length` decides where it ends, not a search for `endstream`. Deflated
       bytes contain anything, including the EOL this used to strip off the end
       and including the word itself, and one byte either way is the difference
       between a stream that inflates and one that throws. The search is the
       fallback for a `/Length` that is an indirect reference, which is legal and
       which needs a second pass to resolve.
    */
    let stream: RawObject["stream"] = null;
    const streamAt = body.search(/\bstream\r?\n?/);
    if (streamAt >= 0) {
      let from = bodyStart + streamAt + "stream".length;
      if (source[from] === "\r") from++;
      if (source[from] === "\n") from++;

      const declared = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      if (declared) {
        stream = { start: from, end: from + Number(declared[1]) };
      } else {
        const streamEnd = source.indexOf("endstream", from);
        if (streamEnd >= 0) {
          let to = streamEnd;
          if (source[to - 1] === "\n") to--;
          if (source[to - 1] === "\r") to--;
          stream = { start: from, end: to };
        }
      }
    }

    objects.set(number, { dict, stream });
  }

  return objects;
}

function numbersIn(text: string): number[] {
  return (text.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/*
   The pages, in order.

   Taken from the page tree rather than from the order objects happen to appear
   in the file, because nothing requires those to agree and a page grid that
   reports page 3's baselines as page 1's is worse than no report.
*/
function pageOrder(objects: Map<number, RawObject>): number[] {
  let rootKids: number[] | null = null;

  for (const [, object] of objects) {
    if (!/\/Type\s*\/Pages\b/.test(object.dict)) continue;
    /* The root of the tree is the one nothing else lists as a kid. */
    const kids = object.dict.match(/\/Kids\s*\[([^\]]*)\]/);
    if (!kids) continue;
    const refs = [...kids[1]!.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    if (!rootKids) rootKids = refs;
    else rootKids = rootKids.concat(refs);
  }

  /* Flatten, following any /Pages nodes among the kids. */
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (numbers: number[]) => {
    for (const n of numbers) {
      if (seen.has(n)) continue;
      seen.add(n);
      const object = objects.get(n);
      if (!object) continue;
      if (/\/Type\s*\/Pages\b/.test(object.dict)) {
        const kids = object.dict.match(/\/Kids\s*\[([^\]]*)\]/);
        if (kids) {
          walk([...kids[1]!.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])));
        }
      } else if (/\/Type\s*\/Page\b/.test(object.dict)) {
        out.push(n);
      }
    }
  };
  walk(rootKids ?? []);

  /* A file with no readable tree still has pages, and reading them in file
     order is better than reporting none. Flagged by returning them anyway:
     a caller checking page count will still get the right number. */
  if (out.length === 0) {
    for (const [number, object] of objects) {
      if (/\/Type\s*\/Page\b/.test(object.dict)) out.push(number);
    }
  }

  return out;
}

/*
   Every text-positioning operator in a content stream.

   PDF text state: `BT` starts a text object and resets the text and line
   matrices, `Tm` sets both, `Td` moves the line matrix and resets the text
   matrix to it, `TD` does that and sets the leading, `T*` moves down by the
   leading, and the show operators draw at whatever the text matrix currently is.
   The graphics state stack, `q` and `Q`, carries the CTM.
*/
function runsIn(content: string, base: Matrix): PdfTextRun[] {
  const runs: PdfTextRun[] = [];

  let ctm: Matrix = base;
  const stack: Matrix[] = [];

  let text: Matrix = IDENTITY;
  let line: Matrix = IDENTITY;
  let leading = 0;
  let fontSize = 0;

  /* Operands accumulate until an operator consumes them. Strings and hex
     strings are skipped wholesale so a `(` inside one cannot be read as
     syntax. */
  let operands: number[] = [];

  const token = /(<[0-9A-Fa-f\s]*>)|(\((?:\\.|[^\\)])*\))|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)|(\/[^\s/<>\[\]()]+)|([A-Za-z'"*]+)|(\[|\])/g;
  let match: RegExpExecArray | null;

  const show = () => {
    const at = apply(multiply(text, ctm), 0, 0);
    runs.push({
      x: Math.round(at.x * 1000) / 1000,
      y: Math.round(at.y * 1000) / 1000,
      size: Math.round(fontSize * scaleOf(multiply(text, ctm)) * 1000) / 1000,
    });
  };

  while ((match = token.exec(content)) !== null) {
    if (match[1] !== undefined || match[2] !== undefined) continue; /* a string */
    if (match[3] !== undefined) {
      operands.push(Number(match[3]));
      continue;
    }
    if (match[4] !== undefined || match[6] !== undefined) continue; /* a name or array bracket */

    const op = match[5]!;
    switch (op) {
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? ctm;
        break;
      case "cm":
        if (operands.length >= 6) {
          ctm = multiply(operands.slice(-6) as Matrix, ctm);
        }
        break;
      case "BT":
        text = IDENTITY;
        line = IDENTITY;
        break;
      case "Tf":
        if (operands.length >= 1) fontSize = operands[operands.length - 1]!;
        break;
      case "Tm":
        if (operands.length >= 6) {
          text = operands.slice(-6) as Matrix;
          line = text;
        }
        break;
      case "TL":
        if (operands.length >= 1) leading = operands[operands.length - 1]!;
        break;
      case "Td":
        if (operands.length >= 2) {
          line = multiply([1, 0, 0, 1, operands[operands.length - 2]!, operands[operands.length - 1]!], line);
          text = line;
        }
        break;
      case "TD":
        if (operands.length >= 2) {
          leading = -operands[operands.length - 1]!;
          line = multiply([1, 0, 0, 1, operands[operands.length - 2]!, operands[operands.length - 1]!], line);
          text = line;
        }
        break;
      case "T*":
        line = multiply([1, 0, 0, 1, 0, -leading], line);
        text = line;
        break;
      case "Tj":
      case "TJ":
        show();
        break;
      case "'":
        line = multiply([1, 0, 0, 1, 0, -leading], line);
        text = line;
        show();
        break;
      case '"':
        line = multiply([1, 0, 0, 1, 0, -leading], line);
        text = line;
        show();
        break;
      default:
        break;
    }
    operands = [];
  }

  return runs;
}

/**
 * Read the position of every text run in a PDF.
 *
 * Positions are in points, in device space, with the origin at the bottom left
 * of the page, which is the PDF's own convention rather than a translation of
 * it into somebody's preferred one.
 *
 * `inflate` is passed in rather than imported: `node:zlib` has `inflateSync` and
 * this file should not decide that a browser cannot use it.
 */
export function readPdfText(
  bytes: Uint8Array,
  inflate: (compressed: Uint8Array) => Uint8Array
): PdfPage[] {
  if (bytes.length < 8 || latin1(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new PdfError("notPdf", "quoin: that is not a PDF");
  }

  const source = latin1(bytes);
  const objects = readObjects(bytes, source);
  const order = pageOrder(objects);

  if (order.length === 0) {
    throw new PdfError("noPages", "quoin: no pages found in this PDF");
  }

  return order.map((number) => {
    const object = objects.get(number)!;

    const box = object.dict.match(/\/MediaBox\s*\[([^\]]*)\]/);
    const numbers = box ? numbersIn(box[1]!) : [];
    const [x0, y0, x1, y1] = numbers.length >= 4 ? numbers : [0, 0, 612, 792];

    /* One `/Contents` or several, which a page is allowed to have. */
    const contents = object.dict.match(/\/Contents\s*(?:\[([^\]]*)\]|(\d+)\s+\d+\s+R)/);
    const refs: number[] = [];
    if (contents?.[1]) {
      refs.push(...[...contents[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])));
    } else if (contents?.[2]) {
      refs.push(Number(contents[2]));
    }

    let content = "";
    for (const ref of refs) {
      const stream = objects.get(ref)?.stream;
      if (!stream) continue;
      const raw = bytes.subarray(stream.start, stream.end);
      const deflated = /\/FlateDecode\b/.test(objects.get(ref)!.dict);
      try {
        content += latin1(deflated ? inflate(raw) : raw) + "\n";
      } catch {
        /* A stream that will not inflate is one page's worth of text missing,
           and reporting the rest as the whole page would be a quiet lie. */
        throw new PdfError(
          "badStream",
          `quoin: could not inflate the content stream of page object ${number}`
        );
      }
    }

    return {
      width: Math.round((x1! - x0!) * 1000) / 1000,
      height: Math.round((y1! - y0!) * 1000) / 1000,
      runs: runsIn(content, IDENTITY),
    };
  });
}

/**
 * The baselines on each page, measured down from the top of the page, in CSS px.
 *
 * PDF puts its origin at the bottom left and measures in points; a grid is
 * written in px and counted from the top. One conversion, in one place, so the
 * arithmetic everywhere else is the arithmetic the rest of the library uses.
 */
export function baselinesFromTop(page: PdfPage, pxPerPoint = 1 / 0.75): number[] {
  const tops = page.runs
    .map((run) => Math.round((page.height - run.y) * pxPerPoint * 1000) / 1000)
    .sort((a, b) => a - b);

  /*
     One baseline per line, not one per run.

     A line of text is often several show operators: a change of font, a kerned
     pair, a run of digits. They sit at the same baseline, and counting each one
     separately weights a line by how many pieces the engine happened to cut it
     into. Two layouts of the same text then report different totals while every
     baseline in both is in the same place, which is what made an early reading
     of this show 81 baselines against 111 for the same forty paragraphs.
  */
  const distinct: number[] = [];
  for (const top of tops) {
    const last = distinct[distinct.length - 1];
    if (last === undefined || Math.abs(top - last) > 0.5) distinct.push(top);
  }
  return distinct;
}
