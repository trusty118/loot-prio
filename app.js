/* TBC Tier 6 loot priority browser — vanilla JS, no build step. */

(function () {
  "use strict";

  var DATA_URL = "data/loot_data.json";
  var BIS_URL = "data/bis.json";
  var SPECS_URL = "data/specs.json";

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

  /* Tier tokens render as the three class icons. Which classes each token serves
     is fixed by the game, so it stays here; everything about those classes -
     icon, armour, roles - comes from the registry. */
  var TIER_CLASSES = {
    "Tier Token (Pal/Priest/Lock)": ["Paladin", "Priest", "Warlock"],
    "Tier Token (War/Hunter/Shaman)": ["Warrior", "Hunter", "Shaman"],
    "Tier Token (Rogue/Mage/Druid)": ["Rogue", "Mage", "Druid"]
  };

  function tierClasses(rec) {
    return TIER_CLASSES[rec.type] || null;
  }

  /* Does this one class satisfy the role and type filters simultaneously? A token
     surfaces under "Caster + Cloth" only if one and the same class is both -
     Conqueror has a tank (Paladin) and cloth wearers (Priest/Warlock), but no
     cloth tank, so it must not match. */
  function classPasses(cls, skip) {
    var info = REG.classes[cls];
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

  /* Does one priority entry speak to the selected class/spec? A class entry (Mage)
     stands for every spec of that class, and a spec entry satisfies a selection of
     its own class - 104 of the 398 entries are class-level, so both directions have
     to work. */
  function entrySpeaksTo(entry, clsId, specId) {
    if (!entry) return false;
    if (entry.spec) {
      var named = entrySpec(entry);
      if (specId) return named === specId || covers(named).indexOf(specId) !== -1;
      var spec = REG.specs[named];
      return !!spec && spec["class"] === clsId;
    }
    if (entry["class"]) return entry["class"] === clsId;
    return false;
  }

  /* The spec an entry actually names: a form narrows an umbrella to one of the
     specs it covers, so "FeralDruid + cat" is FeralCat. */
  function entrySpec(entry) {
    var form = entry.form && REG.forms[entry.spec] && REG.forms[entry.spec][entry.form];
    return (form && form.spec && REG.specs[form.spec]) ? form.spec : entry.spec;
  }

  /* The specs an umbrella stands for. FeralDruid covers bear and cat, which gear
     so differently that one BiS set can't serve both, but the priorities name the
     umbrella - so an umbrella answers for whichever of its specs is asked about. */
  function covers(specId) {
    var spec = REG.specs[specId];
    return (spec && spec.covers) || [];
  }

  /* An empty priority matches nobody, which is how the 23 "whoever needs it" rows
     drop out while a class or spec is selected: the filter asks where you stand in
     a line, and those rows name no line. */
  function priorityHas(rec, clsId, specId) {
    return (rec.priority || []).some(function (e) {
      return entrySpeaksTo(e, clsId, specId);
    });
  }

  /* Which specs of one class the user has narrowed to; empty means the whole class.
     Refining Mage to Fire must not quietly narrow a Warlock picked alongside it, so
     each class is resolved on its own and the results are unioned. */
  function pickedSpecs(clsId) {
    return state.specs.filter(function (id) {
      var spec = REG.specs[id];
      return !!spec && spec["class"] === clsId;
    });
  }

  function selectionSpeaksTo(entry) {
    return state.classes.some(function (clsId) {
      var picked = pickedSpecs(clsId);
      if (!picked.length) return entrySpeaksTo(entry, clsId, "");
      return picked.some(function (id) { return entrySpeaksTo(entry, clsId, id); });
    });
  }

  function selectionHas(rec) {
    return (rec.priority || []).some(selectionSpeaksTo);
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

  var ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large/";

  /* The class/spec/race registry, loaded from data/specs.json. Identifiers are
     what the data files store; `name` is display only. Replaces the hardcoded
     SPECS/CLASS_INFO tables that used to live here - a spec is now a data edit,
     not a code edit. */
  var REG = { classes: {}, specs: {}, forms: {}, races: {}, aliases: {} };

  /* classId -> its spec identifiers, derived rather than stored: it is the same
     fact as spec.class, and two copies of one fact drift. */
  var CLASS_SPECS = {};

  function indexRegistry(doc) {
    REG = {
      classes: (doc && doc.classes) || {},
      specs: (doc && doc.specs) || {},
      forms: (doc && doc.forms) || {},
      races: (doc && doc.races) || {},
      aliases: (doc && doc.aliases) || {}
    };

    /* umbrellas are left out: they hold no BiS of their own and are not offered as
       filter chips, so a class stands for the specs you can actually pick */
    CLASS_SPECS = {};
    Object.keys(REG.specs).forEach(function (id) {
      if ((REG.specs[id].covers || []).length) return;
      var cls = REG.specs[id]["class"];
      (CLASS_SPECS[cls] = CLASS_SPECS[cls] || []).push(id);
    });
  }

  /* One priority entry -> what to draw. Returns null if the registry doesn't know
     it, so a bad identifier is visibly missing rather than silently mis-drawn. */
  function resolveEntry(entry) {
    if (!entry) return null;
    var out = null;

    if (entry.spec) {
      var spec = REG.specs[entry.spec];
      if (!spec) return null;
      out = { name: spec.name, icon: spec.icon, id: entry.spec };
      var forms = REG.forms[entry.spec];
      if (entry.form && forms && forms[entry.form]) {
        var form = forms[entry.form];
        out.name = form.name;
        out.icon = form.icon;
        /* a form names one of the covered specs, so "FeralDruid + cat" resolves to
           FeralCat and its rings come from that spec's own BiS set */
        if (form.spec && REG.specs[form.spec]) out.id = form.spec;
      }
    } else if (entry["class"]) {
      var cls = REG.classes[entry["class"]];
      if (!cls) return null;
      out = { name: cls.name, icon: cls.icon, id: entry["class"] };
    } else {
      return null;
    }

    if (entry.race && REG.races[entry.race]) out.race = REG.races[entry.race];
    return out;
  }

  /* How each operator behaves. `advances` is the only thing ranking cares about:
     ">>" and "~>" are ">" for logic, and differ only in what they say. The labels
     are here for the operator tooltips. */
  var OPERATORS = {
    ">":  { advances: true,  label: "better than" },
    ">>": { advances: true,  label: "much better than" },
    "~>": { advances: true,  label: "roughly better than" },
    "=":  { advances: false, label: "equal to" },
    "~=": { advances: false, label: "roughly equal to" }
  };

  /* Fold a priority list into 1-based positions: ties share a position. */
  function positions(list) {
    var pos = [], n = 0;
    (list || []).forEach(function (entry, i) {
      var op = OPERATORS[entry.op];
      if (i === 0) n = 1;
      else if (!op || op.advances) n += 1;
      pos.push(n);
    });
    return pos;
  }

  /* Plain-text form of a priority, for the search index. */
  function priorityText(list) {
    return (list || []).map(function (entry) {
      var r = resolveEntry(entry);
      return r ? (r.race ? r.race.name + " " : "") + r.name : "";
    }).join(" ");
  }

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
    bossZone: "",    // which zone's boss - only meaningful alongside boss
    classes: [],     // multi-select class identifiers; [] = all
    specs: [],       // multi-select spec identifiers, each refining one of the above
    bisOnly: false,  // narrow to the selected specs' BiS lists
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
    classChips: document.getElementById("class-chips"),
    specChips: document.getElementById("spec-chips"),
    specRow: document.getElementById("spec-row"),
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

  /* Boss names are not unique across zones - both raids have a "Trash". A chip is
     therefore identified by zone + boss, and state.bossZone carries the zone half. */
  var BOSS_SEP = "␟";

  function bossKey(zone, boss) {
    return zone + BOSS_SEP + boss;
  }

  function bossZones(boss) {
    var seen = {};
    ALL.forEach(function (r) { if (r.boss === boss) seen[r.zone] = true; });
    return Object.keys(seen);
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
    if (skip !== "boss" && state.boss) {
      if (rec.boss !== state.boss) return false;
      /* bossZone is absent on an old bare ?boss=Trash link, which keeps its
         previous behaviour of selecting both zones' trash */
      if (state.bossZone && rec.zone !== state.bossZone) return false;
    }
    if (skip !== "slot" && state.slot && slotGroup(rec.slot) !== state.slot) return false;

    /* class and spec are one facet: "spec" skips both, so the counts on either row
       are computed as if neither were applied */
    if (skip !== "spec") {
      if (state.classes.length && !selectionHas(rec)) return false;
      /* "bis" skips only the BiS narrowing, so the toggle can count what it would leave */
      if (skip !== "bis" && state.bisOnly && state.specs.length &&
          !state.specs.some(function (id) { return bisTier(id, rec.id); })) return false;
    }

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
      var hay = [rec.item, rec.boss, rec.zone, priorityText(rec.priority), rec.notes,
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
    /* only "Trash" is ambiguous, so only it needs qualifying - the other 14 bosses
       keep the shorter url they have always had */
    if (state.boss && state.bossZone && bossZones(state.boss).length > 1) {
      p.set("bossZone", state.bossZone);
    }
    if (state.classes.length) p.set("class", state.classes.join(","));
    if (state.specs.length) p.set("spec", state.specs.join(","));
    if (state.bisOnly) p.set("bis", "1");
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
    state.bossZone = p.get("bossZone") || "";

    /* checked against the registry, so a stale or mistyped identifier reads as
       "no filter" rather than filtering every row away */
    var list = function (name) {
      return (p.get(name) || "").split(",").filter(Boolean);
    };
    state.specs = list("spec").filter(function (id) { return !!REG.specs[id]; });
    state.classes = list("class").filter(function (id) { return !!REG.classes[id]; });

    /* a spec implies its class, so a ?spec= link works without one */
    state.specs.forEach(function (id) {
      var cls = REG.specs[id]["class"];
      if (state.classes.indexOf(cls) === -1) state.classes.push(cls);
    });
    /* and a spec without its class selected is not a refinement of anything */
    state.specs = state.specs.filter(function (id) {
      return state.classes.indexOf(REG.specs[id]["class"]) !== -1;
    });

    state.bisOnly = state.specs.length ? p.get("bis") === "1" : false;

    state.roles = p.get("role") ? p.get("role").split(",").filter(Boolean) : [];
    state.type = p.get("type") || "";
    state.slot = p.get("slot") || "";
    state.q = p.get("q") || "";

    var sort = (p.get("sort") || "").split(":");
    state.sort = SORT_KEYS[sort[0]] ? sort[0] : "";
    state.dir = sort[1] === "desc" ? "desc" : "asc";
  }

  /* ---------- rendering: controls ---------- */

  /* `iconOnly` drops the text and the count off the chip and moves both into its
     tooltip. 27 spec chips with names and numbers on them read as a wall; the icons
     are the thing being recognised, and the name is one hover away. The fallback if
     an icon 404s is the label, so an icon-only chip can never end up blank. */
  function chip(label, active, count, dataset, icon, iconOnly) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", active ? "true" : "false");

    if (iconOnly && icon) {
      b.classList.add("chip--icon");
      b.innerHTML = '<img class="chip-icon" src="' + escapeHtml(icon) +
        '" alt="" onerror="this.replaceWith(document.createTextNode(this.parentNode.dataset.tip))">';
      /* the name only - a count here is noise on a row you are reading to find
         your class, and the result count is already above the table */
      b.dataset.tip = label;
      b.setAttribute("aria-label", label);
    } else {
      b.innerHTML =
        /* if the CDN ever stops serving these, fall back to a plain text chip */
        (icon ? '<img class="chip-icon" src="' + escapeHtml(icon) +
                '" alt="" onerror="this.style.display=\'none\'">' : "") +
        escapeHtml(label) +
        (count == null ? "" : ' <span class="n">' + count + "</span>");
    }

    if (dataset) Object.keys(dataset).forEach(function (k) { b.dataset[k] = dataset[k]; });
    return b;
  }

  /* Every row leads with a clear-this-row chip. They all read just "All" so the rows
     line up down the left edge - the full phrase would be the widest chip in each
     row and each a different width. It survives in the tooltip and the aria-label,
     which is also where the row labels went when they were dropped.

     No count either: it would be the row's total on every row at once, which the
     "N of 182 items" line above the results already says, and the numbers that earn
     their place are the ones on the individual chips. */
  function allChip(name, active) {
    var b = chip("All", active, null);
    b.classList.add("chip--all");
    b.dataset.tip = "All " + name;
    b.setAttribute("aria-label", "All " + name);
    return b;
  }

  function renderZoneChips() {
    var counts = countBy("zone", function (r) { return r.zone; });
    el.zoneChips.innerHTML = "";

    var all = allChip("zones", !state.zone);
    all.addEventListener("click", function () {
      state.zone = ""; state.boss = ""; state.bossZone = "";
      update();
    });
    el.zoneChips.appendChild(all);

    ZONE_ORDER.forEach(function (z) {
      var c = chip(zoneLabel(z), state.zone === z, counts[z] || 0, null, ZONE_ICON[z]);
      c.addEventListener("click", function () {
        state.zone = (state.zone === z) ? "" : z;
        state.boss = "";
        state.bossZone = "";
        update();
      });
      el.zoneChips.appendChild(c);
    });
  }

  function renderBossChips() {
    /* keyed by zone + boss: counting on the name alone gave both Trash chips the
       same combined total */
    var counts = countBy("boss", function (r) { return bossKey(r.zone, r.boss); });
    el.bossChips.innerHTML = "";

    var zones = state.zone ? [state.zone] : ZONE_ORDER;

    var all = allChip("bosses", !state.boss);
    all.addEventListener("click", function () {
      state.boss = ""; state.bossZone = "";
      update();
    });
    el.bossChips.appendChild(all);

    zones.forEach(function (z) {
      orderedBosses(z).forEach(function (b) {
        if (b === NO_BOSS) return;   /* crafted items are a zone, not a boss */
        var active = state.boss === b && (!state.bossZone || state.bossZone === z);
        var c = chip(bossLabel(b), active, counts[bossKey(z, b)] || 0, null, BOSS_ICON[b]);
        c.addEventListener("click", function () {
          if (active) { state.boss = ""; state.bossZone = ""; }
          else { state.boss = b; state.bossZone = z; }
          update();
        });
        el.bossChips.appendChild(c);
      });
    });
  }

  /* Class and spec answer the other question the table can be asked: not "who gets
     this item" but "what should I be rolling on". Both are multi-select, because a
     loot council reads several classes at once. Counts can't come from countBy():
     one row speaks to several specs at once, so each chip counts the pool itself. */
  function renderClassChips() {
    el.classChips.innerHTML = "";
    var pool = filtered("spec");

    var all = allChip("classes", !state.classes.length);
    all.addEventListener("click", function () {
      state.classes = []; state.specs = []; state.bisOnly = false;
      update();
    });
    el.classChips.appendChild(all);

    Object.keys(REG.classes).forEach(function (id) {
      var info = REG.classes[id];
      var n = pool.filter(function (r) { return priorityHas(r, id, ""); }).length;
      var active = state.classes.indexOf(id) !== -1;
      var c = chip(info.name, active, n, null, ICON_BASE + info.icon + ".jpg", true);
      c.addEventListener("click", function () {
        if (active) {
          state.classes.splice(state.classes.indexOf(id), 1);
          /* a spec is a refinement of its class - it can't outlive it */
          state.specs = state.specs.filter(function (s) {
            return REG.specs[s] && REG.specs[s]["class"] !== id;
          });
          if (!state.specs.length) state.bisOnly = false;
        } else {
          state.classes.push(id);
        }
        update();
      });
      el.classChips.appendChild(c);
    });
  }

  /* The spec row is hidden until a class is picked: 27 icons with no class chosen
     is a wall, and the question it asks ("which of your specs?") has no meaning
     until the first one is answered. */
  function renderSpecChips() {
    el.specChips.innerHTML = "";
    if (el.specRow) el.specRow.hidden = !state.classes.length;
    if (!state.classes.length) return;

    var pool = filtered("spec");

    var all = allChip("specs", !state.specs.length);
    all.addEventListener("click", function () {
      state.specs = []; state.bisOnly = false;
      update();
    });
    el.specChips.appendChild(all);

    /* grouped by the class order of the row above, not by the registry's spec order */
    state.classes.forEach(function (cls) {
      Object.keys(REG.specs).forEach(function (id) {
        var spec = REG.specs[id];
        if (spec["class"] !== cls) return;
        if (covers(id).length) return;   /* an umbrella is not a spec you can pick */
        var n = pool.filter(function (r) { return priorityHas(r, cls, id); }).length;
        var active = state.specs.indexOf(id) !== -1;
        var c = chip(spec.name, active, n, null, ICON_BASE + spec.icon + ".jpg", true);
        c.addEventListener("click", function () {
          if (active) {
            state.specs.splice(state.specs.indexOf(id), 1);
            if (!state.specs.length) state.bisOnly = false;
          } else {
            state.specs.push(id);
          }
          update();
        });
        el.specChips.appendChild(c);
      });
    });

    /* Only offered once a spec is picked: bis.json is keyed by spec, and a
       class-wide union of nine specs' BiS lists wouldn't mean anything. */
    if (state.specs.length) {
      var bisRows = filtered("bis").filter(function (r) {
        return state.specs.some(function (id) { return bisTier(id, r.id); });
      });
      var toggle = chip("BiS only", state.bisOnly, bisRows.length);
      toggle.classList.add("chip--toggle");
      toggle.addEventListener("click", function () {
        state.bisOnly = !state.bisOnly;
        update();
      });
      el.specChips.appendChild(toggle);
    }
  }

  function renderRoleChips() {
    var counts = countBy("role", function (r) { return r.role; });
    el.roleChips.innerHTML = "";

    var all = allChip("roles", state.roles.length === 0);
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

  /* keyed by the registry identifier (ProtWarr), matching data/bis.json */
  function bisTier(specId, itemId) {
    return BIS[specId + "|" + itemId] || 0;
  }

  /* What ring an icon should carry, and who it is for. A spec icon answers for
     itself. A class icon answers for the specs behind it: bis.json is keyed by
     spec, but 104 of the 398 priority entries name a class, so an item that is
     BiS for Arcane usually sits on a row that says "Mage" - without this most of
     the file would never appear. The highest tier among those specs wins, and
     the names ride along so the tooltip can say who.

     While a filter is on, only the selected specs count: the ring should answer
     "is this BiS for me", not "for someone in this class". */
  function bisMark(resolved, itemId) {
    var stands_for = covers(resolved.id);

    if (REG.specs[resolved.id] && !stands_for.length) {
      return { tier: bisTier(resolved.id, itemId), specs: [] };
    }

    /* an umbrella spec aggregates like a class does, over the specs it covers */
    var ids = stands_for.length ? stands_for : (CLASS_SPECS[resolved.id] || []);
    var picked = stands_for.length
      ? stands_for.filter(function (id) { return state.specs.indexOf(id) !== -1; })
      : pickedSpecs(resolved.id);
    if (picked.length) ids = picked;

    var tier = 0, names = [];
    ids.forEach(function (id) {
      var t = bisTier(id, itemId);
      if (!t) return;
      if (t > tier) tier = t;
      names.push(shortSpecName(id, resolved.name));
    });
    return { tier: tier, specs: names };
  }

  /* These names only ever appear on the icon they belong to, listing what it
     stands for, so repeating that icon's own name after each one says nothing:
     "Discipline Priest" under Priest is "Discipline", and "Feral Druid (cat)"
     under Feral Druid is "cat". Falls back to the full name if neither fits. */
  function shortSpecName(id, parentName) {
    var spec = REG.specs[id];
    if (!spec) return id;
    if (!parentName) return spec.name;

    var suffix = " " + parentName;
    if (spec.name.slice(-suffix.length) === suffix) {
      return spec.name.slice(0, -suffix.length);
    }
    if (spec.name.indexOf(parentName) === 0) {
      return spec.name.slice(parentName.length).replace(/^[\s(]+|[\s)]+$/g, "") || spec.name;
    }
    return spec.name;
  }

  function specIcon(spec, bis, forSpecs) {
    var tier = BIS_TIERS[bis];
    var img = document.createElement("img");
    img.className = "spec-icon" + (tier ? " " + tier.cls : "");
    /* which registry entry this icon is, so nothing downstream has to work it out
       from the display name - forms make that lossy ("Feral Druid (cat)") */
    if (spec.id) img.dataset.id = spec.id;
    img.src = ICON_BASE + spec.icon + ".jpg";
    /* Who the icon is for goes on the name line - "Priest — Discipline, Holy" -
       because that is a fact about the icon, not about the ring. A spec icon is
       already standing there naming itself, so it never carries a list. */
    var who = spec.name +
      (forSpecs && forSpecs.length ? " — " + forSpecs.join(", ") : "");

    img.alt = who + (tier ? " (" + tier.label + ")" : "");
    /* data-tip rather than title: the native tooltip has a ~1s delay the browser
       won't let us change, and these need to read as fast as the item tooltips.
       The BiS line is carried separately so the tooltip can colour it to match
       the ring on the icon. */
    img.dataset.tip = who;
    if (tier) {
      img.dataset.tipBis = tier.label;
      img.dataset.tipTier = String(bis);
    }
    img.setAttribute("aria-label", img.alt);
    img.setAttribute("onerror", "this.style.display='none'");
    return img;
  }

  /* Priority is an ordered list, each entry naming the operator that links it to
     the previous one. Icons come from the registry; operators render as text
     between them. No parsing, so an unknown identifier is a visible gap with a
     console warning rather than a silent plain-text fallback. */
  function priorityCell(rec) {
    var td = document.createElement("td");
    td.className = "col-prio";
    var list = rec.priority;

    if (typeof list === "string") {
      /* pre-migration data, or a bad hand-edit: show it rather than blank the cell */
      if (window.console) console.warn("priority is still a string on " + rec.item);
      appendText(td, list, state.q);
      return td;
    }
    if (!list || !list.length) return td;

    /* With a class or spec selected, everyone else in the line dims, so where you
       stand reads at a glance. Same idea as class-icon--muted on tier tokens; the
       tooltip is untouched, so a dimmed icon still names itself on hover. */
    var picking = state.classes.length > 0;

    list.forEach(function (entry, i) {
      if (i > 0) {
        var op = OPERATORS[entry.op] || OPERATORS[">"];
        var sep = document.createElement("span");
        sep.className = "prio-op";
        sep.textContent = entry.op || ">";
        sep.dataset.tip = op.label;
        td.appendChild(sep);
      }

      var resolved = resolveEntry(entry);
      if (!resolved) {
        if (window.console) {
          console.warn("unknown priority entry on " + rec.item + ":", JSON.stringify(entry));
        }
        appendText(td, "?", state.q);
        return;
      }

      var muted = picking && !selectionSpeaksTo(entry);

      if (resolved.race) {
        var raceIcon = specIcon(resolved.race, 0);
        raceIcon.classList.add("spec-icon--race");   /* sits flush against its spec */
        if (muted) raceIcon.classList.add("spec-icon--muted");
        td.appendChild(raceIcon);
      }
      var mark = bisMark(resolved, rec.id);
      var icon = specIcon(resolved, mark.tier, mark.specs);
      if (muted) icon.classList.add("spec-icon--muted");
      td.appendChild(icon);
    });

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
          var info = REG.classes[c] || { icon: "inv_misc_questionmark" };
          return '<img class="class-icon' + (muted ? " class-icon--muted" : "") + '"' +
            ' src="' + ICON_BASE + info.icon + '.jpg"' +
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
    renderClassChips();
    renderSpecChips();
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
      state.zone = ""; state.boss = ""; state.bossZone = ""; state.roles = [];
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

  /* The registry is not optional the way bis.json is - without it nothing in the
     priority column can be drawn - but a failure should still leave a readable
     table rather than a blank page, so it warns and carries on. */
  function loadRegistry() {
    return fetch(SPECS_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(indexRegistry)
      .catch(function (err) {
        if (window.console) console.warn("spec registry unavailable:", err.message);
        indexRegistry(null);
      });
  }

  Promise.all([
    fetch(DATA_URL).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    loadRegistry(),
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
