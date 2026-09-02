/* The site

   Three jobs. Drive the working specimen on the sheet. Keep the docket honest
   — the baseline overlay, the register, and this page's own score, measured
   by the library rather than a copy of it. And reveal Plate V as it arrives.
*/

(function () {
  "use strict";

  var PITCH = 8;
  var ctx = null;

  function measure(font) {
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    ctx.font = font;
    return ctx.measureText("Hxy");
  }

  /* First baseline of a block, in page coordinates: half-leading plus ascent
     from the line box top. The same construction the library makes. */
  function baselineOf(n) {
    var cs = getComputedStyle(n);
    var lh = parseFloat(cs.lineHeight);
    if (!lh) return null;
    var m = measure(cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily);
    var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    if (asc == null) return null;
    var r = n.getBoundingClientRect();
    var pad = parseFloat(cs.paddingTop) || 0;
    var bt = parseFloat(cs.borderTopWidth) || 0;
    return r.top + bt + pad + (lh - (asc + desc)) / 2 + asc;
  }

  function pageEl() { return document.querySelector(".page"); }
  function sheetEl() { return document.querySelector("[data-sheet]"); }
  function seatBlocks() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-seat]"));
  }

  /* ---------------------------------------------------------------- *
     The specimen. Correcting a block moves every block below it, so the
     deltas accumulate down the sheet.
   * ---------------------------------------------------------------- */

  var seated = false;

  function readSpecimen() {
    var sheet = sheetEl();
    var blocks = seatBlocks();
    if (!sheet || !blocks.length) return;
    var big = document.querySelector("[data-bigscore]");
    var note = document.querySelector("[data-specnote]");
    var origin = sheet.getBoundingClientRect().top;
    var hit = 0;
    blocks.forEach(function (b) {
      var base = baselineOf(b);
      if (base == null) return;
      var d = ((base - origin) % PITCH + PITCH) % PITCH;
      if (Math.min(d, PITCH - d) <= 0.5) hit++;
    });
    var pct = Math.round((hit / blocks.length) * 100);
    if (big) big.textContent = pct + "%";
    if (note && !seated) note.textContent = hit + " of " + blocks.length + " first baselines on the grid";
  }

  function seatSpecimen() {
    var sheet = sheetEl();
    var blocks = seatBlocks();
    var note = document.querySelector("[data-specnote]");
    var big = document.querySelector("[data-bigscore]");
    if (!sheet || !blocks.length) return;
    var origin = sheet.getBoundingClientRect().top;
    var cum = 0, moved = 0;
    blocks.forEach(function (b) {
      var base = baselineOf(b);
      if (base == null) return;
      var rel = base - origin + cum;
      var delta = (PITCH - (((rel % PITCH) + PITCH) % PITCH)) % PITCH;
      b.style.transition = "padding-top 420ms cubic-bezier(.2,.7,.2,1)";
      b.style.paddingTop = delta.toFixed(2) + "px";
      if (delta > 0.01) moved++;
      cum += delta;
    });
    seated = true;
    if (note) note.textContent = "seated — " + moved + " of " + blocks.length +
      " blocks moved, " + cum.toFixed(2) + "px of correction";
    if (big) big.style.color = "var(--y)";
    setTimeout(function () { readSpecimen(); reportSelf(); }, 480);
  }

  function resetSpecimen() {
    var blocks = seatBlocks();
    var note = document.querySelector("[data-specnote]");
    if (!blocks.length) return;
    blocks.forEach(function (b) {
      b.style.transition = "padding-top 420ms cubic-bezier(.2,.7,.2,1)";
      b.style.paddingTop = "0px";
    });
    seated = false;
    setTimeout(function () { readSpecimen(); reportSelf(); }, 480);
    if (note) note.textContent = "reset — back to a leading of 1.47";
  }

  function toggleSpecGrid() {
    var g = document.querySelector("[data-specgrid]");
    if (g) g.classList.toggle("on");
  }

  /* ---------------------------------------------------------------- *
     The docket
   * ---------------------------------------------------------------- */

  var misreg = true; // out of register by default. It is a decision, not an accident.

  function setMisreg(on) {
    misreg = on;
    document.body.classList.toggle("reg-in", !misreg);
    var btn = document.getElementById("regToggle");
    if (btn) btn.textContent = misreg ? "in register" : "out of register";
  }

  function driveDocket() {
    var gridBtn = document.getElementById("gridToggle");
    if (gridBtn) {
      gridBtn.addEventListener("click", function () {
        var on = document.body.classList.toggle("grid-on");
        gridBtn.setAttribute("aria-pressed", String(on));
      });
    }

    var regBtn = document.getElementById("regToggle");
    if (regBtn) regBtn.addEventListener("click", function () { setMisreg(!misreg); });

    /* The cursor rule snaps to the pitch, because a rule that lands between
       rows is not showing the grid, it is showing its own opinion of it. */
    var page = pageEl();
    var rule = document.querySelector(".cursor-rule");
    if (page && rule) {
      document.addEventListener("pointermove", function (e) {
        var r = page.getBoundingClientRect();
        var y = Math.round((e.clientY - r.top) / PITCH) * PITCH;
        rule.style.transform = "translateY(" + y + "px)";
        document.body.classList.add("rule-live");
      });
      document.documentElement.addEventListener("mouseleave", function () {
        document.body.classList.remove("rule-live");
      });
    }
  }

  /* ---------------------------------------------------------------- *
     Plate V, revealed
   * ---------------------------------------------------------------- */

  function driveReveal() {
    var targets = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
    if (!targets.length) return;
    var show = function (n) { n.classList.add("is-in"); };
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { show(en.target); io.unobserve(en.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
      targets.forEach(function (n) { io.observe(n); });
    } else {
      targets.forEach(show);
    }
    /* A score that never arrives reads as broken, so nothing waits on the
       observer alone. */
    setTimeout(function () { targets.forEach(show); }, 2600);
  }

  /* ---------------------------------------------------------------- *
     This page's own score. The library measures it, not a copy of the
     library: a site arguing that pages should be measured publishes its own
     measurement or is asking to be measured by somebody else.
   * ---------------------------------------------------------------- */

  /* Display type opts out. A headline at 136px with tight leading is a shape
     rather than a line of reading, and forcing one onto an 8px rhythm makes it
     worse. Stated here rather than hidden, because a score with a quiet
     exclusion list is a score with a thumb on it. */
  var IGNORE = [".mast__title", ".bigscore", "pre", "pre *", "[data-score]"];

  function reportSelf() {
    if (!window.quoin) return;
    var result = window.quoin.verifyGrid({
      pitch: PITCH,
      tolerance: 0.5,
      ignore: IGNORE,
    });
    var total = result.report.total;
    var pct = total ? Math.round((result.report.onGrid / total) * 100) : 0;
    var text = pct + "% on the 8px grid · " + result.report.onGrid + " of " + total + " blocks";
    Array.prototype.forEach.call(document.querySelectorAll("[data-score]"), function (out) {
      out.textContent = text;
    });
  }

  /* ---------------------------------------------------------------- */

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var version = document.querySelector("[data-version]");
    if (version && window.quoin) version.textContent = window.quoin.version;

    driveDocket();
    driveReveal();

    /* Webfonts change every metric on the page, so measuring before they land
       measures a fallback. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { reportSelf(); readSpecimen(); });
    } else {
      window.addEventListener("load", function () { reportSelf(); readSpecimen(); });
    }
    setTimeout(function () { reportSelf(); readSpecimen(); }, 1200);

    var seat = document.getElementById("seatIt");
    if (seat) seat.addEventListener("click", seatSpecimen);
    var reset = document.getElementById("resetIt");
    if (reset) reset.addEventListener("click", resetSpecimen);
    var grid = document.getElementById("specGridBtn");
    if (grid) grid.addEventListener("click", toggleSpecGrid);
  });
})();
