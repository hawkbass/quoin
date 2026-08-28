/* Accepting a design from whoever is holding one.

   `fitScale` takes families, each with a font and a list of steps. That is the
   shape the arithmetic wants, and it is not the shape anybody arrives with.

   A person exporting from Figma has variables named `fontSize` and
   `lineHeight`, in px strings. A design system has a flat token file with no
   families in it at all. An agent reading a screenshot has a list of things it
   measured and no idea what this library calls them. Every one of those is the
   same information, and refusing all but one spelling of it makes the tool
   useless to exactly the callers it was built for.

   So this accepts the spellings that actually turn up and says precisely what is
   wrong with the ones it cannot take. That second half matters more than the
   first: an agent cannot ask a follow-up question, so an error that does not say
   which entry was wrong and what was expected costs a whole round trip and
   sometimes a wrong answer instead. */

import type { DesignStep, FamilyRequest } from "./fit-core.ts";

export interface NormaliseResult {
  families: FamilyRequest[];
  /**
   * What had to be interpreted, in the caller's own terms.
   *
   * A silent coercion is how a design gets fitted at 17px when it said "17rem".
   * Everything guessed at is listed so the caller can check the guess.
   */
  notes: string[];
}

export class DesignError extends Error {
  /** Where in the input the problem is, in dotted path form. */
  readonly at: string;
  constructor(at: string, message: string) {
    super(`${at}: ${message}`);
    this.at = at;
    this.name = "DesignError";
  }
}

/** A number, from a number or from the strings a design tool exports. */
function toPx(value: unknown, at: string, notes: string[]): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DesignError(at, `${value} is not a number`);
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^(-?\d*\.?\d+)\s*(px|pt|rem|em|%)?$/i.exec(trimmed);
    if (!match) throw new DesignError(at, `cannot read "${value}" as a length`);

    const amount = Number.parseFloat(match[1]!);
    const unit = (match[2] ?? "px").toLowerCase();

    switch (unit) {
      case "px":
        return amount;
      case "pt":
        /* 96 CSS pixels to the inch, 72 points. Design tools that came from
           print still export points. */
        notes.push(`${at}: read "${value}" as ${(amount * 96) / 72}px`);
        return (amount * 96) / 72;
      case "rem":
      case "em":
        /*
           Refused rather than assumed. A rem is 16px only if nothing has changed
           the root size, and a design that says 1.0625rem where the root is 18px
           means 19.125px. Guessing turns a fit into a plausible wrong answer,
           which is the one outcome worth avoiding.
        */
        throw new DesignError(
          at,
          `"${value}" is relative. Give it in px, because a rem depends on a root ` +
            "size this cannot see and guessing would produce a fit that looks right"
        );
      case "%":
        throw new DesignError(at, `"${value}" is a percentage, which needs a size to be relative to`);
      default:
        throw new DesignError(at, `unknown unit in "${value}"`);
    }
  }

  throw new DesignError(at, `expected a length, got ${typeof value}`);
}

/** One step, from any of the spellings that turn up. */
function toStep(raw: unknown, at: string, notes: string[]): DesignStep {
  if (typeof raw === "number" || typeof raw === "string") {
    /* A bare size. A flat token file is often nothing but these. */
    return { size: toPx(raw, at, notes) };
  }

  if (!raw || typeof raw !== "object") {
    throw new DesignError(at, `expected a step, got ${raw === null ? "null" : typeof raw}`);
  }

  const it = raw as Record<string, unknown>;

  const sizeKey = ["size", "fontSize", "font-size", "fontsize"].find((k) => k in it);
  if (!sizeKey) {
    throw new DesignError(
      at,
      `no size. Give it as "size", or as "fontSize" if that is what your export calls it`
    );
  }
  const size = toPx(it[sizeKey], `${at}.${sizeKey}`, notes);
  if (size <= 0) throw new DesignError(`${at}.${sizeKey}`, `a size of ${size} is not a size`);

  const step: DesignStep = { size };

  const nameKey = ["name", "label", "token", "role", "id"].find(
    (k) => k in it && typeof it[k] === "string"
  );
  if (nameKey) step.name = String(it[nameKey]);

  const leadingKey = ["leading", "lineHeight", "line-height", "lineheight"].find((k) => k in it);
  if (leadingKey) {
    const value = it[leadingKey];
    /*
       A unitless line-height is a ratio, which is how CSS spells it and how most
       design tools export it. `1.5` is a ratio; `24` is almost certainly pixels.
       The boundary is where those stop overlapping: nothing sets a ratio above 4,
       and nothing sets a leading below 4px.
    */
    if (typeof value === "number" && value > 0 && value <= 4) {
      step.ratio = value;
      notes.push(`${at}.${leadingKey}: read ${value} as a ratio, not ${value}px`);
    } else {
      step.leading = toPx(value, `${at}.${leadingKey}`, notes);
    }
  }

  const ratioKey = ["ratio", "lineHeightRatio"].find((k) => k in it);
  if (ratioKey && step.ratio === undefined && step.leading === undefined) {
    const value = it[ratioKey];
    if (typeof value !== "number" || !(value > 0)) {
      throw new DesignError(`${at}.${ratioKey}`, `expected a positive number, got ${String(value)}`);
    }
    step.ratio = value;
  }

  const spaceKey = ["space", "spacing", "marginTop", "margin-top", "gap"].find((k) => k in it);
  if (spaceKey) step.space = toPx(it[spaceKey], `${at}.${spaceKey}`, notes);

  return step;
}

/**
 * Turn whatever a caller has into families `fitScale` can take.
 *
 * Accepts a list of families, a flat list of steps with a font on each, or a
 * single family with its steps inline. Anything it has to interpret is reported
 * in `notes`; anything it cannot is a `DesignError` naming the exact entry.
 */
export function normaliseDesign(input: unknown): NormaliseResult {
  const notes: string[] = [];

  if (!input || typeof input !== "object") {
    throw new DesignError(
      "design",
      `expected an object with families or steps, got ${input === null ? "null" : typeof input}`
    );
  }

  const root = input as Record<string, unknown>;

  /* Shape one: the canonical families array. */
  if (Array.isArray(root.families)) {
    if (root.families.length === 0) {
      throw new DesignError("design.families", "is empty, so there is nothing to fit");
    }

    const families = root.families.map((raw, index): FamilyRequest => {
      const at = `design.families[${index}]`;
      if (!raw || typeof raw !== "object") {
        throw new DesignError(at, `expected a family, got ${typeof raw}`);
      }
      const family = raw as Record<string, unknown>;

      const fontKey = ["font", "fontFamily", "font-family", "family", "stack"].find(
        (k) => typeof family[k] === "string"
      );
      if (!fontKey) {
        throw new DesignError(
          at,
          'no font. Give it as "font", with the CSS family exactly as the page will set it'
        );
      }

      const stepsKey = ["steps", "sizes", "scale", "tokens"].find((k) => Array.isArray(family[k]));
      if (!stepsKey) {
        throw new DesignError(at, 'no steps. Give them as "steps", an array of sizes');
      }

      const list = family[stepsKey] as unknown[];
      if (list.length === 0) throw new DesignError(`${at}.${stepsKey}`, "is empty");

      return {
        role: typeof family.role === "string" ? family.role : `family-${index + 1}`,
        font: String(family[fontKey]),
        steps: list.map((step, at2) => toStep(step, `${at}.${stepsKey}[${at2}]`, notes)),
        ...(typeof family.file === "string" ? { file: family.file } : {}),
      } as FamilyRequest;
    });

    return { families, notes };
  }

  /* Shape two: one family, with its font and steps at the top level. */
  const fontKey = ["font", "fontFamily", "font-family", "family", "stack"].find(
    (k) => typeof root[k] === "string"
  );
  const stepsKey = ["steps", "sizes", "scale", "tokens"].find((k) => Array.isArray(root[k]));

  if (fontKey && stepsKey) {
    const list = root[stepsKey] as unknown[];
    if (list.length === 0) throw new DesignError(`design.${stepsKey}`, "is empty");
    notes.push("read the whole design as a single family");

    return {
      families: [
        {
          role: typeof root.role === "string" ? root.role : "body",
          font: String(root[fontKey]),
          steps: list.map((step, i) => toStep(step, `design.${stepsKey}[${i}]`, notes)),
          ...(typeof root.file === "string" ? { file: root.file } : {}),
        } as FamilyRequest,
      ],
      notes,
    };
  }

  if (stepsKey && !fontKey) {
    throw new DesignError(
      "design",
      `found ${stepsKey} but no font. Every family needs the CSS family it is set in, ` +
        "because the cap height that decides the spacing belongs to the typeface"
    );
  }

  throw new DesignError(
    "design",
    'expected either a "families" array, or a "font" and "steps" at the top level'
  );
}
