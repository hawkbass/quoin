/* Finding every element on the page that owns rendered words.

   A `TreeWalker` does not cross a shadow boundary, and the first version of
   this used one. On the torture fixture that walk found 332 blocks, seated all
   332, and reported the page 100% on the grid while two paragraphs inside an
   open shadow root sat off it, unmeasured and unmentioned.

   That is the failure mode this library's own config validation exists to
   prevent: silent, and flattering. A measuring tool that cannot see a region
   has to say so, and where it can see it, it should.

   So the walk descends into open shadow roots, and counts the closed ones and
   the frames it could not enter. */

export interface WalkOptions {
  /** Skip elements matching these selectors, and everything inside them. */
  ignore?: readonly string[];
  /**
   * Descend into open shadow roots. On by default: a page built out of web
   * components has most of its text in them, and not looking is not the same
   * as there being nothing there.
   */
  crossShadow?: boolean;
}

export interface WalkResult {
  blocks: Element[];
  /**
   * Shadow roots that could not be entered.
   *
   * A closed root is closed on purpose and there is no way in from outside. The
   * text inside it is real and this tool cannot see it, which is a fact about
   * the measurement rather than about the page.
   */
  closedShadowRoots: number;
  /**
   * Frames on the page. Their content is a different document with its own
   * layout origin, so a grid measured out here does not describe it. Point the
   * tool at the frame's own URL instead.
   */
  frames: number;
}

/** Elements whose text is not prose and should not be judged as prose. */
export const NON_TEXT: readonly string[] = [
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS",
  "IFRAME", "FRAME", "OPTION", "TEXTAREA", "CODE", "PRE", "KBD", "SAMP",
  "OBJECT", "EMBED", "VIDEO", "AUDIO", "MAP", "MATH", "SELECT", "PROGRESS", "METER",
];

const NON_TEXT_SET = new Set(NON_TEXT);
const FRAME_TAGS = new Set(["IFRAME", "FRAME", "OBJECT", "EMBED"]);

/** True when this element is inside a shadow root rather than the document. */
export function inShadowRoot(el: Element): boolean {
  const root = el.getRootNode();
  return root !== el.ownerDocument && root instanceof ShadowRoot;
}

function ownsRenderedText(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
  }
  return false;
}

function matchesAny(el: Element, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    try {
      if (el.matches(selector)) return true;
    } catch {
      /* An unparseable ignore selector should not take the whole walk down
         with it. Skipping nothing is the safe reading of a typo. */
    }
  }
  return false;
}

/*
   Recursive rather than a TreeWalker, because the thing being walked is not a
   tree: a shadow root hangs off its host and renders where the host is, so the
   flattened order is depth-first with each host's shadow content in the host's
   own position.
*/
function descend(
  node: Element | ShadowRoot | DocumentFragment,
  options: Required<Pick<WalkOptions, "ignore" | "crossShadow">>,
  out: WalkResult,
  depth: number
): void {
  /* A component tree fourteen wrappers deep is ordinary. A thousand is a cycle
     or a bug, and blowing the stack is a worse answer than stopping. */
  if (depth > 200) return;

  for (const child of node.children) {
    const el = child;
    const tag = el.tagName.toUpperCase();

    if (FRAME_TAGS.has(tag)) {
      out.frames++;
      continue;
    }
    if (NON_TEXT_SET.has(el.tagName) || NON_TEXT_SET.has(tag)) continue;
    if (matchesAny(el, options.ignore)) continue;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    /* Vertical writing modes have a baseline, but it runs the other way and a
       horizontal grid has nothing to say about it. */
    if (style.writingMode && style.writingMode !== "horizontal-tb") continue;

    /*
       Only elements that directly own rendered words, and only block-level
       ones.

       An inline box does not have a baseline of its own: it sits on the line
       box its parent laid out, which is where `strong`, `em`, `code`, `a` and
       every `span` in a sentence live. Counting one is counting its parent's
       line twice, and seating one is worse: it moves those words off the line
       the rest of the sentence is on.

       This was visible on the first build of quoin.dev, where a version number
       wrapped in a span was pushed seven pixels below the words either side of
       it, by the tool, on the tool's own homepage.
    */
    if (ownsRenderedText(el) && !style.display.startsWith("inline")) {
      out.blocks.push(el);
    }

    /* The shadow root first: its content renders inside the host, so in
       flattened order it comes before whatever the host's light children are
       slotted into. Slotted light-DOM children are reached by the ordinary
       descent below and are not double-counted, because a `<slot>` owns no
       text of its own. */
    const shadow = el.shadowRoot;
    if (shadow) {
      if (options.crossShadow) descend(shadow, options, out, depth + 1);
      else out.closedShadowRoots++;
    } else if (isProbablyClosedHost(el)) {
      out.closedShadowRoots++;
    }

    descend(el, options, out, depth + 1);
  }
}

/*
   A closed shadow root is invisible: `el.shadowRoot` is null and there is no
   other way to ask. A custom element with no light children and no text is the
   only signal available that something is being rendered we cannot see, and it
   is a guess rather than a detection, so it is counted rather than reported as
   a certainty.
*/
function isProbablyClosedHost(el: Element): boolean {
  return (
    el.tagName.includes("-") &&
    el.children.length === 0 &&
    !el.textContent?.trim() &&
    el.getBoundingClientRect().height > 0
  );
}

/** Every element that owns rendered words, in flattened tree order. */
export function walk(
  root: Element | ShadowRoot = document.body,
  options: WalkOptions = {}
): WalkResult {
  const out: WalkResult = { blocks: [], closedShadowRoots: 0, frames: 0 };

  /* The root itself can own text, and a caller passing a specific element
     usually means that element. */
  if (root instanceof Element && ownsRenderedText(root)) {
    const style = getComputedStyle(root);
    if (style.display !== "none" && style.visibility !== "hidden") {
      out.blocks.push(root);
    }
  }

  descend(
    root,
    { ignore: options.ignore ?? [], crossShadow: options.crossShadow ?? true },
    out,
    0
  );

  return out;
}
