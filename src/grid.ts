/* The grid itself. Pure arithmetic: no DOM, no canvas, no font. */

export interface GridConfig {
  /** Distance between baselines, in px. Usually the spacing unit. */
  pitch: number;
  /** How far off a baseline may sit and still count as on-grid, in px. */
  tolerance: number;
  /** Where the grid starts, in px from the top of the document. */
  origin: number;
}

export const DEFAULT_GRID: GridConfig = {
  pitch: 8,
  tolerance: 0.5,
  origin: 0,
};

/* A pitch of zero divides by zero and reports every baseline as perfect, which
   is the worst possible failure for a measuring tool: silent and flattering.
   So the config is validated once, at the edge, rather than trusted. */
export function gridConfig(options: Partial<GridConfig> = {}): GridConfig {
  const pitch = options.pitch ?? DEFAULT_GRID.pitch;
  const tolerance = options.tolerance ?? DEFAULT_GRID.tolerance;
  const origin = options.origin ?? DEFAULT_GRID.origin;

  if (!Number.isFinite(pitch) || pitch <= 0) {
    throw new RangeError(`quoin: pitch must be a positive number, got ${pitch}`);
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError(
      `quoin: tolerance must be zero or a positive number, got ${tolerance}`
    );
  }
  if (!Number.isFinite(origin)) {
    throw new RangeError(`quoin: origin must be a finite number, got ${origin}`);
  }
  /* Half the pitch is the point at which every baseline is within tolerance of
     something, so the report reads 100% and means nothing. */
  if (tolerance >= pitch / 2) {
    throw new RangeError(
      `quoin: tolerance ${tolerance} is at least half the pitch ${pitch}, ` +
        `which would put every possible baseline on grid`
    );
  }

  return { pitch, tolerance, origin };
}

export interface GridResult {
  /** Absolute baseline position in the document, in px. */
  baseline: number;
  /** Nearest grid line to that baseline. */
  nearest: number;
  /** Signed distance to it. Positive means the text sits below the line. */
  drift: number;
  /** True when |drift| is within tolerance. */
  onGrid: boolean;
}

/* Compare a measured baseline against the grid. */
export function checkBaseline(
  baseline: number,
  grid: GridConfig = DEFAULT_GRID
): GridResult {
  const fromOrigin = baseline - grid.origin;
  const nearestIndex = Math.round(fromOrigin / grid.pitch);
  const nearest = grid.origin + nearestIndex * grid.pitch;
  const drift = baseline - nearest;

  return {
    baseline,
    nearest,
    drift,
    onGrid: Math.abs(drift) <= grid.tolerance,
  };
}

/* The line-height that puts consecutive baselines exactly one pitch apart.
   Rounds up, never down: shrinking leading to reach the grid tightens the
   setting, which is a typographic decision the caller did not ask for. */
export function snapLineHeight(
  preferred: number,
  grid: GridConfig = DEFAULT_GRID
): number {
  if (!Number.isFinite(preferred) || preferred <= 0) return grid.pitch;
  const steps = Math.ceil(preferred / grid.pitch);
  return Math.max(1, steps) * grid.pitch;
}

/* How far down to push a baseline to seat it, given its current drift.

   Always downward. Pulling text up to the previous grid line can collide it
   with whatever sits above, and a corrector that overlaps two paragraphs to
   satisfy its own metric has optimised for the metric. */
export function seatingShift(drift: number, grid: GridConfig = DEFAULT_GRID): number {
  if (Math.abs(drift) <= grid.tolerance) return 0;
  return drift <= 0 ? -drift : grid.pitch - drift;
}

/* Padding that seats the first baseline of a block on the grid.

   `top` and `bottom` always sum to exactly one pitch, so the box grows by a
   whole number of grid rows and everything below it stays seated. That is the
   property that makes the pair usable in a stylesheet a human maintains. */
export function seatingPadding(
  baselineWithinBox: number,
  blockTop: number,
  grid: GridConfig = DEFAULT_GRID
): { top: number; bottom: number } {
  const { drift } = checkBaseline(blockTop + baselineWithinBox, grid);
  const top = seatingShift(drift, grid);
  /* Already seated: adding a full row of bottom padding would move everything
     below it for no reason. */
  if (top === 0) return { top: 0, bottom: 0 };
  return { top, bottom: grid.pitch - top };
}

/** Summary of a whole page, which is what a gate reports on. */
export interface GridReport {
  total: number;
  onGrid: number;
  offGrid: number;
  /** Worst absolute drift found, in px. */
  worst: number;
  /** Whether every off-grid node drifted by the same amount. */
  systematic: boolean;
  /**
   * How many different drift values the off-grid nodes take.
   *
   * Read this before the percentage. A page 40% on grid with three distinct
   * drifts has a type scale and a spacing scale that agree with each other and
   * one wrong origin. The same percentage with thirty distinct drifts is a
   * different problem with a different fix.
   */
  distinctDrifts: number;
}

export function summarise(
  results: readonly GridResult[],
  /* Drift values are compared after rounding, because floating point makes
     3.0000000000000004 and 3 two different problems when they are one. */
  precision = 2
): GridReport {
  const off = results.filter((r) => !r.onGrid);
  const factor = 10 ** precision;
  const unique = new Set(off.map((r) => Math.round(r.drift * factor) / factor));

  return {
    total: results.length,
    onGrid: results.length - off.length,
    offGrid: off.length,
    worst: off.reduce((max, r) => Math.max(max, Math.abs(r.drift)), 0),
    systematic: off.length > 1 && unique.size === 1,
    distinctDrifts: unique.size,
  };
}
