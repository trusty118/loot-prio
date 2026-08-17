/* TBC Tier 6 loot priority browser — vanilla JS, no build step. */

(function () {
  "use strict";

  var DATA_URL = "data/loot_data.json";

  /* Encounter order per zone (the JSON is not in kill order). */
  var BOSS_ORDER = {
    "Black Temple": [
      "Trash",
      "High Warlord Naj'entus",
      "Supremus",
      "Shade of Akama",
      "Teron Gorefiend",
      "Gurtogg Bloodboil",
      "Reliquary of Souls",
      "Mother Shahraz",
      "Illidari Council",
      "Illidan Stormrage"
    ],
    "Mount Hyjal": [
      "Trash",
      "Rage Winterchill",
      "Anetheron",
      "Kaz'rogal",
      "Azgalor",
      "Archimonde"
    ]
  };

  var ZONE_ORDER = ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"];
  var ZONE_LABEL = { "Crafted (Heart of Darkness)": "Crafted" };
  var ROLE_ORDER = ["Physical", "Caster", "Healer", "Tank", "Tier"];

  /* Encounter Journal boss portraits (128x64 PNG). TBC bosses have no achievement
     icons - those postdate them - but Legion backfilled the Adventure Guide, so
     these exist. The slugs are irregular: apostrophes vanish without a hyphen
     (najentus, kazrogal) and the Illidari Council has no leading "the". Verified
     forms, do not tidy. */
  var JOURNAL = "https://wow.zamimg.com/images/wow/journal/ui-ej-boss-";
  var ICON = "https://wow.zamimg.com/images/wow/icons/large/";

  var BOSS_ICON = {
    "High Warlord Naj'entus": JOURNAL + "high-warlord-najentus.png",
    "Supremus": JOURNAL + "supremus.png",
    "Shade of Akama": JOURNAL + "shade-of-akama.png",
    "Teron Gorefiend": JOURNAL + "teron-gorefiend.png",
    "Gurtogg Bloodboil": JOURNAL + "gurtogg-bloodboil.png",
    "Reliquary of Souls": JOURNAL + "reliquary-of-souls.png",
    "Mother Shahraz": JOURNAL + "mother-shahraz.png",
    "Illidari Council": JOURNAL + "illidari-council.png",
    "Illidan Stormrage": JOURNAL + "illidan-stormrage.png",
    "Rage Winterchill": JOURNAL + "rage-winterchill.png",
    "Anetheron": JOURNAL + "anetheron.png",
    "Kaz'rogal": JOURNAL + "kazrogal.png",
    "Azgalor": JOURNAL + "azgalor.png",
    "Archimonde": JOURNAL + "archimonde.png",
    "Trash": ICON + "inv_misc_bag_08.jpg",
    "—": ICON + "spell_shadow_demonictactics.jpg"
  };

  /* Hyjal has no Encounter Journal instance image (only Black Temple does), so
     both zones borrow their final boss's portrait and stay consistent. */
  var ZONE_ICON = {
    "Black Temple": JOURNAL + "illidan-stormrage.png",
    "Mount Hyjal": JOURNAL + "archimonde.png",
    "Crafted (Heart of Darkness)": ICON + "spell_shadow_demonictactics.jpg"
  };

  var SLOT_ORDER = [
    "Head", "Neck", "Shoulder", "Back", "Chest", "Wrist", "Hands", "Waist",
    "Legs", "Feet", "Finger", "Trinket", "One-Hand", "Main-Hand", "Off-Hand",
    "Two-Hand", "Ranged", "Relic"
  ];

  /* The raw `type` field has 30+ values; collapse them into usable buckets. */
  var TYPE_GROUPS = [
    "Cloth", "Leather", "Mail", "Plate",
    "Weapon", "Shield / Off-hand", "Cloak", "Jewellery", "Relic", "Tier Token"
  ];

  function typeGroup(type) {
    if (!type) return "Other";
    if (/^Tier Token/i.test(type)) return "Tier Token";
    if (type === "Cloth" || type === "Leather" || type === "Mail" || type === "Plate") return type;
    if (type === "Cloak") return "Cloak";
    if (type === "Shield" || /^Off-hand$/i.test(type)) return "Shield / Off-hand";
    if (type === "Ring" || type === "Neck" || type === "Trinket") return "Jewellery";
    if (type === "Idol" || type === "Totem" || type === "Libram") return "Relic";
    return "Weapon";
  }

  var state = {
    zone: "",        // "" = all
    boss: "",        // "" = all
    roles: [],       // multi-select; [] = all
    type: "",
    slot: "",
    q: ""
  };

  var ALL = [];

  var el = {
    zoneChips: document.getElementById("zone-chips"),
    bossChips: document.getElementById("boss-chips"),
    roleChips: document.getElementById("role-chips"),
    type: document.getElementById("type-select"),
    slot: document.getElementById("slot-select"),
    search: document.getElementById("search"),
    reset: document.getElementById("reset"),
    count: document.getElementById("count"),
    results: document.getElementById("results")
  };

  /* ---------- helpers ---------- */

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* Escape first, then wrap search hits in <mark>. */
  function highlight(text, needle) {
    var safe = escapeHtml(text);
    if (!needle) return safe;
    return safe.replace(new RegExp("(" + escapeRegExp(escapeHtml(needle)) + ")", "gi"), "<mark>$1</mark>");
  }

  function zoneLabel(zone) {
    return ZONE_LABEL[zone] || zone;
  }

  function bossLabel(boss) {
    return boss === "—" ? "Craftable" : boss;
  }

  function orderedBosses(zone) {
    var known = BOSS_ORDER[zone] || [];
    var seen = {};
    var out = [];
    known.forEach(function (b) { seen[b] = true; out.push(b); });
    ALL.forEach(function (r) {
      if (r.zone === zone && !seen[r.boss]) { seen[r.boss] = true; out.push(r.boss); }
    });
    return out;
  }

  function bossSortKey(rec) {
    var zi = ZONE_ORDER.indexOf(rec.zone);
    var order = orderedBosses(rec.zone);
    var bi = order.indexOf(rec.boss);
    return (zi < 0 ? 99 : zi) * 1000 + (bi < 0 ? 999 : bi);
  }

  /* ---------- filtering ---------- */

  /* `skip` lets us count a facet as if its own filter weren't applied. */
  function matches(rec, skip) {
    if (skip !== "zone" && state.zone && rec.zone !== state.zone) return false;
    if (skip !== "boss" && state.boss && rec.boss !== state.boss) return false;
    if (skip !== "role" && state.roles.length && state.roles.indexOf(rec.role) === -1) return false;
    if (skip !== "type" && state.type && typeGroup(rec.type) !== state.type) return false;
    if (skip !== "slot" && state.slot && rec.slot !== state.slot) return false;

    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = [rec.item, rec.boss, rec.zone, rec.priority, rec.notes, rec.slot, rec.type, rec.role]
        .join("   ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function filtered(skip) {
    return ALL.filter(function (r) { return matches(r, skip); });
  }

  function countBy(skip, keyFn) {
    var counts = {};
    filtered(skip).forEach(function (r) {
      var k = keyFn(r);
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  /* ---------- URL state ---------- */

  function writeUrl() {
    var p = new URLSearchParams();
    if (state.zone) p.set("zone", state.zone);
    if (state.boss) p.set("boss", state.boss);
    if (state.roles.length) p.set("role", state.roles.join(","));
    if (state.type) p.set("type", state.type);
    if (state.slot) p.set("slot", state.slot);
    if (state.q) p.set("q", state.q);
    var s = p.toString();
    var url = location.pathname + (s ? "#" + s : "");
    history.replaceState(null, "", url);
  }

  function readUrl() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ""));
    state.zone = p.get("zone") || "";
    state.boss = p.get("boss") || "";
    state.roles = p.get("role") ? p.get("role").split(",").filter(Boolean) : [];
    state.type = p.get("type") || "";
    state.slot = p.get("slot") || "";
    state.q = p.get("q") || "";
  }

  /* ---------- rendering: controls ---------- */

  function chip(label, active, count, dataset, icon) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.innerHTML =
      /* if the CDN ever stops serving these, fall back to a plain text chip */
      (icon ? '<img class="chip-icon" src="' + escapeHtml(icon) +
              '" alt="" onerror="this.style.display=\'none\'">' : "") +
      escapeHtml(label) +
      (count == null ? "" : ' <span class="n">' + count + "</span>");
    if (dataset) Object.keys(dataset).forEach(function (k) { b.dataset[k] = dataset[k]; });
    return b;
  }

  function renderZoneChips() {
    var counts = countBy("zone", function (r) { return r.zone; });
    var total = filtered("zone").length;
    el.zoneChips.innerHTML = "";

    var all = chip("All zones", !state.zone, total);
    all.addEventListener("click", function () { state.zone = ""; state.boss = ""; update(); });
    el.zoneChips.appendChild(all);

    ZONE_ORDER.forEach(function (z) {
      var c = chip(zoneLabel(z), state.zone === z, counts[z] || 0, null, ZONE_ICON[z]);
      c.addEventListener("click", function () {
        state.zone = (state.zone === z) ? "" : z;
        state.boss = "";
        update();
      });
      el.zoneChips.appendChild(c);
    });
  }

  function renderBossChips() {
    var counts = countBy("boss", function (r) { return r.boss; });
    el.bossChips.innerHTML = "";

    var zones = state.zone ? [state.zone] : ZONE_ORDER;
    var total = filtered("boss").length;

    var all = chip("All bosses", !state.boss, total);
    all.addEventListener("click", function () { state.boss = ""; update(); });
    el.bossChips.appendChild(all);

    zones.forEach(function (z) {
      orderedBosses(z).forEach(function (b) {
        var c = chip(bossLabel(b), state.boss === b, counts[b] || 0, null, BOSS_ICON[b]);
        c.addEventListener("click", function () {
          state.boss = (state.boss === b) ? "" : b;
          update();
        });
        el.bossChips.appendChild(c);
      });
    });
  }

  function renderRoleChips() {
    var counts = countBy("role", function (r) { return r.role; });
    el.roleChips.innerHTML = "";

    var all = chip("All roles", state.roles.length === 0, filtered("role").length);
    all.addEventListener("click", function () { state.roles = []; update(); });
    el.roleChips.appendChild(all);

    ROLE_ORDER.forEach(function (role) {
      var active = state.roles.indexOf(role) !== -1;
      var c = chip(role, active, counts[role] || 0, { role: role });
      c.addEventListener("click", function () {
        var i = state.roles.indexOf(role);
        if (i === -1) state.roles.push(role); else state.roles.splice(i, 1);
        update();
      });
      el.roleChips.appendChild(c);
    });
  }

  function fillSelect(sel, values, current, counts, allLabel) {
    sel.innerHTML = "";
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = allLabel;
    sel.appendChild(opt);
    values.forEach(function (v) {
      var n = counts[v] || 0;
      var o = document.createElement("option");
      o.value = v;
      o.textContent = v + " (" + n + ")";
      if (n === 0 && v !== current) o.disabled = true;
      sel.appendChild(o);
    });
    sel.value = current;
  }

  function renderSelects() {
    var typeCounts = countBy("type", function (r) { return typeGroup(r.type); });
    var slotCounts = countBy("slot", function (r) { return r.slot; });

    var types = TYPE_GROUPS.slice();
    Object.keys(typeCounts).forEach(function (t) { if (types.indexOf(t) === -1) types.push(t); });

    var slots = SLOT_ORDER.slice();
    Object.keys(slotCounts).forEach(function (s) { if (slots.indexOf(s) === -1) slots.push(s); });

    fillSelect(el.type, types, state.type, typeCounts, "All types");
    fillSelect(el.slot, slots, state.slot, slotCounts, "All slots");
  }

  /* ---------- rendering: results ---------- */

  function itemCell(rec) {
    var td = document.createElement("td");
    td.className = "col-item";
    var a = document.createElement("a");
    a.className = "item-link";
    a.href = rec.wowhead || ("https://www.wowhead.com/tbc/item=" + rec.id);
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML = highlight(rec.item, state.q);
    td.appendChild(a);
    return td;
  }

  function renderRow(rec) {
    var tr = document.createElement("tr");
    tr.dataset.role = rec.role;

    tr.appendChild(itemCell(rec));

    var slot = document.createElement("td");
    slot.className = "col-slot";
    slot.textContent = rec.slot || "";
    tr.appendChild(slot);

    var type = document.createElement("td");
    type.className = "col-type";
    type.textContent = rec.type || "";
    tr.appendChild(type);

    var role = document.createElement("td");
    var pill = document.createElement("span");
    pill.className = "role-pill role-" + rec.role;
    pill.textContent = rec.role;
    role.appendChild(pill);
    tr.appendChild(role);

    var prio = document.createElement("td");
    prio.className = "col-prio";
    prio.innerHTML = highlight(rec.priority, state.q);
    tr.appendChild(prio);

    var notes = document.createElement("td");
    notes.className = "col-notes";
    notes.innerHTML = highlight(rec.notes, state.q);
    tr.appendChild(notes);

    return tr;
  }

  function renderGroup(zone, boss, rows) {
    var section = document.createElement("section");
    section.className = "boss-group";

    var h = document.createElement("h2");
    h.className = "boss-head";
    var portrait = BOSS_ICON[boss];
    h.innerHTML =
      (portrait ? '<img class="boss-portrait" src="' + escapeHtml(portrait) +
                  '" alt="" onerror="this.style.display=\'none\'">' : "") +
      '<span class="zone-tag">' + escapeHtml(zoneLabel(zone)) + "</span> " +
      highlight(bossLabel(boss), state.q) +
      '<span class="n">' + rows.length + (rows.length === 1 ? " item" : " items") + "</span>";
    section.appendChild(h);

    var scroll = document.createElement("div");
    scroll.className = "table-scroll";
    var table = document.createElement("table");
    table.innerHTML =
      "<thead><tr>" +
      "<th>Item</th><th>Slot</th><th>Type</th><th>Role</th><th>Priority</th><th>Notes</th>" +
      "</tr></thead>";
    var tbody = document.createElement("tbody");
    rows.forEach(function (r) { tbody.appendChild(renderRow(r)); });
    table.appendChild(tbody);
    scroll.appendChild(table);
    section.appendChild(scroll);

    return section;
  }

  function renderResults() {
    var rows = filtered();
    el.count.textContent = rows.length + " of " + ALL.length + " items";
    el.results.innerHTML = "";

    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No items match these filters.";
      el.results.appendChild(empty);
      return;
    }

    /* Group by zone + boss, in encounter order. */
    var groups = {};
    var keys = [];
    rows.forEach(function (r) {
      var k = r.zone + "" + r.boss;
      if (!groups[k]) {
        groups[k] = { zone: r.zone, boss: r.boss, rows: [], sort: bossSortKey(r) };
        keys.push(k);
      }
      groups[k].rows.push(r);
    });

    keys.sort(function (a, b) { return groups[a].sort - groups[b].sort; });

    var frag = document.createDocumentFragment();
    keys.forEach(function (k) {
      var g = groups[k];
      frag.appendChild(renderGroup(g.zone, g.boss, g.rows));
    });
    el.results.appendChild(frag);

    /* Re-attach Wowhead tooltips to the freshly rendered links. */
    if (window.$WowheadPower && typeof window.$WowheadPower.refreshLinks === "function") {
      try { window.$WowheadPower.refreshLinks(); } catch (e) { /* tooltips are optional */ }
    }
  }

  function update() {
    renderZoneChips();
    renderBossChips();
    renderRoleChips();
    renderSelects();
    renderResults();
    writeUrl();
  }

  /* ---------- wiring ---------- */

  function bind() {
    el.type.addEventListener("change", function () { state.type = el.type.value; update(); });
    el.slot.addEventListener("change", function () { state.slot = el.slot.value; update(); });

    var t;
    el.search.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { state.q = el.search.value.trim(); update(); }, 120);
    });

    el.reset.addEventListener("click", function () {
      state.zone = ""; state.boss = ""; state.roles = [];
      state.type = ""; state.slot = ""; state.q = "";
      el.search.value = "";
      update();
    });

    window.addEventListener("hashchange", function () {
      readUrl();
      el.search.value = state.q;
      update();
    });
  }

  /* ---------- boot ---------- */

  el.results.innerHTML = '<p class="loading">Loading loot data&hellip;</p>';

  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      ALL = data;
      readUrl();
      el.search.value = state.q;
      bind();
      update();
    })
    .catch(function (err) {
      el.results.innerHTML =
        '<p class="empty error">Could not load <code>' + DATA_URL + "</code> (" + escapeHtml(err.message) +
        "). If you opened this file directly from disk, run a local server instead: " +
        "<code>python -m http.server</code></p>";
    });
})();
