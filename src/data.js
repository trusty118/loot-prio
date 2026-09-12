/* Constants, URLs, the zone and boss tables, icon urls, type groupings, and the data loaders. */
import { indexRegistry } from "./registry.js";
import { PHASES, TIER_CLASSES } from "./rules.js";


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
export var FRESH = { cache: "no-cache" };

export var DATA_URL = "data/loot_data.json";
export var BIS_URL = "data/bis.json";
export var SPECS_URL = "data/specs.json";
export var LISTS_URL = "data/lists/index.json";
export var RULES_URL = "data/rules.json";

/* Encounter order per zone (the JSON is not in kill order). */
/* Kill order per zone. The seven zones outside Phase 3 have no items yet, so their
   chips all read 0 - they are here so the phases open onto something real, and so a
   boss has a name to arrive under. Trash is listed for the raids that actually drop
   it; Gruul's Lair and Magtheridon's Lair get none, which is why they have none. */
export var BOSS_ORDER = {
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
  /* No kill order to speak of - two bosses standing in two different zones, which is
     the point of them. Listed largest-first the way the raids are. */
  "World Bosses": [
    "Doomwalker",
    "Doom Lord Kazzak"
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

/* The order zones are listed in is load-bearing, not cosmetic: ZONE_ORDER derives from
   it, and ZONE_ORDER decides the zone chip row, the order of the art strips on a phase
   tile, and - through bossSortKey() - the order boss groups appear in the table. Change
   it and all three move together, which is the point. */

/* The raids of a phase, which is not quite its zones: the crafted pseudo-zone has no
   bosses and no art, so it has no strip on the tile. Having a boss list is the test,
   rather than naming it, so a future crafted-style zone behaves the same. Its name is
   still on the tooltip - the phase does cover it, it just cannot be pictured. */
export function phaseRaids(id) {
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
export var CURRENT_PHASE = "P3";

export function defaultPhase() {
  return CURRENT_PHASE;
}

export function phaseZones(id) {
  for (var i = 0; i < PHASES.length; i++) {
    if (PHASES[i].id === id) return PHASES[i].zones;
  }
  return [];
}

/* Each phase has its own crafting tier, named for the material it is gated on, and
   both render as plain "Crafted" - they are never on screen together, because the
   phase above them decides which one is. */
export var ZONE_LABEL = {
  "Crafted (Nether Vortex)": "Crafted",
  "Crafted (Heart of Darkness)": "Crafted",
  "Crafted (Sunmote)": "Crafted"
};

/* Encounter Journal boss portraits (128x64 PNG). TBC bosses have no achievement
   icons - those postdate them - but Legion backfilled the Adventure Guide, so
   these exist. The slugs are irregular: apostrophes vanish without a hyphen
   (najentus, kazrogal) and the Illidari Council has no leading "the". Verified
   forms, do not tidy. */
export var JOURNAL = "https://wow.zamimg.com/images/wow/journal/ui-ej-boss-";
export var ICON = "https://wow.zamimg.com/images/wow/icons/large/";

export var BOSS_ICON = {
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
export var ZONE_ICON = {
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
  "Sunwell Plateau": JOURNAL + "kiljaeden.png",
  /* THE FEL REAVER'S portrait, standing in for Doomwalker. The Encounter Journal has
     nothing for either world boss - they never stood in an instance, and every
     ui-ej-boss-doomwalker slug is a 404 - but Doomwalker is the same kind of fel
     construct and Wowhead does have art for the Fel Reaver.

     It matters that this is journal art rather than an item icon: at 128x64 it frames
     exactly like every other zone tile, where a square icon has to be letterboxed by
     .chip--emblem and reads as a different kind of thing. */
  "World Bosses": JOURNAL + "felreaver.png"
};

/* Slots as the character sheet presents them: every weapon slot is one "Weapon" entry.

   Ranged and Relic were collapsed into one "Ranged/Relic" option until Sep 2026, on the
   grounds that they share a paper-doll slot and no class has both. They are still one
   slot on the character, but they are not one QUESTION: a hunter scanning for a bow and
   a druid scanning for an idol were both handed the other's items, and the label was the
   only thing on the row that named two things at once. Ranged is guns, bows, crossbows,
   thrown and wands; Relic is idols, totems and librams. */
export var SLOT_GROUP = {
  "One-Hand": "Weapon",
  "Main-Hand": "Weapon",
  "Off-Hand": "Weapon",
  "Two-Hand": "Weapon"
};

export function slotGroup(slot) {
  return SLOT_GROUP[slot] || slot || "";
}

export var SLOT_ORDER = [
  "Head", "Neck", "Shoulder", "Back", "Chest", "Wrist", "Hands", "Waist",
  "Legs", "Feet", "Finger", "Trinket", "Weapon", "Ranged", "Relic"
];

/* The raw `type` field has 30+ values; collapse them into usable buckets. */
export var TYPE_GROUPS = [
  "Cloth", "Leather", "Mail", "Plate",
  "Weapons - 1H", "Weapons - 2H", "Ranged",
  "Shield / Off-hand", "Cloak", "Jewellery", "Relic"
];

/* Nothing is hidden from the type dropdown any more. "Tier Token" used to be,
   because the Tier role chip selected exactly those 15 items - with the role
   filter gone, the dropdown is the only way to reach them. */
export var HIDDEN_TYPES = {};

/* Display-only tidy-up of the raw type. Staves and polearms are two-handed by
   definition, so the "2H" prefix is noise. Relabelled at render time rather
   than in the data, so `type` stays as the item DB records it and typeGroup()
   can still key off the 2H prefix. */
export var TYPE_LABEL = {
  "2H Staff": "Staff",
  "2H Polearm": "Polearm"
};

/* These arrive with no hand count at all. The Slot column used to supply it,
   but slots now collapse to a single "Weapon", so the type has to carry it. */
export var BARE_WEAPON = { "Mace": 1, "Sword": 1, "Dagger": 1, "Axe": 1, "Fist": 1 };

/* Tier tokens render as the three class icons. Which classes each token serves
   is fixed by the game, so it stays here; everything about those classes -
   icon, armour, roles - comes from the registry. */

export function tierClasses(rec) {
  return TIER_CLASSES[rec.type] || null;
}

export function fetchJson(url) {
  return fetch(url, FRESH).then(function (res) {
    if (!res.ok) throw new Error(url + ": HTTP " + res.status);
    return res.json();
  });
}

/* Fetched raw here and indexed in boot, AFTER applyRules(): indexBis() reads PHASE_IDS,
   and the fetches run in parallel, so the rules may not have landed when this resolves. */
export function loadBis() {
  return fetchJson(BIS_URL).catch(function (err) {
    if (window.console) console.warn("BiS data unavailable, rings disabled:", err.message);
    return null;
  });
}

/* The registry is not optional the way bis.json is - without it nothing in the
   priority column can be drawn - but a failure should still leave a readable
   table rather than a blank page, so it warns and carries on. */
export function loadRegistry() {
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
