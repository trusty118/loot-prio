/* TBC Tier 6 loot priority browser — vanilla JS, no build step. */

(function () {
  "use strict";

  /* Revalidate rather than trust the cache. GitHub Pages serves these with
     max-age=600, so without this a corrected role or a fixed boss attribution can read
     stale for ten minutes after a deploy - the classic "tell everyone to hard-refresh"
     problem, and nobody should ever be asked to do that.

     `no-cache` does not mean "don't cache": it means "always ask the server if this is
     still current". The browser sends a conditional request and gets back a ~200 byte
     304 when nothing has changed, or the new file when it has. One tiny round trip per
     load buys data that is never stale.

     This is also why item data stays in these files rather than moving to a database:
     the code and the data ship in one commit and deploy together, so a cached app.js
     can never disagree with the data it is reading. */
  var FRESH = { cache: "no-cache" };

  var DATA_URL = "data/loot_data.json";
  var BIS_URL = "data/bis.json";
  var SPECS_URL = "data/specs.json";

  /* Encounter order per zone (the JSON is not in kill order). */
  /* Kill order per zone. The seven zones outside Phase 3 have no items yet, so their
     chips all read 0 - they are here so the phases open onto something real, and so a
     boss has a name to arrive under. Trash is listed for the raids that actually drop
     it; Gruul's Lair and Magtheridon's Lair get none, which is why they have none. */
  var BOSS_ORDER = {
    "Karazhan": [
      "Trash",
      "Attumen the Huntsman",
      "Moroes",
      "Maiden of Virtue",
      "Opera Event",
      "The Curator",
      "Terestian Illhoof",
      "Shade of Aran",
      "Netherspite",
      "Chess Event",
      "Prince Malchezaar",
      "Nightbane"
    ],
    "Gruul's Lair": [
      "High King Maulgar",
      "Gruul the Dragonkiller"
    ],
    "Magtheridon's Lair": [
      "Magtheridon"
    ],
    "Serpentshrine Cavern": [
      "Trash",
      "Hydross the Unstable",
      "The Lurker Below",
      "Leotheras the Blind",
      "Fathom-Lord Karathress",
      "Morogrim Tidewalker",
      "Lady Vashj"
    ],
    "Tempest Keep": [
      "Trash",
      "Al'ar",
      "Void Reaver",
      "High Astromancer Solarian",
      "Kael'thas Sunstrider"
    ],
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
    ],
    "Zul'Aman": [
      "Trash",
      "Nalorakk",
      "Akil'zon",
      "Jan'alai",
      "Halazzi",
      "Hex Lord Malacrass",
      "Zul'jin"
    ],
    "Sunwell Plateau": [
      "Trash",
      "Kalecgos",
      "Brutallus",
      "Felmyst",
      "Eredar Twins",
      "M'uru",
      "Kil'jaeden"
    ]
  };

  /* shown on rows the source guide never covered, and in the search haystack so
     the set is reachable by typing it */
  var UNSOURCED_TAG = "not in the guide";

  /* The five content phases of TBC, and the zones each one opened. Only Phase 3 has
     items in the dataset so far; the rest are here so the shape of the whole
     expansion is visible and a zone has somewhere to arrive. A phase with nothing
     in it still says what belongs there, and its chip reads 0.

     This is also what makes the where-panel readable: 17 boss chips and 3 zone
     chips at once was a wall, so nothing below a phase is shown until one is
     picked, and nothing below a zone until a zone is. */
  var PHASES = [
    { id: "P1", label: "Phase 1", zones: ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"] },
    { id: "P2", label: "Phase 2",
      zones: ["Serpentshrine Cavern", "Tempest Keep", "Crafted (Nether Vortex)"] },
    { id: "P3", label: "Phase 3",
      zones: ["Mount Hyjal", "Black Temple", "Crafted (Heart of Darkness)"] },
    { id: "P4", label: "Phase 4", zones: ["Zul'Aman"] },
    { id: "P5", label: "Phase 5", zones: ["Sunwell Plateau", "Crafted (Sunmote)"] }
  ];

  /* The order zones are listed in is load-bearing, not cosmetic: ZONE_ORDER derives from
     it, and ZONE_ORDER decides the zone chip row, the order of the art strips on a phase
     tile, and - through bossSortKey() - the order boss groups appear in the table. Change
     it and all three move together, which is the point. */

  /* The raids of a phase, which is not quite its zones: the crafted pseudo-zone has no
     bosses and no art, so it has no strip on the tile. Having a boss list is the test,
     rather than naming it, so a future crafted-style zone behaves the same. Its name is
     still on the tooltip - the phase does cover it, it just cannot be pictured. */
  function phaseRaids(id) {
    return phaseZones(id).filter(function (z) { return !!BOSS_ORDER[z]; });
  }

  /* The phase to land on: the last one that actually has items. Derived rather than
     hardcoded, so it follows the content - when Zul'Aman items arrive, Phase 4 becomes
     the landing phase without anyone editing this. Needs ALL, so it cannot be a static
     initialiser; state.phase is set from it once the data is in. */
  function defaultPhase() {
    for (var i = PHASES.length - 1; i >= 0; i--) {
      var zones = PHASES[i].zones;
      for (var j = 0; j < ALL.length; j++) {
        if (zones.indexOf(ALL[j].zone) !== -1) return PHASES[i].id;
      }
    }
    return PHASES[0].id;
  }

  function phaseZones(id) {
    for (var i = 0; i < PHASES.length; i++) {
      if (PHASES[i].id === id) return PHASES[i].zones;
    }
    return [];
  }

  /* Every zone, in phase order - which is also kill order across the expansion, so
     bossSortKey() can go on using the index of this list. */
  var ZONE_ORDER = PHASES.reduce(function (all, p) { return all.concat(p.zones); }, []);
  /* Each phase has its own crafting tier, named for the material it is gated on, and
     both render as plain "Crafted" - they are never on screen together, because the
     phase above them decides which one is. */
  var ZONE_LABEL = {
    "Crafted (Nether Vortex)": "Crafted",
    "Crafted (Heart of Darkness)": "Crafted",
    "Crafted (Sunmote)": "Crafted"
  };

  /* Encounter Journal boss portraits (128x64 PNG). TBC bosses have no achievement
     icons - those postdate them - but Legion backfilled the Adventure Guide, so
     these exist. The slugs are irregular: apostrophes vanish without a hyphen
     (najentus, kazrogal) and the Illidari Council has no leading "the". Verified
     forms, do not tidy. */
  var JOURNAL = "https://wow.zamimg.com/images/wow/journal/ui-ej-boss-";
  var ICON = "https://wow.zamimg.com/images/wow/icons/large/";

  var BOSS_ICON = {
    "Attumen the Huntsman": JOURNAL + "attumen-the-huntsman.png",
    "Moroes": JOURNAL + "moroes.png",
    "Maiden of Virtue": JOURNAL + "maiden-of-virtue.png",
    "Opera Event": JOURNAL + "opera.png",
    "The Curator": JOURNAL + "the-curator.png",
    "Terestian Illhoof": JOURNAL + "terestian-illhoof.png",
    "Shade of Aran": JOURNAL + "shade-of-aran.png",
    "Netherspite": JOURNAL + "netherspite.png",
    /* the Chess Event is the one encounter with no portrait in the journal at all -
       the chip falls back to text, which chip() handles */
    "Prince Malchezaar": JOURNAL + "prince-malchezaar.png",
    "Nightbane": JOURNAL + "nightbane.png",
    "High King Maulgar": JOURNAL + "high-king-maulgar.png",
    "Gruul the Dragonkiller": JOURNAL + "gruul-the-dragonkiller.png",
    "Magtheridon": JOURNAL + "magtheridon.png",
    "Hydross the Unstable": JOURNAL + "hydross-the-unstable.png",
    "The Lurker Below": JOURNAL + "the-lurker-below.png",
    "Leotheras the Blind": JOURNAL + "leotheras-the-blind.png",
    "Fathom-Lord Karathress": JOURNAL + "fathom-lord-karathress.png",
    "Morogrim Tidewalker": JOURNAL + "morogrim-tidewalker.png",
    "Lady Vashj": JOURNAL + "lady-vashj.png",
    "Al'ar": JOURNAL + "alar.png",
    "Void Reaver": JOURNAL + "void-reaver.png",
    "High Astromancer Solarian": JOURNAL + "high-astromancer-solarian.png",
    "Kael'thas Sunstrider": JOURNAL + "kaelthas-sunstrider.png",
    "Nalorakk": JOURNAL + "nalorakk.png",
    "Akil'zon": JOURNAL + "akilzon.png",
    "Jan'alai": JOURNAL + "janalai.png",
    "Halazzi": JOURNAL + "halazzi.png",
    "Hex Lord Malacrass": JOURNAL + "hex-lord-malacrass.png",
    "Zul'jin": JOURNAL + "daakara.png",
    "Kalecgos": JOURNAL + "kalecgos.png",
    "Brutallus": JOURNAL + "brutallus.png",
    "Felmyst": JOURNAL + "felmyst.png",
    "Eredar Twins": JOURNAL + "eredar-twins.png",
    "M'uru": JOURNAL + "muru.png",
    "Kil'jaeden": JOURNAL + "kiljaeden.png",
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
  /* Each zone borrows its final boss's portrait, since only Black Temple has an
     instance image of its own. Zul'Aman is the odd one: Zul'jin has no slug, and the
     Encounter Journal files that raid's last boss as "daakara". All checked for 200. */
  var ZONE_ICON = {
    "Karazhan": JOURNAL + "prince-malchezaar.png",
    "Gruul's Lair": JOURNAL + "gruul-the-dragonkiller.png",
    "Magtheridon's Lair": JOURNAL + "magtheridon.png",
    "Serpentshrine Cavern": JOURNAL + "lady-vashj.png",
    "Tempest Keep": JOURNAL + "kaelthas-sunstrider.png",
    "Black Temple": JOURNAL + "illidan-stormrage.png",
    "Mount Hyjal": JOURNAL + "archimonde.png",
    "Crafted (Nether Vortex)": ICON + "inv_elemental_mote_nether.jpg",
    "Crafted (Heart of Darkness)": ICON + "spell_shadow_demonictactics.jpg",
    "Crafted (Sunmote)": ICON + "spell_nature_elementalshields.jpg",
    "Zul'Aman": JOURNAL + "daakara.png",
    "Sunwell Plateau": JOURNAL + "kiljaeden.png"
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

  /* Nothing is hidden from the type dropdown any more. "Tier Token" used to be,
     because the Tier role chip selected exactly those 15 items - with the role
     filter gone, the dropdown is the only way to reach them. */
  var HIDDEN_TYPES = {};

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

  /* ---------- what an item suits ----------
     Two layers, in order, and they are deliberately not the same kind of rule.

     1. Proficiency is HARD. A class wears its own armour type and everything below
        it - Cloth < Leather < Mail < Plate - so a Mage is never offered leather and
        a Hunter never plate; a relic belongs to exactly one class. Checked against
        zatar's 398 entries, this breaks none of them, and check_priority.py keeps
        it that way.

     2. Role tags are ADVISORY, and run on whoever survived the first layer. They
        cross the item's `roles` with the spec's, which is why ProtPal carries
        Caster (spellpower was its threat stat) rather than every caster item
        needing a Tank tag. Advisory because the same crossing contradicts 59 of
        zatar's own calls - a Prot Warrior on a physical weapon, an Enhancement
        Shaman on a healer ring - so the editor hides these, never refuses them. */

  var ARMOUR_RANK = { "Cloth": 1, "Leather": 2, "Mail": 3, "Plate": 4 };
  var RELIC_CLASS = { "Idol": "Druid", "Totem": "Shaman", "Libram": "Paladin" };

  /* Layer 1 on its own: can this class physically use the item at all? */
  function canUse(clsId, rec) {
    var info = REG.classes[clsId];
    if (!info) return false;

    var need = ARMOUR_RANK[rec.type];
    if (need && need > (ARMOUR_RANK[info.armor] || 9)) return false;

    var owner = RELIC_CLASS[rec.type];
    if (owner && clsId !== owner) return false;

    return true;
  }

  /* Both layers, for one spec. Tier tokens answer through the three classes they
     serve, which TIER_CLASSES already knows. */
  function suitsItem(rec, specId) {
    var spec = REG.specs[specId];
    if (!spec) return false;

    var tokenClasses = tierClasses(rec);
    if (tokenClasses) return tokenClasses.indexOf(spec["class"]) !== -1;

    if (!canUse(spec["class"], rec)) return false;

    var tags = rec.roles || [];
    if (!tags.length) return true;              /* nothing said, so nothing excluded */
    return (spec.roles || []).some(function (r) { return tags.indexOf(r) !== -1; });
  }

  /* A class is offered when any of its specs is. */
  function classSuitsItem(rec, clsId) {
    return (CLASS_SPECS[clsId] || []).some(function (id) { return suitsItem(rec, id); });
  }

  /* Does this one class satisfy the role and type filters simultaneously? A token
     surfaces under "Caster + Cloth" only if one and the same class is both -
     Conqueror has a tank (Paladin) and cloth wearers (Priest/Warlock), but no
     cloth tank, so it must not match. */
  function classPasses(cls, skip) {
    var info = REG.classes[cls];
    if (!info) return false;

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
    return (effectivePriority(rec) || []).some(function (e) {
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

  /* Both of these ask the list actually on screen, not the guide underneath it: with
     a template open, reading rec.priority would filter by his ordering while showing
     yours, and a list you had only just started would go on matching all 195 rows. */
  function selectionHas(rec) {
    return (effectivePriority(rec) || []).some(selectionSpeaksTo);
  }

  /* The specs the current selection actually stands for: a class with none of its
     specs picked means all of them. Recomputed once per update() rather than per
     record, since matches() runs it across every row for every chip. */
  var SELECTED_SPECS = [];

  function indexSelection() {
    SELECTED_SPECS = [];
    state.classes.forEach(function (cls) {
      var picked = pickedSpecs(cls);
      (picked.length ? picked : (CLASS_SPECS[cls] || [])).forEach(function (id) {
        if (SELECTED_SPECS.indexOf(id) === -1) SELECTED_SPECS.push(id);
      });
    });
  }

  /* An unsourced row names nobody, so selectionHas() can never match it - but the
     BiS data can, and these are real T6 items: 11 of the 13 are BiS for at least
     one spec. Without this, Band of the Eternal Champion is BiS for eight physical
     specs and reachable from none of them. The row still shows an empty priority
     column and its "not in the guide" tag, so nothing about it reads as a call. */
  function unsourcedBis(rec) {
    if (!rec.unsourced) return false;
    /* Only while reading the guide. It is a bridge across a gap in HIS data, so with
       a list of your own open there is no gap to bridge: those rows have a priority
       column you control like any other, and letting 13 of them through a filter the
       other 182 fail would make your own list lie about itself. */
    if (activeTemplate) return false;
    return SELECTED_SPECS.some(function (id) { return bisTier(id, rec.id); });
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

  /* Sort keys for the clickable column headers. Slot sorts in paper-doll order
     rather than alphabetically; Item and Type sort on the text as displayed. */
  var SORT_KEYS = {
    item: function (r) { return r.item.toLowerCase(); },
    slot: function (r) { return SLOT_ORDER.indexOf(slotGroup(r.slot)); },
    type: function (r) { return typeLabel(r).toLowerCase(); }
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


  var state = {
    phase: "",       // "" = none picked, so only the phase pills show
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
    editing: false,  // edit mode: priority cells become editable
    sort: "",        // "" = leave rows in source order
    dir: "asc"
  };

  var ALL = [];

  var el = {
    phaseChips: document.getElementById("phase-chips"),
    zoneChips: document.getElementById("zone-chips"),
    bossRow: document.getElementById("boss-row"),
    bossChips: document.getElementById("boss-chips"),
    classChips: document.getElementById("class-chips"),
    specChips: document.getElementById("spec-chips"),
    specRow: document.getElementById("spec-row"),
    type: document.getElementById("type-select"),
    slot: document.getElementById("slot-select"),
    search: document.getElementById("search"),
    reset: document.getElementById("reset"),
    count: document.getElementById("count"),
    results: document.getElementById("results"),
    templateBar: document.getElementById("template-bar"),
    listTrigger: document.getElementById("list-trigger"),
    listTriggerName: document.getElementById("list-trigger-name"),
    tplDirty: document.getElementById("tpl-dirty"),
    editToggle: document.getElementById("edit-toggle"),
    signIn: document.getElementById("sign-in"),
    account: document.getElementById("account"),
    accountName: document.getElementById("account-name"),
    tplLinkOut: document.getElementById("tpl-link-out"),
    tplLinkField: document.getElementById("tpl-link-field"),
    editMsg: document.getElementById("edit-msg"),
    editHint: document.getElementById("edit-hint"),
    refine: document.querySelector(".controls--refine")
  };

  /* ---------- templates ---------- */

  /* A template is a person's own version of the priorities: a full copy, keyed by
     item id. zatar's data in ALL is never touched, so "reset to his" is always one
     step away and a template can be diffed against what it forked from.

     Full copy rather than a sparse overlay was a deliberate call: 11.6 KB of JSON,
     2.1 KB once gzipped and base64'd, which fits in a URL fragment. The cost is that
     a saved template is frozen - later fixes to loot_data.json don't reach it - and
     items added after it was saved simply aren't in it. Both are handled at read
     time rather than hidden: see effectivePriority() and inTemplate(). */

  var TEMPLATE_VERSION = 1;

  /* Three views, one variable and one flag. zatar's list and a list that arrived on
     a link are reference; only a list in your own store is a workspace. */
  var activeTemplate = null;   /* the list being VIEWED; null means zatar's */
  var activeIsMine = false;    /* is it in your store? false for one from a #t= link */
  var unsaved = false;         /* an edit made but not yet written back */

  function canEdit() {
    return !!activeTemplate && activeIsMine && state.editing;
  }

  function effectivePriority(rec) {
    if (activeTemplate) {
      var own = activeTemplate.priorities[rec.id];
      if (own) return own;
    }
    return rec.priority;
  }

  /* False for an item the active template has never heard of - added to the dataset
     after it was saved. The row still renders, from the guide's data, and says so. */
  function inTemplate(rec) {
    return !activeTemplate || !!activeTemplate.priorities[rec.id];
  }

  function makeTemplate(name, base, priorities) {
    return {
      v: TEMPLATE_VERSION,
      id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name,
      created: new Date().toISOString().slice(0, 10),
      base: base,
      priorities: priorities
    };
  }

  /* A copy of whatever is on screen. effectivePriority() already answers "what is
     this row showing", so one function copies the guide's list, one of yours, or one
     that arrived on a link, without branching on which of the three it is. */
  function copyOfCurrent(name) {
    var priorities = {};
    ALL.forEach(function (rec) {
      /* deep copy: editing one must never reach into ALL */
      priorities[rec.id] = (effectivePriority(rec) || []).map(function (e) {
        var c = {};
        Object.keys(e).forEach(function (k) { c[k] = e[k]; });
        return c;
      });
    });
    return makeTemplate(name || "My priorities",
      activeTemplate ? activeTemplate.id : "zatar", priorities);
  }

  /* Nobody's list yet: all 195 rows, every priority empty. Still a full copy, so it
     validates, encodes and shares exactly like any other. */
  function newBlankTemplate(name) {
    var priorities = {};
    ALL.forEach(function (rec) { priorities[rec.id] = []; });
    return makeTemplate(name || "My list", "blank", priorities);
  }

  /* ---------- template storage ----------
     Async on purpose even though localStorage is synchronous: the Azure
     implementation that arrives with login is then a drop-in, not a refactor of
     every call site. */

  var STORE_KEY = "lootprio.templates";
  var SMART_KEY = "lootprio.smartFilter";

  /* Smart filtering narrows the add popover to specs the item suits. On by default:
     most of the time the full 37 is noise, and the few real exceptions are reached
     by turning it off rather than by never filtering. */
  function smartFilter() {
    try { return window.localStorage.getItem(SMART_KEY) !== "off"; }
    catch (e) { return true; }
  }

  function setSmartFilter(on) {
    try { window.localStorage.setItem(SMART_KEY, on ? "on" : "off"); }
    catch (e) { /* private browsing: the session still works, it just won't persist */ }
  }

  /* How much of a list actually says something. Every list holds all 195 records - a
     template is a full copy, not a diff - so "195 items" was true of every one of them
     and told you nothing. What separates them is how many carry a priority. */
  function filledCount(priorities) {
    if (!priorities) return 0;
    var n = 0;
    Object.keys(priorities).forEach(function (id) {
      if ((priorities[id] || []).length) n++;
    });
    return n;
  }

  /* zatar's own, which is not in any store: 159 of the 195. The other 36 are the rows
     where his call was "whoever needs it" and the 13 the videos never covered. */
  function zatarFilled() {
    var n = 0;
    ALL.forEach(function (rec) { if ((rec.priority || []).length) n++; });
    return n;
  }

  var localStore = {
    read: function () {
      try {
        return JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}");
      } catch (e) {
        if (window.console) console.warn("saved templates unreadable:", e.message);
        return {};
      }
    },
    write: function (all) {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
    },
    list: function () {
      var all = this.read();
      return Promise.resolve(Object.keys(all).map(function (id) {
        return {
          id: id, name: all[id].name, created: all[id].created,
          filled: filledCount(all[id].priorities)
        };
      }));
    },
    load: function (id) {
      return Promise.resolve(this.read()[id] || null);
    },
    save: function (t) {
      var all = this.read();
      all[t.id] = t;
      try {
        this.write(all);
      } catch (e) {
        /* quota is the realistic failure: ~400 templates fit, but say so plainly */
        return Promise.reject(new Error("Could not save: " + e.message));
      }
      return Promise.resolve(t);
    },
    remove: function (id) {
      var all = this.read();
      delete all[id];
      this.write(all);
      return Promise.resolve();
    }
  };

  /* ---------- the account, and the store behind it ----------

     Signed out is the full product: make lists, edit them, share them by link, all of
     it kept in localStorage. Signing in is an upgrade - your lists follow you between
     machines instead of being trapped in one browser - and never a gate. Friends
     arriving to try the editor should never meet a login wall first.

     Everything here fails soft, the same way specs.json and bis.json do. No config, a
     blocked CDN, a paused project: you lose sign-in, not the page. That is why
     supabaseReady() is checked at every entry point rather than assumed once. */

  /* Filled in once the Supabase project exists. The anon key is *designed* to be
     public and belongs in this file: it identifies the project, it does not authorise
     anything. Row-level security is what actually protects a list - a policy of
     `auth.uid() = user_id` means the database itself refuses to hand your rows to
     anyone else, no matter what the client asks for.

     The service-role key is the one that bypasses those policies. It must never appear
     in this repo, in this file, or in any client. */
  /* Empty is still a supported state, not a broken one - see docs/login-setup.md. No
     config means no sign-in button and a site that behaves exactly as it did before
     login existed, which is what every test in this repo except test/auth.mjs runs as.

     The publishable key is safe here on one condition, which Supabase states on the
     page it is copied from: RLS is enabled on `lists` and a policy is configured. That
     policy is the only thing standing between this key and every list in the table. */
  var SUPABASE_URL = "https://korqkbphefucdqwxezso.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_JYJyZ_R_0a5_igZkGnY3Vw_S6B9pHrL";

  var sb = null;            /* the Supabase client, once it exists */
  var session = null;       /* the signed-in session, or null */

  function supabaseConfigured() {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  /* The SDK is a hotlinked CDN script, like Wowhead's tooltips.js, so it can simply be
     absent - offline, blocked, or in jsdom, which is how the tests run. */
  function supabaseReady() {
    return !!(sb && supabaseConfigured());
  }

  function signedIn() {
    return !!(session && session.user);
  }

  /* The Discord display name, for the bar. Falls back through what Discord actually
     sends before giving up on a label rather than rendering "undefined". */
  /* The one image on this page that does not come from wow.zamimg.com, and the only
     one whose URL is chosen by someone else. Built here rather than sitting empty in
     the markup - an <img> with no src is a request for the page itself in some
     browsers - and it removes itself if Discord's CDN will not serve it, leaving the
     name, which was always the part that mattered. */
  function renderAvatar() {
    var have = el.account && el.account.querySelector(".account-avatar");
    var url = accountAvatar();
    if (!url) { if (have) have.remove(); return; }
    if (have && have.getAttribute("src") === url) return;
    if (have) have.remove();
    var img = document.createElement("img");
    img.className = "account-avatar";
    img.alt = "";
    img.setAttribute("onerror", "this.remove()");
    img.src = url;
    el.account.insertBefore(img, el.account.firstChild);
  }

  function accountAvatar() {
    if (!signedIn()) return "";
    var m = session.user.user_metadata || {};
    return m.avatar_url || m.picture || "";
  }

  function accountName() {
    if (!signedIn()) return "";
    var m = session.user.user_metadata || {};
    return m.full_name || m.name || m.user_name || m.preferred_username ||
           session.user.email || "Signed in";
  }

  /* One row of the `lists` table is one template. The column names match the template
     shape validateTemplate() already enforces, so nothing about the format changes and
     a list is byte-identical whether it came from here or from localStorage. */
  function rowToTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      created: row.created,
      v: row.v,
      base: row.base,
      priorities: row.priorities
    };
  }

  /* The same four methods as localStore, same promises, same meanings - which is the
     whole reason edit mode was built against an async store before login existed.
     Nothing that calls these learns which one it is talking to. */
  var remoteStore = {
    /* `priorities` is the heavy column and this pulls it for every list, only to count
       the non-empty entries. It is fine at the scale this runs at - a person has a
       handful of lists, each ~12KB - and it keeps the count honest without a schema
       change. If someone ever has dozens, the fix is a generated column in Postgres
       holding the count, not a lighter select here: the number has to come from the
       priorities either way, and the database can compute it once per write instead of
       the client computing it once per read. */
    list: function () {
      return sb.from("lists").select("id,name,created,priorities")
        .order("updated_at", { ascending: false })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return (res.data || []).map(function (r) {
            return { id: r.id, name: r.name, created: r.created, filled: filledCount(r.priorities) };
          });
        });
    },
    load: function (id) {
      return sb.from("lists").select("*").eq("id", id).maybeSingle()
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          /* a missing id is null, not an error - same as localStore */
          return res.data ? rowToTemplate(res.data) : null;
        });
    },
    save: function (t) {
      /* user_id is left to the column default (auth.uid()); sending it from the client
         would be a claim the database has to check anyway, and the RLS policy is the
         thing that decides. */
      return sb.from("lists").upsert({
        id: t.id,
        name: t.name,
        created: t.created,
        v: t.v,
        base: t.base,
        priorities: t.priorities,
        updated_at: new Date().toISOString()
      }).then(function (res) {
        if (res.error) throw new Error("Could not save: " + res.error.message);
        return t;
      });
    },
    remove: function (id) {
      return sb.from("lists").delete().eq("id", id).then(function (res) {
        if (res.error) throw new Error(res.error.message);
      });
    }
  };

  /* The single swap point the whole design turned on. Signed in reads and writes the
     account; signed out reads and writes this browser. */
  function activeStore() {
    return signedIn() && supabaseReady() ? remoteStore : localStore;
  }

  var store = localStore;

  /* Kept in step with the session rather than resolved at each call site, so `store`
     stays the plain object every existing caller already holds. */
  function syncStore() {
    store = activeStore();
  }

  /* ---------- editing rules ----------
     The same rules verify/check_priority.py enforces, applied while editing so the
     editor cannot produce data the validator would reject. */

  var OP_LIST = [">", ">>", "~>", "=", "~="];
  var DOUBLE_SLOTS = { "Finger": 1, "Trinket": 1, "One-Hand": 1, "Main-Hand": 1, "Off-Hand": 1 };

  /* You can only be told to take two of something you could equip twice. */
  function allowsRepeat(rec) {
    return !rec.unique && !!DOUBLE_SLOTS[rec.slot];
  }

  function entryKey(entry) {
    return [entry.spec || entry["class"] || "", entry.form || "", entry.race || ""].join("|");
  }

  /* Why a change is refused, or null if it is fine. Returned as a message because
     the editor says it out loud rather than silently ignoring the drop. */
  function rejectReason(rec, list, entry, replacingIndex) {
    if (!resolveEntry(entry)) return "that isn't a spec or class I know";
    var key = entryKey(entry);
    var clash = list.some(function (e, i) {
      return i !== replacingIndex && entryKey(e) === key;
    });
    if (clash && !allowsRepeat(rec)) {
      return rec.unique
        ? rec.item + " is unique - only one can be equipped"
        : "a " + rec.slot + " item can only be equipped once";
    }
    return null;
  }

  /* Every edit goes through here: it keeps the operator invariant (first entry has
     none, everything after has one) so no caller has to remember it. */
  function normaliseList(list) {
    return list.map(function (e, i) {
      var c = {};
      Object.keys(e).forEach(function (k) { if (k !== "op") c[k] = e[k]; });
      if (i > 0) c.op = OP_LIST.indexOf(e.op) === -1 ? ">" : e.op;
      return c;
    });
  }

  /* ---------- editing actions ----------
     Each returns a new list rather than mutating, so undo is a matter of keeping the
     previous one, and so nothing can half-apply. */

  function moveEntry(list, from, to) {
    if (to < 0 || to >= list.length || from === to) return list;
    var out = list.slice();
    out.splice(to, 0, out.splice(from, 1)[0]);
    return normaliseList(out);
  }

  function removeEntry(list, at) {
    var out = list.slice();
    out.splice(at, 1);
    return normaliseList(out);
  }

  function addEntry(list, entry, at) {
    var out = list.slice();
    out.splice(at == null ? out.length : at, 0, entry);
    return normaliseList(out);
  }

  /* Set the operator linking entry `at` to the one before it. */
  function setOp(list, at, op) {
    if (at < 1 || at >= list.length) return list;      /* the first entry has no operator */
    if (OP_LIST.indexOf(op) === -1) return list;
    var out = list.slice();
    var c = {};
    Object.keys(out[at]).forEach(function (k) { c[k] = out[at][k]; });
    c.op = op;
    out[at] = c;
    return normaliseList(out);
  }

  /* Step to the next operator. The pointer picks from a menu instead - four clicks
     to reach "~=" was one of the complaints - but stepping is the right thing on a
     keyboard, where there is nothing to aim at. */
  function cycleOp(list, at) {
    if (at < 1 || at >= list.length) return list;
    var next = (OP_LIST.indexOf(list[at].op) + 1) % OP_LIST.length;
    return setOp(list, at, OP_LIST[next]);
  }

  /* Applies an edited list to the active template. There is always one: editable
     cells are only rendered for a list of your own. */
  function applyEdit(rec, list) {
    if (!activeTemplate || !activeIsMine) return;
    activeTemplate.priorities[rec.id] = normaliseList(list);
    unsaved = true;
    saveNow();
  }

  /* There is no Save button. A list is written when it is made and again on every
     edit: localStorage is synchronous and a whole template is ~12 KB, which is
     nothing next to losing an afternoon's list by forgetting to press something.
     `unsaved` is stored out here rather than on the template so it never travels
     into the store or into a share link. */
  function saveNow() {
    if (!activeTemplate || !activeIsMine) return Promise.resolve();
    var t = activeTemplate;
    return store.save(t).then(function () {
      if (activeTemplate === t) { unsaved = false; renderTemplateBar(); }
    }, function (err) {
      announce(err.message);
    });
  }

  function resetItem(rec) {
    if (!activeTemplate || !activeIsMine) return;
    applyEdit(rec, (rec.priority || []).map(function (e) {
      var c = {}; Object.keys(e).forEach(function (k) { c[k] = e[k]; }); return c;
    }));
  }

  /* ---------- sharing ----------
     gzip via CompressionStream where the browser has it (11.6 KB -> ~2.1 KB), plain
     base64 where it doesn't. The marker byte says which, so a link made in one
     browser opens in another. It all lives in the hash, which never leaves the
     browser, so only browser URL limits apply. */

  function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64ToBytes(b64) {
    var bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* btoa only speaks latin-1, so text has to become bytes first. TextEncoder is the
     obvious way and is present in every browser; the fallback keeps this working
     under jsdom, where it isn't. */
  function utf8ToBytes(str) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(str);
    var bin = unescape(encodeURIComponent(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToUtf8(bytes) {
    if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(bin));
  }

  function encodeTemplate(t) {
    var json = JSON.stringify({ v: t.v, name: t.name, base: t.base, priorities: t.priorities });
    var bytes = utf8ToBytes(json);
    if (typeof CompressionStream !== "function" || typeof Response !== "function") {
      return Promise.resolve("r" + bytesToB64(bytes));
    }
    var cs = new CompressionStream("gzip");
    var writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(cs.readable).arrayBuffer().then(function (buf) {
      return "z" + bytesToB64(new Uint8Array(buf));
    });
  }

  function decodeTemplate(text) {
    var kind = text.charAt(0);
    var bytes;
    try {
      bytes = b64ToBytes(text.slice(1));
    } catch (e) {
      return Promise.reject(new Error("that link is damaged"));
    }
    if (kind === "r") {
      return Promise.resolve(JSON.parse(bytesToUtf8(bytes)));
    }
    if (kind !== "z") return Promise.reject(new Error("that link is not a template"));
    if (typeof DecompressionStream !== "function" || typeof Response !== "function") {
      return Promise.reject(new Error("this browser can't read compressed links"));
    }
    var ds = new DecompressionStream("gzip");
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).arrayBuffer().then(function (buf) {
      return JSON.parse(bytesToUtf8(new Uint8Array(buf)));
    });
  }

  /* A shared template is untrusted input. Check it against the registry and the
     editing rules before any of it reaches the table, and say what is wrong rather
     than rendering something broken. */
  function validateTemplate(doc) {
    if (!doc || typeof doc !== "object") return "not a template";
    if (doc.v !== TEMPLATE_VERSION) return "made by a different version of this site";
    if (!doc.priorities || typeof doc.priorities !== "object") return "no priorities in it";

    var byId = {};
    ALL.forEach(function (r) { byId[r.id] = r; });

    var ids = Object.keys(doc.priorities);
    if (!ids.length) return "it has no items";

    for (var i = 0; i < ids.length; i++) {
      var rec = byId[ids[i]];
      if (!rec) continue;              /* an item we no longer carry: ignored, not fatal */
      var list = doc.priorities[ids[i]];
      if (!Array.isArray(list)) return "item " + ids[i] + " has a broken priority";

      var seen = {};
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!e || typeof e !== "object") return rec.item + ": entry " + j + " is not an entry";
        if (e.spec && e["class"]) return rec.item + ": entry names both a spec and a class";
        if (!resolveEntry(e)) return rec.item + ": unknown spec or class";
        if (j === 0 && e.op) return rec.item + ": the first entry can't have an operator";
        if (j > 0 && OP_LIST.indexOf(e.op) === -1) return rec.item + ": unknown operator";
        var key = entryKey(e);
        if (seen[key] && !allowsRepeat(rec)) return rec.item + ": lists the same spec twice";
        seen[key] = true;
      }
    }
    return null;
  }

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
    if (skip !== "phase" && state.phase &&
        phaseZones(state.phase).indexOf(rec.zone) === -1) return false;
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
      if (state.classes.length && !selectionHas(rec) && !unsourcedBis(rec)) return false;
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
        if (skip !== "type" && state.type && typeGroup(rec) !== state.type) return false;
    }

    if (state.q) {
      var q = state.q.toLowerCase();
      /* search both the raw and displayed forms, so "2H mace" and "mace" both hit */
      var hay = [rec.item, rec.boss, rec.zone, priorityText(effectivePriority(rec)), rec.notes,
                 rec.slot, slotGroup(rec.slot), rec.type, typeLabel(rec), (rec.roles || []).join(" "),
                 rec.unsourced ? UNSOURCED_TAG : ""]
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
    if (state.phase) p.set("phase", state.phase);
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
    if (state.type) p.set("type", state.type);
    if (state.slot) p.set("slot", state.slot);
    if (state.q) p.set("q", state.q);
    if (state.sort) p.set("sort", state.sort + (state.dir === "desc" ? ":desc" : ""));
    var s = p.toString();
    /* Keep location.search. This used to rebuild from pathname alone, which silently
       dropped any query string - and the one that matters is `?code=` coming back from
       an OAuth redirect. update() runs at boot before the SDK has finished loading, so
       dropping it here deleted Discord's answer before anything could read it, and
       sign-in appeared to do nothing at all. Nothing else on this site uses the query
       string, which is exactly why it went unnoticed. */
    var url = location.pathname + location.search + (s ? "#" + s : "");
    history.replaceState(null, "", url);
  }

  function readUrl() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ""));
    var phase = p.get("phase") || "";
    state.phase = phaseZones(phase).length ? phase : defaultPhase();
    state.zone = p.get("zone") || "";
    /* a zone outside the chosen phase would leave the row showing nothing selected */
    if (state.phase && state.zone && phaseZones(state.phase).indexOf(state.zone) === -1) {
      state.zone = "";
    }
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
      /* The label is wrapped rather than left as a bare text node because the boss
         rail hides the name and keeps the count, and a text node cannot be hidden.
         textContent is unchanged either way.

         The fallback if the CDN stops serving a portrait is the same one the
         icon-only branch uses: replace the img with the name, rather than just
         hiding it. In the rail the name is hidden, so hiding the image too would
         leave an empty cell you could still click. */
      b.innerHTML =
        (icon ? '<img class="chip-icon" src="' + escapeHtml(icon) +
                '" alt="" onerror="this.replaceWith(document.createTextNode(this.parentNode.dataset.tip || \'\'))">' : "") +
        '<span class="chip-label">' + escapeHtml(label) + "</span>" +
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

  /* The top of the where-hierarchy. Nothing below it renders until one is picked,
     which is what stops the panel opening as 3 zone chips and 17 boss chips. */
  /* ---------- art tiles ----------
     Phase and zone are both "where am I", so they share a language: art behind, label
     over it, count in the corner, dim until picked. They are deliberately not the same
     size - a phase tile is twice a zone tile - because that difference is what says
     which one is above the other. One builder, two skins. */
  function artChip(opts) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip chip--art " + opts.cls;
    b.setAttribute("aria-pressed", opts.active ? "true" : "false");

    /* one strip per image, so a phase covering three raids shows three. A zone passes
       one and gets the same treatment for free. */
    var art = document.createElement("div");
    art.className = "art-split";
    (opts.images || []).forEach(function (src) {
      var img = document.createElement("img");
      img.src = src;
      img.alt = "";
      /* the tile still reads as itself if the CDN ever stops serving these */
      img.setAttribute("onerror", "this.style.display='none'");
      art.appendChild(img);
    });
    b.appendChild(art);

    var label = document.createElement("span");
    label.className = "art-label";
    label.textContent = opts.label;
    b.appendChild(label);

    /* No count on the face of a tile. The number is noise where the art is doing the
       work, and "N of 195 items" above the table already answers it. It stays in the
       aria-label, where it costs nothing and is the only way a screen reader gets it. */
    b.dataset.tip = opts.tip;
    b.setAttribute("aria-label", opts.ariaLabel || opts.tip);
    return b;
  }

  /* A phase is the one control you set and leave, so it earns the most room, and the
     raid art says which tier you are in faster than the words do.

     The strips use the same ui-ej-boss-* portraits as every other chip rather than the
     sharper 256x128 instance tiles: there is no instance tile for Serpentshrine or
     Hyjal, so those phases could only ever have shown one of their raids. */
  function phaseChip(ph, active, count) {
    var zones = ph.zones.map(function (z) { return zoneLabel(z); }).join(", ");
    return artChip({
      cls: "chip--phase",
      active: active,
      label: ph.label,
      count: count,
      images: phaseRaids(ph.id).map(function (z) { return ZONE_ICON[z]; }),
      tip: ph.label + " — " + zones,
      ariaLabel: ph.label + ", " + count + " items: " + zones
    });
  }

  /* A zone is the same idea one level down, at half the size. */
  function zoneChip(z, active, count) {
    /* A crafted zone is pictured by a square item icon rather than a 2:1 Encounter
       Journal portrait, so cover-cropping it into a wide tile throws most of it away.
       Having no BOSS_ORDER entry is the test, not the name - the same rule the phase
       tiles use to decide which zones get an art strip - so a future crafted-style
       zone gets this for free. */
    var cls = "chip--zone" + (BOSS_ORDER[z] ? "" : " chip--emblem");
    return artChip({
      cls: cls,
      active: active,
      label: zoneLabel(z),
      count: count,
      images: [ZONE_ICON[z]],
      tip: zoneLabel(z),
      ariaLabel: zoneLabel(z) + ", " + count + " items"
    });
  }

  function renderPhaseChips() {
    if (!el.phaseChips) return;
    var counts = countBy("phase", function (r) {
      for (var i = 0; i < PHASES.length; i++) {
        if (PHASES[i].zones.indexOf(r.zone) !== -1) return PHASES[i].id;
      }
      return "";
    });
    el.phaseChips.innerHTML = "";

    /* No All chip: a phase is a mode, not a filter. Which tier you are gearing for is
       true for the whole tier, where everything else on this panel is answered per
       lookup - so it is set once and always set, and there is no "every phase" to
       return to. */
    PHASES.forEach(function (ph) {
      var c = phaseChip(ph, state.phase === ph.id, counts[ph.id] || 0);
      c.addEventListener("click", function () {
        if (state.phase === ph.id) return;      /* clicking the current one is a no-op */
        state.phase = ph.id;
        /* the zone and boss below it belonged to the phase you just left */
        state.zone = ""; state.boss = ""; state.bossZone = "";
        update();
      });
      el.phaseChips.appendChild(c);
    });
  }

  function renderZoneChips() {
    var counts = countBy("zone", function (r) { return r.zone; });
    el.zoneChips.innerHTML = "";

    var all = allChip("zones", !state.zone);
    all.addEventListener("click", function () {
      /* every zone in this phase - the phase itself stays picked */
      state.zone = ""; state.boss = ""; state.bossZone = "";
      update();
    });
    el.zoneChips.appendChild(all);

    phaseZones(state.phase).forEach(function (z) {
      var c = zoneChip(z, state.zone === z, counts[z] || 0);
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
    /* no zone, no boss list: without one this is every boss of the phase at once,
       which is the wall the hierarchy exists to avoid */
    if (el.bossRow) el.bossRow.hidden = !state.zone;
    if (!state.zone) return;

    var zones = state.zone ? [state.zone] : phaseZones(state.phase);

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
        var n = counts[bossKey(z, b)] || 0;
        /* No count on the face of a rail portrait, for the same reason the phase and
           zone tiles don't carry one: the number is clutter where the art is doing
           the work, and the "N of 195 items" line above the table already answers it.
           It survives in the aria-label, exactly as it does on the tiles - which is
           the only way a screen reader gets it, and costs nothing on screen.

           The name has to be carried somewhere too, now that the face shows neither.
           data-tip is the instant tooltip (a title attribute has a browser delay that
           can't be turned off); the aria-label is what a screen reader gets, since a
           display:none label is out of the accessible name. */
        var c = chip(bossLabel(b), active, null, null, BOSS_ICON[b]);
        c.dataset.tip = bossLabel(b);
        c.setAttribute("aria-label", bossLabel(b) + ", " + n + " items");
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

  /* ---------- the editor ----------
     Every action has a keyboard form as well as a pointer one. That is partly
     accessibility and partly how the editor is testable at all: jsdom can dispatch a
     keydown but cannot drag. */

  var editMsg = "";        /* why the last edit was refused, shown under the toolbar */

  var toastTimer = null;

  /* Same role="status" element and the same call sites it always had - only where it
     sits has changed. It used to live inside the template bar, so every message pushed
     the buttons along as it appeared and changed length; now it is a toast that affects
     no layout at all.

     `undo` is optional and is what lets the delete confirm stay light: an undo is worth
     more than any confirm, and the deleted record is held in the closure until the
     toast clears. */
  function announce(msg, undo) {
    editMsg = msg || "";
    if (!el.editMsg) return;
    clearTimeout(toastTimer);
    el.editMsg.innerHTML = "";
    if (!editMsg) { el.editMsg.hidden = true; return; }

    var text = document.createElement("span");
    text.textContent = editMsg;
    el.editMsg.appendChild(text);

    if (undo) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "toast-undo";
      b.textContent = "Undo";
      b.addEventListener("click", function () { announce(""); undo(); });
      el.editMsg.appendChild(b);
    }

    el.editMsg.hidden = false;
    /* An undo needs longer than a status line, and neither should stay forever. */
    toastTimer = setTimeout(function () { announce(""); }, undo ? 12000 : 6000);
  }

  /* ---------- dragging ----------
     Pointer events rather than HTML5 drag-and-drop: these icons live in a
     table-layout: fixed cell, where HTML5 DnD drop targets are unreliable. Every
     gesture here has the keyboard equivalent above, which is what the tests drive. */

  var DRAG_SLOP = 4;      /* px of movement before a press counts as a drag, not a click */

  /* Which gap the pointer is in: 0 is before the first icon, n after the last. */
  function dropSlot(td, clientX) {
    var icons = td.querySelectorAll(".prio-edit");
    for (var i = 0; i < icons.length; i++) {
      var r = icons[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return icons.length;
  }

  function clearDrops() {
    var marked = el.results.querySelectorAll(".prio-drop, .prio-drop-after, .prio-drop-empty");
    [].forEach.call(marked, function (n) {
      n.classList.remove("prio-drop");
      n.classList.remove("prio-drop-after");
      n.classList.remove("prio-drop-empty");
    });
  }

  /* Show the gap the icon would land in by marking the icon that follows it. A line
     with no icons has nothing to mark, so the cell itself becomes the target - which
     is every row of a list you have only just started. */
  function markSlot(td, slot) {
    var icons = td.querySelectorAll(".prio-edit");
    if (!icons.length) { td.classList.add("prio-drop-empty"); return; }
    var mark = icons[slot];
    if (mark) mark.classList.add("prio-drop");
    else icons[icons.length - 1].classList.add("prio-drop-after");
  }

  /* A half-size copy of the icon that follows the pointer. */
  function makeGhost(node, e) {
    var g = node.cloneNode(true);
    g.className = "drag-ghost";
    document.body.appendChild(g);
    moveGhost(g, e);
    return g;
  }
  function moveGhost(g, e) {
    g.style.left = e.clientX + "px";
    g.style.top = e.clientY + "px";
  }

  /* Shared press-drag-release plumbing. onDrop gets the pointer event. */
  function onDrag(node, opts) {
    node.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var startX = e.clientX, startY = e.clientY, ghost = null;

      function move(ev) {
        if (!ghost) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_SLOP) return;
          ghost = makeGhost(node, ev);
          node.classList.add("prio-dragging");
          if (node.setPointerCapture) node.setPointerCapture(ev.pointerId);
        }
        moveGhost(ghost, ev);
        clearDrops();
        opts.over(ev);
      }
      function done(ev) {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", done);
        window.removeEventListener("pointercancel", done);
        if (!ghost) return;                      /* it was a click; leave that to click */
        ghost.parentNode.removeChild(ghost);
        node.classList.remove("prio-dragging");
        clearDrops();
        ev.preventDefault();
        /* The browser took the gesture off us - a native image drag is how that used
           to happen, and it swallowed every drop without a word. Abandoning is right;
           doing it in silence is what hid the bug. */
        if (ev.type === "pointercancel") {
          if (window.console) console.warn("drag cancelled by the browser, drop abandoned");
          return;
        }
        opts.drop(ev);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", done);
      window.addEventListener("pointercancel", done);
    });
  }

  /* The editable cell under the pointer, if any. */
  function cellUnder(e) {
    var n = document.elementFromPoint(e.clientX, e.clientY);
    return n && n.closest ? n.closest(".col-prio--editing") : null;
  }

  /* One icon inside an editable line. */
  function editableIcon(rec, list, index, resolved, entry) {
    var wrap = document.createElement("span");
    wrap.className = "prio-edit";
    wrap.tabIndex = 0;
    wrap.dataset.index = String(index);
    wrap.setAttribute("role", "listitem");
    wrap.setAttribute("aria-label",
      resolved.name + ", position " + (index + 1) + " of " + list.length +
      ". Left and right arrows move, Delete removes, Enter changes the operator.");

    var mark = bisMark(resolved, rec.id);
    wrap.appendChild(specIcon(resolved, mark.tier, mark.specs));

    var x = document.createElement("button");
    x.type = "button";
    x.className = "prio-x";
    x.textContent = "×";
    x.tabIndex = -1;                    /* the wrapper is the tab stop, Delete removes */
    x.setAttribute("aria-hidden", "true");
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      applyEdit(rec, removeEntry(list, index));
      update();
    });
    wrap.appendChild(x);

    wrap.addEventListener("keydown", function (e) {
      var handled = true;
      if (e.key === "ArrowLeft") applyEdit(rec, moveEntry(list, index, index - 1));
      else if (e.key === "ArrowRight") applyEdit(rec, moveEntry(list, index, index + 1));
      else if (e.key === "Delete" || e.key === "Backspace") applyEdit(rec, removeEntry(list, index));
      else if (e.key === "Enter" || e.key === " ") applyEdit(rec, cycleOp(list, index));
      else handled = false;
      if (!handled) return;
      e.preventDefault();
      announce("");
      update();
      /* keep the moved icon focused so arrows can be held down */
      var sel = "tr[data-id='" + rec.id + "'] .prio-edit";
      var all = el.results.querySelectorAll(sel);
      var want = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : index;
      var next = all[Math.max(0, Math.min(all.length - 1, want))];
      if (next) next.focus();
    });

    /* Drag to reorder. Dropping anywhere but on a line does nothing: taking an icon
       off is the x and the Delete key, both deliberate. Dragging clear of the row
       used to remove it, which fired by accident more often than on purpose. */
    onDrag(wrap, {
      over: function (ev) {
        var td = wrap.parentNode;
        if (cellUnder(ev) === td) markSlot(td, dropSlot(td, ev.clientX));
      },
      drop: function (ev) {
        var td = wrap.parentNode;
        if (cellUnder(ev) !== td) return;      /* dropped off its line: it goes home */
        var slot = dropSlot(td, ev.clientX);
        applyEdit(rec, moveEntry(list, index, slot > index ? slot - 1 : slot));
        announce("");
        update();
      }
    });

    return wrap;
  }

  /* The editable form of a priority cell: same icons, plus handles. */
  function editablePriorityCell(rec) {
    var td = document.createElement("td");
    td.className = "col-prio col-prio--editing";
    td.setAttribute("role", "list");
    var list = effectivePriority(rec) || [];

    list.forEach(function (entry, i) {
      if (i > 0) {
        var op = OPERATORS[entry.op] || OPERATORS[">"];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "prio-op prio-op--editing";
        btn.textContent = entry.op || ">";
        btn.dataset.tip = op.label + " - click to change";
        btn.setAttribute("aria-label", op.label + ", click to change");
        btn.setAttribute("aria-haspopup", "true");
        btn.addEventListener("click", function () {
          openOpMenu(rec, list, i, btn);
        });
        td.appendChild(btn);
      }
      var resolved = resolveEntry(entry);
      if (!resolved) return;
      td.appendChild(editableIcon(rec, list, i, resolved, entry));
    });

    var add = document.createElement("button");
    add.type = "button";
    add.className = "prio-add";
    add.textContent = "+";
    add.dataset.tip = "Add a spec - click one, or drag it onto a line";
    add.setAttribute("aria-label", "Add a spec to " + rec.item);
    add.addEventListener("click", function (e) {
      e.stopPropagation();
      openPop(rec, add);
    });
    td.appendChild(add);

    if (activeTemplate && rec.priority && rec.priority.length) {
      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "prio-reset";
      reset.textContent = "↺";
      reset.dataset.tip = "Back to zatar's order";
      reset.setAttribute("aria-label", "Reset " + rec.item + " to the guide's order");
      reset.addEventListener("click", function () { resetItem(rec); update(); });
      td.appendChild(reset);
    }

    return td;
  }

  /* ---------- the add popover ----------
     Every class and spec, opened from the + on a row. One element, created lazily and
     parented to <body> like the tooltip is: inside a table-layout: fixed cell with a
     horizontal scroll container it would be clipped.

     Each icon does two things. Clicking adds it to the row the popover was opened on;
     dragging drops it into a chosen gap on ANY row, because cellUnder() resolves
     whatever is under the pointer and does not care where the drag began. */

  var pop = null;          /* the element */
  var popFor = null;       /* the record it was opened on */
  var popQuery = "";

  /* Sit an overlay under its anchor, flipping above when there is no room below and
     clamping to the viewport. Shared by the add popover and the operator menu, which
     otherwise drift into two subtly different versions of the same arithmetic. */
  function placeUnder(node, anchor) {
    var r = anchor.getBoundingClientRect();
    var n = node.getBoundingClientRect();
    var left = r.left;
    var top = r.bottom + 6;
    if (top + n.height > document.documentElement.clientHeight - 4) {
      top = Math.max(4, r.top - n.height - 6);
    }
    var maxLeft = document.documentElement.clientWidth - n.width - 6;
    if (left > maxLeft) left = maxLeft;
    if (left < 6) left = 6;
    node.style.left = Math.round(left) + "px";
    node.style.top = Math.round(top) + "px";
  }

  function closePop() {
    popFor = null;
    popQuery = "";
    if (pop) pop.style.display = "none";
  }

  /* ---------- the operator menu ----------
     Clicking the operator between two icons used to step to the next one, so the
     five were a cycle and "~=" was four clicks away. It picks directly now. Same
     element-per-page, anchor-under, click-outside shape as the add popover. */

  var opMenu = null;
  var opMenuFor = null;      /* { rec, list, index } while it is open */

  function closeOpMenu() {
    opMenuFor = null;
    if (opMenu) opMenu.style.display = "none";
  }

  function buildOpMenu() {
    opMenu = document.createElement("div");
    opMenu.className = "prio-menu";
    opMenu.setAttribute("role", "menu");
    opMenu.setAttribute("aria-label", "Choose an operator");
    opMenu.style.display = "none";

    OP_LIST.forEach(function (op) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "prio-menu-item";
      b.dataset.op = op;
      b.setAttribute("role", "menuitemradio");

      var sym = document.createElement("span");
      sym.className = "prio-menu-op";
      sym.textContent = op;
      var label = document.createElement("span");
      label.className = "prio-menu-label";
      label.textContent = OPERATORS[op].label;
      b.appendChild(sym);
      b.appendChild(label);

      b.addEventListener("click", function () {
        if (!opMenuFor) return;
        var at = opMenuFor;
        applyEdit(at.rec, setOp(at.list, at.index, op));
        announce(resolveEntry(at.list[at.index]).name + " is now " + OPERATORS[op].label);
        closeOpMenu();
        update();
      });

      opMenu.appendChild(b);
    });

    opMenu.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeOpMenu(); }
    });

    document.body.appendChild(opMenu);
  }

  function openOpMenu(rec, list, index, anchor) {
    if (!canEdit()) return;
    if (!opMenu) buildOpMenu();
    closePop();                       /* only one overlay at a time */
    opMenuFor = { rec: rec, list: list, index: index };

    var current = list[index] && list[index].op;
    var items = opMenu.querySelectorAll(".prio-menu-item");
    for (var i = 0; i < items.length; i++) {
      var on = items[i].dataset.op === current;
      items[i].setAttribute("aria-checked", on ? "true" : "false");
      items[i].classList.toggle("is-current", on);
    }

    opMenu.style.display = "block";
    placeUnder(opMenu, anchor);

    var pick = opMenu.querySelector(".prio-menu-item.is-current") || items[0];
    if (pick) pick.focus();
  }

  /* Put entry into rec at slot, or refuse and say why. */
  function place(rec, entry, resolved, slot) {
    var list = effectivePriority(rec) || [];
    var why = rejectReason(rec, list, entry, -1);
    if (why) { announce(resolved.name + ": " + why); return false; }
    applyEdit(rec, addEntry(list, entry, slot));
    announce(resolved.name + " added to " + rec.item);
    update();
    return true;
  }

  /* Every pickable entry once: each class, then its specs. */
  /* Everything pickable, narrowed to what the item suits unless smart filtering is
     off. A class is offered when any of its specs is, matching how a class icon
     already answers for the specs behind it. */
  function pickableEntries(rec) {
    var out = [];
    var smart = rec && smartFilter();

    Object.keys(REG.classes).forEach(function (clsId) {
      if (smart && !classSuitsItem(rec, clsId)) return;
      out.push({ clsId: clsId, entry: { "class": clsId } });
      (CLASS_SPECS[clsId] || []).forEach(function (id) {
        if (smart && !suitsItem(rec, id)) return;
        out.push({ clsId: clsId, entry: { spec: id } });
      });
    });
    return out.filter(function (e) { return !!resolveEntry(e.entry); });
  }

  function buildPop() {
    pop = document.createElement("div");
    pop.className = "prio-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Add a spec");

    var field = document.createElement("input");
    field.type = "search";
    field.className = "prio-pop-find";
    field.placeholder = "Type to narrow, Enter to take the first";
    field.setAttribute("aria-label", "Find a class or spec");
    pop.appendChild(field);

    var body = document.createElement("div");
    body.className = "prio-pop-body";
    pop.appendChild(body);

    /* the escape hatch from smart filtering, in the popover rather than on the bar:
       it is a decision about this pick, made where the picking happens */
    var foot = document.createElement("button");
    foot.type = "button";
    foot.className = "prio-pop-foot";
    foot.addEventListener("click", function () {
      setSmartFilter(!smartFilter());
      fillPop();
      pop.querySelector(".prio-pop-find").focus();
    });
    pop.appendChild(foot);

    document.body.appendChild(pop);

    field.addEventListener("input", function () {
      popQuery = field.value.trim().toLowerCase();
      fillPop();
    });

    field.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closePop(); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      var first = pop.querySelector(".prio-pop-icon");
      if (first) first.click();
    });

    pop.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closePop(); }
    });

    return pop;
  }

  function fillPop() {
    var body = pop.querySelector(".prio-pop-body");
    body.innerHTML = "";

    var groups = {};
    var order = [];
    var shown = 0;

    pickableEntries(popFor).forEach(function (e) {
      var resolved = resolveEntry(e.entry);
      if (popQuery && resolved.name.toLowerCase().indexOf(popQuery) === -1) return;
      if (!groups[e.clsId]) {
        groups[e.clsId] = document.createElement("span");
        groups[e.clsId].className = "prio-pop-group";
        order.push(e.clsId);
      }
      groups[e.clsId].appendChild(popIcon(e.entry, resolved));
      shown++;
    });

    order.forEach(function (id) { body.appendChild(groups[id]); });
    if (!shown) {
      var none = document.createElement("p");
      none.className = "prio-pop-none";
      none.textContent = "Nothing matches that.";
      body.appendChild(none);
    }

    /* Never hide silently: say how many are missing and offer them back. Turning it
       off is how you build something the rules do not expect - a healing warrior. */
    var foot = pop.querySelector(".prio-pop-foot");
    var hidden = popFor ? pickableEntries(null).length - pickableEntries(popFor).length : 0;
    foot.textContent = smartFilter() ? "Show all specs" : "Show only what suits";
    /* nothing to reveal on an item that suits everyone, so the control goes away
       rather than sitting there doing nothing */
    foot.hidden = smartFilter() && !hidden;
  }

  function popIcon(entry, resolved) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "prio-pop-icon";
    b.dataset.tip = resolved.name;
    b.setAttribute("aria-label", "Add " + resolved.name);
    b.appendChild(specIcon(resolved, 0));

    /* click: onto the row this was opened on, at the end of its line */
    b.addEventListener("click", function () {
      if (!popFor) return;
      if (place(popFor, entry, resolved, null)) closePop();
    });

    /* drag: onto whichever row you drop it on, in the gap you drop it in */
    onDrag(b, {
      over: function (ev) {
        var td = cellUnder(ev);
        if (td) markSlot(td, dropSlot(td, ev.clientX));
      },
      drop: function (ev) {
        var td = cellUnder(ev);
        if (!td) { announce("Drop it on a row to add it there"); return; }
        var rec = recordFor(td.parentNode.dataset.id);
        if (!rec) return;
        if (place(rec, entry, resolved, dropSlot(td, ev.clientX))) closePop();
      }
    });

    return b;
  }

  function recordFor(id) {
    return ALL.filter(function (r) { return String(r.id) === String(id); })[0];
  }

  /* Anchored under the + that opened it, clamped into the viewport the same way the
     tooltip is. */
  function openPop(rec, anchor) {
    if (!canEdit()) return;
    if (!pop) buildPop();
    popFor = rec;
    popQuery = "";
    pop.setAttribute("aria-label", "Add a spec to " + rec.item);
    pop.querySelector(".prio-pop-find").value = "";
    pop.style.display = "block";
    fillPop();

    placeUnder(pop, anchor);
    pop.querySelector(".prio-pop-find").focus();
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

    /* These 13 rows are real T6 loot the source guide never mentions, found by
       auditing the BiS guides against this dataset. They are worth listing, but
       the whole point of the site is that the priorities are one person's calls -
       so a row carrying none of his has to say so rather than read as an item he
       had no opinion on. */
    if (rec.unsourced) {
      var tag = document.createElement("span");
      tag.className = "item-tag";
      tag.textContent = UNSOURCED_TAG;
      tag.dataset.tip = "Not in the source guide - added from the Phase 3 BiS audit";
      td.appendChild(tag);
    }
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
    /* An <img> is draggable by default in every browser, and the browser's own image
       drag cancels the pointer sequence underneath it - which silently killed every
       drop in the editor. user-select: none does not cover this; only this does. */
    img.draggable = false;
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
    var list = effectivePriority(rec);

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
    /* one value, as it always was - the CSS hooks and the token matching expect a
       single word. The rest of the tags reach search through the haystack. */
    tr.dataset.role = (rec.roles || [])[0] || "";
    tr.dataset.id = String(rec.id);

    tr.appendChild(itemCell(rec));

    var slot = document.createElement("td");
    slot.className = "col-slot";
    slot.textContent = slotGroup(rec.slot);
    tr.appendChild(slot);

    var type = document.createElement("td");
    type.className = "col-type";
    var classes = tierClasses(rec);
    if (classes) {
      /* Icons only, no word: typeLabel() still returns text for sorting and
         search. Classes that don't satisfy the active type filter are dimmed, so
         it's clear which of the three put the token in these results. */
      var filtering = state.type !== "";
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

    tr.appendChild(canEdit() ? editablePriorityCell(rec) : priorityCell(rec));

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
      '<col class="c-prio"><col class="c-notes">' +
      "</colgroup>" +
      "<thead><tr>" +
      sortableTh("Item", "item") +
      sortableTh("Slot", "slot") +
      sortableTh("Type", "type") +
      "<th>Priority</th><th>Notes</th>" +
      "</tr></thead>";
    var tbody = document.createElement("tbody");
    sortRows(rows).forEach(function (r) { tbody.appendChild(renderRow(r)); });
    table.appendChild(tbody);
    scroll.appendChild(table);
    section.appendChild(scroll);

    return section;
  }

  /* Asked only on the no-results path, so walking 195 entries costs nothing. Narrowed
     to a class or spec filter because that is the only one an empty priority defeats:
     search still reads item names, notes and bosses. */
  /* True when the chosen phase has nothing in the dataset at all. Worth saying in its
     own words: with the phase locked there is no "all phases" to fall back to, so an
     empty phase is the whole page, and "no items match these filters" would send you
     hunting for a filter to clear that does not exist. */
  function phaseIsEmpty() {
    var zones = phaseZones(state.phase);
    return !ALL.some(function (r) { return zones.indexOf(r.zone) !== -1; });
  }

  function phaseLabel(id) {
    for (var i = 0; i < PHASES.length; i++) {
      if (PHASES[i].id === id) return PHASES[i].label;
    }
    return id;
  }

  function blankListFiltered() {
    if (!activeTemplate) return false;
    if (!state.classes.length && !state.specs.length) return false;
    var p = activeTemplate.priorities;
    return Object.keys(p).every(function (k) { return !p[k] || !p[k].length; });
  }

  function renderResults() {
    var rows = filtered();
    el.count.textContent = rows.length + " of " + ALL.length + " items";
    el.results.innerHTML = "";

    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      /* A list you have only just started names nobody, so the class and spec chips
         all read zero. That is honest - the filter reflects the list in front of you
         - but it must say so rather than looking broken. */
      empty.textContent = phaseIsEmpty()
        ? phaseLabel(state.phase) + " isn't in the dataset yet - its bosses are listed, "
          + "but no loot has been added to them."
        : blankListFiltered()
          ? "This list is empty so far, so there is nobody for the class and spec "
            + "filters to find. Press Edit and add specs to a row, or clear the filters "
            + "to see every item."
          : "No items match these filters.";
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
    indexSelection();
    renderTemplateBar();
    renderPhaseChips();
    renderZoneChips();
    renderBossChips();
    renderClassChips();
    renderSpecChips();
    renderSelects();
    renderResults();
    writeUrl();
  }

  /* ---------- the list bar ----------

     [ List v ] [ name____ ]  New  Make a copy  Edit  Copy link  Delete

     What it offers follows what is on screen. zatar's list, and a list that arrived
     on a link, are someone else's work: they get New and Make a copy and nothing
     more. The rest appears once a list of your own is open. No browser dialogs -
     naming, opening and deleting all happen in the page. */

  var savedLists = [];        /* store.list() is async; this is its cached answer */

  /* ---------- signing in ----------
     Discord only. Every raider has one, it is the easiest of the three OAuth flows,
     and Supabase implements the token exchange - so the two places a project this size
     usually grows a security hole (the exchange, and "can this user read this row")
     are both somebody else's tested code rather than ours. */

  var RETURN_KEY = "lootprio.returnTo";

  /* Come back to the page you left, not to the site root - the phase, zone and filters
     all live in the hash, and losing them across a login is a small betrayal that is
     entirely avoidable.

     The hash cannot simply ride along in redirectTo: Supabase appends `?code=` to that
     URL, and a query has to sit before a fragment, so a redirectTo that already ends in
     one composes into nonsense. Park it instead, and put it back on the way in. */
  function stashReturn() {
    try { window.sessionStorage.setItem(RETURN_KEY, location.hash); }
    catch (e) { /* private browsing: you lose your filters, not your sign-in */ }
  }

  function restoreReturn() {
    var h = "";
    try {
      h = window.sessionStorage.getItem(RETURN_KEY) || "";
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch (e) { return false; }
    if (!h || h === location.hash) return false;
    history.replaceState(null, "", location.pathname + location.search + h);
    readUrl();
    return true;
  }

  function signIn() {
    if (!supabaseReady()) { announce("Sign-in is unavailable right now."); return; }
    stashReturn();
    sb.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: location.origin + location.pathname }
    }).then(function (res) {
      if (res && res.error) announce("Could not sign in: " + res.error.message);
    });
  }

  /* ---------- the account menu ----------
     The third overlay on this page, and built like the other two: created once,
     parented to <body> so no scroll container can clip it, positioned by placeUnder()
     rather than by arithmetic of its own, and closed by Escape or a click away. */

  var acctMenu = null;

  function closeAcctMenu() {
    if (acctMenu) acctMenu.style.display = "none";
    if (el.account) el.account.setAttribute("aria-expanded", "false");
  }

  function buildAcctMenu() {
    acctMenu = document.createElement("div");
    acctMenu.className = "acct-menu";
    acctMenu.setAttribute("role", "menu");
    acctMenu.setAttribute("aria-label", "Account");
    acctMenu.style.display = "none";

    /* Who you are, stated rather than actionable - the button that opened this shows a
       name, and a menu whose first line repeats it without saying what it is reads as a
       thing you should click. */
    var who = document.createElement("div");
    who.className = "acct-who";
    var w1 = document.createElement("span");
    w1.className = "acct-who-label";
    w1.textContent = "Signed in as";
    var w2 = document.createElement("span");
    w2.className = "acct-who-name";
    who.appendChild(w1);
    who.appendChild(w2);
    acctMenu.appendChild(who);

    var out = document.createElement("button");
    out.type = "button";
    out.className = "acct-item";
    out.setAttribute("role", "menuitem");
    out.textContent = "Sign out";
    out.addEventListener("click", function () { closeAcctMenu(); signOut(); });
    acctMenu.appendChild(out);

    acctMenu.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeAcctMenu(); el.account.focus(); }
    });

    document.body.appendChild(acctMenu);
  }

  function toggleAcctMenu() {
    if (!acctMenu) buildAcctMenu();
    if (acctMenu.style.display === "block") { closeAcctMenu(); return; }
    closePop();                       /* only one overlay at a time */
    closeOpMenu();
    acctMenu.querySelector(".acct-who-name").textContent = accountName();
    acctMenu.style.display = "block";
    el.account.setAttribute("aria-expanded", "true");
    placeUnder(acctMenu, el.account);
    var first = acctMenu.querySelector(".acct-item");
    if (first) first.focus();
  }

  function signOut() {
    if (!supabaseReady()) return;
    closeAcctMenu();
    sb.auth.signOut().then(function () {
      /* Back to this browser's own lists. Nothing of theirs is deleted either side of
         the line: the account keeps its rows, localStorage keeps its own. */
      openTemplate(null, false);
      refreshLists();
    });
  }



  /* Wiring the session to the store. Runs on load and on every auth change, which is
     also how a redirect back from Discord is picked up - the SDK parses the URL,
     restores the session, and fires this. */
  /* The SDK is very often not there yet when this first runs, and the reason is worth
     writing down because it looks like it should be fine.

     app.js is a classic script at the end of <body>, so it executes *during* parsing.
     The SDK is deferred, so it executes *after* parsing. app.js therefore always runs
     first, and initAuth() is called from the data-fetch .then() - which over localhost
     resolves in a couple of milliseconds, long before 212KB has arrived from a CDN.

     So checking window.supabase once and giving up means the sign-in button never
     appears at all, on exactly the machine where you would be testing it. Wait for the
     tag instead. Checking the global first matters: if the script has already run, its
     load event has already fired and will never fire again. */
  function whenSupabaseReady(cb) {
    if (window.supabase) { cb(); return; }
    var tag = document.getElementById("supabase-sdk");
    /* absent by design - jsdom, or someone stripped the tag. Not an error. */
    if (!tag) return;
    tag.addEventListener("load", function () { if (window.supabase) cb(); });
    tag.addEventListener("error", function () {
      if (window.console) console.warn("sign-in unavailable: the Supabase SDK did not load");
    });
  }

  function initAuth() {
    if (!supabaseConfigured()) return;
    whenSupabaseReady(startAuth);
  }

  function startAuth() {
    try {
      /* PKCE puts the answer in `?code=`, where the implicit flow puts it in the hash
         fragment. This whole site drives its state from the hash, so the implicit flow
         would have us and Supabase writing to the same place on the same page load.
         Different storage, no collision, and a code in a query survives a redirect
         chain that a fragment does not. */
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true }
      });
    } catch (err) {
      if (window.console) console.warn("sign-in unavailable:", err.message);
      return;
    }

    sb.auth.onAuthStateChange(function (event, next) {
      var was = signedIn();
      session = next;
      syncStore();
      /* the lists on screen belonged to whoever was signed in a moment ago */
      if (was !== signedIn()) openTemplate(null, false);
      refreshLists();
      /* the filters you left behind, now that the round trip is over */
      if (!was && signedIn() && restoreReturn()) update();
      renderTemplateBar();
    });

    sb.auth.getSession().then(function (res) {
      session = (res && res.data && res.data.session) || null;
      syncStore();
      refreshLists();
      renderTemplateBar();
    });
  }
  var nameTimer = null;
  var SHARED_VALUE = "__shared__";   /* template ids are t+base36, so no collision */

  /* Refreshes the dropdown's contents. Renders the bar directly and never calls
     update(), which is what calls renderTemplateBar in the first place. */
  function refreshLists() {
    return store.list().then(function (all) {
      savedLists = all;
      renderTemplateBar();
    }, function () { savedLists = []; });
  }

  /* The one place the view changes. Editing never survives it: a list opens for
     reading, and you say when you want to change it. */
  function openTemplate(t, mine) {
    activeTemplate = t;
    activeIsMine = !!mine;
    unsaved = false;
    state.editing = false;
    closePop();
    closeOpMenu();
    clearTimeout(nameTimer);
    if (el.tplLinkOut) el.tplLinkOut.hidden = true;
  }

  function showZatar() { openTemplate(null, false); }

  function option(value, label) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function show(node, on) {
    if (node) node.hidden = !on;
  }

  /* Two controls, in every state. The bar's old defect was that it reflowed: opening a
     list of your own unhid four more buttons at once and everything jumped sideways.
     Nothing here hides, so nothing moves. */
  function renderTemplateBar() {
    if (!el.listTrigger) return;

    el.listTriggerName.textContent =
      activeTemplate ? activeTemplate.name : "zatar's list";

    /* Disabled, never hidden, and the title says what to do about it - a control that
       vanishes teaches nothing. Weight stays constant across both states and the button
       has a min-width, because a weight flip alone moves the row about a pixel, which
       is the same defect this whole rewrite exists to remove. */
    el.editToggle.disabled = !activeIsMine;
    el.editToggle.title = activeIsMine ? "" : "Make a copy to edit";
    el.editToggle.setAttribute("aria-pressed", state.editing ? "true" : "false");
    el.editToggle.textContent = state.editing ? "Done editing" : "Edit priorities";

    /* Three signals for the armed state, because a mode that changes what a click does
       should be impossible to be in without noticing: the button fills, the bar it sits
       in tints, and a line of fixed text says so. The class is what carries the second
       and, through it, the wash on the editable rows. */
    if (el.refine) el.refine.classList.toggle("is-editing", !!state.editing);
    show(el.editHint, !!state.editing);

    show(el.tplDirty, activeIsMine && unsaved);

    /* No sign-in button at all when it could not work - an unconfigured project or a
       blocked CDN should read as "this site has no accounts", not as a broken button. */
    show(el.signIn, supabaseReady() && !signedIn());
    show(el.account, supabaseReady() && signedIn());

    if (signedIn()) {
      if (el.accountName) el.accountName.textContent = accountName();
      renderAvatar();
    } else {
      closeAcctMenu();
    }

    if (listMenu && listMenu.style.display === "block") renderListMenu();
  }


  /* ---------- the list menu ----------
     The third overlay built on the same machinery as .prio-pop and .prio-menu: created
     once, parented to <body> so no scroll container can clip it, positioned by
     placeUnder() rather than by arithmetic of its own, closed by Escape or a click
     away. docs/edit-mode-plan.md extracted placeUnder() precisely so overlays could not
     drift into two versions of the same sum; this must not become the version that does.

     It has three faces - the list, the rename field, the delete confirm - because a
     panel that swaps in place keeps one Escape target and one anchor. */

  var listMenu = null;
  var menuFace = "list";      /* "list" | "rename" | "delete" */

  function closeListMenu() {
    if (listMenu) listMenu.style.display = "none";
    menuFace = "list";
    if (el.listTrigger) el.listTrigger.setAttribute("aria-expanded", "false");
  }

  function buildListMenu() {
    listMenu = document.createElement("div");
    listMenu.className = "list-menu";
    listMenu.setAttribute("role", "menu");
    listMenu.setAttribute("aria-label", "Lists");
    listMenu.style.display = "none";

    /* One level at a time: Escape out of rename or delete returns to the list, and only
       Escape from the list closes the menu. A mistyped rename should not cost you the
       menu as well. */
    listMenu.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (menuFace !== "list") { menuFace = "list"; renderListMenu(); return; }
      closeListMenu();
      el.listTrigger.focus();
    });

    document.body.appendChild(listMenu);
  }

  function menuSection(title) {
    var h = document.createElement("div");
    h.className = "lm-section";
    h.textContent = title;
    return h;
  }

  function menuItem(label, cls, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "lm-item" + (cls ? " " + cls : "");
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /* A list row: the name, what it holds, and a tick on the one you are reading. The
     count is what confirms you picked the right list - the same argument that keeps
     counts on the boss chips. */
  function listRow(name, count, current, byline, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "lm-row" + (current ? " lm-row--current" : "");
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", current ? "true" : "false");

    var tick = document.createElement("span");
    tick.className = "lm-tick";
    tick.textContent = current ? "\u2713" : "";
    tick.setAttribute("aria-hidden", "true");

    var main = document.createElement("span");
    main.className = "lm-row-main";
    var n = document.createElement("span");
    n.className = "lm-row-name";
    n.textContent = name;
    main.appendChild(n);
    if (byline) {
      var by = document.createElement("span");
      by.className = "lm-row-by";
      by.textContent = byline;
      main.appendChild(by);
    }

    var c = document.createElement("span");
    c.className = "lm-row-count";
    /* "ranked", not "items": every list holds all 195 records, so an item count is the
       same number on every row. This is the one that differs. */
    c.textContent = count == null ? "" : count + " ranked";

    b.appendChild(tick);
    b.appendChild(main);
    b.appendChild(c);
    b.addEventListener("click", onClick);
    return b;
  }

  function renderListMenu() {
    if (menuFace === "rename") return renderRenamePanel();
    if (menuFace === "delete") return renderDeletePanel();

    listMenu.innerHTML = "";

    if (savedLists.length) {
      listMenu.appendChild(menuSection("Your lists"));
      savedLists.forEach(function (t) {
        /* the open list is the one being edited, so take its count live rather than
           from the cache, which is only as fresh as the last write */
        var n = (activeIsMine && activeTemplate && activeTemplate.id === t.id)
          ? filledCount(activeTemplate.priorities) : t.filled;
        listMenu.appendChild(listRow(
          t.name, n,
          activeIsMine && activeTemplate && activeTemplate.id === t.id, "",
          function () { closeListMenu(); openById(t.id); }));
      });
    }

    listMenu.appendChild(menuSection("Following"));
    listMenu.appendChild(listRow("zatar's list", zatarFilled(), !activeTemplate, "by zatar",
      function () { closeListMenu(); showZatar(); announce("Showing zatar's list"); update(); }));
    /* a list that arrived on a link is not in the store, so it needs a row of its own or
       the menu would claim zatar's list was the one on screen */
    if (activeTemplate && !activeIsMine) {
      listMenu.appendChild(listRow(activeTemplate.name, filledCount(activeTemplate.priorities),
        true, "shared with you",
        function () { closeListMenu(); }));
    }

    listMenu.appendChild(document.createElement("hr"));
    listMenu.appendChild(menuItem("+  New list", "lm-item--new", function () {
      closeListMenu();
      startList(newBlankTemplate(), "A blank list - every priority is empty until you fill it in");
    }));

    listMenu.appendChild(document.createElement("hr"));
    listMenu.appendChild(menuSection(activeIsMine ? "This list" :
      activeTemplate ? "Following " + activeTemplate.name : "zatar's list"));

    /* Said once, plainly, instead of silently offering fewer buttons and leaving the
       reader to notice what is missing. */
    if (!activeIsMine) {
      var note = document.createElement("p");
      note.className = "lm-note";
      note.textContent = activeTemplate
        ? "You're following this list. Make a copy to change anything."
        : "zatar's calls, as published. Make a copy to build your own.";
      listMenu.appendChild(note);
    }

    if (activeIsMine) {
      listMenu.appendChild(menuItem("Rename\u2026", "", function () {
        menuFace = "rename"; renderListMenu();
      }));
    }
    listMenu.appendChild(menuItem("Make a copy", "", function () {
      closeListMenu();
      var from = activeTemplate ? activeTemplate.name : "zatar's list";
      startList(copyOfCurrent("Copy of " + from), "Copied " + from);
    }));
    listMenu.appendChild(menuItem("Copy link", "", function () {
      closeListMenu(); copyShareLink();
    }));

    if (activeIsMine) {
      listMenu.appendChild(document.createElement("hr"));
      listMenu.appendChild(menuItem("Delete list\u2026", "lm-item--danger", function () {
        menuFace = "delete"; renderListMenu();
      }));
    }
  }

  function renderRenamePanel() {
    listMenu.innerHTML = "";
    listMenu.appendChild(menuSection("Rename list"));

    var field = document.createElement("input");
    field.type = "text";
    field.className = "lm-field";
    field.value = activeTemplate ? activeTemplate.name : "";
    field.setAttribute("aria-label", "List name");
    listMenu.appendChild(field);

    var row = document.createElement("div");
    row.className = "lm-actions";
    row.appendChild(menuItem("Cancel", "", function () { menuFace = "list"; renderListMenu(); }));

    var save = menuItem("Save", "lm-item--primary", function () { commitRename(field.value); });
    row.appendChild(save);
    listMenu.appendChild(row);

    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commitRename(field.value); }
    });
    field.focus();
    field.select();
    placeUnder(listMenu, el.listTrigger);
  }

  /* The same path the old name field's blur used, so the dirty marker and the store
     write are unchanged - this is a bar rewrite, not a model change. */
  function commitRename(name) {
    if (!activeIsMine) return;
    var next = (name || "").trim();
    if (!next) { announce("A list needs a name"); return; }
    activeTemplate.name = next;
    unsaved = true;
    closeListMenu();
    announce("Renamed to " + next);
    update();
    saveNow().then(refreshLists);
  }

  function renderDeletePanel() {
    listMenu.innerHTML = "";
    listMenu.appendChild(menuSection("Delete list"));

    var p = document.createElement("p");
    p.className = "lm-note";
    var n = filledCount(activeTemplate.priorities);
    p.textContent = "Delete \u201c" + activeTemplate.name + "\u201d and the " + n +
      (n === 1 ? " item" : " items") + " you have ranked? Anyone you sent the link to will lose it.";
    listMenu.appendChild(p);

    var row = document.createElement("div");
    row.className = "lm-actions";
    /* The safe one sits where the cursor already is - under the row that was just
       clicked - and carries the weight; the destructive one is quiet and off to the
       right, so it has to be aimed at. The old bar armed the same button in place,
       which meant a double-click destroyed a list. */
    row.appendChild(menuItem("Keep it", "lm-item--primary", function () {
      menuFace = "list"; renderListMenu();
    }));
    row.appendChild(menuItem("Delete", "lm-item--danger", doDelete));
    listMenu.appendChild(row);
    placeUnder(listMenu, el.listTrigger);
  }

  function doDelete() {
    if (!activeIsMine) return;
    var doomed = activeTemplate;
    closeListMenu();
    store.remove(doomed.id).then(function () {
      showZatar();
      update();
      refreshLists();
      /* An undo is worth more than any confirm, which is why the confirm above can stay
         light. The record is held in memory until the toast clears. */
      announce("Deleted " + doomed.name, function () {
        store.save(doomed).then(function () {
          openTemplate(doomed, true);
          announce("Restored " + doomed.name);
          update();
          refreshLists();
        });
      });
    });
  }

  function toggleListMenu() {
    if (!listMenu) buildListMenu();
    if (listMenu.style.display === "block") { closeListMenu(); return; }
    closePop();
    closeOpMenu();
    closeAcctMenu();
    menuFace = "list";
    listMenu.style.display = "block";
    el.listTrigger.setAttribute("aria-expanded", "true");
    renderListMenu();
    placeUnder(listMenu, el.listTrigger);
  }

  function openById(id) {
    store.load(id).then(function (t) {
      var why = t ? validateTemplate(t) : "it is not there any more";
      if (why) { announce("That list will not open: " + why); renderTemplateBar(); return; }
      openTemplate(t, true);
      announce("Opened " + t.name);
      update();
    });
  }

  function copyShareLink() {
    if (!activeTemplate) return;
    encodeTemplate(activeTemplate).then(function (code) {
      var url = location.origin + location.pathname + "#t=" + code;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { announce("Link copied (" + url.length + " characters)"); },
          function () { offerLink(url); });
      } else {
        offerLink(url);
      }
    }, function (err) { announce(err.message); });
  }

  /* New and Make a copy differ only in what they seed. Both write the list at once,
     so it is in the dropdown from birth and there is nothing to forget to press. */
  function startList(t, said) {
    openTemplate(t, true);
    state.editing = true;      /* you made it in order to change it */
    announce(said);
    update();
    saveNow().then(refreshLists);
  }

  function bindTemplateBar() {
    if (!el.listTrigger) return;

    /* Both halves of the gesture have to be kept off the document handler, or the
       trigger's own mousedown closes the menu and its click reopens it - which looks
       like the menu ignoring every second press. */
    el.listTrigger.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    el.listTrigger.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleListMenu();
    });

    if (el.signIn) el.signIn.addEventListener("click", signIn);
    if (el.account) el.account.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleAcctMenu();
    });

    el.editToggle.addEventListener("click", function () {
      if (!activeIsMine) return;
      state.editing = !state.editing;
      if (!state.editing) { closePop(); closeOpMenu(); }
      announce("");
      update();
    });
  }

  /* No clipboard API, or it refused: the link goes in a field, selected, to be copied
     by hand. Anything rather than a grey browser box in the middle of the page. */
  function offerLink(url) {
    if (!el.tplLinkField) return;
    el.tplLinkField.value = url;
    el.tplLinkOut.hidden = false;
    el.tplLinkField.focus();
    el.tplLinkField.select();
    announce("Copy this link (" + url.length + " characters)");
  }

  /* A #t= link opens someone else's list. It is untrusted input, so it is validated
     before any of it reaches the table, and refused out loud if it does not hold up.
     It opens as reference, not as yours: Make a copy is how you keep it. */
  function loadSharedTemplate() {
    var m = /(?:^|&)t=([^&]+)/.exec(location.hash.replace(/^#/, ""));
    if (!m) return;
    decodeTemplate(decodeURIComponent(m[1])).then(function (doc) {
      var why = validateTemplate(doc);
      if (why) { announce("That shared list will not load: " + why); update(); return; }
      openTemplate({
        v: doc.v,
        id: "t" + Date.now().toString(36),
        name: doc.name || "Shared list",
        created: new Date().toISOString().slice(0, 10),
        base: doc.base || "zatar",
        priorities: doc.priorities
      }, false);
      announce("Opened shared list: " + activeTemplate.name + " - Make a copy to change it");
      update();
    }, function (err) {
      announce("That shared link did not work: " + err.message);
      update();
    });
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
    return fetch(BIS_URL, FRESH)
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
    return fetch(SPECS_URL, FRESH)
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
    fetch(DATA_URL, FRESH).then(function (res) {
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
        '<p class="empty error">Could not load <code>' + DATA_URL + "</code> (" + escapeHtml(err.message) +
        "). If you opened this file directly from disk, run a local server instead: " +
        "<code>python -m http.server</code></p>";
    });
})();
