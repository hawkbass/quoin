/* The site

   Two jobs. Drive the specimen in the iframe, and report this page's own score
   in the footer.

   The second one is the point. A site arguing that pages should be measured,
   which does not publish its own measurement, is asking to be measured by
   somebody else. */

(function () {
  "use strict";

  var GRID = { pitch: 8, tolerance: 0.5 };

  /* Display type opts out. A headline at 72px with tight leading is a shape
     rather than a line of reading, and forcing one onto an 8px rhythm makes it
     worse. Stated here rather than hidden, because a score with a quiet
     exclusion list is a score with a thumb on it. */
  var IGNORE = ["h1", ".standfirst", ".live", "pre", "pre *"];

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  /* ---------------------------------------------------------------- *
     The specimen
   * ---------------------------------------------------------------- */

  function driveSpecimen() {
    var frame = document.getElementById("specimen");
    var score = document.getElementById("demoScore");
    var dot = document.querySelector(".demo-readout .dot");
    var gridButton = document.getElementById("demoGrid");
    var seatButton = document.getElementById("demoSeat");
    var foot = document.getElementById("demoFoot");
    if (!frame || !score) return;

    var inner = null;
    var seated = null;
    var overlay = null;

    function say(html, state) {
      score.innerHTML = html;
      if (dot) dot.setAttribute("data-state", state || "off");
    }

    function report() {
      /* The specimen loads the same bundle this page does, so the numbers in
         the readout come from the library rather than from a copy of it. */
      var result = inner.quoin.verifyGrid(GRID);
      var share = result.report.total
        ? Math.round((result.report.onGrid / result.report.total) * 100)
        : 0;
      return { share: share, report: result.report };
    }

    function refresh() {
      var r = report();
      say(
        "<b>" + r.report.onGrid + " of " + r.report.total + "</b> lines on an 8px grid" +
        " &middot; " + r.share + "%" +
        " &middot; " + r.report.distinctDrifts + " distinct drifts",
        r.share > 90 ? "good" : "bad"
      );
      return r;
    }

    frame.addEventListener("load", function () {
      try {
        inner = frame.contentWindow;
        if (!inner.quoin) {
          say("The specimen could not load the library.", "bad");
          return;
        }
        refresh();
      } catch (error) {
        say("The specimen is on another origin and cannot be measured.", "bad");
      }
    });

    gridButton.addEventListener("click", function () {
      if (!inner) return;
      if (overlay) {
        overlay.parentNode.removeChild(overlay);
        overlay = null;
        gridButton.setAttribute("aria-pressed", "false");
        gridButton.textContent = "Show the grid";
        return;
      }
      var doc = inner.document;
      overlay = doc.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:9999;" +
        "background-image:repeating-linear-gradient(to bottom," +
        "rgba(122,74,32,0.30) 0 1px,transparent 1px 8px)";
      doc.documentElement.appendChild(overlay);
      gridButton.setAttribute("aria-pressed", "true");
      gridButton.textContent = "Hide the grid";
    });

    seatButton.addEventListener("click", function () {
      if (!inner) return;

      if (seated) {
        seated.undo();
        seated = null;
        seatButton.setAttribute("aria-pressed", "false");
        seatButton.textContent = "Seat it";
        var back = refresh();
        foot.textContent =
          "Back where it started, at " + back.share + "%. Nothing on the specimen " +
          "is a mistake: a fluid type scale, a spacing scale in round numbers, " +
          "and leading set as a ratio.";
        return;
      }

      var before = report();
      var t0 = performance.now();
      seated = inner.quoin.seatPage({
        pitch: GRID.pitch,
        tolerance: GRID.tolerance,
        ignore: ["h1"],
        mode: "full",
      });
      var elapsed = Math.round(performance.now() - t0);
      var after = refresh();

      seatButton.setAttribute("aria-pressed", "true");
      seatButton.textContent = "Lift it back off";

      var missed = seated.missed
        ? ", and " + seated.missed + " it could not move, which it says rather than counts as fixed"
        : "";
      foot.textContent =
        before.share + "% to " + after.share + "% in " + seated.passes +
        (seated.passes === 1 ? " sweep" : " sweeps") + ", " + elapsed + "ms" + missed +
        ". Press it again to compare.";
    });

    /* The frame may already be loaded by the time this runs. */
    if (frame.contentDocument && frame.contentDocument.readyState === "complete") {
      frame.dispatchEvent(new Event("load"));
    }
  }

  /* ---------------------------------------------------------------- *
     This page's own score
   * ---------------------------------------------------------------- */

  function reportSelf() {
    var out = document.getElementById("liveScore");
    var note = document.getElementById("liveNote");
    if (!out || !window.quoin) return;

    var result = window.quoin.verifyGrid({
      pitch: GRID.pitch,
      tolerance: GRID.tolerance,
      ignore: IGNORE,
    });
    var total = result.report.total;
    var share = total ? Math.round((result.report.onGrid / total) * 100) : 0;

    out.textContent = result.report.onGrid + " of " + total + "  ·  " + share + "%";

    /* Whatever it says, it says. A footer that only appears on a good day is
       decoration. */
    var lines = [
      "Measured in your browser just now, on the fonts your browser resolved, " +
      "at an 8px pitch with display type excluded.",
    ];
    if (result.report.distinctDrifts) {
      lines.push(result.report.distinctDrifts + " distinct drift values.");
    }
    if (result.closedShadowRoots || result.frames) {
      lines.push(
        "Not counted: " +
        [
          result.frames ? result.frames + " frame" + (result.frames === 1 ? "" : "s") : null,
          result.closedShadowRoots ? result.closedShadowRoots + " closed shadow roots" : null,
        ].filter(Boolean).join(", ") + "."
      );
    }
    if (note) note.textContent = lines.join(" ");

    /* Which regime this viewport is in, said plainly. A number without the
       thing that governs it invites the reader to draw the wrong conclusion. */
    var where = document.getElementById("liveWhere");
    if (where) {
      where.textContent = window.innerWidth >= 1040
        ? "Above 1040px the layout has stopped reflowing, so the build-time " +
          "corrections hold at every width."
        : "Below 1040px the layout reflows continuously, so corrections " +
          "computed at one width only approximate another. Widen the window " +
          "and watch this climb.";
    }
  }

  function selfGrid() {
    var button = document.getElementById("footGrid");
    if (button) {
      button.addEventListener("click", function () {
        var on = document.body.classList.toggle("grid-on");
        button.textContent = on ? "Hide the grid" : "Show the grid on this page";
      });
    }

    /* The other axis. Separate toggles rather than one, because they answer
       separate questions and a page is often right about one and wrong about
       the other. */
    var columnButtons = [
      document.getElementById("footColumns"),
      document.getElementById("inlineColumns"),
    ].filter(Boolean);

    columnButtons.forEach(function (columns) {
      columns.addEventListener("click", function () {
        var on = document.body.classList.toggle("columns-on");
        /* Both buttons say the same thing, because they toggle the same thing
           and a control that lies about the state it is in is worse than one
           that is not there. */
        columnButtons.forEach(function (other) {
          other.textContent = on ? "Hide the columns" : "Show the columns";
        });
      });
    });
  }

  ready(function () {
    var version = document.querySelector("[data-version]");
    if (version && window.quoin) version.textContent = window.quoin.version;

    driveSpecimen();
    selfGrid();

    /* Webfonts change every metric on the page, so measuring before they land
       measures a fallback. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        requestAnimationFrame(reportSelf);
      });
    } else {
      window.addEventListener("load", reportSelf);
    }
  });
})();
