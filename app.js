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
  var LISTS_URL = "data/lists/index.json";

  /* Encounter order per zone (the JSON is not in kill order). */
  /* Kill order per zone. The seven zones outside Phase 3 have no items yet, so their
     chips all read 0 - they are here so the phases open onto something real, and so a
     boss has a name to arrive under. Trash is listed for the raids that actually drop
     it; Gruul's Lair and Magtheridon's Lair get none, which is why they have none. */
  var BOSS_ORDER = {
    "Karazhan": [
      "Trash",
      /* Hyakiss, Rokad and Shadikith - three rare spawns in the Servant's Quarters,
         folded into one card. They are not Encounter Journal bosses and have no
         portrait art, so this chip falls back to text the way the Chess Event does.
         It sits beside Trash because neither has a place in a kill order. */
      "Basement",
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
      /* The timed chests come last: they reward the whole run rather than mark a step
         through it. Four chests folded into one source - three and four hold the same
         five rings, and the question is which source, not which chest. No portrait
         exists, which chip() handles by falling back to the name, as for the Chess Event. */
    "Zul'Aman": [
      "Trash",
      "Nalorakk",
      "Akil'zon",
      "Jan'alai",
      "Halazzi",
      "Hex Lord Malacrass",
      "Zul'jin",
      "Timed Chest"
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

  /* THE PHASE THE GAME IS CURRENTLY ON. Bump this by hand when a new one releases -
     roughly every six months - and nothing else needs touching.

     Deliberately a constant rather than derived. Which phase is live in-game is a fact
     about the world, and every derivation available in here is a proxy that eventually
     disagrees with it: "the newest list that ships" breaks the day a Phase 5 guest list
     arrives while the game is still on Phase 3, and "the last phase with items" already
     points at Sunwell. This used to derive "the last phase carrying zatar's calls", which
     worked only while his calls were the substrate - they are a list among lists now, and
     the item data holds no priorities to count. */
  var CURRENT_PHASE = "P3";

  function defaultPhase() {
    return CURRENT_PHASE;
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
    /* No journal portrait exists for a chest, so it takes an item icon like Trash does
       - a text chip in a rail of portraits reads as something that fell out of it. */
    "Timed Chest": ICON + "inv_box_01.jpg",
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
  /* Tier 4 and Tier 5 share one set of groupings, Tier 6 uses another - Priest is with
     Warlock at T6 and with Warrior at T4/T5 - so these are six entries and not three
     under different names. Taken from the tokens' own "Classes:" lines. */
  var TIER_CLASSES = {
    "Tier Token (Pal/Priest/Lock)": ["Paladin", "Priest", "Warlock"],
    "Tier Token (War/Hunter/Shaman)": ["Warrior", "Hunter", "Shaman"],
    "Tier Token (Rogue/Mage/Druid)": ["Rogue", "Mage", "Druid"],
    "Tier Token (Pal/Rogue/Shaman)": ["Paladin", "Rogue", "Shaman"],
    "Tier Token (War/Priest/Druid)": ["Warrior", "Priest", "Druid"],
    "Tier Token (Hunter/Mage/Lock)": ["Hunter", "Mage", "Warlock"]
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

  /* Point the class/spec filter at one registry identifier, from wherever it was named.
     A spec sets its class too, because a spec is a refinement of its class and never a
     selection in its own right - the chip rows enforce the same rule, and a spec left
     standing without its class would be dropped on the next read anyway.

     Clicking what is already the whole selection clears it, so the icons are a way in
     AND a way back out. Without that, every click narrows and only the chip row can
     widen, which makes an icon a one-way door. */
  function focusOn(id) {
    var spec = REG.specs[id];
    var clsId = spec ? spec["class"] : (REG.classes[id] ? id : "");
    if (!clsId) return;

    var already = spec
      ? state.classes.length === 1 && state.classes[0] === clsId &&
        state.specs.length === 1 && state.specs[0] === id
      : state.classes.length === 1 && state.classes[0] === clsId && !state.specs.length;

    if (already) {
      state.classes = [];
      state.specs = [];
    } else {
      state.classes = [clsId];
      state.specs = spec ? [id] : [];
    }
    /* BiS only rides on the specs that were picked when it was turned on, so a new
       selection must not inherit it - state.specs changing under it would silently
       re-aim a filter the reader set for something else. */
    state.bisOnly = false;
    update();
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

  /* With NO LIST OPEN nothing has a priority, so selectionHas() matches nothing and
     picking a class would empty the table. The BiS data still knows who wants what, so
     it answers instead: on a bare loot table, "Warrior" means the items that are BiS for
     a Warrior spec.

     This began narrower - it bridged the rows nobody had ranked while zatar's calls were
     the baseline. Removing the baseline made every row that case, so the flag it keyed
     on went and the rule generalised.

     Only while reading a list you did not write - which is what this rule always claimed
     and never quite did. It used to test "no list open", and while zatar's calls were the
     baseline those were the same thing; for a list arriving on a link they were not, so
     the bridge was silently off there too. On a list of your OWN there is genuinely no gap
     to bridge: every row has a priority column you control, and letting BiS through as
     well would make your list look like it ranks items it does not. */
  function bisOnlyMatch(rec) {
    if (activeIsMine) return false;
    /* Only where the list says NOTHING about the item - no key at all. A key holding an
       empty line is a deliberate "whoever needs it", and 23 of zatar's are exactly that:
       he answered, and the answer was nobody in particular. Bridging those would put a
       row into a filter that asks "where do I stand in this line" when the author's point
       was that there is no line. An absent key is the different thing: not an answer. */
    if (activeTemplate && activeTemplate.priorities[rec.id]) return false;
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

  /* registry identifier -> the shorthands people type for it. Search-only; see
     priorityText(), which is the one thing that reads it. */
  var ALIAS_WORDS = {};

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

    /* Shorthand -> the identifier it stands for, inverted: identifier -> the shorthands.
       Built here rather than per keystroke, because search runs over every row on every
       character typed.

       Forms collapse the same way resolveEntry() collapses them, so "Cat" keys FeralCat
       and finds the rows a cat icon actually renders on - not the FeralDruid umbrella,
       which is a different thing on screen.

       An alias whose target the registry does not know is SKIPPED rather than fatal.
       specs.json fails soft everywhere else on this page; a stale shorthand should cost
       that one word and nothing more. */
    ALIAS_WORDS = {};
    Object.keys(REG.aliases).forEach(function (word) {
      var t = REG.aliases[word];
      var id = typeof t === "string" ? t : (t && t.spec);
      if (!id) return;
      if (typeof t !== "string" && t.form) {
        var forms = REG.forms[id];
        if (forms && forms[t.form] && forms[t.form].spec) id = forms[t.form].spec;
      }
      if (!REG.specs[id] && !REG.classes[id]) return;
      (ALIAS_WORDS[id] = ALIAS_WORDS[id] || []).push(word);
    });

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
  /* The search haystack's view of a priority line, and NOTHING else reads it - which is
     what makes it safe to put words in here that the page never shows. The column renders
     icons; this renders the names behind them, plus the shorthands people actually type.

     Fifteen of the forty-four aliases used to find nothing at all: "Boomkin", "SPriest",
     "BM", "Prot Warrior" and friends. The other twenty-nine only worked by accident, being
     substrings of the rendered name - "Fury", "Arms", "Mage". */
  function priorityText(list) {
    return (list || []).map(function (entry) {
      var r = resolveEntry(entry);
      if (!r) return "";
      var words = (r.race ? r.race.name + " " : "") + r.name;
      var also = r.id && ALIAS_WORDS[r.id];
      return also ? words + " " + also.join(" ") : words;
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
    bisSource: "wowhead",   // which BiS data the rings come from; see BIS_SOURCES
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
    bisSource: document.getElementById("bis-source"),
    search: document.getElementById("search"),
    reset: document.getElementById("reset"),
    count: document.getElementById("count"),
    results: document.getElementById("results"),
    templateBar: document.getElementById("template-bar"),
    listTrigger: document.getElementById("list-trigger"),
    listTriggerName: document.getElementById("list-trigger-name"),
    listWarn: document.getElementById("list-warn"),
    tplDirty: document.getElementById("tpl-dirty"),
    editToggle: document.getElementById("edit-toggle"),
    signIn: document.getElementById("sign-in"),
    account: document.getElementById("account"),
    accountName: document.getElementById("account-name"),
    shareTrigger: document.getElementById("share-trigger"),
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

  /* The open list's ordering, or nothing. There is no fall-back to the item data any
     more, because the item data holds no priorities: a priority is something a LIST says,
     and with no list open the column is honestly empty. Until Aug 2026 this fell through
     to rec.priority - zatar's - which is what made him the substrate rather than an
     option, and what made an item a template had never heard of quietly render his call
     as if it were yours. */
  function effectivePriority(rec) {
    if (!activeTemplate) return EMPTY;
    return activeTemplate.priorities[rec.id] || EMPTY;
  }

  /* one shared empty array rather than a fresh [] per row per render - this is called
     for every record on every update, and nothing mutates the result */
  var EMPTY = [];

  /* The same overlay, for the notes column. A note you have written wins; absent means
     the guide's, which is why a template saved before notes existed still reads correctly
     and why TEMPLATE_VERSION did not have to move.

     Everything asking what a row SAYS goes through this, exactly as everything asking
     what it RANKS goes through effectivePriority - including the search haystack, or a
     search would keep finding wording you had already replaced. */
  /* The same, for notes - with one difference. A handful of notes are facts about the
     ITEM rather than anybody's opinion of it ("Also drops from Eredar Twins"), and those
     stayed in the item data when the commentary left. They show whatever list is open,
     including none, because they are true either way. A list's own note wins over them. */
  function effectiveNotes(rec) {
    if (activeTemplate && activeTemplate.notes) {
      var own = activeTemplate.notes[rec.id];
      if (typeof own === "string") return own;
    }
    return rec.notes || "";
  }

  /* False for an item the active template has never heard of - added to the dataset
     after it was saved. The row still renders, from the guide's data, and says so. */
  function inTemplate(rec) {
    return !activeTemplate || !!activeTemplate.priorities[rec.id];
  }

  /* Whose list this is, stamped when it is made. Signed out it is empty and stays empty:
     a list with no author claims none, which is not the same as claiming to be anonymous.

     A COPY takes YOUR name, not the name of the list it came from. That is the whole
     point - a copy is your list from the moment you make it, which is the same rule
     `base` already records the other half of. */
  function makeTemplate(name, base, priorities, notes) {
    return {
      v: TEMPLATE_VERSION,
      id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name,
      created: new Date().toISOString().slice(0, 10),
      base: base,
      author: signedIn() ? accountName() : "",
      priorities: priorities,
      notes: notes || {}
    };
  }

  /* Whether an author is worth showing, which is NOT the same as whether one is set.

     A #t= link carries whatever the sender put in the payload, so its author is
     unverified - someone could stamp it "zatar" and pass their calls off as his, which
     is precisely what CLAUDE.md section 8 exists to prevent. A list in your own store you
     know the provenance of, and a ?s= list came out of the database under its owner's
     auth.uid(). Those two are attested; a #t= list is not, and shows no byline at all.

     `sharedFrom` is set only by loadSharedByToken(), so it is the marker for "the server
     told us this", never something a payload can claim for itself. */
  function attestedAuthor(t) {
    if (!t || !t.author) return "";
    if (t === activeTemplate && !activeIsMine && !t.sharedFrom) return "";
    return t.author;
  }

  /* A copy of whatever is on screen. effectivePriority() already answers "what is
     this row showing", so one function copies the guide's list, one of yours, or one
     that arrived on a link, without branching on which of the three it is. */
  function copyOfCurrent(name) {
    var priorities = {}, notes = {};
    ALL.forEach(function (rec) {
      /* deep copy: editing one must never reach into ALL */
      priorities[rec.id] = (effectivePriority(rec) || []).map(function (e) {
        var c = {};
        Object.keys(e).forEach(function (k) { c[k] = e[k]; });
        return c;
      });
      /* Notes are copied for the same reason the priorities are: a copy is a full
         snapshot of what was on screen, so it reads identically the moment it is made
         and diverges only where you change it. */
      notes[rec.id] = effectiveNotes(rec);
    });
    return makeTemplate(name || "My priorities",
      activeTemplate ? activeTemplate.id : "zatar", priorities, notes);
  }

  /* Nobody's list yet: all 195 rows, every priority empty. Still a full copy, so it
     validates, encodes and shares exactly like any other. */
  function newBlankTemplate(name) {
    var priorities = {}, notes = {};
    ALL.forEach(function (rec) {
      priorities[rec.id] = [];
      /* Blank means blank. The guide's notes are not seeded here the way they are into
         a copy - you asked for nobody's list, and his wording is somebody's. */
      notes[rec.id] = "";
    });
    return makeTemplate(name || "My list", "blank", priorities, notes);
  }

  /* ---------- template storage ----------
     Async on purpose even though localStorage is synchronous: the Azure
     implementation that arrives with login is then a drop-in, not a refactor of
     every call site. */

  var STORE_KEY = "lootprio.templates";
  var SMART_KEY = "lootprio.smartFilter";
  var BIS_SOURCE_KEY = "lootprio.bisSource";

  /* Where the BiS rings come from. A preference about how you read the page rather than
     a filter on it, so it lives in this browser and NOT in the url: a link you send
     should not silently change somebody else's source out from under them.

     Wowhead is the default because it is the only source that is complete - all five
     phases, all 28 specs. See BIS_SOURCES for what the others hold. */
  var BIS_SOURCES = [
    { id: "wowhead", label: "Wowhead" },
    { id: "wowsims", label: "WoWSims" },
    /* Reserved. Choosing it shows no rings at all, which is the honest rendering of
       "you have not supplied any BiS data yet" - the alternative is a menu entry that
       silently does nothing, which reads as broken rather than as unbuilt. */
    { id: "custom", label: "Custom (not set up)" }
  ];

  function bisSource() {
    try {
      var v = window.localStorage.getItem(BIS_SOURCE_KEY);
      return BIS_SOURCES.some(function (s) { return s.id === v; }) ? v : "wowhead";
    } catch (e) { return "wowhead"; }
  }

  function setBisSource(id) {
    try { window.localStorage.setItem(BIS_SOURCE_KEY, id); }
    catch (e) { /* private browsing: the session still works, it just won't persist */ }
  }

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
      priorities: row.priorities,
      /* both default rather than being required: a row written before these columns
         existed returns null, and absent notes already means "the guide's" */
      notes: row.notes || {},
      author: row.author || "",
      /* carried so the menu knows whether to offer Stop sharing, and so a second
         Copy link reuses the token the first one minted rather than orphaning it */
      share_token: row.share_token || null,
      shared: !!row.shared,
      /* The version this copy was read at. Every save is conditional on it, so a
         second person's write cannot be silently overwritten by a stale first. */
      updated_at: row.updated_at || null,
      /* What the share link is currently handing out. Carried so the owner can be
         told how far the draft has moved from it; recipients never see these,
         because get_shared_list returns the published columns AS priorities. */
      published_priorities: row.published_priorities || null,
      published_notes: row.published_notes || null,
      published_at: row.published_at || null
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
      return sb.from("lists").select("id,name,created,priorities,shared")
        .order("updated_at", { ascending: false })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return (res.data || []).map(function (r) {
            return { id: r.id, name: r.name, created: r.created,
                     filled: filledCount(r.priorities), shared: !!r.shared };
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
      /* Every field the template carries has to be named here. An upsert silently
         drops what it does not mention, so a column missing from this object is not an
         error anywhere - it is a field that saves, appears to work, and is gone on the
         next load. `notes` was exactly that between Aug 2026 and this fix: editable
         notes worked signed out, where localStore writes the whole blob, and vanished
         signed in. */
      var stamp = new Date().toISOString();
      var row = {
        id: t.id,
        name: t.name,
        created: t.created,
        v: t.v,
        base: t.base,
        priorities: t.priorities,
        notes: t.notes || {},
        author: t.author || null,
        share_token: t.share_token || null,
        shared: !!t.shared,
        published_priorities: t.published_priorities || null,
        published_notes: t.published_notes || null,
        published_at: t.published_at || null,
        updated_at: stamp
      };

      function took(res) {
        if (res.error) throw new Error("Could not save: " + res.error.message);
        /* the write is the new baseline, so the next save is guarded against this one */
        t.updated_at = stamp;
        return t;
      }

      /* A list this browser has never read back has no version to guard against, so it
         is an insert. Everything else is conditional. */
      if (!t.updated_at) {
        return sb.from("lists").upsert(row).then(took);
      }

      /* THE GUARD. A blind upsert sends this browser's whole ~21KB copy of the list, so
         two people editing one list meant the second save silently erased the first -
         no error, nothing on screen, found out days later if ever. Matching on the
         updated_at we read means the write only lands if nobody else has written since.
         Zero rows back is not an error from Postgres, so it has to be checked for. */
      return sb.from("lists").update(row)
        .eq("id", t.id).eq("updated_at", t.updated_at).select("id")
        .then(function (res) {
          if (res.error) throw new Error("Could not save: " + res.error.message);
          if (!res.data || !res.data.length) {
            var stale = new Error("This list changed somewhere else while you were editing");
            stale.stale = true;      /* distinguishable, so saveNow can offer a reload */
            throw stale;
          }
          return took(res);
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
    /* Fill in a missing author on the way past. Every list made before the field existed
       has none, so sharing one showed no byline at all - and those are exactly the lists
       worth sharing, being the ones with work in them.

       Safe because of what activeIsMine already guarantees: a list in your own store is
       yours by definition, so writing your name into a blank is recording a fact rather
       than making a claim. It never OVERWRITES - a list that already names someone keeps
       that name, so making a copy of a shared list cannot quietly relabel the original,
       and re-saving offline (signedIn() false) cannot blank one either. */
    if (!t.author && signedIn()) t.author = accountName();
    return store.save(t).then(function () {
      if (activeTemplate === t) { unsaved = false; renderTemplateBar(); }
    }, function (err) {
      /* A stale write is the one failure the person can actually act on, and the one
         that used to happen in silence. unsaved deliberately stays true: the edit is
         still on screen and still unsaved, and saying otherwise is the lie this whole
         guard exists to stop telling. */
      if (err.stale) {
        /* Asserted rather than assumed: another save may have resolved in between, and
           whatever it did, THIS edit did not land. The marker has to say so. */
        unsaved = true;
        announce("Someone else saved this list while you were editing - reload to see "
                 + "their version. Your change is still on screen but not saved.",
                 function () { location.reload(); }, "Reload");
        renderTemplateBar();
        return;
      }
      announce(err.message);
    });
  }

  /* One note, written into the template. Never into ALL - the guide's own wording has to
     survive so a reset has something to go back to, which is the same reason the
     priorities are an overlay rather than an edit in place. */
  function setNote(rec, text) {
    if (!activeTemplate || !activeIsMine) return;
    if (!activeTemplate.notes) activeTemplate.notes = {};
    if (activeTemplate.notes[rec.id] === text) return;
    activeTemplate.notes[rec.id] = text.slice(0, MAX_NOTE);
    unsaved = true;
    saveNow();
  }

  /* Clears YOUR note rather than restoring anybody's. The key is deleted rather than set
     to "", so effectiveNotes() falls back properly - on the handful of rows carrying a
     fact about the item ("Also drops from Eredar Twins") that fact reappears, which is
     right, because it was never yours to overwrite in the first place. */
  function clearNote(rec) {
    if (!activeTemplate || !activeIsMine || !activeTemplate.notes) return;
    if (!(rec.id in activeTemplate.notes)) return;
    delete activeTemplate.notes[rec.id];
    unsaved = true;
    saveNow();
  }

  /* Fill the empty priorities on this phase from the BiS data - every spec that calls
     the item best-in-slot, joined with "=" - as a starting point to drag into an order.

     This is what the 268 stored SEEDED rows used to be. They were exactly this, computed
     once and written into the item data, where they duplicated bis.json and had to carry
     a tag explaining they were not anybody's ranking. As an action there is nothing to
     disclaim: you asked for it, and what you do with the line afterwards is yours.

     Two limits, both so it can only ever add. It touches the phase on screen, not the
     whole dataset, because seeding 699 rows from one click is not something anyone means.
     And it skips any row that already has a priority, so it cannot overwrite work. */
  function seedFromBis() {
    if (!activeTemplate || !activeIsMine) return;
    var zones = phaseZones(state.phase);
    var order = Object.keys(REG.specs);
    var filled = 0;

    ALL.forEach(function (rec) {
      if (zones.indexOf(rec.zone) === -1) return;
      if ((activeTemplate.priorities[rec.id] || []).length) return;
      var specs = order.filter(function (id) { return bisTier(id, rec.id); });
      if (!specs.length) return;
      activeTemplate.priorities[rec.id] = specs.map(function (id, i) {
        return i ? { spec: id, op: "=" } : { spec: id };
      });
      filled++;
    });

    if (!filled) {
      announce("Nothing to seed here - every item on this phase either has a priority "
               + "already or is BiS for nobody");
      return;
    }
    unsaved = true;
    saveNow().then(refreshLists);
    announce("Seeded " + filled + " items from BiS, all equal - drag to put them in order");
    update();
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
  /* Long enough for a paragraph of reasoning, short enough that 368 of them can't be
     used to make a share link nobody can open. */
  var MAX_NOTE = 600;

  /* Long enough for any Discord display name, short enough that it cannot be used to
     smuggle a paragraph into a byline. */
  var MAX_AUTHOR = 60;

  function validateTemplate(doc) {
    if (!doc || typeof doc !== "object") return "not a template";
    if (doc.v !== TEMPLATE_VERSION) return "made by a different version of this site";
    if (!doc.priorities || typeof doc.priorities !== "object") return "no priorities in it";
    /* notes is optional - a template saved before notes existed has none, and absent
       means "the guide's". Present and wrong is still refused. */
    if (doc.notes != null) {
      if (typeof doc.notes !== "object" || Array.isArray(doc.notes)) return "broken notes in it";
      var nids = Object.keys(doc.notes);
      for (var n = 0; n < nids.length; n++) {
        var note = doc.notes[nids[n]];
        if (typeof note !== "string") return "item " + nids[n] + " has a broken note";
        if (note.length > MAX_NOTE) return "item " + nids[n] + ": the note is too long";
      }
    }
    /* author is optional the same way - absent means nobody claimed one. Present and
       wrong is refused; present and merely UNVERIFIED is a separate question, answered
       by attestedAuthor() at render time rather than here. */
    if (doc.author != null) {
      if (typeof doc.author !== "string") return "broken author on it";
      if (doc.author.length > MAX_AUTHOR) return "the author name is too long";
    }

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
      if (state.classes.length && !selectionHas(rec) && !bisOnlyMatch(rec)) return false;
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
      var hay = [rec.item, rec.boss, rec.zone, priorityText(effectivePriority(rec)), effectiveNotes(rec),
                 rec.slot, slotGroup(rec.slot), rec.type, typeLabel(rec), (rec.roles || []).join(" ")]
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
    /* Which bundled list is open, by id. Only the bundled ones: they ship with the site,
       so a recipient can be pointed at one instead of being sent a copy of it. A list of
       your own has ?s= or #t= for that, and a list from a link already carries itself. */
    if (activeTemplate && !activeIsMine
        && OOTB.some(function (e) { return e.id === activeTemplate.id; })) {
      p.set("list", activeTemplate.id);
    }
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
        /* Almost every boss flies a 2:1 Encounter Journal portrait, which cover-crops
           into the rail's 76x44 cell exactly right. Trash flies a square item icon,
           and cover-cropping a square into a landscape box throws away most of it -
           the same problem the crafted zone tiles have, and the same fix. */
        if ((BOSS_ICON[b] || "").indexOf(JOURNAL) !== 0) c.classList.add("chip--emblem");
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
      /* Reads "8 items" rather than "BiS only 8". The label carries the count and
         there is no separate badge, so it says how many rather than naming the rule.
         What it DOES is still on the tooltip and the aria-label, because a control
         whose face is a number has to explain itself somewhere - otherwise the only
         way to learn what it filters is to press it and compare. */
      var toggle = chip(bisRows.length + (bisRows.length === 1 ? " item" : " items"),
                        state.bisOnly, null);
      toggle.classList.add("chip--toggle");
      toggle.dataset.tip = "Show only what is BiS for the specs you picked";
      toggle.setAttribute("aria-label",
        "Show only the " + bisRows.length + " items that are BiS for the specs you picked");
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
    syncOptTrigger(el.type);
    syncOptTrigger(el.slot);
  }

  /* ---------- the editor ----------
     Pointer only, by decision. Every action used to have a keyboard form as well, which
     was partly accessibility and partly the only reason the editor was testable - jsdom
     can dispatch a keydown but cannot drag.

     Two consequences to know rather than rediscover. The editor is not keyboard
     operable. And reordering is now drag-only, so **nothing automated covers it** -
     remove, operator and add all still have click paths and stay tested, but a
     reordering regression will only ever be caught by hand at localhost:8642. */

  var editMsg = "";        /* why the last edit was refused, shown under the toolbar */

  var toastTimer = null;

  /* Same role="status" element and the same call sites it always had - only where it
     sits has changed. It used to live inside the template bar, so every message pushed
     the buttons along as it appeared and changed length; now it is a toast that affects
     no layout at all.

     `undo` is optional and is what lets the delete confirm stay light: an undo is worth
     more than any confirm, and the deleted record is held in the closure until the
     toast clears. */
  function announce(msg, undo, label) {
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
      b.textContent = label || "Undo";
      b.addEventListener("click", function () { announce(""); undo(); });
      el.editMsg.appendChild(b);
    }

    el.editMsg.hidden = false;
    /* An undo needs longer than a status line, and neither should stay forever. */
    toastTimer = setTimeout(function () { announce(""); }, undo ? 12000 : 6000);
  }

  /* ---------- dragging ----------
     Pointer events rather than HTML5 drag-and-drop: these icons live in a
     table-layout: fixed cell, where HTML5 DnD drop targets are unreliable. This is the
     only way to reorder, so it is also the only part of the editor no test can reach. */

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
    wrap.dataset.index = String(index);
    wrap.setAttribute("role", "listitem");
    /* The position is still worth announcing - it is the whole meaning of the line -
       but there are no keys left to name. */
    wrap.setAttribute("aria-label",
      resolved.name + ", position " + (index + 1) + " of " + list.length);

    var mark = bisMark(resolved, rec.id);
    wrap.appendChild(specIcon(resolved, mark.tier, mark.specs, mark.variant));

    var x = document.createElement("button");
    x.type = "button";
    x.className = "prio-x";
    x.textContent = "×";
    x.tabIndex = -1;
    x.setAttribute("aria-hidden", "true");
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      applyEdit(rec, removeEntry(list, index));
      update();
    });
    wrap.appendChild(x);

    /* Drag to reorder. Dropping anywhere but on a line does nothing: taking an icon
       off is the x, deliberately. Dragging clear of the row used to remove it, which
       fired by accident more often than on purpose. */
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

    /* There was a per-row "back to zatar's order" here. It reset to rec.priority, and
       the item data holds no priorities now - there is no baseline to go back to, because
       a priority is something a list says. Undoing a change means reopening the list you
       copied from, or not saving; the button would have been a control that could only
       ever clear the row. */

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
    field.placeholder = "Type to narrow";
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
      /* Escape only. It closes all five overlays on this page and is not an editing
         gesture - the editor itself is pointer-only. */
      if (e.key === "Escape") { e.preventDefault(); closePop(); }
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

  /* How long an item stays best-in-slot. Colours borrow WoW's item-quality ladder -
     epic purple, then legendary orange, then artifact gold - so "rarer" reads as
     "lasts longer".

     Called LONGEVITY rather than "tier". "Tier" already means something else in this
     dataset - the T6 armour tokens, `type: "Tier Token (Pal/Priest/Lock)"` - and using
     one word for both has confused a reader at least once. */
  var BIS_LONGEVITY = {
    1: { cls: "spec-icon--bis", label: "Phase BiS" },
    2: { cls: "spec-icon--bis2", label: "Multi-phase BiS" },
    3: { cls: "spec-icon--bis3", label: "Expansion BiS" }
  };

  var BIS_LONGEVITY_BY_NAME = { "phase": 1, "multiPhase": 2, "expansion": 3 };

  /* Flattened from data/bis.json: "P3|ProtWarr|32375" -> { longevity, variant }.

     The phase is part of the key because bis.json holds all five, and a spec can list
     the same item in several of them - keyed by spec alone, the last phase read
     silently overwrote every earlier one.

     There was a second index here, BIS_BY_SPEC, kept in the per-spec shape the file is
     written in and described as the natural source for "click a spec icon to see that
     spec's list". That feature is built now and did not need it: the click sets
     state.classes/state.specs and the existing filter does the rest, so the answer stays
     one lookup through bisTier() rather than a second copy of the same data. It was
     rebuilt from bis.json on every load and read by nothing, which is the shape of thing
     that makes a feature look half-finished when it is not started. Four lines to bring
     back if a cross-phase view ever needs the per-spec shape. */
  /* One index per source, same key shape, so bisAt() reads whichever is selected and
     nothing downstream knows there is a choice. */
  var BIS_INDEX = { wowhead: {}, wowsims: {}, custom: {} };

  /* HOW LONG AN ITEM LASTS IS DERIVED HERE, not read from the source, and always
     WITHIN one source and one spec - Wowhead's phases against Wowhead's, never across.

     `expansion` means what it says: you got the item before Sunwell and nothing in Sunwell
     replaced it. So the test is whether that source's FINAL phase still names it for that
     spec, and whether it was gained before then. `multiPhase` is anything that outlives its
     own phase without reaching the end; everything else is `phase`.

     This replaced a run-length rule - "BiS for three or more consecutive phases" - which
     was a different claim wearing the same word. An item BiS in P1, P2 and P3 and then
     dropped is not BiS for the expansion; an item picked up in P4 and still best in Sunwell
     is, and the old rule called it multiPhase.

     A source with only two phases cannot show `multiPhase` at all: reaching its last phase
     from its first IS surviving the expansion, as far as that source can see. That is
     honest about wowsims holding P4 and P5 rather than a gap to paper over.

     A VARIANT is not derivable and is read where a source states one: "best threat" versus
     "best mitigation" is a judgement the guide made. wowsims states none. */
  function longevityOf(listedByPhase, phases, phase, itemId) {
    var last = phases[phases.length - 1];
    var here = phases.indexOf(phase);

    var survives = !!(listedByPhase[last] && listedByPhase[last][itemId]);
    if (survives && phase !== last) return 3;

    var run = 0;
    for (var i = here; i < phases.length; i++) {
      if (!listedByPhase[phases[i]] || !listedByPhase[phases[i]][itemId]) break;
      run++;
    }
    return run > 1 ? 2 : 1;
  }

  function indexBis(doc) {
    BIS_INDEX = { wowhead: {}, wowsims: {}, custom: {} };
    indexOneSource(BIS_INDEX.wowhead, (doc && doc.specs) || {}, function (e) {
      /* A guide lists several rows as "Best" in one slot and says which is actually BiS
         through row order. fetch_bis.py marks everything past what the slot holds, and a
         near-BiS alternative is not BiS: no ring, and no claim on how long it lasted. */
      if (!e || e.id == null || e.near) return null;
      return { id: e.id, variant: e.variant || "" };
    });
    indexOneSource(BIS_INDEX.wowsims, (doc && doc.wowsimsPresets) || {}, function (id) {
      /* a preset is a bare list of item ids - no qualifier, and no ranking to lose */
      return id != null ? { id: id, variant: "" } : null;
    });
  }

  /* Two passes per spec, and the first is what makes the derivation possible: you cannot
     know how long an item lasts until you have read every phase it might last into. Only
     the phases this source actually holds are considered, in release order. */
  function indexOneSource(into, bySpec, read) {
    Object.keys(bySpec).forEach(function (specName) {
      var raw = bySpec[specName] || {};
      var phases = PHASE_IDS.filter(function (p) { return raw[p]; });

      var listed = {};
      phases.forEach(function (phase) {
        listed[phase] = {};
        (raw[phase] || []).forEach(function (row) {
          var e = read(row);
          if (e) listed[phase][e.id] = true;
        });
      });

      phases.forEach(function (phase) {
        (raw[phase] || []).forEach(function (row) {
          var e = read(row);
          if (!e) return;
          into[phase + "|" + specName + "|" + e.id] = {
            longevity: longevityOf(listed, phases, phase, e.id),
            variant: e.variant
          };
        });
      });
    });
  }

  /* the phases in release order, which is the order "survives to" means */
  var PHASE_IDS = PHASES.map(function (p) { return p.id; });

  /* Keyed by the registry identifier (ProtWarr), matching data/bis.json, and scoped to
     the phase on screen: a Sunwell item is not BiS for someone reading Phase 3, and a
     ring that ignored the phase would answer "BiS at some point" rather than "BiS for me
     now" - which is the question a loot council is actually asking. */
  function bisAt(specId, itemId) {
    var idx = BIS_INDEX[state.bisSource] || BIS_INDEX.wowhead;
    return idx[state.phase + "|" + specId + "|" + itemId] || null;
  }

  function bisVariant(specId, itemId) {
    var hit = bisAt(specId, itemId);
    return hit ? hit.variant : "";
  }

  function bisTier(specId, itemId) {
    var hit = bisAt(specId, itemId);
    return hit ? hit.longevity : 0;
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
      return { tier: bisTier(resolved.id, itemId), specs: [],
               variant: bisVariant(resolved.id, itemId) };
    }

    /* an umbrella spec aggregates like a class does, over the specs it covers */
    var ids = stands_for.length ? stands_for : (CLASS_SPECS[resolved.id] || []);
    var picked = stands_for.length
      ? stands_for.filter(function (id) { return state.specs.indexOf(id) !== -1; })
      : pickedSpecs(resolved.id);
    if (picked.length) ids = picked;

    /* A class icon can stand for two specs wanting the item for opposite reasons - a
       Prot Warrior's threat piece is a Fury Warrior's plain BiS. Only carry a qualifier
       up when every ringed spec behind the icon agrees on it; otherwise the icon would
       claim one spec's reason on behalf of all of them. */
    var tier = 0, names = [], variants = {};
    ids.forEach(function (id) {
      var t = bisTier(id, itemId);
      if (!t) return;
      if (t > tier) tier = t;
      names.push(shortSpecName(id, resolved.name));
      variants[bisVariant(id, itemId)] = 1;
    });
    var agreed = Object.keys(variants);
    return { tier: tier, specs: names, variant: agreed.length === 1 ? agreed[0] : "" };
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

  function specIcon(spec, bis, forSpecs, variant) {
    var lasts = BIS_LONGEVITY[bis];
    var img = document.createElement("img");
    img.className = "spec-icon" + (lasts ? " " + lasts.cls : "");
    /* which registry entry this icon is, so nothing downstream has to work it out
       from the display name - forms make that lossy ("Feral Druid (cat)") */
    if (spec.id) img.dataset.id = spec.id;
    img.src = ICON_BASE + spec.icon + ".jpg";
    /* Who the icon is for goes on the name line - "Priest — Discipline, Holy" -
       because that is a fact about the icon, not about the ring. A spec icon is
       already standing there naming itself, so it never carries a list. */
    var who = spec.name +
      (forSpecs && forSpecs.length ? " — " + forSpecs.join(", ") : "");

    /* The qualifier says WHY it is BiS, where a spec has more than one answer for a
       slot - a tank's threat helm and mitigation helm are both BiS. It rides on the
       longevity line, not the name line: it is a fact about the ring rather than about
       the icon, and the ring's colour keeps meaning longevity alone. */
    var bisLine = lasts ? lasts.label + (variant ? " (" + variant + ")" : "") : "";

    img.alt = who + (bisLine ? " (" + bisLine + ")" : "");
    /* data-tip rather than title: the native tooltip has a ~1s delay the browser
       won't let us change, and these need to read as fast as the item tooltips.
       The BiS line is carried separately so the tooltip can colour it to match
       the ring on the icon. */
    img.dataset.tip = who;
    if (lasts) {
      img.dataset.tipBis = bisLine;
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

  /* Turn a rendered priority icon into a way to filter by whoever it names.

     Applied HERE and not inside specIcon(), deliberately: the editor renders its icons
     through the same function, and there a press is the start of a drag. An icon that
     also filtered would fight the gesture it is already carrying.

     It stays an <img> with role="button" rather than becoming a real <button>, because
     the drag code, the tests and bisMark() all reach for `img.spec-icon` - wrapping it
     would be a structural change to serve a behavioural one. The keyboard handler is
     what a <button> would have given for free, and is written out instead.

     A race icon never gets this: it carries no registry id, and the entry it prefixes
     is the thing worth filtering on. */
  function makeFocusable(icon, id) {
    if (!id || (!REG.specs[id] && !REG.classes[id])) return;
    icon.classList.add("spec-icon--link");
    icon.setAttribute("role", "button");
    icon.setAttribute("tabindex", "0");
    icon.addEventListener("click", function () { focusOn(id); });
    icon.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); focusOn(id); }
    });
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

    /* The SEEDED tag stood here. It marked lines seed_priority.py wrote from the BiS
       data, and those are gone: every one was exactly the specs bis.json already lists,
       so they duplicated data the page draws as rings anyway. Seeding is an action on a
       list of your own now - see seedFromBis() - and a line you seeded and then ordered
       is yours, so there is nothing left to disclaim. */

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
      var icon = specIcon(resolved, mark.tier, mark.specs, mark.variant);
      if (muted) icon.classList.add("spec-icon--muted");
      makeFocusable(icon, resolved.id);
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

    tr.appendChild(canEdit() ? editableNotesCell(rec) : notesCell(rec));

    return tr;
  }

  function notesCell(rec) {
    var td = document.createElement("td");
    td.className = "col-notes";
    td.innerHTML = highlight(effectiveNotes(rec), state.q);
    return td;
  }

  /* Click the note to change it, blur to keep it - the same shape the rest of the editor
     has, and the same absence of a Save button.

     A textarea rather than an input: these run to a sentence or two, and a one-line box
     hides the end of your own reasoning. It is created on the click rather than always
     being there, because a row you are not editing should read as text, and 368 textareas
     per render is real cost for nothing. */
  function editableNotesCell(rec) {
    var td = document.createElement("td");
    td.className = "col-notes col-notes--edit";

    var text = document.createElement("div");
    text.className = "note-text";
    var body = highlight(effectiveNotes(rec), state.q);
    if (body) text.innerHTML = body;
    else {
      text.className += " note-text--empty";
      text.textContent = "Add a note";
    }
    text.setAttribute("role", "button");
    text.dataset.tip = "Click to edit";

    text.addEventListener("click", function () {
      var field = document.createElement("textarea");
      field.className = "note-field";
      field.value = effectiveNotes(rec);
      field.rows = 3;
      /* The same cap validateTemplate() enforces, so a list of your own can never be one
         your own validator would refuse when it comes back off a link. */
      field.maxLength = MAX_NOTE;
      field.setAttribute("aria-label", "Note for " + rec.item);
      td.replaceChild(field, text);
      field.focus();
      field.selectionStart = field.selectionEnd = field.value.length;

      /* blur fires again while update() tears the row down, so the commit is guarded */
      var done = false;
      field.addEventListener("blur", function () {
        if (done) return;
        done = true;
        setNote(rec, field.value.trim());
        update();
      });
      field.addEventListener("keydown", function (ev) {
        /* Escape abandons the edit. Enter is a newline - these are sentences, and there
           is no Save button for it to stand in for. */
        if (ev.key === "Escape") { ev.preventDefault(); done = true; update(); }
      });
    });

    td.appendChild(text);

    /* Offered only where this list carries a note of its own. It clears yours; it does
       not restore anyone else's, because there is no longer anyone else's to restore. */
    if (activeTemplate.notes && (rec.id in activeTemplate.notes)) {
      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "note-reset";
      reset.textContent = "\u21BA";
      reset.dataset.tip = "Clear this note";
      reset.setAttribute("aria-label", "Clear the note on " + rec.item);
      reset.addEventListener("click", function () { clearNote(rec); update(); });
      td.appendChild(reset);
    }

    return td;
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

  /* Whether a zone is outside the guide entirely, rather than merely having gaps in
     it. Cached because it walks ALL and renderGroup runs once per boss group, and keyed
     on ALL itself so the cache cannot outlive the data it came from - clearing it from
     the loader instead is a different scope, and was silently a no-op. */
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

  /* How many items the phase on screen holds. The denominator has to be the phase's
     total, not the dataset's: a phase is always set and only one is ever rendered, so
     "132 of 699" measured the fraction against 567 rows that could not have been shown
     whatever the filters said. Phase 3 reading "195 of 195" with nothing filtered is
     the honest version of that line. */
  function phaseTotal() {
    var zones = phaseZones(state.phase);
    var n = 0;
    for (var i = 0; i < ALL.length; i++) {
      if (zones.indexOf(ALL[i].zone) !== -1) n++;
    }
    return n;
  }

  function renderResults() {
    var rows = filtered();
    el.count.textContent = rows.length + " of " + phaseTotal() + " items";
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
  function whenSupabaseReady(cb, onFail) {
    if (window.supabase) { cb(); return; }
    var tag = document.getElementById("supabase-sdk");
    /* absent by design - jsdom, or someone stripped the tag. Not an error. */
    if (!tag) { if (onFail) onFail(); return; }
    tag.addEventListener("load", function () { if (window.supabase) cb(); else if (onFail) onFail(); });
    tag.addEventListener("error", function () {
      if (window.console) console.warn("sign-in unavailable: the Supabase SDK did not load");
      if (onFail) onFail();
    });
  }

  function initAuth() {
    if (!supabaseConfigured()) return;
    /* Losing sign-in is allowed to be quiet: the button is simply absent, which says
       "no accounts here" well enough. A shared link is not, because the visitor asked
       for one specific list and would otherwise be looking at a different one with
       nothing to explain the swap. */
    whenSupabaseReady(startAuth, function () {
      if (hasShareToken()) {
        announce("That shared link could not be opened right now - try again in a moment");
        update();
      }
    });
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
      /* A ?s= link is resolved against Supabase, so it cannot be read at boot - the SDK
         is still arriving then. loadSharedTemplate() reports it as handled and this is
         where it actually happens. */
      if (!activeTemplate) loadSharedByToken();
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

  /* Back to no list open, which is now a real state rather than a synonym for zatar:
     the loot table with an empty priority column. */
  function closeList() { openTemplate(null, false); }

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

    /* No list open is a real state now, not a synonym for zatar's - the priority column
       is empty and the trigger says so rather than naming somebody. */
    el.listTriggerName.textContent =
      activeTemplate ? activeTemplate.name : "No list";

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
    /* the one state where the table cannot say anything about who gets what */
    show(el.listWarn, !activeTemplate);

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



  /* ---------- the option menus ----------
     A native <select>'s popup is drawn by the operating system, not the page: its
     background, its highlight and its font are all unreachable from CSS. So Slot and
     Type looked like macOS while every other menu on the page looked like this site.
     The only way to match is to draw the list ourselves.

     The <select> stays and remains the source of truth - it is what app.js reads, what
     fillSelect() rebuilds, and what the tests drive. This is a skin over it, so if the
     enhancement ever fails to build, the field is still a working select rather than
     nothing at all: the native one is only hidden once its trigger exists.

     Fifth overlay, same shell and the same placeUnder() as the other four. */

  var optMenu = null;
  var optFor = null;          /* the <select> the open menu belongs to */

  function closeOptMenu() {
    if (optMenu) optMenu.style.display = "none";
    if (optFor && optFor.trigger) optFor.trigger.setAttribute("aria-expanded", "false");
    optFor = null;
  }

  function buildOptMenu() {
    optMenu = document.createElement("div");
    optMenu.className = "list-menu opt-menu";
    optMenu.setAttribute("role", "listbox");
    optMenu.style.display = "none";
    document.body.appendChild(optMenu);
  }

  function optItems() {
    return [].slice.call(optMenu.querySelectorAll(".opt-item"));
  }

  /* Arrow keys, Home/End, Enter and Escape - everything the native control gave away
     for free and has to be paid back by hand. */
  function optKeydown(e) {
    var items = optItems();
    var at = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); var t = optFor.trigger; closeOptMenu(); t.focus(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); (items[at + 1] || items[0]).focus(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); (items[at - 1] || items[items.length - 1]).focus(); return; }
    if (e.key === "Home") { e.preventDefault(); items[0].focus(); return; }
    if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
  }

  function openOptMenu(sel) {
    if (!optMenu) { buildOptMenu(); optMenu.addEventListener("keydown", optKeydown); }
    if (optFor === sel) { closeOptMenu(); return; }
    closePop();
    closeOpMenu();
    closeAcctMenu();
    closeListMenu();
    optFor = sel;
    optMenu.innerHTML = "";

    [].forEach.call(sel.options, function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "opt-item" + (o.value === sel.value ? " opt-item--current" : "");
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", o.value === sel.value ? "true" : "false");

      var tick = document.createElement("span");
      tick.className = "lm-tick";
      tick.textContent = o.value === sel.value ? "\u2713" : "";
      tick.setAttribute("aria-hidden", "true");
      var name = document.createElement("span");
      name.className = "opt-item-name";
      name.textContent = o.textContent;
      b.appendChild(tick);
      b.appendChild(name);

      b.addEventListener("click", function () {
        sel.value = o.value;
        closeOptMenu();
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.trigger.focus();
      });
      optMenu.appendChild(b);
    });

    optMenu.style.display = "block";
    sel.trigger.setAttribute("aria-expanded", "true");
    placeUnder(optMenu, sel.trigger);
    var current = optMenu.querySelector(".opt-item--current") || optMenu.querySelector(".opt-item");
    if (current) current.focus();
  }

  /* The trigger shows whatever the select currently says, so everything that already
     rebuilds the options - fillSelect(), the url, Reset - keeps working untouched. */
  function syncOptTrigger(sel) {
    if (!sel || !sel.trigger) return;
    var o = sel.options[sel.selectedIndex];
    sel.trigger.querySelector(".opt-trigger-name").textContent = o ? o.textContent : "";
  }

  function enhanceSelect(sel, label) {
    if (!sel || !sel.parentNode) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "opt-trigger";
    b.setAttribute("aria-haspopup", "listbox");
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-label", label);
    b.innerHTML = '<span class="opt-trigger-name"></span>' +
                  '<span class="opt-trigger-caret" aria-hidden="true">&#9662;</span>';
    b.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    b.addEventListener("click", function (ev) { ev.stopPropagation(); openOptMenu(sel); });

    sel.trigger = b;
    sel.parentNode.insertBefore(b, sel);
    /* only now is the native one redundant - if any of the above had thrown, the field
       would still be a working select */
    sel.parentNode.classList.add("field--enhanced");
    syncOptTrigger(sel);
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
          /* no byline under Your lists - it would be your own name on every row, which
             says nothing. Whose a list is only becomes a question once it is someone
             else's, and that is the Following section below. */
          t.name, n,
          activeIsMine && activeTemplate && activeTemplate.id === t.id, "",
          function () { closeListMenu(); openById(t.id); }));
      });
    }

    /* The lists that ship with the site, for the phase on screen. zatar used to be
       hardcoded here as THE thing you were following when no template was open; he is one
       entry in data/lists/index.json now, and a phase with no bundled list simply shows
       no rows here. */
    var bundled = ootbForPhase();
    if (bundled.length) {
      listMenu.appendChild(menuSection("Starting points"));
      bundled.forEach(function (entry) {
        var loaded = ootbCache[entry.id];
        listMenu.appendChild(listRow(
          entry.name,
          loaded ? filledCount(loaded.priorities) : null,
          !!(activeTemplate && activeTemplate.id === entry.id),
          entry.author ? "by " + entry.author : "",
          function () { closeListMenu(); openOotb(entry); }));
      });
    }

    /* a list that arrived on a link is not in the store, so it needs a row of its own or
       the menu would claim a bundled list was the one on screen.

       This is where the credit CLAUDE.md section 8 promised actually lands: someone opens
       your link and the menu says whose calls they are reading. Only where the server
       attested it - see attestedAuthor(). Where it did not, the row falls back to saying
       how the list arrived rather than claiming a name nobody checked. */
    var isBundled = activeTemplate && OOTB.some(function (e) { return e.id === activeTemplate.id; });
    if (activeTemplate && !activeIsMine && !isBundled) {
      listMenu.appendChild(menuSection("Following"));
      var who = attestedAuthor(activeTemplate);
      listMenu.appendChild(listRow(activeTemplate.name, filledCount(activeTemplate.priorities),
        true, who ? "by " + who : "shared with you",
        function () { closeListMenu(); }));
    }

    listMenu.appendChild(document.createElement("hr"));
    listMenu.appendChild(menuItem("+  New list", "lm-item--new", function () {
      closeListMenu();
      startList(newBlankTemplate(), "A blank list - every priority is empty until you fill it in");
    }));

    listMenu.appendChild(document.createElement("hr"));
    listMenu.appendChild(menuSection(activeIsMine ? "This list" :
      activeTemplate ? activeTemplate.name : "No list open"));

    /* Said once, plainly, instead of silently offering fewer buttons and leaving the
       reader to notice what is missing. */
    if (!activeIsMine) {
      var note = document.createElement("p");
      note.className = "lm-note";
      /* The no-list case is said on the bar now (#list-warn), not in here: a warning you
         have to open a menu to find is not doing the job. */
      note.textContent = "You're reading this list. Make a copy to change anything.";
      if (activeTemplate) listMenu.appendChild(note);
    }

    if (activeIsMine) {
      listMenu.appendChild(menuItem("Seed empty rows from BiS", "", function () {
        closeListMenu(); seedFromBis();
      }));
      listMenu.appendChild(menuItem("Rename\u2026", "", function () {
        menuFace = "rename"; renderListMenu();
      }));
    }
    listMenu.appendChild(menuItem("Make a copy", "", function () {
      closeListMenu();
      var from = activeTemplate ? activeTemplate.name : "the loot table";
      startList(copyOfCurrent("Copy of " + from), "Copied " + from);
    }));
    /* Nothing about sharing lives here any more. It has its own control on the bar and
       its own popover, because an item four deep in a dropdown is not something people
       find - and Stop sharing belongs next to the link it stops, not next to Delete. */

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
      closeList();
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

  /* Would pressing Share PUBLISH something, or is there already a link to hand over?
     The popover asks this to decide which face to open on, and the answer is also what
     stops it publishing as a side effect of being looked at. */
  /* The publish face is for a list with nothing to hand out yet. That is now two
     conditions rather than one: never shared, or shared but never published - the
     second is what a list looks like between minting a link and deciding the draft is
     ready, and its link resolves to nothing until it is. */
  function shareWouldPublish() {
    return !!(activeTemplate && activeIsMine && signedIn() && supabaseReady()
              && (!activeTemplate.shared || !activeTemplate.published_at));
  }

  /* The link for whatever is on screen, as a promise. Three cases, and the third used to
     be a silent no-op: copyShareLink() opened with `if (!activeTemplate) return;`, so on
     zatar's list the menu offered Copy link, you pressed it, and nothing happened at all -
     no clipboard write, no message, no error. That is the first share control most people
     ever meet, since it is what you see before you have made a list of your own. */
  function shareLink() {
    /* Nobody's list: the page itself, filters and all. location.hash already carries
       phase, zone, boss, class, spec and the search - "here is what I am looking at" is
       a real thing to send someone, and it is what the dead item was pretending to do. */
    /* No list, or one that ships with the site: the page URL says it all. The hash
       carries the phase, the filters and now list=, so the recipient opens exactly what
       is on screen - and encoding a bundled list into #t= would send someone a 5,700
       character copy of a list they already have. */
    if (!activeTemplate || OOTB.some(function (e) { return e.id === activeTemplate.id; })) {
      return Promise.resolve(location.origin + location.pathname + location.hash);
    }
    var server = shareServerSide();
    if (server) return server.then(function (url) { refreshLists(); return url; });
    /* Signed out there is nothing in the database to point at, so the whole list travels
       in the link exactly as it always has. It is capped and frozen, and that is the
       honest trade for a site that has to work without a backend. */
    return encodeTemplate(activeTemplate).then(function (code) {
      return location.origin + location.pathname + "#t=" + code;
    });
  }

  /* What the link DOES, which differs by how it was made. Said next to the link rather
     than only in a toast, because it is the thing a person needs before sending it. */
  function shareBlurb(url) {
    if (!activeTemplate) return "Opens the page on the phase, zone and filters you have set.";
    if (url.indexOf("?s=") !== -1) {
      return "Anyone with this link can read the list, and sees your edits as you make them.";
    }
    return "This link carries the whole list, frozen as it is now - " +
           url.length + " characters, so it may be too long for some chat apps.";
  }

  function copyToClipboard(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(url).then(
        function () { announce("Link copied"); },
        function () { announce("Could not reach the clipboard - copy it from the box"); });
    }
    announce("Copy the link from the box");
    return Promise.resolve();
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

    if (el.shareTrigger) {
      /* both halves, for the same reason the list trigger does it: without the mousedown
         guard the document handler closes the popover and the click reopens it */
      el.shareTrigger.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
      el.shareTrigger.addEventListener("click", function (ev) {
        ev.stopPropagation();
        toggleSharePop();
      });
    }
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

  /* ---------- the share popover ----------
     The seventh overlay, and built like the other six: created once, parented to <body>
     so no scroll container can clip it, positioned by placeUnder() rather than by
     arithmetic of its own, closed by Escape and by an outside mousedown.

     Two faces, swapped in place, the way the list menu swaps rename and delete:

       "publish"  a list of yours, signed in, not shared yet. States what sharing does,
                  and a button to do it. This face exists so that OPENING the popover
                  never publishes - looking at a thing must not change it.
       "link"     the link in a field with Copy beside it, plus Stop sharing where there
                  is something to stop. Everything else opens straight onto this: signed
                  out, zatar's list, or a list already shared has nothing to publish. */

  var sharePop = null;

  function closeSharePop() {
    if (sharePop) sharePop.style.display = "none";
    if (el.shareTrigger) el.shareTrigger.setAttribute("aria-expanded", "false");
  }

  function buildSharePop() {
    sharePop = document.createElement("div");
    sharePop.className = "share-pop";
    sharePop.setAttribute("role", "dialog");
    sharePop.setAttribute("aria-label", "Share this list");
    sharePop.style.display = "none";
    document.body.appendChild(sharePop);

    sharePop.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); closeSharePop(); el.shareTrigger.focus(); }
    });
  }

  function renderSharePublishFace() {
    sharePop.innerHTML = "";
    var head = document.createElement("p");
    head.className = "share-head";
    head.textContent = "Share \u201c" + activeTemplate.name + "\u201d";
    sharePop.appendChild(head);

    var body = document.createElement("p");
    body.className = "share-note";
    /* It used to say readers "will see your edits as you make them", which stopped
       being true the moment publishing became a snapshot. A share panel that describes
       the wrong behaviour is worse than one that says nothing. */
    body.textContent = "Publishing gives you a short link to this list as it is right " +
      "now. Carry on editing afterwards - nobody sees those changes until you publish " +
      "again. You can stop sharing at any time.";
    sharePop.appendChild(body);

    var go = document.createElement("button");
    go.type = "button";
    go.className = "share-go";
    go.textContent = "Publish this list";
    go.addEventListener("click", function () {
      go.disabled = true;
      publishNow().then(function () { renderShareLinkFace(); });
    });
    sharePop.appendChild(go);
    go.focus();
  }

  /* Which render of this face is current. shareLink() is async, and the face is rebuilt
     whenever it is reopened or republished - so without this an earlier call resolving
     late writes its url into a field that has already been thrown away, and the one on
     screen stays on "Preparing..." for good. */
  var shareRender = 0;

  function renderShareLinkFace() {
    var mine = ++shareRender;
    sharePop.innerHTML = "";
    var head = document.createElement("p");
    head.className = "share-head";
    head.textContent = activeTemplate ? "Link to \u201c" + activeTemplate.name + "\u201d"
                                      : "Link to this view";
    sharePop.appendChild(head);

    var row = document.createElement("div");
    row.className = "share-row";
    var field = document.createElement("input");
    field.type = "text";
    field.className = "share-field";
    field.readOnly = true;
    field.value = "Preparing\u2026";
    field.setAttribute("aria-label", "Share link");
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "share-copy";
    copy.textContent = "Copy";
    copy.disabled = true;
    row.appendChild(field);
    row.appendChild(copy);
    sharePop.appendChild(row);

    var note = document.createElement("p");
    note.className = "share-note";
    sharePop.appendChild(note);

    shareLink().then(function (url) {
      if (mine !== shareRender) return;   /* a newer render owns the panel now */
      field.value = url;
      /* On a list of your own the useful line is not how long the link is, it is how
         far the draft has drifted from what the guild is actually reading. */
      /* Only on the account path. Signed out there is nothing to publish - the link IS
         the list - so that case keeps the warning about how long it is. */
      note.textContent = (activeTemplate && activeIsMine && signedIn() && supabaseReady())
        ? publishedBlurb(activeTemplate) : shareBlurb(url);
      copy.disabled = false;
      copy.addEventListener("click", function () {
        field.select();
        copyToClipboard(url);
      });
      field.focus();
      field.select();
      /* the link is longer than the field once published, and the panel is anchored
         under a button whose position has not moved - re-place in case it grew */
      placeUnder(sharePop, el.shareTrigger);

      /* Offered only when there is something to send, so the button is never a no-op */
      if (activeTemplate && activeIsMine && changedSincePublish(activeTemplate)) {
        var again = document.createElement("button");
        again.type = "button";
        again.className = "share-go";
        again.textContent = "Publish changes";
        again.addEventListener("click", function () {
          again.disabled = true;
          publishNow().then(function () { renderShareLinkFace(); });
        });
        sharePop.appendChild(again);
      }

      if (activeTemplate && activeIsMine && activeTemplate.shared) {
        var stop = document.createElement("button");
        stop.type = "button";
        stop.className = "share-stop";
        stop.textContent = "Stop sharing";
        stop.addEventListener("click", function () {
          closeSharePop();
          stopSharing();
        });
        sharePop.appendChild(stop);
      }
    }, function (err) {
      if (mine !== shareRender) return;
      field.value = "";
      note.textContent = "Could not make a link: " + err.message;
    });
  }

  function toggleSharePop() {
    if (!sharePop) buildSharePop();
    if (sharePop.style.display === "block") { closeSharePop(); return; }
    closePop();                       /* only one overlay at a time */
    closeOpMenu();
    closeListMenu();
    closeAcctMenu();
    sharePop.style.display = "block";
    el.shareTrigger.setAttribute("aria-expanded", "true");
    if (shareWouldPublish()) renderSharePublishFace();
    else renderShareLinkFace();
    placeUnder(sharePop, el.shareTrigger);
  }

  function makeShareToken() {
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* A link that carries a token instead of the list. The whole template used to travel
     in the URL, which capped what a list could hold - the notes are what would have
     broken it. This carries about thirty characters no matter how much the list says.

     It is also live: the recipient reads the row, so a call you fix reaches everyone
     holding the link. That is a real change from the frozen copy `#t=` gives, and it is
     why Stop sharing exists - a live link needs a way to stop being one. */
  function shareServerSide() {
    if (!activeTemplate) return null;
    if (!(signedIn() && supabaseReady() && activeIsMine)) return null;
    if (!activeTemplate.share_token) activeTemplate.share_token = makeShareToken();
    activeTemplate.shared = true;
    unsaved = true;
    return saveNow().then(function () {
      return location.origin + location.pathname + "?s=" +
        encodeURIComponent(activeTemplate.share_token) + location.hash;
    });
  }

  /* ---------- publishing ----------

     A list has two faces: the draft its owner edits, and the snapshot the share link
     hands out. Publishing copies one onto the other. The link never changes - it
     carries a token pointing at the row, and the row decides which version to serve.

     This is a plain update run as the signed-in owner, under the existing
     `auth.uid() = user_id` policy. It must NEVER become a security-definer function
     taking a share token: that would let anyone holding the read link publish over the
     draft, which is the one way this feature could be got badly wrong. */

  function publishNow() {
    if (!activeTemplate || !activeIsMine) return Promise.resolve();
    var t = activeTemplate;
    /* deep-copied, so later edits to the draft cannot reach into what was published */
    t.published_priorities = JSON.parse(JSON.stringify(t.priorities || {}));
    t.published_notes = JSON.parse(JSON.stringify(t.notes || {}));
    t.published_at = new Date().toISOString();
    unsaved = true;
    return saveNow();
  }

  /* How far the draft has moved from what the guild is reading. Counts items, not
     keystrokes, because "23 items changed" is the number a council can act on. */
  function changedSincePublish(t) {
    if (!t || !t.published_at) return 0;
    var pubP = t.published_priorities || {}, pubN = t.published_notes || {};
    var liveP = t.priorities || {}, liveN = t.notes || {};
    var ids = {}, count = 0;
    Object.keys(liveP).forEach(function (k) { ids[k] = 1; });
    Object.keys(pubP).forEach(function (k) { ids[k] = 1; });
    Object.keys(liveN).forEach(function (k) { ids[k] = 1; });
    Object.keys(pubN).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (k) {
      var pChanged = JSON.stringify(liveP[k] || []) !== JSON.stringify(pubP[k] || []);
      var nChanged = (liveN[k] || "") !== (pubN[k] || "");
      if (pChanged || nChanged) count++;
    });
    return count;
  }

  function publishedBlurb(t) {
    if (!t || !t.published_at) return "Not published yet - nobody can open the link.";
    var changed = changedSincePublish(t);
    var when = String(t.published_at).slice(0, 10);
    return changed
      ? "Published " + when + ". " + changed + (changed === 1 ? " item has" : " items have")
        + " changed since - publish again to send them."
      : "Published " + when + ". The link is up to date.";
  }

  function stopSharing() {
    if (!activeTemplate || !activeIsMine) return;
    activeTemplate.shared = false;
    unsaved = true;
    saveNow().then(function () {
      announce("Stopped sharing \u201c" + activeTemplate.name + "\u201d - the link no longer opens it");
      renderTemplateBar();
    });
  }

  /* Someone else's list, fetched by token. The table itself stays unreadable to an
     anonymous caller - this goes through a security-definer function that can only
     return a row that is both flagged shared and matched by an exact token. */
  function hasShareToken() {
    return /[?&]s=([^&]+)/.test(location.search);
  }

  function loadSharedByToken() {
    var m = /[?&]s=([^&]+)/.exec(location.search);
    if (!m) return false;
    if (!supabaseReady()) return true;    /* handled, just not yet - see initAuth */
    sb.rpc("get_shared_list", { token: decodeURIComponent(m[1]) }).then(function (res) {
      var row = res.data && res.data.length ? res.data[0] : null;
      if (res.error || !row) {
        /* A paused project fails as a transport error rather than an empty answer, and
           the raw message is a Postgres string nobody outside this repo can act on.
           Empty means the token is wrong or the list was unshared - both of which are
           the same thing to whoever is holding the link. */
        announce(res.error ? "That shared link could not be opened right now - try again in a moment"
                           : "That link does not open a list any more");
        update();
        return;
      }
      var why = validateTemplate(row);
      if (why) { announce("That shared list will not load: " + why); update(); return; }
      /* the server said so, not the payload - which is what lets its author be shown */
      row.sharedFrom = "server";
      openTemplate(row, false);
      announce("Opened shared list: " + row.name + " - Make a copy to change it");
      update();
    });
    return true;
  }

  function loadSharedTemplate() {
    if (loadSharedByToken()) return;
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
  /* ---------- the lists that ship with the site ----------
     Starting points somebody can open and copy - zatar's Phase 3 calls today, guest
     lists for other phases later. NOT a baseline: nothing falls back to them, and with
     none open the priority column is empty.

     Fails soft like bis.json. A missing or malformed index costs the options, not the
     page, and one list failing to load costs that one. */

  var OOTB = [];          /* index entries: id, name, phase, author, file */
  var ootbCache = {};     /* id -> the loaded template */

  function loadOotb() {
    return fetch(LISTS_URL, FRESH)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (doc) {
        OOTB = (doc && doc.lists) || [];
      })
      .catch(function (err) {
        if (window.console) console.warn("bundled lists unavailable:", err.message);
        OOTB = [];
      });
  }

  /* Loaded on demand and kept, so reopening one costs nothing. It goes through
     validateTemplate() exactly as a shared list does - a file that ships with the site
     is not more trustworthy than one that arrives on a link, it is just likelier to be
     right, and the same validator catches the same mistakes. */
  function openOotb(entry) {
    if (ootbCache[entry.id]) { openTemplate(ootbCache[entry.id], false); update(); return; }
    fetch("data/lists/" + entry.file, FRESH)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (doc) {
        var why = validateTemplate(doc);
        if (why) throw new Error(why);
        /* it came from this site's own files, so its author is attested the same way a
           ?s= list's is - see attestedAuthor() */
        doc.sharedFrom = "server";
        ootbCache[entry.id] = doc;
        openTemplate(doc, false);
        announce("Opened " + doc.name);
        update();
      })
      .catch(function (err) {
        announce("That list would not open: " + err.message);
      });
  }

  function ootbForPhase() {
    return OOTB.filter(function (e) { return !e.phase || e.phase === state.phase; });
  }

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
    loadBis(),
    loadOotb()
  ])
    .then(function (results) {
      var data = results[0];
      ALL = data;
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
        '<p class="empty error">Could not load <code>' + DATA_URL + "</code> (" + escapeHtml(err.message) +
        "). If you opened this file directly from disk, run a local server instead: " +
        "<code>python -m http.server</code></p>";
    });
})();
