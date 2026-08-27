/* Appended to the Quoin bundle to make one injectable content script.

   Everything the popup needs lives on the page rather than in the popup,
   because a popup is destroyed the moment it loses focus. If the seating
   handle lived there, clicking away would strand the page in a corrected
   state with nothing left that knew how to undo it. */

(function () {
  if (globalThis.__quoinExt) return;

  var state = {
    seated: null,
    overlay: null,
    lastCss: "",
  };

  function options(config) {
    var opts = { pitch: config.pitch, tolerance: config.tolerance };
    if (config.ignore && config.ignore.length) opts.ignore = config.ignore;
    return opts;
  }

  globalThis.__quoinExt = {
    version: globalThis.quoin.version,

    /* Measure without changing anything. */
    check: function (config) {
      var result = globalThis.quoin.verifyGrid(options(config));
      var worst = globalThis.quoin.offGrid(result.results, 8).map(function (r) {
        return {
          drift: Math.round(r.drift * 100) / 100,
          path: r.path,
          sample: r.sample,
          inShadow: r.inShadow,
        };
      });
      return {
        total: result.report.total,
        onGrid: result.report.onGrid,
        offGrid: result.report.offGrid,
        worstDrift: result.report.worst,
        distinctDrifts: result.report.distinctDrifts,
        systematic: result.report.systematic,
        skippedTransformed: result.skippedTransformed,
        closedShadowRoots: result.closedShadowRoots,
        frames: result.frames,
        seated: Boolean(state.seated),
        gridShown: Boolean(state.overlay),
        worst: worst,
      };
    },

    /* Sweep the origin to find where this page's baselines actually sit.

       A page can be perfectly rhythmic and score nought against an origin of
       zero, which is a true reading and a useless one. This reports the offset
       that suits the page best, so the number describes the typography rather
       than an arbitrary starting line. */
    findOrigin: function (config) {
      var best = { origin: 0, onGrid: -1 };
      for (var origin = 0; origin < config.pitch; origin += 0.25) {
        var report = globalThis.quoin.verifyGrid({
          pitch: config.pitch,
          tolerance: config.tolerance,
          origin: origin,
          ignore: config.ignore && config.ignore.length ? config.ignore : undefined,
        }).report;
        if (report.onGrid > best.onGrid) {
          best = { origin: origin, onGrid: report.onGrid, total: report.total };
        }
      }
      return best;
    },

    /* The grid itself, drawn over the page. */
    toggleGrid: function (config) {
      if (state.overlay) {
        state.overlay.remove();
        state.overlay = null;
        return false;
      }
      var el = document.createElement("div");
      el.setAttribute("data-quoin-overlay", "");
      el.style.cssText = [
        "position:fixed", "inset:0", "pointer-events:none",
        "z-index:2147483646",
        "background-image:repeating-linear-gradient(to bottom," +
          config.colour + " 0 1px,transparent 1px " + config.pitch + "px)",
        "background-position:0 " + (config.origin || 0) + "px",
      ].join(";");
      document.documentElement.appendChild(el);
      state.overlay = el;
      return true;
    },

    /* Seat the page, or lift it back off. */
    toggleSeat: function (config) {
      if (state.seated) {
        state.seated.undo();
        state.seated = null;
        state.lastCss = "";
        return { seated: false };
      }

      var before = globalThis.quoin.verifyGrid(options(config)).report;
      state.seated = globalThis.quoin.seatPage({
        pitch: config.pitch,
        tolerance: config.tolerance,
        ignore: config.ignore && config.ignore.length ? config.ignore : undefined,
        mode: config.mode,
      });
      var after = globalThis.quoin.verifyGrid(options(config)).report;

      var levers = { padding: 0, offset: 0, none: 0 };
      state.seated.blocks.forEach(function (b) { levers[b.lever]++; });

      return {
        seated: true,
        before: before.onGrid,
        after: after.onGrid,
        total: after.total,
        passes: state.seated.passes,
        missed: state.seated.missed,
        unexportable: state.seated.unexportable,
        inShadow: state.seated.inShadow,
        exhausted: state.seated.exhausted,
        levers: levers,
      };
    },

    /*
       The stylesheet, checked against the page before it is handed over.

       exportCssVerified undoes the seating to test the sheet honestly, so the
       page ends up lifted back off the grid. That is the correct behaviour and
       a surprising one from a button labelled "copy", so the caller is told.
    */
    css: function () {
      if (!state.seated) return { css: "", error: "Nothing is seated yet." };
      var verified = globalThis.quoin.exportCssVerified(state.seated);
      state.lastCss = verified.css;
      state.seated = null;
      return {
        css: verified.css,
        escalated: verified.escalated,
        lost: verified.check.lost.length,
        unseated: true,
      };
    },

    /* Put everything back. */
    reset: function () {
      if (state.seated) { state.seated.undo(); state.seated = null; }
      if (state.overlay) { state.overlay.remove(); state.overlay = null; }
      state.lastCss = "";
      return true;
    },
  };
})();
