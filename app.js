/* TBC Tier 6 loot priority browser — vanilla JS, no build step. */

(function () {
  "use strict";

  var DATA_URL = "data/loot_data.json";
  var BIS_URL = "data/bis.json";

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

  /* Role column and filter are switched off for now. Everything behind them is
     intact - role still filters, still feeds the token class matching, and is
     still in the search index - so flipping this back to true restores it.
     Hiding the cells with CSS instead does not work: in a table-layout:fixed
     table the remaining cells shift into the wrong columns. */
  var SHOW_ROLE = false;

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

  /* Slots as the character sheet presents them: every weapon slot is one "Weapon"
     entry, and relics share the ranged slot - no class has both, so splitting them
     only ever produced two half-empty options. */
  var SLOT_GROUP = {
    "One-Hand": "Weapon",
    "Main-Hand": "Weapon",
    "Off-Hand": "Weapon",
    "Two-Hand": "Weapon",
    "Ranged": "Ranged/Relic",
    "Relic": "Ranged/Relic"
  };

  function slotGroup(slot) {
    return SLOT_GROUP[slot] || slot || "";
  }

  var SLOT_ORDER = [
    "Head", "Neck", "Shoulder", "Back", "Chest", "Wrist", "Hands", "Waist",
    "Legs", "Feet", "Finger", "Trinket", "Weapon", "Ranged/Relic"
  ];

  /* The raw `type` field has 30+ values; collapse them into usable buckets. */
  var TYPE_GROUPS = [
    "Cloth", "Leather", "Mail", "Plate",
    "Weapons - 1H", "Weapons - 2H", "Ranged",
    "Shield / Off-hand", "Cloak", "Jewellery", "Relic"
  ];

  /* typeGroup() still returns "Tier Token" - it's a real bucket and an existing
     ?type= link must keep working - but it's kept out of the dropdown, since the
     Tier role chip already selects exactly those items. */
  var HIDDEN_TYPES = { "Tier Token": true };

  /* Display-only tidy-up of the raw type. Staves and polearms are two-handed by
     definition, so the "2H" prefix is noise. Relabelled at render time rather
     than in the data, so `type` stays as the item DB records it and typeGroup()
     can still key off the 2H prefix. */
  var TYPE_LABEL = {
    "2H Staff": "Staff",
    "2H Polearm": "Polearm"
  };

  /* These arrive with no hand count at all. The Slot column used to supply it,
     but slots now collapse to a single "Weapon", so the type has to carry it. */
  var BARE_WEAPON = { "Mace": 1, "Sword": 1, "Dagger": 1, "Axe": 1, "Fist": 1 };

  /* Tier tokens render as "Tier" plus the three class icons - the written-out
     "Tier Token (Pal/Priest/Lock)" wrapped over three lines in the type column. */
  var CLASS_ICON = "https://wow.zamimg.com/images/wow/icons/large/classicon_";

  var TIER_CLASSES = {
    "Tier Token (Pal/Priest/Lock)": ["Paladin", "Priest", "Warlock"],
    "Tier Token (War/Hunter/Shaman)": ["Warrior", "Hunter", "Shaman"],
    "Tier Token (Rogue/Mage/Druid)": ["Rogue", "Mage", "Druid"]
  };

  /* What each class wears and which roles it can fill in T6. Tokens are matched
     against this per class, so a token surfaces under "Caster + Cloth" only if
     one and the same class is both - Conqueror has a tank (Paladin) and cloth
     wearers (Priest/Warlock), but no cloth tank, so it must not match. */
  var CLASS_INFO = {
    "Paladin": { armor: "Plate", roles: ["Physical", "Healer", "Tank"] },
    "Priest": { armor: "Cloth", roles: ["Healer", "Caster"] },
    "Warlock": { armor: "Cloth", roles: ["Caster"] },
    "Warrior": { armor: "Plate", roles: ["Physical", "Tank"] },
    "Hunter": { armor: "Mail", roles: ["Physical"] },
    "Shaman": { armor: "Mail", roles: ["Caster", "Healer", "Physical"] },
    "Rogue": { armor: "Leather", roles: ["Physical"] },
    "Mage": { armor: "Cloth", roles: ["Caster"] },
    "Druid": { armor: "Leather", roles: ["Physical", "Tank", "Healer", "Caster"] }
  };

  function tierClasses(rec) {
    return TIER_CLASSES[rec.type] || null;
  }

  /* Does this one class satisfy the role and type filters simultaneously? */
  function classPasses(cls, skip) {
    var info = CLASS_INFO[cls];
    if (!info) return false;

    if (skip !== "role" && state.roles.length) {
      var roleOk = state.roles.indexOf("Tier") !== -1 ||
        state.roles.some(function (r) { return info.roles.indexOf(r) !== -1; });
      if (!roleOk) return false;
    }

    if (skip !== "type" && state.type &&
        state.type !== "Tier Token" && state.type !== info.armor) {
      return false;
    }
    return true;
  }

  function typeLabel(rec) {
    var type = rec.type || "";
    if (TYPE_LABEL[type]) return TYPE_LABEL[type];
    if (BARE_WEAPON[type]) return (rec.slot === "Two-Hand" ? "2H " : "1H ") + type;
    /* keeps sorting and search working on the text the icons stand in for;
       searching "tier" still hits via the raw type in the haystack */
    if (TIER_CLASSES[type]) return "Token " + TIER_CLASSES[type].join(" ");
    return type;
  }

  /* Takes the whole record, not just `type`: nine weapon types say neither 1H nor
     2H ("Mace", "Sword", "Fist", ...), so `slot` is what settles the hand count. */
  function typeGroup(rec) {
    var type = rec.type || "";
    if (!type) return "Other";
    if (/^Tier Token/i.test(type)) return "Tier Token";
    if (type === "Cloth" || type === "Leather" || type === "Mail" || type === "Plate") return type;
    if (type === "Cloak") return "Cloak";
    if (type === "Shield" || /^Off-hand$/i.test(type)) return "Shield / Off-hand";
    if (type === "Ring" || type === "Neck" || type === "Trinket") return "Jewellery";
    if (type === "Idol" || type === "Totem" || type === "Libram") return "Relic";

    /* everything left is a weapon */
    if (rec.slot === "Ranged") return "Ranged";
    if (/^2H/i.test(type) || rec.slot === "Two-Hand") return "Weapons - 2H";
    return "Weapons - 1H";
  }

  /* Sort keys for the clickable column headers. Slot and Role sort by their
     canonical order rather than alphabetically - paper-doll order and
     Physical/Caster/Healer/Tank/Tier are more useful than Back-before-Chest or
     Caster-before-Physical. Item and Type sort on the text as displayed. */
  var SORT_KEYS = {
    item: function (r) { return r.item.toLowerCase(); },
    slot: function (r) { return SLOT_ORDER.indexOf(slotGroup(r.slot)); },
    type: function (r) { return typeLabel(r).toLowerCase(); },
    role: function (r) { return ROLE_ORDER.indexOf(r.role); }
  };

  /* Shorthand used in the priority strings -> the spec it names. Longest key wins,
     so "Prot Pal" is matched before "Prot" and "Fire Mage" before "Mage". Entries
     with no spec (plain "Lock", "Rogue") get the class icon instead.
     STEP 1: icons are appended after the existing words so the mapping can be
     eyeballed before anything is replaced. */
  var SPEC_ICON = "https://wow.zamimg.com/images/wow/icons/large/";

  var SPECS = [
    /* --- warrior --- */
    ["Prot Warrior", "Protection Warrior", "ability_warrior_defensivestance"],
    ["Prot War", "Protection Warrior", "ability_warrior_defensivestance"],
    ["Arms", "Arms Warrior", "ability_warrior_savageblow"],
    ["Fury", "Fury Warrior", "ability_warrior_innerrage"],
    ["Warrior", "Warrior", "classicon_warrior"],
    ["War", "Warrior", "classicon_warrior"],

    /* --- paladin --- */
    ["Prot Paladin", "Protection Paladin", "spell_holy_devotionaura"],
    ["Prot Pal", "Protection Paladin", "spell_holy_devotionaura"],
    ["H Pal", "Holy Paladin", "spell_holy_holybolt"],
    ["Ret", "Retribution Paladin", "spell_holy_auraoflight"],
    ["Paladin", "Paladin", "classicon_paladin"],

    /* --- priest --- */
    ["Shadow Priest", "Shadow Priest", "spell_shadow_shadowwordpain"],
    ["SPriest", "Shadow Priest", "spell_shadow_shadowwordpain"],
    ["H Priest", "Holy Priest", "spell_holy_guardianspirit"],
    ["Priest", "Priest", "classicon_priest"],

    /* --- shaman --- */
    ["R Shaman", "Restoration Shaman", "spell_nature_magicimmunity"],
    ["Ele Shaman", "Elemental Shaman", "spell_nature_lightning"],
    ["Elemental", "Elemental Shaman", "spell_nature_lightning"],
    ["Enhance", "Enhancement Shaman", "spell_nature_lightningshield"],
    ["Ele", "Elemental Shaman", "spell_nature_lightning"],
    ["Shaman", "Shaman", "classicon_shaman"],

    /* --- druid --- */
    ["R Druid", "Restoration Druid", "spell_nature_healingtouch"],
    ["Boomkin", "Balance Druid", "spell_nature_starfall"],
    ["Feral Cat", "Feral Druid (cat)", "ability_druid_catform"],
    ["Feral", "Feral Druid", "ability_racial_bearform"],
    ["Bear", "Feral Druid (bear)", "ability_racial_bearform"],
    ["Cat", "Feral Druid (cat)", "ability_druid_catform"],
    ["Druid", "Druid", "classicon_druid"],

    /* --- hunter --- */
    ["BM Hunter", "Beast Mastery Hunter", "ability_hunter_beasttaming"],
    ["Survival Hunter", "Survival Hunter", "ability_hunter_swiftstrike"],
    ["Survival", "Survival Hunter", "ability_hunter_swiftstrike"],
    ["BM", "Beast Mastery Hunter", "ability_hunter_beasttaming"],
    ["Hunter", "Hunter", "classicon_hunter"],

    /* --- mage --- */
    ["Fire Mage", "Fire Mage", "spell_fire_flamebolt"],
    ["Arcane", "Arcane Mage", "spell_holy_magicalsentry"],
    ["Mage", "Mage", "classicon_mage"],

    /* --- warlock --- */
    ["Fire Lock", "Destruction Warlock", "spell_shadow_rainoffire"],
    ["Lock", "Warlock", "classicon_warlock"],

    /* --- rogue --- */
    ["Rogue", "Rogue", "classicon_rogue"],

    /* --- races, where the priority turns on a racial --- */
    ["Orc", "Orc", "achievement_character_orc_male"],
    ["Human", "Human", "achievement_character_human_female"]
  ];

  var SPEC_BY_KEY = {};
  SPECS.forEach(function (s) { SPEC_BY_KEY[s[0].toLowerCase()] = { name: s[1], icon: s[2] }; });

  /* Longest first so multi-word shorthand wins over its own suffix ("Prot Pal"
     before "Pal", "Elemental" before "Ele"). The \b guards stop substring hits -
     without them "Cat" matches inside "Hunter (catch-up)". */
  var SPEC_RE = new RegExp(
    "\\b(?:" + SPECS.map(function (s) { return s[0]; })
      .sort(function (a, b) { return b.length - a.length; })
      .map(escapeRegExp).join("|") + ")\\b",
    "gi"
  );

  /* Role glyphs, drawn rather than fetched: Blizzard's ready-check role icons
     live in the game's UI atlas and aren't hosted as individual files anywhere.
     Shapes follow the same language - shield for tank, cross for healer, sword
     for melee - so the pill reads without relying on colour. */
  var ROLE_GLYPH = {
    "Tank": '<path d="M12 2 3 5v7c0 5 4 8.5 9 10 5-1.5 9-5 9-10V5z"/>',
    "Healer": '<path d="M9.5 2h5v5.5H20v5h-5.5V21h-5v-8.5H4v-5h5.5z"/>',
    "Physical": '<path d="M20.5 2 22 3.5 12.5 13l-1.5-1.5zM10 12.5 11.5 14l-6 6-3 1 1-3zM3 3l4 1 9 9-2 2-9-9z"/>',
    "Caster": '<path d="M12 1.5 14 9l7.5 2-7.5 2-2 7.5-2-7.5L2.5 11 10 9z"/>',
    "Tier": '<path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6zm0 4.5 4 2v4c0 2.6-1.7 4.4-4 5.2-2.3-.8-4-2.6-4-5.2v-4z"/>'
  };

  function roleGlyph(role) {
    var d = ROLE_GLYPH[role];
    if (!d) return "";
    return '<svg class="role-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      d + "</svg>";
  }

  var state = {
    zone: "",        // "" = all
    boss: "",        // "" = all
    roles: [],       // multi-select; [] = all
    type: "",
    slot: "",
    q: "",
    sort: "",        // "" = leave rows in source order
    dir: "asc"
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

  /* Crafted items have no boss - the em-dash is a placeholder in the data. They are
     reachable through the Crafted zone, so they get no boss chip and their group is
     headed by the zone instead. */
  var NO_BOSS = "—";

  function bossLabel(boss) {
    return boss;
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
    if (skip !== "slot" && state.slot && slotGroup(rec.slot) !== state.slot) return false;

    /* A token is not cloth or a caster item itself, but it turns into one. Match
       it on the classes it serves so it appears alongside the gear it competes
       with; the Role column still just says "Tier". */
    var classes = tierClasses(rec);
    if (classes) {
      if (!classes.some(function (c) { return classPasses(c, skip); })) return false;
    } else {
      if (skip !== "role" && state.roles.length && state.roles.indexOf(rec.role) === -1) return false;
      if (skip !== "type" && state.type && typeGroup(rec) !== state.type) return false;
    }

    if (state.q) {
      var q = state.q.toLowerCase();
      /* search both the raw and displayed forms, so "2H mace" and "mace" both hit */
      var hay = [rec.item, rec.boss, rec.zone, rec.priority, rec.notes,
                 rec.slot, slotGroup(rec.slot), rec.type, typeLabel(rec), rec.role]
        .join("   ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function filtered(skip) {
    return ALL.filter(function (r) { return matches(r, skip); });
  }

  /* Sorts within a boss group - the grouping itself always stays in kill order. */
  function sortRows(rows) {
    if (!state.sort || !SORT_KEYS[state.sort]) return rows;
    var key = SORT_KEYS[state.sort];
    var dir = state.dir === "desc" ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var x = key(a), y = key(b), c;
      if (typeof x === "number" && typeof y === "number") c = x - y;
      else c = String(x).localeCompare(String(y));
      if (c === 0) c = a.item.localeCompare(b.item);  /* stable, readable tie-break */
      return c * dir;
    });
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
    if (state.sort) p.set("sort", state.sort + (state.dir === "desc" ? ":desc" : ""));
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

    var sort = (p.get("sort") || "").split(":");
    state.sort = SORT_KEYS[sort[0]] ? sort[0] : "";
    state.dir = sort[1] === "desc" ? "desc" : "asc";
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
        if (b === NO_BOSS) return;   /* crafted items are a zone, not a boss */
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
    var typeCounts = countBy("type", function (r) { return typeGroup(r); });
    var slotCounts = countBy("slot", function (r) { return slotGroup(r.slot); });

    /* any bucket not in TYPE_GROUPS still surfaces, so a new type can't go
       missing - except the ones deliberately hidden */
    var types = TYPE_GROUPS.slice();
    Object.keys(typeCounts).forEach(function (t) {
      if (!HIDDEN_TYPES[t] && types.indexOf(t) === -1) types.push(t);
    });
    if (state.type && types.indexOf(state.type) === -1) types.push(state.type);

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

  /* Appends text, wrapping any search hits in <mark>. Built as nodes rather than
     innerHTML so the spec icons interleaved with this text can't be matched
     against - a search for "priest" must not hit an icon's title attribute. */
  function appendText(parent, text, needle) {
    if (!needle) {
      parent.appendChild(document.createTextNode(text));
      return;
    }
    var lower = text.toLowerCase();
    var find = needle.toLowerCase();
    var at = 0;
    var hit;
    while ((hit = lower.indexOf(find, at)) !== -1) {
      if (hit > at) parent.appendChild(document.createTextNode(text.slice(at, hit)));
      var mark = document.createElement("mark");
      mark.textContent = text.slice(hit, hit + find.length);
      parent.appendChild(mark);
      at = hit + find.length;
    }
    if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)));
  }

  /* How long an item stays best-in-slot, marked with trailing asterisks in the
     priority string: * this phase, ** several phases, *** the whole expansion.
     Colours borrow the item-quality ladder - epic purple, then gold, then
     legendary orange - so "rarer" reads as "lasts longer". */
  var BIS_TIERS = {
    1: { cls: "spec-icon--bis", label: "Phase BiS" },
    2: { cls: "spec-icon--bis2", label: "Multi-phase BiS" },
    3: { cls: "spec-icon--bis3", label: "Expansion BiS" }
  };

  var BIS_TIER_BY_NAME = { "phase": 1, "multiPhase": 2, "expansion": 3 };

  /* Flattened from data/bis.json: "Spec Name|itemId" -> tier number.
     BIS_BY_SPEC keeps the per-spec shape the file is written in, which is what a
     spec filter would read from later. */
  var BIS = {};
  var BIS_BY_SPEC = {};

  function indexBis(doc) {
    BIS = {};
    BIS_BY_SPEC = {};
    var specs = (doc && doc.specs) || {};

    Object.keys(specs).forEach(function (specName) {
      var phases = specs[specName] || {};
      Object.keys(phases).forEach(function (phase) {
        (phases[phase] || []).forEach(function (entry) {
          if (!entry || entry.id == null) return;
          var tier = BIS_TIER_BY_NAME[entry.bis || "phase"] || 1;
          BIS[specName + "|" + entry.id] = tier;
          (BIS_BY_SPEC[specName] = BIS_BY_SPEC[specName] || []).push({
            id: entry.id, item: entry.item, tier: tier, phase: phase
          });
        });
      });
    });
  }

  function bisTier(specName, itemId) {
    return BIS[specName + "|" + itemId] || 0;
  }

  function specIcon(spec, bis) {
    var tier = BIS_TIERS[bis];
    var img = document.createElement("img");
    img.className = "spec-icon" + (tier ? " " + tier.cls : "");
    img.src = SPEC_ICON + spec.icon + ".jpg";
    img.alt = spec.name + (tier ? " (" + tier.label + ")" : "");
    /* data-tip rather than title: the native tooltip has a ~1s delay the browser
       won't let us change, and these need to read as fast as the item tooltips.
       The BiS line is carried separately so the tooltip can colour it to match
       the ring on the icon. */
    img.dataset.tip = spec.name;
    if (tier) {
      img.dataset.tipBis = tier.label;
      img.dataset.tipTier = String(bis);
    }
    img.setAttribute("aria-label", img.alt);
    img.setAttribute("onerror", "this.style.display='none'");
    return img;
  }

  /* The recognised shorthand is replaced by its icon; everything else (the > = >>
     operators, and free text like "Anyone" or "biggest upgrade") stays as words.
     The underlying string is untouched, so search and sort still see the names. */
  function priorityCell(rec) {
    var td = document.createElement("td");
    td.className = "col-prio";
    var text = rec.priority || "";
    var at = 0;
    var m;

    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(text)) !== null) {
      var spec = SPEC_BY_KEY[m[0].toLowerCase()];
      if (!spec) continue;
      /* "non-orc Fury" and "(non-human)" are exclusions - icon would invert them */
      if (/non-$/i.test(text.slice(0, m.index))) continue;
      if (m.index > at) appendText(td, text.slice(at, m.index), state.q);
      at = m.index + m[0].length;

      /* Defensive: asterisks used to mark BiS inline. data/bis.json is the source
         of truth now, but swallow any leftover so it can't render as text. */
      var stars = /^\*{1,3}/.exec(text.slice(at));
      if (stars) {
        at += stars[0].length;
        SPEC_RE.lastIndex = at;
      }

      td.appendChild(specIcon(spec, bisTier(spec.name, rec.id)));
    }
    if (at < text.length) appendText(td, text.slice(at), state.q);
    return td;
  }

  function renderRow(rec) {
    var tr = document.createElement("tr");
    tr.dataset.role = rec.role;

    tr.appendChild(itemCell(rec));

    var slot = document.createElement("td");
    slot.className = "col-slot";
    slot.textContent = slotGroup(rec.slot);
    tr.appendChild(slot);

    var type = document.createElement("td");
    type.className = "col-type";
    var classes = tierClasses(rec);
    if (classes) {
      /* Icons only - the Role column already says "Tier", so a word here as well
         is noise. typeLabel() still returns text for sorting and search.
         Classes that don't satisfy the active filters are dimmed, so it's clear
         which of the three put the token in these results. */
      var filtering = state.roles.length > 0 || state.type !== "";
      type.innerHTML =
        classes.map(function (c) {
          var muted = filtering && !classPasses(c, null);
          return '<img class="class-icon' + (muted ? " class-icon--muted" : "") + '"' +
            ' src="' + CLASS_ICON + c.toLowerCase() + '.jpg"' +
            ' alt="' + escapeHtml(c) + '" aria-label="' + escapeHtml(c) + '"' +
            ' data-tip="' + escapeHtml(c) + (muted ? " (does not match the current filters)" : "") + '"' +
            ' onerror="this.replaceWith(document.createTextNode(this.alt))">';
        }).join('<span class="tier-sep">-</span>');
    } else {
      type.textContent = typeLabel(rec);
    }
    tr.appendChild(type);

    if (SHOW_ROLE) {
      var role = document.createElement("td");
      role.className = "col-role";
      var pill = document.createElement("span");
      pill.className = "role-pill role-" + rec.role;
      pill.innerHTML = roleGlyph(rec.role) + "<span>" + escapeHtml(rec.role) + "</span>";
      role.appendChild(pill);
      tr.appendChild(role);
    }

    tr.appendChild(priorityCell(rec));

    var notes = document.createElement("td");
    notes.className = "col-notes";
    notes.innerHTML = highlight(rec.notes, state.q);
    tr.appendChild(notes);

    return tr;
  }

  /* Sort state is global, so every boss group stays in step - sorting one section
     and leaving the rest alone would make the columns lie about each other. */
  function sortableTh(label, key) {
    var active = state.sort === key;
    var arrow = active ? (state.dir === "asc" ? "▲" : "▼") : "▴▾";
    return '<th class="sortable' + (active ? " is-sorted" : "") + '"' +
      ' data-sort="' + key + '"' +
      ' aria-sort="' + (active ? (state.dir === "asc" ? "ascending" : "descending") : "none") + '"' +
      ' tabindex="0" role="button"' +
      ' title="Sort by ' + escapeHtml(label) + '">' +
      escapeHtml(label) + '<span class="sort-arrow">' + arrow + "</span></th>";
  }

  function toggleSort(key) {
    if (state.sort === key) {
      state.dir = state.dir === "asc" ? "desc" : "asc";
    } else {
      state.sort = key;
      state.dir = "asc";
    }
    update();
  }

  function renderGroup(zone, boss, rows) {
    var section = document.createElement("section");
    section.className = "boss-group";

    var h = document.createElement("h2");
    h.className = "boss-head";
    var portrait = BOSS_ICON[boss];
    /* no boss means crafted: the zone is the heading, and repeating it as a tag
       alongside itself would just read "Crafted Crafted" */
    var heading = boss === NO_BOSS ? zoneLabel(zone) : bossLabel(boss);
    h.innerHTML =
      (portrait ? '<img class="boss-portrait" src="' + escapeHtml(portrait) +
                  '" alt="" onerror="this.style.display=\'none\'">' : "") +
      '<span class="boss-name">' + highlight(heading, state.q) + "</span>" +
      (boss === NO_BOSS ? "" :
        '<span class="zone-tag">' + escapeHtml(zoneLabel(zone)) + "</span>");
    section.appendChild(h);

    var scroll = document.createElement("div");
    scroll.className = "table-scroll";
    var table = document.createElement("table");
    /* Every boss is its own table, so the column widths have to be declared here -
       left to themselves, each table would size its columns to its own contents
       and no two groups would line up. */
    table.innerHTML =
      "<colgroup>" +
      '<col class="c-item"><col class="c-slot"><col class="c-type">' +
      (SHOW_ROLE ? '<col class="c-role">' : "") +
      '<col class="c-prio"><col class="c-notes">' +
      "</colgroup>" +
      "<thead><tr>" +
      sortableTh("Item", "item") +
      sortableTh("Slot", "slot") +
      sortableTh("Type", "type") +
      (SHOW_ROLE ? sortableTh("Role", "role") : "") +
      "<th>Priority</th><th>Notes</th>" +
      "</tr></thead>";
    var tbody = document.createElement("tbody");
    sortRows(rows).forEach(function (r) { tbody.appendChild(renderRow(r)); });
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

  /* ---------- instant tooltips ---------- */

  /* One element reused for every icon, parented to <body> so the table's
     overflow-x container can't clip it, and positioned on hover with no delay. */
  var tip = null;

  function showTip(el) {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tip";
      document.body.appendChild(tip);
    }
    tip.textContent = el.dataset.tip;

    /* second line, coloured to match the ring drawn on the icon */
    if (el.dataset.tipBis) {
      var line = document.createElement("span");
      line.className = "tip-bis tip-bis--" + (el.dataset.tipTier || "1");
      line.textContent = el.dataset.tipBis;
      tip.appendChild(line);
    }

    tip.style.display = "block";

    var r = el.getBoundingClientRect();
    var t = tip.getBoundingClientRect();

    /* centred above the icon, flipped below when there's no room up there */
    var left = r.left + (r.width - t.width) / 2;
    var top = r.top - t.height - 8;
    if (top < 4) top = r.bottom + 8;

    var maxLeft = document.documentElement.clientWidth - t.width - 6;
    if (left < 6) left = 6;
    if (left > maxLeft) left = maxLeft;

    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }

  function hideTip() {
    if (tip) tip.style.display = "none";
  }

  function bindTips() {
    /* delegated, because every render replaces the icons */
    document.addEventListener("mouseover", function (e) {
      var el = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (el) showTip(el);
    });
    document.addEventListener("mouseout", function (e) {
      var el = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (el) hideTip();
    });
    /* keyboard users get it too */
    document.addEventListener("focusin", function (e) {
      var el = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (el) showTip(el);
    });
    document.addEventListener("focusout", hideTip);
    window.addEventListener("scroll", hideTip, true);
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
  function loadBis() {
    return fetch(BIS_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(indexBis)
      .catch(function (err) {
        if (window.console) console.warn("BiS data unavailable, rings disabled:", err.message);
        indexBis(null);
      });
  }

  Promise.all([
    fetch(DATA_URL).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    loadBis()
  ])
    .then(function (results) {
      var data = results[0];
      ALL = data;
      readUrl();
      el.search.value = state.q;
      bind();
      bindTips();
      update();
    })
    .catch(function (err) {
      el.results.innerHTML =
        '<p class="empty error">Could not load <code>' + DATA_URL + "</code> (" + escapeHtml(err.message) +
        "). If you opened this file directly from disk, run a local server instead: " +
        "<code>python -m http.server</code></p>";
    });
})();
