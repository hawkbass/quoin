/* Solving for a type scale that lands on the grid without correction.

   Everything else in this library is remedial. It measures a page that is off
   the grid and pushes each block into place, which works and leaves you with a
   stylesheet of corrections to regenerate whenever the copy changes.

   This is the other half, and it is the half that makes the first half
   unnecessary for new work.

   ## The arithmetic

   A block's phase, meaning where its first baseline sits inside its own line
   box, is

       phase(S, L) = (L - (ascent + descent)) / 2 + ascent

   with ascent and descent taken at size S. Expanding, with A and D as the
   font's per-em ascent and descent:

       phase(S, L) = L/2 + S(A - D)/2

   If every size-and-leading pair on a page produces the same phase modulo the
   pitch, and every vertical distance is a whole number of rows, then a single
   grid origin seats the entire page and there is nothing left to correct. The
   phase is the same, so the correction would be the same, so it can be folded
   into where the grid starts.

   ## What that costs

   The sizes are not free. Rearranging, sizes that share a phase are spaced

       pitch / (A - D)

   apart, which is about eleven pixels for most text faces on an eight pixel
   grid. So you take the nearest solved size to the one you had in mind rather
   than the round number, and how near that is depends on the typeface.

   This is the trade print has always made. It is why the checkbox in InDesign
   changes your leading when you tick it. */

import { measureFont, fontIsAvailable } from "./metrics.ts";
import { gridConfig, type GridConfig } from "./grid.ts";

export interface ScaleStep {
  /** The size to set, in px. */
  size: number;
  /** The leading to set, in px. Always a whole number of grid rows. */
  leading: number;
  /** Leading over size, for a human deciding whether it reads. */
  ratio: number;
  /** How many grid rows the leading spans. */
  rows: number;
  /** The size that was asked for, and how far this is from it. */
  wanted: number;
  off: number;
}

export interface GridScale {
  /** The family these were solved against, as asked for. */
  font: string;
  /**
   * Whether that family actually rendered.
   *
   * False means the scale describes a fallback. It is worth checking rather
   * than assuming, because the obvious check does not work: `ctx.font` reads
   * back the family you asked for, so a font nobody has installed hands its own
   * name back while the measurement comes off something else entirely. This is
   * settled the only way it can be, by measuring a probe string against two
   * different fallbacks and seeing whether the widths agree.
   */
  resolved: boolean;
  grid: GridConfig;
  /**
   * The phase every step shares, in px, modulo the pitch.
   *
   * Set the grid origin to this and the page needs no per-element correction:
   * every first baseline is the same distance inside its own line box, so one
   * offset accounts for all of them.
   */
  phase: number;
  steps: ScaleStep[];
  /** Sizes asked for that no step could be found near enough to. */
  missed: number[];
  /**
   * How far apart solved sizes are for this font and pitch, in px.
   *
   * `pitch / (ascent - descent)`. It is the whole cost of the method: a smaller
   * number is a font that offers you more choices.
   */
  spacing: number;
  /** Every size available at this phase, for browsing rather than solving. */
  available: number[];
}

export interface ScaleOptions extends Partial<GridConfig> {
  /** The sizes you actually want, in px. */
  targets?: number[];
  /**
   * How far from a target a step may sit, in px, before it counts as missed.
   *
   * Deliberately not called `tolerance`. This interface extends `GridConfig`,
   * which already has one, meaning how far a baseline may drift and still count
   * as on the grid. Two different quantities under one name is how a scale
   * request of four pixels became a grid tolerance of four pixels and threw,
   * which is at least a loud failure and was still the wrong shape of API.
   */
  near?: number;
  /** Acceptable leading over size, as [min, max]. */
  ratio?: [number, number];
  /** Range of sizes to consider, in px. */
  range?: [number, number];
  /** Step between candidate sizes, in px. Half a pixel is the useful floor. */
  step?: number;
  /**
   * The smallest gap between consecutive steps, in px.
   *
   * Guards against a scale whose first two steps are 17 and 17.5, which
   * satisfies two targets and is one step.
   */
  minimumStep?: number;
}

interface Candidate {
  size: number;
  leading: number;
  rows: number;
  ratio: number;
  phase: number;
  key: string;
}

/*
   Phases are grouped to a quarter pixel rather than compared exactly.

   `fontBoundingBox` comes back rounded to whole pixels in every engine tested,
   so phase lands on halves and quarters and two sizes that agree typographically
   can differ in the last bit of a float. Grouping too finely splits a usable
   scale into singletons; too coarsely gathers sizes that visibly do not match.
*/
const PHASE_RESOLUTION = 4;

/**
 * Solve for a type scale that sits on the grid with no correction.
 *
 * Runs in the browser, because it measures the font the browser actually
 * resolved. A scale solved against metrics from a font file describes the font
 * you asked for rather than the one that loaded.
 */
export function gridNativeScale(
  font: string,
  options: ScaleOptions = {}
): GridScale {
  const grid = gridConfig(options);
  const targets = options.targets ?? [16, 20, 28, 40];
  const near = options.near ?? 3;
  const [minRatio, maxRatio] = options.ratio ?? [1.2, 1.75];
  const [minSize, maxSize] = options.range ?? [10, 96];
  const step = options.step ?? 0.5;
  const minimumStep = options.minimumStep ?? 2;

  /*
     How far apart solved sizes sit, which is `pitch / (A - D)` with A and D as
     the font's per-em ascent and descent.

     Taken at 400px rather than at a text size, because `fontBoundingBox` comes
     back rounded to whole pixels: at 48px a difference of 33px serves six
     different typefaces and they all report an identical spacing, which is the
     rounding talking rather than the fonts. At 400px the rounding is under a
     tenth of a percent.
  */
  /*
     A generic keyword is a promise that something will be found rather than a
     statement about what, so it is never "unresolved" and never worth probing.
  */
  const generic = /^\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|math|emoji)\s*$/i;
  const bare = font.replace(/^["']|["']$/g, "").trim();
  const resolved = generic.test(bare) ? true : fontIsAvailable(bare);

  const large = measureFont(`400 400px ${font}`, 400);
  const perEm = (large.ascent - large.descent) / 400;
  const spacing = perEm > 0 ? Math.round((grid.pitch / perEm) * 100) / 100 : 0;

  /* Every readable size-and-leading pair, with the phase it produces. */
  const candidates: Candidate[] = [];

  for (let size = minSize; size <= maxSize + 1e-9; size += step) {
    const rounded = Math.round(size * 100) / 100;
    const metrics = measureFont(`400 ${rounded}px ${font}`, rounded);

    for (let rows = 1; rows <= 16; rows++) {
      const leading = rows * grid.pitch;
      const ratio = leading / rounded;
      if (ratio < minRatio || ratio > maxRatio) continue;

      const phase = (leading - (metrics.ascent + metrics.descent)) / 2 + metrics.ascent;
      const mod = ((phase % grid.pitch) + grid.pitch) % grid.pitch;

      candidates.push({
        size: rounded,
        leading,
        rows,
        ratio: Math.round(ratio * 100) / 100,
        phase: Math.round(mod * 100) / 100,
        key: (Math.round(mod * PHASE_RESOLUTION) / PHASE_RESOLUTION).toFixed(2),
      });
    }
  }

  /* Grouped by shared phase. Each group is a candidate scale. */
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.key);
    if (existing) existing.push(candidate);
    else groups.set(candidate.key, [candidate]);
  }

  /*
     The best group is the one that gets closest to the sizes actually asked
     for, not the one with the most members. A group of two hundred pairs
     clustered at display sizes is no use to somebody setting body text.
  */
  let best: { key: string; steps: ScaleStep[]; missed: number[]; cost: number } | null = null;

  /*
     Targets are solved in ascending order and each step must be clearly larger
     than the one before it.

     Without that rule the solver produced 17px for a target of 16 and 17.5px
     for a target of 20, which satisfies both within tolerance and is not a type
     scale. Two steps half a pixel apart are one step and a rounding error.

     The consequence is worth stating rather than hiding: solved sizes for a
     text face on an 8px grid sit about eleven pixels apart, so two targets
     closer together than that cannot both be met. Missing one and saying so
     tells the reader something true about the scale they asked for.
  */
  const ascending = [...targets].sort((a, b) => a - b);

  for (const [key, members] of groups) {
    const steps: ScaleStep[] = [];
    const missed: number[] = [];
    let cost = 0;
    let previous = 0;

    for (const wanted of ascending) {
      let pick: Candidate | null = null;
      let distance = Infinity;

      for (const member of members) {
        if (member.size <= previous + minimumStep) continue;
        const away = Math.abs(member.size - wanted);
        if (away > near) continue;
        /* Nearest size wins; on a tie, the leading closest to a comfortable
           1.45 rather than whichever came first. */
        const score = away + Math.abs(member.ratio - 1.45) * 0.25;
        if (score < distance) {
          distance = score;
          pick = member;
        }
      }

      if (!pick) {
        missed.push(wanted);
        /* A missed target is worse than any near miss, so it is priced above
           the window rather than merely counted. */
        cost += near * 4;
        continue;
      }

      previous = pick.size;
      steps.push({
        size: pick.size,
        leading: pick.leading,
        ratio: pick.ratio,
        rows: pick.rows,
        wanted,
        off: Math.round((pick.size - wanted) * 100) / 100,
      });
      cost += Math.abs(pick.size - wanted);
    }

    if (!best || cost < best.cost) best = { key, steps, missed, cost };
  }

  const chosen = best ?? { key: "0.00", steps: [], missed: [...targets], cost: 0 };
  const members = groups.get(chosen.key) ?? [];

  return {
    font: bare,
    resolved,
    grid,
    phase: Number(chosen.key),
    steps: chosen.steps,
    missed: chosen.missed,
    spacing,
    available: [...new Set(members.map((m) => m.size))].sort((a, b) => a - b),
  };
}

/**
 * A solved scale as CSS custom properties, with the origin it needs.
 *
 * Every leading is a whole number of grid rows and every step shares one phase,
 * so a page built from these and spaced in multiples of the pitch needs no
 * correction at all.
 */
export function scaleToCss(scale: GridScale, names?: string[]): string {
  const labels =
    names ??
    scale.steps.map((_, i) =>
      ["body", "lead", "heading", "display", "step-5", "step-6", "step-7"][i] ?? `step-${i + 1}`
    );

  const lines = [
    `/* Grid-native type scale for ${scale.font}`,
    ...(scale.resolved
      ? []
      : [
          ` *`,
          ` * WARNING: ${scale.font} did not render when this was solved, so these`,
          ` * sizes describe whatever the browser fell back to. Load the font first.`,
        ]),
    ` * ${scale.grid.pitch}px pitch, shared phase ${scale.phase}px.`,
    ` *`,
    ` * Set the grid origin to ${scale.phase}px. Keep every vertical distance a`,
    ` * whole number of ${scale.grid.pitch}px rows and no block needs correcting.`,
    ` *`,
    ` * Solved sizes for this font sit about ${scale.spacing}px apart, which is`,
    ` * why these are not round numbers.`,
    ` */`,
    ":root {",
    `  --pitch: ${scale.grid.pitch}px;`,
    `  --grid-origin: ${scale.phase}px;`,
  ];

  scale.steps.forEach((step, i) => {
    const name = labels[i] ?? `step-${i + 1}`;
    lines.push(
      `  --size-${name}: ${step.size}px;`,
      `  --leading-${name}: ${step.leading}px;  /* ${step.rows} rows, ratio ${step.ratio} */`
    );
  });

  lines.push("}");

  if (scale.missed.length) {
    lines.push(
      "",
      `/* No solved size within tolerance of: ${scale.missed.join(", ")}px.`,
      ` * Widen the tolerance, change the pitch, or accept a nearer size. */`
    );
  }

  return lines.join("\n");
}
