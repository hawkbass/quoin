/* The popup.

   It holds no state that matters. Everything the page needs to undo lives on
   the page, because this document is destroyed the instant it loses focus, and
   a corrected page whose only undo handle died with a popup is a page somebody
   has to reload. */

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  pitch: 8,
  tolerance: 0.5,
  origin: 0,
  ignore: "",
  mode: "full",
};

let config = { ...DEFAULTS };
let tabId = null;

/* ------------------------------------------------------------------ *
   Talking to the page
 * ------------------------------------------------------------------ */

/*
   Injected into the MAIN world rather than the default isolated one, for two
   reasons. Font metrics have to be read against the document's own font set,
   and afterwards `quoin` is left on `window` so anyone who wants to script it
   from the console can, without installing anything else.

   A page's Content-Security-Policy does not apply to this. That matters more
   than it sounds: measured across four sites, adding a <script> tag was refused
   by Stripe and GitHub, which is a correct policy and the reason a hosted
   version of this tool cannot exist.
*/
async function ensureInjected() {
  const [already] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => Boolean(globalThis.__quoinExt),
  });
  if (already?.result) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["quoin.content.js"],
  });
}

async function call(method, argument) {
  await ensureInjected();
  const [response] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [method, argument ?? null],
    func: (name, arg) => globalThis.__quoinExt[name](arg),
  });
  return response?.result;
}

/* ------------------------------------------------------------------ *
   Rendering
 * ------------------------------------------------------------------ */

function say(message, level) {
  const banner = $("banner");
  if (!message) {
    banner.hidden = true;
    return;
  }
  banner.textContent = message;
  banner.className = level === "warn" ? "banner warn" : "banner";
  banner.hidden = false;
}

function renderScore(report) {
  /* Filled first, revealed last. Unhiding before the numbers are in leaves a
     blank panel on screen for a frame, which reads as a hang on a page with a
     few thousand text nodes. */
  const share = report.total ? (report.onGrid / report.total) * 100 : 0;

  $("pct").textContent = `${share.toFixed(0)}%`;
  $("fraction").textContent = `${report.onGrid} of ${report.total} blocks`;
  $("drifts").textContent = report.distinctDrifts;

  /*
     Two pages can sit at the same percentage and want completely different
     work, so the sentence reports the shape rather than the score.
  */
  $("verdict").textContent = report.total === 0
    ? "No text found to measure on this page."
    : report.offGrid === 0
      ? "On the grid. Every first baseline this walk can reach sits on a line."
      : report.systematic
        ? "One shared offset. This is an origin, or a single un-snapped line-height, and it is a one-line fix."
        : report.distinctDrifts <= 6
          ? "Orderly. The type scale and the spacing scale broadly agree with each other."
          : "Scattered. The type scale and the spacing scale are having different conversations.";

  /* Regions the walk could not enter get said out loud rather than folded
     into a percentage they are not part of. */
  const unseen = [];
  if (report.closedShadowRoots > 0) {
    unseen.push(`${report.closedShadowRoots} closed shadow ${report.closedShadowRoots === 1 ? "root" : "roots"}`);
  }
  if (report.frames > 0) {
    unseen.push(`${report.frames} ${report.frames === 1 ? "frame" : "frames"}`);
  }
  if (report.skippedTransformed > 0) {
    unseen.push(`${report.skippedTransformed} under a transform`);
  }
  say(unseen.length ? `Not counted: ${unseen.join(", ")}.` : "");

  const body = document.querySelector("#offenders tbody");
  body.replaceChildren();
  for (const row of report.worst) {
    const tr = document.createElement("tr");
    const drift = document.createElement("td");
    drift.textContent = `${row.drift > 0 ? "+" : ""}${row.drift.toFixed(2)}`;
    const where = document.createElement("td");
    where.textContent = row.path + (row.inShadow ? " (shadow)" : "");
    where.title = row.sample;
    tr.append(drift, where);
    body.appendChild(tr);
  }
  $("offendersWrap").hidden = report.worst.length === 0;

  $("grid").classList.toggle("on", report.gridShown);
  $("gridlabel").textContent = report.gridShown ? "Hide the grid" : "Show the grid";
  $("seat").textContent = report.seated ? "Lift it back off" : "Seat the page";
  $("copy").disabled = !report.seated;

  $("score").hidden = false;
}

/* ------------------------------------------------------------------ *
   Actions
 * ------------------------------------------------------------------ */

async function measure() {
  try {
    const report = await call("check", config);
    renderScore(report);
  } catch (error) {
    $("score").hidden = true;
    say(explain(error), "warn");
  }
}

/*
   Chrome refuses injection on its own pages, the Web Store, and PDFs. The
   error it gives back is about extension APIs, which is true and no use to
   somebody who just wants to know why nothing happened.
*/
function explain(error) {
  const message = String(error?.message ?? error);
  if (/cannot be scripted|chrome:\/\/|extension:\/\/|Extension manifest|chrome-error/i.test(message)) {
    return "This page cannot be measured. Browsers keep extensions out of their own pages, the extension store, and PDFs.";
  }
  if (/No tab with id|Frame with ID/i.test(message)) {
    return "That tab has gone. Reopen the popup on a live page.";
  }
  return message.slice(0, 160);
}

async function toggleGrid() {
  try {
    const shown = await call("toggleGrid", {
      pitch: config.pitch,
      origin: config.origin,
      colour: "rgba(122, 74, 32, 0.30)",
    });
    $("grid").classList.toggle("on", shown);
    $("gridlabel").textContent = shown ? "Hide the grid" : "Show the grid";
  } catch (error) {
    say(explain(error), "warn");
  }
}

async function toggleSeat() {
  $("seat").disabled = true;
  try {
    const result = await call("toggleSeat", config);
    if (!result.seated) {
      $("result").hidden = true;
      await measure();
      return;
    }

    const before = ((result.before / result.total) * 100).toFixed(0);
    const after = ((result.after / result.total) * 100).toFixed(0);

    const parts = [
      `<b>${before}%</b> to <span class="up">${after}%</span>`,
      `${result.passes} ${result.passes === 1 ? "sweep" : "sweeps"}`,
      `padding moved ${result.levers.padding}, offset ${result.levers.offset}`,
    ];
    if (result.missed) parts.push(`<b>${result.missed}</b> could not be moved`);
    if (result.inShadow) parts.push(`${result.inShadow} in shadow roots, where no stylesheet reaches`);
    if (result.exhausted) parts.push("<b>not converged</b>: still moving on the last sweep");

    $("result").innerHTML = parts.join(" &middot; ");
    $("result").hidden = false;
    await measure();
  } catch (error) {
    say(explain(error), "warn");
  } finally {
    $("seat").disabled = false;
  }
}

async function copyCss() {
  try {
    const result = await call("css");
    if (result.error) { say(result.error, "warn"); return; }

    await navigator.clipboard.writeText(result.css);

    /* The verified export has to undo the seating to test the stylesheet
       against a page that is not already wearing it, so the page is now back
       where it started. Better to say that than to let it look like a bug. */
    const notes = [`Copied. ${result.css.split("\n").filter((l) => l.endsWith("{")).length} rules.`];
    if (result.escalated) notes.push(`${result.escalated} needed !important to beat the page's own CSS.`);
    if (result.lost) notes.push(`${result.lost} the page still overrules, and the file says which.`);
    notes.push("The page has been lifted back off the grid so the CSS could be checked against it.");

    say(notes.join(" "));
    $("result").hidden = true;
    await measure();
  } catch (error) {
    say(explain(error), "warn");
  }
}

async function sweepOrigin() {
  $("sweep").disabled = true;
  $("sweep").textContent = "sweeping…";
  try {
    const best = await call("findOrigin", config);
    config.origin = best.origin;
    $("origin").textContent = `${best.origin.toFixed(2)}px`;
    save();
    say(
      `Best origin for this page is ${best.origin.toFixed(2)}px, which seats ` +
      `${best.onGrid} of ${best.total}. A page can be perfectly rhythmic and ` +
      `score badly against an origin of zero.`
    );
    await measure();
  } catch (error) {
    say(explain(error), "warn");
  } finally {
    $("sweep").disabled = false;
    $("sweep").textContent = "find the page's own";
  }
}

async function reset() {
  try {
    await call("reset");
    $("result").hidden = true;
    $("grid").classList.remove("on");
    await measure();
  } catch (error) {
    say(explain(error), "warn");
  }
}

/* ------------------------------------------------------------------ *
   Settings
 * ------------------------------------------------------------------ */

function save() {
  chrome.storage.local.set({ config }).catch(() => {});
}

async function load() {
  try {
    const stored = await chrome.storage.local.get("config");
    if (stored?.config) config = { ...DEFAULTS, ...stored.config };
  } catch {
    /* First run, or storage refused. Defaults are fine. */
  }
  $("ignore").value = config.ignore;
  $("origin").textContent = `${config.origin.toFixed(2)}px`;
  for (const button of document.querySelectorAll("[data-pitch]")) {
    button.classList.toggle("on", Number(button.dataset.pitch) === config.pitch);
  }
}

function parseIgnore(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ *
   Wiring
 * ------------------------------------------------------------------ */

/*
   The page this popup is about.

   Normally that is simply the active tab, because a popup is an overlay and
   never a tab itself. It can be one: opening popup.html directly is what you do
   while building the thing, and it is how the test suite drives it. Measuring
   the popup with itself is not useful.

   `tabs.getCurrent()` is the discriminator, and it is the only one available.
   It resolves to this document's own tab when there is one and to undefined in
   a real popup. Reading `tab.url` cannot do the job: under `activeTab` alone
   the url is withheld, so every tab looks like every other tab, which is the
   permission behaving exactly as intended.
*/
async function resolveTab() {
  const own = await chrome.tabs.getCurrent().catch(() => undefined);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!own || active?.id !== own.id) return active ?? null;

  const others = (await chrome.tabs.query({ currentWindow: true }))
    .filter((t) => t.id !== own.id)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return others[0] ?? null;
}

document.addEventListener("DOMContentLoaded", async () => {
  const tab = await resolveTab();
  tabId = tab?.id ?? null;

  try {
    $("host").textContent = tab?.url ? new URL(tab.url).hostname || tab.url : "no page";
  } catch {
    $("host").textContent = "this page";
  }

  await load();
  config.ignore = parseIgnore($("ignore").value);

  const manifest = chrome.runtime.getManifest();
  $("version").textContent = `quoin ${manifest.version}`;

  if (tabId === null) {
    say("No page to measure.", "warn");
    return;
  }
  await measure();
});

for (const button of document.querySelectorAll("[data-pitch]")) {
  button.addEventListener("click", async () => {
    for (const other of document.querySelectorAll("[data-pitch]")) other.classList.remove("on");
    button.classList.add("on");
    config.pitch = Number(button.dataset.pitch);
    /* The old origin was found for a different grid, so it means nothing now. */
    config.origin = 0;
    $("origin").textContent = "0.00px";
    save();
    await measure();
  });
}

$("ignore").addEventListener("change", async () => {
  config.ignore = parseIgnore($("ignore").value);
  chrome.storage.local.set({ config: { ...config, ignore: $("ignore").value } }).catch(() => {});
  await measure();
});

$("grid").addEventListener("click", toggleGrid);
$("seat").addEventListener("click", toggleSeat);
$("copy").addEventListener("click", copyCss);
$("reset").addEventListener("click", reset);
$("sweep").addEventListener("click", sweepOrigin);
