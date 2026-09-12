/* Entry point: wiring, then boot. */
import { acctMenu, bindTemplateBar, closeAcctMenu, closeListMenu, closeOptMenu, enhanceSelect, initAuth, listMenu, optMenu, option, refreshLists } from "./bar.js";
import { DATA_URL, RULES_URL, defaultPhase, fetchJson, loadBis, loadRegistry } from "./data.js";
import { closeOpMenu, closePop, opMenu, pop } from "./editor.js";
import { readUrl } from "./filter.js";
import { escapeHtml } from "./helpers.js";
import { OOTB, loadOotb, openOotb } from "./lists.js";
import { indexBis, toggleSort, update } from "./results.js";
import { applyRules } from "./rules.js";
import { closeSharePop, loadSharedTemplate, sharePop } from "./share.js";
import { el, setAll, state } from "./state.js";
import { BIS_SOURCES, bisSource, setBisSource } from "./store.js";
import { bindTips } from "./tooltips.js";

/* ---------- wiring ---------- */

export function bind() {
  enhanceSelect(el.slot, "Slot");
  enhanceSelect(el.type, "Type");

  if (el.bisSource) {
    BIS_SOURCES.forEach(function (src) {
      el.bisSource.appendChild(option(src.id, src.label));
    });
    el.bisSource.value = state.bisSource;
    enhanceSelect(el.bisSource, "BiS data source");
    el.bisSource.addEventListener("change", function () {
      state.bisSource = el.bisSource.value;
      setBisSource(state.bisSource);
      /* the rings are drawn from bisAt() during the render, so redrawing is all it
         takes - nothing is cached per source beyond the two indexes themselves */
      update();
    });
  }
  el.type.addEventListener("change", function () { state.type = el.type.value; update(); });
  el.slot.addEventListener("change", function () { state.slot = el.slot.value; update(); });

  var t;
  el.search.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () { state.q = el.search.value.trim(); update(); }, 120);
  });

  el.reset.addEventListener("click", function () {
    state.phase = defaultPhase(); state.zone = ""; state.boss = ""; state.bossZone = "";
    state.classes = []; state.specs = []; state.bisOnly = false;
    state.type = ""; state.slot = ""; state.q = "";
    state.sort = ""; state.dir = "asc";
    el.search.value = "";
    update();
  });

  /* delegated: the headers are rebuilt on every render */
  el.results.addEventListener("click", function (e) {
    var th = e.target.closest ? e.target.closest("th[data-sort]") : null;
    if (th) toggleSort(th.dataset.sort);
  });

  el.results.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var th = e.target.closest ? e.target.closest("th[data-sort]") : null;
    if (th) { e.preventDefault(); toggleSort(th.dataset.sort); }
  });

  document.addEventListener("click", function (e) {
    if (pop && pop.style.display !== "none" && !pop.contains(e.target)) closePop();
    /* the operator button itself opens the menu, so a click on it must not also
       count as a click away from it */
    if (opMenu && opMenu.style.display !== "none" &&
        !opMenu.contains(e.target) &&
        !(e.target.closest && e.target.closest(".prio-op--editing"))) closeOpMenu();
    if (acctMenu && acctMenu.style.display !== "none" && !acctMenu.contains(e.target)) {
      closeAcctMenu();
    }

  });

  /* mousedown, not click, and the difference is load-bearing. A menu item that swaps
     the panel - Rename, Delete - has already replaced the menu's contents by the time
     the click event reaches the document, so the node that was clicked is no longer a
     child of the menu and contains() says false. The menu would close itself every
     time you opened one of its own panels. mousedown fires while the node is still
     attached. */
  document.addEventListener("mousedown", function (e) {
    if (listMenu && listMenu.style.display !== "none" && !listMenu.contains(e.target)) {
      closeListMenu();
    }
    if (optMenu && optMenu.style.display !== "none" && !optMenu.contains(e.target)) {
      closeOptMenu();
    }
    if (sharePop && sharePop.style.display !== "none" && !sharePop.contains(e.target)) {
      closeSharePop();
    }
  });

  window.addEventListener("hashchange", function () {
    readUrl();
    el.search.value = state.q;
    update();
  });
}

/* ---------- boot ---------- */

el.results.innerHTML = '<p class="loading">Loading loot data&hellip;</p>';

/* BiS is decoration on top of the loot table, so it must never take the page
   down with it: a missing or malformed bis.json costs the rings, nothing else. */
Promise.all([
  fetchJson(DATA_URL),
  fetchJson(RULES_URL),
  loadRegistry(),
  loadBis(),
  loadOotb()
])
  .then(function (results) {
    applyRules(results[1]);
    indexBis(results[3]);
    var data = results[0];
    setAll(data);
    state.bisSource = bisSource();
    readUrl();
    /* A list= in the url opens that bundled list, so a link to "here is what I am
       looking at" carries the calls as well as the filters. Read before update(), which
       rewrites the hash from state and would drop it. An unknown id is ignored rather
       than fatal - a link outliving a renamed list should cost the list, not the page. */
    var wantList = new URLSearchParams(location.hash.replace(/^#/, "")).get("list");
    if (wantList) {
      var entry = OOTB.filter(function (e) { return e.id === wantList; })[0];
      if (entry) openOotb(entry);
    }
    el.search.value = state.q;
    bind();
    bindTips();
    bindTemplateBar();
    /* After bind, so the bar's controls exist before a session can render into them;
       before refreshLists, so a restored session picks the right store first. */
    initAuth();
    refreshLists();
    loadSharedTemplate();
    update();
  })
  .catch(function (err) {
    el.results.innerHTML =
      '<p class="empty error">Could not load the site data (' + escapeHtml(err.message) +
      "). If you opened this file directly from disk, run a local server instead: " +
      "<code>python -m http.server</code></p>";
  });
