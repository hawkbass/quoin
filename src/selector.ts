/* Stable CSS selectors for elements the seater moved.

   This exists because of a bug worth writing down. The first version of the
   CSS export emitted rules keyed on `[data-quoin-seat="7"]`, an attribute the
   script stamps onto the DOM at runtime. The README told you to export the
   stylesheet, paste it in and delete the script. At which point nothing on
   the page carries the attribute and every rule matches nothing. The export
   was a well-formed stylesheet that did nothing at all, and the test covering
   it asserted the string contained `padding-top`, which it did.

   So the export needs selectors that address the page as authored, and every
   one of them is checked against the document before it is written out. Same
   rule as the seater: check the correction rather than trust it. */

/** Longest path we will build before giving up and admitting it. */
const MAX_DEPTH = 12;

function escapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  /* Older engines: escape everything that is not plainly safe. */
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/** Does this selector parse, and does it match exactly this one element? */
export function matchesOnly(selector: string, el: Element): boolean {
  const doc = el.ownerDocument;
  if (!doc) return false;
  try {
    const found = doc.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    /* An unparseable selector throws rather than returning nothing, and a
       corrector that emits invalid CSS breaks the rules after it in the same
       stylesheet, not just its own. */
    return false;
  }
}

function classSelector(el: Element): string | null {
  const raw = el.getAttribute("class");
  if (!raw?.trim()) return null;
  const classes = raw.trim().split(/\s+/).filter(Boolean);
  if (!classes.length) return null;
  /* Utility-class markup produces forty of these and a selector nobody can
     read. Four is enough to be specific and still legible in a diff. */
  return classes.slice(0, 4).map((c) => `.${escapeIdent(c)}`).join("");
}

function nthOfParent(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const index = [...parent.children].indexOf(el) + 1;
  return `${tag}:nth-child(${index})`;
}

/**
 * A selector that addresses exactly this element, or null when none could be
 * verified.
 *
 * Tries the readable forms first and falls back to a structural path, checking
 * each against the document rather than assuming. Null is a real answer: a
 * caller that gets one should report the block as unexportable rather than
 * write out a rule that silently matches nothing, or worse, something else.
 */
export function uniqueSelector(el: Element): string | null {
  if (!el.ownerDocument || !el.isConnected) return null;

  /*
     Inside a shadow root there is nothing to return. A document stylesheet does
     not reach in, `::part()` only exposes what the component chose to expose,
     and `>>>` was removed from the platform years ago. The seater can still move
     these at runtime; the export cannot carry them, and saying so is the whole
     job of this returning null.
  */
  const root = el.getRootNode();
  if (root !== el.ownerDocument && typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
    return null;
  }

  const tag = el.tagName.toLowerCase();

  /* 1. An id, if it is unique and addressable. Duplicate ids are invalid HTML
        and also completely normal, so this is checked rather than trusted. */
  const id = el.getAttribute("id");
  if (id) {
    const candidate = `#${escapeIdent(id)}`;
    if (matchesOnly(candidate, el)) return candidate;
  }

  /* 2. Tag plus classes, which is the form a human reading the diff can map
        back onto their own stylesheet. */
  const classes = classSelector(el);
  for (const candidate of [classes && `${tag}${classes}`, classes]) {
    if (candidate && matchesOnly(candidate, el)) return candidate;
  }

  /* 3. A structural path, anchored on the nearest addressable ancestor so the
        selector stays as short as the document allows. */
  const steps: string[] = [];
  let node: Element | null = el;
  let depth = 0;

  while (node && depth < MAX_DEPTH) {
    steps.unshift(nthOfParent(node));

    const parent: Element | null = node.parentElement;
    if (!parent) break;

    const parentId = parent.getAttribute("id");
    if (parentId) {
      const anchored = `#${escapeIdent(parentId)} > ${steps.join(" > ")}`;
      if (matchesOnly(anchored, el)) return anchored;
    }

    const fromHere = steps.join(" > ");
    if (matchesOnly(fromHere, el)) return fromHere;

    node = parent;
    depth++;
  }

  const full = steps.join(" > ");
  return matchesOnly(full, el) ? full : null;
}

/**
 * A short human-readable path. For reports and console tables, never for a
 * stylesheet: it is not required to be unique and frequently is not.
 */
export function describe(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;

  while (node && depth < 3) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const first = node.getAttribute("class")?.trim().split(/\s+/)[0];
    const cls = first ? `.${first}` : "";
    parts.unshift(`${tag}${id}${cls}`);
    if (node.id) break;
    node = node.parentElement;
    depth++;
  }

  return parts.join(" > ");
}
