/* A font, built byte by byte.

   The corpus is thirty megabytes of somebody else's work that `npm run fonts`
   downloads, and CI does not download it. Every test that reaches for a real
   font therefore skips in the one place skipping matters, which is how the font
   parser went its whole life without being exercised in a single CI run.

   So this assembles one: a table directory, a `head` and an `OS/2`, put together
   by hand so the offsets under test are offsets these tests chose. It is a
   narrower thing than a real font and it runs everywhere, which is the trade
   worth making for the arithmetic that reads it. */

export interface BuiltFont {
  unitsPerEm?: number;
  os2Version?: number;
  /** In design units. Defaults to 0.7 em, which is an ordinary text face. */
  capHeight?: number;
  xHeight?: number;
  os2Length?: number;
  signature?: number;
  extraTables?: string[];
}

export function buildFont(options: BuiltFont = {}): Uint8Array {
  const unitsPerEm = options.unitsPerEm ?? 1000;
  const os2Version = options.os2Version ?? 4;
  const os2Length = options.os2Length ?? 96;

  const tags = ["OS/2", "head", ...(options.extraTables ?? [])];
  const headLength = 54;

  const lengths: Record<string, number> = { "OS/2": os2Length, head: headLength };
  for (const extra of options.extraTables ?? []) lengths[extra] = 16;

  let offset = 12 + tags.length * 16;
  const offsets: Record<string, number> = {};
  for (const tag of tags) {
    offsets[tag] = offset;
    offset += lengths[tag]!;
  }

  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, options.signature ?? 0x00010000);
  view.setUint16(4, tags.length);

  tags.forEach((tag, i) => {
    const base = 12 + i * 16;
    for (let c = 0; c < 4; c++) view.setUint8(base + c, tag.charCodeAt(c));
    view.setUint32(base + 8, offsets[tag]!);
    view.setUint32(base + 12, lengths[tag]!);
  });

  view.setUint16(offsets.head! + 18, unitsPerEm);

  view.setUint16(offsets["OS/2"]!, os2Version);
  view.setInt16(offsets["OS/2"]! + 68, Math.round(unitsPerEm * 0.8));
  view.setInt16(offsets["OS/2"]! + 70, -Math.round(unitsPerEm * 0.2));
  if (os2Length >= 96) {
    view.setInt16(offsets["OS/2"]! + 86, options.xHeight ?? Math.round(unitsPerEm * 0.5));
    view.setInt16(offsets["OS/2"]! + 88, options.capHeight ?? Math.round(unitsPerEm * 0.7));
  }

  return bytes;
}

/**
 * The cap height a built font declares, at a size, in px.
 *
 * The tests that use this need the same number the code under test will derive,
 * and computing it here rather than importing `capHeightAt` keeps the assertion
 * independent of the thing it is asserting about.
 */
export function capAt(size: number, options: BuiltFont = {}): number {
  const unitsPerEm = options.unitsPerEm ?? 1000;
  const capHeight = options.capHeight ?? Math.round(unitsPerEm * 0.7);
  return (capHeight / unitsPerEm) * size;
}
