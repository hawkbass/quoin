/* A committed record of where a page stands, so it can be stopped getting worse.

   `--min 90` is the obvious CI gate and it is the wrong primitive. Almost no
   real page is at 90, so the number a team can actually set is the number they
   are already at, and then the gate does nothing until somebody edits it. Every
   tool that gets adopted for this kind of work uses the other shape: record
   today's figure, fail on a regression, and let improvements land freely.

   So this is a small file you commit. It holds one entry per URL and breakpoint
   with the counts, and the comparison speaks in blocks rather than percentages,
   because a percentage moves when the denominator does and "three blocks came
   off the grid" is a sentence somebody can act on. */

export interface BaselineEntry {
  url: string;
  /** Viewport width the reading was taken at. */
  width: number;
  pitch: number;
  onGrid: number;
  total: number;
  distinctDrifts: number;
  /** Boxes that are a whole number of rows tall, and how many were measured. */
  onRhythm?: number;
  rhythmTotal?: number;
}

export interface Baseline {
  /** Schema version, so an old file can be recognised rather than misread. */
  version: 1;
  /** The quoin that wrote it. A number taken by a different version is a
      different number, and the file should say which. */
  quoin: string;
  recorded: string;
  entries: BaselineEntry[];
}

export type Verdict = "improved" | "unchanged" | "regressed" | "new" | "removed";

export interface Comparison {
  url: string;
  width: number;
  verdict: Verdict;
  /** Blocks gained or lost since the baseline. Negative is a regression. */
  delta: number;
  /** Rhythm boxes gained or lost, when both readings have it. */
  rhythmDelta: number | null;
  before: BaselineEntry | null;
  after: BaselineEntry | null;
  /**
   * A sentence naming what changed, in the terms a pull request comment wants.
   */
  summary: string;
  /**
   * True when phase held and only rhythm went backwards.
   *
   * Worth distinguishing, because the fix is a different one. Phase is seated
   * with a correction; rhythm is a box that is not a whole number of rows, and
   * no correction survives the next reflow until it is.
   */
  rhythmOnly?: boolean;
}

export interface CompareResult {
  comparisons: Comparison[];
  regressed: Comparison[];
  improved: Comparison[];
  /** True when nothing got worse. */
  clean: boolean;
}

function key(entry: { url: string; width: number }): string {
  return `${entry.url}@${entry.width}`;
}

export function makeBaseline(entries: BaselineEntry[], quoin: string, when: string): Baseline {
  return {
    version: 1,
    quoin,
    recorded: when,
    /* Sorted, so the committed file has a stable diff and a run that measures
       the same pages in a different order does not look like a change. */
    entries: [...entries].sort((a, b) => key(a).localeCompare(key(b))),
  };
}

/**
 * Compare a fresh set of readings against a committed baseline.
 *
 * Tolerance is in blocks rather than percent, and defaults to one. Sub-pixel
 * layout moves a single block on and off the grid between runs for reasons that
 * have nothing to do with the change under review, and a gate that fires on
 * that is a gate people turn off in a week.
 */
export function compareToBaseline(
  baseline: Baseline,
  fresh: BaselineEntry[],
  allowed = 1
): CompareResult {
  const before = new Map(baseline.entries.map((e) => [key(e), e]));
  const after = new Map(fresh.map((e) => [key(e), e]));
  const comparisons: Comparison[] = [];

  for (const [id, now] of after) {
    const then = before.get(id);
    if (!then) {
      comparisons.push({
        url: now.url,
        width: now.width,
        verdict: "new",
        delta: 0,
        rhythmDelta: null,
        before: null,
        after: now,
        summary:
          `New: ${now.onGrid}/${now.total} on grid at ${now.width}px. ` +
          `Recorded, not judged.`,
      });
      continue;
    }

    const delta = now.onGrid - then.onGrid;
    const rhythmDelta =
      typeof now.onRhythm === "number" && typeof then.onRhythm === "number"
        ? now.onRhythm - then.onRhythm
        : null;

    /*
       The total can move on its own, because copy changes and a page gains a
       paragraph. Comparing counts alone would then call an unchanged page
       improved, so a change in the denominator is reported rather than folded
       into the verdict.
    */
    const grew = now.total - then.total;
    const context = grew === 0 ? "" : ` (${grew > 0 ? "+" : ""}${grew} blocks on the page)`;

    /*
       Phase and rhythm are two different defects, and either one going
       backwards is a regression.

       The case that makes this necessary is a hairline border, which is also
       the most common one. It moves every block below it by a single pixel, so
       the page splits into two phases one pixel apart. On an 8px grid with half
       a pixel of tolerance, an origin sitting between those two halves is
       within tolerance of both, and the phase count does not move at all. Only
       rhythm sees it. Gating on phase alone would wave through the exact defect
       this tool was written to find.
    */
    let verdict: Verdict;
    const worst = rhythmDelta === null ? delta : Math.min(delta, rhythmDelta);
    if (worst < -allowed) verdict = "regressed";
    else if (delta > allowed || (rhythmDelta ?? 0) > allowed) verdict = "improved";
    else verdict = "unchanged";

    const direction =
      delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta} on grid`;

    comparisons.push({
      url: now.url,
      width: now.width,
      verdict,
      delta,
      rhythmDelta,
      before: then,
      after: now,
      summary:
        `${now.onGrid}/${now.total} at ${now.width}px, ${direction}${context}` +
        (rhythmDelta !== null && rhythmDelta !== 0
          ? `, rhythm ${rhythmDelta > 0 ? "+" : ""}${rhythmDelta}`
          : ""),
      rhythmOnly: delta >= -allowed && rhythmDelta !== null && rhythmDelta < -allowed,
    });
  }

  /* A page that has gone is worth saying, because a URL quietly dropping out
     of the run looks exactly like a page that stopped failing. */
  for (const [id, then] of before) {
    if (after.has(id)) continue;
    comparisons.push({
      url: then.url,
      width: then.width,
      verdict: "removed",
      delta: 0,
      rhythmDelta: null,
      before: then,
      after: null,
      summary: `Not measured this run. It was ${then.onGrid}/${then.total} at ${then.width}px.`,
    });
  }

  /* Worst first, where worst is whichever of the two moved further down. */
  const cost = (c: Comparison) =>
    c.rhythmDelta === null ? c.delta : Math.min(c.delta, c.rhythmDelta);
  comparisons.sort((a, b) => cost(a) - cost(b) || a.url.localeCompare(b.url));

  const regressed = comparisons.filter((c) => c.verdict === "regressed");
  const improved = comparisons.filter((c) => c.verdict === "improved");

  return { comparisons, regressed, improved, clean: regressed.length === 0 };
}

/** The comparison as a Markdown comment, for a pull request. */
export function comparisonToMarkdown(result: CompareResult, baseline: Baseline): string {
  const { comparisons, regressed, improved } = result;

  const heading = regressed.length
    ? `**${regressed.length} ${regressed.length === 1 ? "page" : "pages"} came off the baseline grid.**`
    : improved.length
      ? `**${improved.length} ${improved.length === 1 ? "page" : "pages"} improved.** Nothing regressed.`
      : `No change against the baseline.`;

  const rows = comparisons.map((c) => {
    const mark =
      c.verdict === "regressed" ? "🔻" :
      c.verdict === "improved" ? "🔺" :
      c.verdict === "new" ? "•" :
      c.verdict === "removed" ? "○" : " ";
    const share = c.after ? Math.round((c.after.onGrid / c.after.total) * 1000) / 10 : null;
    /* A page that was not measured says so in words. A dash in the cell reads
       as a zero to anybody skimming, and zero is the one thing it does not
       mean. */
    return `| ${mark} | \`${c.url}\` | ${c.width}px | ${
      c.after ? `${c.after.onGrid}/${c.after.total}` : "not measured"
    } | ${share === null ? "" : share + "%"} | ${
      c.delta === 0 ? "" : (c.delta > 0 ? "+" : "") + c.delta
    } |`;
  });

  return [
    "### Quoin",
    "",
    heading,
    "",
    "| | Page | Width | On grid | | Δ |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    `<sub>Against a baseline recorded ${baseline.recorded} with quoin ${baseline.quoin}. ` +
      `The delta is blocks, not percent: a percentage moves when the page gains a paragraph.</sub>`,
  ].join("\n");
}
