/* The JS mirror of data/rules.json: every table three languages agree on, filled once at boot by applyRules(). */

export var RULES = null;
/* Filled by applyRules() from data/rules.json at boot, where the phases live alongside
   every other table three languages have to agree on. World Bosses sits with Phase 1
   because Doomwalker and Doom Lord Kazzak were there from launch: a zone in the same
   sense Crafted is, a source of loot rather than an instance. */
export var PHASES = [];
/* Every zone, in phase order - which is also kill order across the expansion, so
   bossSortKey() can go on using the index of this list. */
export var ZONE_ORDER = [];   // derived from PHASES in applyRules()
/* Tier 4 and Tier 5 share one set of groupings, Tier 6 uses another - Priest is with
   Warlock at T6 and with Warrior at T4/T5 - so these are six entries and not three
   under different names. Taken from the tokens' own "Classes:" lines. */
export var TIER_CLASSES = {}; // from rules.json - six groupings, since T4/T5 pair classes differently from T6
export var ARMOUR_RANK = {};  // from rules.json
export var RELIC_CLASS = {};  // from rules.json
/* From data/rules.json. "?" is not an ordering at all: these names are listed, and
   nobody has said which comes first. It does not advance, because a rank nobody has
   decided is not a rank - all of them share one position, the way a tie does. It is
   what the BiS view uses between the specs an item is best-in-slot for, and it is a
   real operator rather than a display trick so that a line you seed and have not got
   to yet says the same thing as one the site drew for you. */
export var OPERATORS = {};
export var OP_LIST = [];      // from rules.json
export var DOUBLE_SLOTS = {}; // from rules.json
export var BIS_LONGEVITY_BY_NAME = {};  // from rules.json
/* Qualifiers that say nothing once they reach a tooltip. "Best Overall" is how Wowhead
   marks the piece that is simply best REGARDLESS of the two specialised sets beside it -
   37 of its 41 entries are tanks, sitting alongside that spec's Best Threat and Best
   Mitigation rows. So it is the absence of a condition, and "Multi-phase BiS - Overall"
   spends a suffix announcing that no suffix applies.

   Suppressed at render, not stripped from the data: bis.json records what the guide
   actually wrote, which is what verify/dump_bis_raw.py audits against. */
export var SILENT_VARIANTS = {};  // from rules.json: a variant whose label is null
/* Qualifiers whose stored slug does not read as English once a capital is put on it.
   Everything else goes through charAt(0).toUpperCase() below and comes out fine -
   "Hit", "Threat", "Contested" - so this holds only the exceptions, the way
   SILENT_VARIANTS above holds only the one qualifier worth suppressing.

   The slug is what bis.json stores and check_bis.py's closed vocabulary admits, and it
   stays short and hyphenated for that; this is the sentence a reader gets. Keeping the
   two separate is why a rewording is a one-line change here and not a data migration. */
export var VARIANT_LABEL = {};    // from rules.json: every variant's label, so the slug never renders
/* the phases in release order, which is the order "survives to" means */
export var PHASE_IDS = [];    // derived from PHASES in applyRules()
/* The rules three languages agree on - operators, slot capacity, the variant vocabulary,
   the phases - come from ONE file, and this is where the page takes them. Not fail-soft
   like bis.json: without operators nothing in the priority column can be validated or
   drawn, so a missing file is the same kind of failure as a missing loot_data.json. */
export function applyRules(doc) {
  RULES = doc;
  PHASES = doc.phases;
  ZONE_ORDER = PHASES.reduce(function (all, p) { return all.concat(p.zones); }, []);
  PHASE_IDS = PHASES.map(function (p) { return p.id; });
  OPERATORS = doc.operators;
  OP_LIST = doc.operatorOrder;
  DOUBLE_SLOTS = {};
  doc.doubleSlots.forEach(function (s) { DOUBLE_SLOTS[s] = 1; });
  ARMOUR_RANK = doc.armourRank;
  RELIC_CLASS = doc.relicClass;
  TIER_CLASSES = doc.tierClasses;
  BIS_LONGEVITY_BY_NAME = doc.longevity;
  SILENT_VARIANTS = {};
  VARIANT_LABEL = {};
  Object.keys(doc.variants).forEach(function (v) {
    if (doc.variants[v].label === null) SILENT_VARIANTS[v] = true;
    else VARIANT_LABEL[v] = doc.variants[v].label;
  });
}
