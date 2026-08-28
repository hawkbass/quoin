/* A Figma file, as a design this can fit.

   The fitter takes a design and returns it with the spacing that puts it on a
   grid. Until now the only ways to hand it one were to write the JSON yourself
   or to point it at a rendered page, and neither is what somebody has when they
   are working from a design rather than from a site. The design is the thing
   that comes first, and fitting it before anybody writes CSS is the whole point:
   corrections applied afterwards are a repair, and a design fitted up front
   needs none.

   Figma's own node JSON is what this reads, from the REST API or from a plugin.
   A text node carries its family, its size and its leading, and its bounding box
   carries what the designer put between it and the block above it, which is the
   space the fit has to preserve. So the conversion is a grouping, the same
   grouping `inferDesign` does on a page, with the source swapped.

   No network, no key, no dependency. It takes JSON somebody already has, which
   also means an agent that can read a Figma file can hand it straight over
   without this library needing to know what an agent is. */

import type { FamilyRequest, DesignStep } from "./fit-core.ts";

export class FigmaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FigmaError";
    this.code = code;
  }
}

export interface FigmaOptions {
  /**
   * How many nodes a combination needs before it counts as a step.
   *
   * One, unlike the page reader, which wants two. On a page a combination used
   * once is usually a widget or a third party. In a design file it is a style
   * somebody drew on purpose, and a display size appears exactly once because
   * there is one hero. Dropping it is dropping the design.
   */
  minimum?: number;
  /**
   * Whether to read nodes Figma has marked invisible.
   *
   * Off by default. A hidden layer is a design somebody rejected, and fitting a
   * page to include it is fitting it to a decision that was already taken.
   */
  includeHidden?: boolean;
}

export interface FigmaDesign {
  families: FamilyRequest[];
  /** Text nodes found in the file. */
  nodes: number;
  /** How many of them are covered by a step. */
  covered: number;
  /** Combinations too rare to be a step, commonest first. */
  rare: { font: string; size: number; leading: number | null; nodes: number }[];
  /**
   * What could not be read, said plainly rather than guessed around.
   *
   * A design half-converted in silence is worse than one that refuses, because
   * the fit that comes out of it looks like an answer.
   */
  warnings: string[];
}

/* Figma's text node, as much of it as this needs. Typed loosely on purpose: the
   file comes from somebody else's API and a missing field is a warning rather
   than a crash. */
interface FigmaNode {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  visible?: unknown;
  children?: unknown;
  style?: {
    fontFamily?: unknown;
    fontSize?: unknown;
    fontWeight?: unknown;
    lineHeightPx?: unknown;
    lineHeightUnit?: unknown;
    lineHeightPercentFontSize?: unknown;
  };
  absoluteBoundingBox?: {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
  } | null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface TextNode {
  name: string;
  font: string;
  weight: number | null;
  size: number;
  /** Null when Figma says the leading is automatic. */
  leading: number | null;
  top: number | null;
  bottom: number | null;
}

/* Every TEXT node in the tree, in document order. */
function collect(
  node: FigmaNode,
  options: Required<FigmaOptions>,
  out: TextNode[],
  warnings: string[]
): void {
  if (!node || typeof node !== "object") return;

  if (node.visible === false && !options.includeHidden) return;

  if (node.type === "TEXT") {
    const name = typeof node.name === "string" ? node.name : "text";
    const style = node.style ?? {};

    const size = style.fontSize;
    const font = style.fontFamily;

    if (!isNumber(size) || size <= 0) {
      warnings.push(`"${name}" is a text node with no readable fontSize`);
    } else if (typeof font !== "string" || !font.trim()) {
      warnings.push(`"${name}" is a text node with no readable fontFamily`);
    } else {
      /*
         Figma reports leading three ways. `lineHeightPx` is the resolved figure
         and is present for all of them, but when the unit is INTRINSIC that
         figure is whatever the font's own metrics came to for the size, which is
         not a decision the designer made. Treating it as one would fit the page
         to an accident of the typeface.
      */
      const unit = style.lineHeightUnit;
      const resolved = style.lineHeightPx;
      const leading =
        unit === "INTRINSIC" || !isNumber(resolved) || resolved <= 0
          ? null
          : Math.round(resolved * 1000) / 1000;

      const box = node.absoluteBoundingBox;
      const top = box && isNumber(box.y) ? box.y : null;
      const height = box && isNumber(box.height) ? box.height : null;

      out.push({
        name,
        font: font.trim(),
        weight: isNumber(style.fontWeight) ? style.fontWeight : null,
        size: Math.round(size * 1000) / 1000,
        leading,
        top,
        bottom: top !== null && height !== null ? top + height : null,
      });
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collect(child as FigmaNode, options, out, warnings);
    }
  }
}

/*
   The space above each block, from the geometry.

   A designer's spacing is in the layout rather than in the type styles, so it
   has to come out of the bounding boxes: the gap between one block's bottom and
   the next block's top is what they put there. Taken per step and reduced to the
   commonest value, because one heading with extra air above it is not the rule.

   Nodes are sorted by their top edge first. Figma's document order is the layer
   order, which is the order things were drawn rather than the order they read.
*/
function spacesByStep(nodes: readonly TextNode[], keyOf: (n: TextNode) => string) {
  const ordered = nodes
    .filter((n) => n.top !== null && n.bottom !== null)
    .slice()
    .sort((a, b) => a.top! - b.top!);

  const gaps = new Map<string, Map<number, number>>();

  for (let i = 1; i < ordered.length; i++) {
    const above = ordered[i - 1]!;
    const block = ordered[i]!;
    const gap = Math.round((block.top! - above.bottom!) * 100) / 100;

    /* A negative gap is an overlap, which is a layered design rather than a
       flow, and a very large one is a new section rather than a rhythm. */
    if (gap < 0 || gap > 400) continue;

    const key = keyOf(block);
    let counts = gaps.get(key);
    if (!counts) {
      counts = new Map();
      gaps.set(key, counts);
    }
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }

  /*
     The commonest gap, and on a tie the smallest.

     A step used twice has two gaps above it and no majority, and taking
     whichever the sort happened to put first read a 76px section break as the
     rhythm for a 13px caption and asked for a 79px space. The repeated gap is
     the rhythm and the odd large one is a section boundary, so where they are
     equally common the smaller is the one to keep.
  */
  const commonest = new Map<string, number>();
  for (const [key, counts] of gaps) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (ranked[0]) commonest.set(key, ranked[0][0]);
  }
  return commonest;
}

/**
 * Turn a Figma file, or any node in one, into a design the fitter takes.
 *
 * Pass the parsed JSON: the whole `GET /v1/files/:key` response, its `document`,
 * or a single frame from `GET /v1/files/:key/nodes`. All three are the same
 * shape once you are inside them, so all three are accepted rather than made
 * somebody's problem.
 */
export function figmaToDesign(
  input: unknown,
  options: FigmaOptions = {}
): FigmaDesign {
  const settings: Required<FigmaOptions> = {
    minimum: options.minimum ?? 1,
    includeHidden: options.includeHidden ?? false,
  };

  if (!input || typeof input !== "object") {
    throw new FigmaError("notFigma", "quoin: that is not a Figma document");
  }

  /* The three shapes somebody actually has. */
  const record = input as Record<string, unknown>;
  const roots: FigmaNode[] = [];

  if (record.document && typeof record.document === "object") {
    roots.push(record.document as FigmaNode);
  } else if (record.nodes && typeof record.nodes === "object") {
    for (const entry of Object.values(record.nodes as Record<string, unknown>)) {
      const node = (entry as Record<string, unknown>)?.document;
      if (node && typeof node === "object") roots.push(node as FigmaNode);
    }
  } else {
    roots.push(record as FigmaNode);
  }

  const warnings: string[] = [];
  const nodes: TextNode[] = [];
  for (const root of roots) collect(root, settings, nodes, warnings);

  if (nodes.length === 0) {
    throw new FigmaError(
      "noText",
      "quoin: no readable text nodes in that file. Export the frame with " +
        "geometry included, or check that the layers are not all hidden."
    );
  }

  /* Grouped on family, size and leading, the same grouping a page gets. */
  const keyOf = (n: TextNode) => `${n.font}|${n.size}|${n.leading ?? "auto"}`;
  const groups = new Map<string, { nodes: TextNode[] }>();
  for (const node of nodes) {
    const key = keyOf(node);
    const group = groups.get(key);
    if (group) group.nodes.push(node);
    else groups.set(key, { nodes: [node] });
  }

  const spaces = spacesByStep(nodes, keyOf);

  const kept = [...groups.entries()].filter(
    ([, g]) => g.nodes.length >= settings.minimum
  );
  const rare = [...groups.entries()]
    .filter(([, g]) => g.nodes.length < settings.minimum)
    .map(([, g]) => ({
      font: g.nodes[0]!.font,
      size: g.nodes[0]!.size,
      leading: g.nodes[0]!.leading,
      nodes: g.nodes.length,
    }))
    .sort((a, b) => b.nodes - a.nodes);

  /*
     One family per typeface, its steps ordered by size, which is how a design
     system would describe itself and how somebody reading the output will
     recognise what they drew.
  */
  const byFont = new Map<string, [string, { nodes: TextNode[] }][]>();
  for (const entry of kept) {
    const font = entry[1].nodes[0]!.font;
    const existing = byFont.get(font);
    if (existing) existing.push(entry);
    else byFont.set(font, [entry]);
  }

  const used = new Set<string>();
  const families: FamilyRequest[] = [...byFont.entries()]
    .sort((a, b) => sumNodes(b[1]) - sumNodes(a[1]))
    .map(([font, members], index) => ({
      role: index === 0 ? "body" : `family-${index + 1}`,
      font,
      steps: members
        .sort((a, b) => a[1].nodes[0]!.size - b[1].nodes[0]!.size)
        .map(([key, group]): DesignStep => {
          const first = group.nodes[0]!;

          /* Named for the layer name the designer used most, because that is
             what they will look for in the output. */
          const names = new Map<string, number>();
          for (const node of group.nodes) {
            const clean = node.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
            if (clean) names.set(clean, (names.get(clean) ?? 0) + 1);
          }
          const commonest = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
          let name = commonest ? commonest[0]!.slice(0, 32) : `s${first.size}`;
          if (used.has(name)) name = `${name}-${first.size}`;
          if (used.has(name)) {
            let n = 2;
            while (used.has(`${name}-${n}`)) n++;
            name = `${name}-${n}`;
          }
          used.add(name);

          const space = spaces.get(key);

          return {
            name,
            size: first.size,
            ...(first.leading === null ? {} : { leading: first.leading }),
            ...(space === undefined ? {} : { space }),
          };
        }),
    }));

  if (families.length === 0) {
    warnings.push(
      `no combination appeared ${settings.minimum} times, so nothing was kept. ` +
        "Lower the minimum, or convert a frame with more text in it."
    );
  }

  return {
    families,
    nodes: nodes.length,
    covered: kept.reduce((sum, [, g]) => sum + g.nodes.length, 0),
    rare,
    warnings,
  };
}

function sumNodes(members: [string, { nodes: TextNode[] }][]): number {
  return members.reduce((sum, [, g]) => sum + g.nodes.length, 0);
}
