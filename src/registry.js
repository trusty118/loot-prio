/* The spec registry, what an item suits, and how a selection speaks to a priority. */
import { BARE_WEAPON, SLOT_ORDER, TYPE_LABEL, slotGroup, tierClasses } from "./data.js";
import { bisPick, update } from "./results.js";
import { ARMOUR_RANK, OPERATORS, RELIC_CLASS, TIER_CLASSES } from "./rules.js";
import { activeIsMine, activeTemplate, state } from "./state.js";
import { effectivePriority } from "./templates.js";

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

/* Layer 1 on its own: can this class physically use the item at all? */
export function canUse(clsId, rec) {
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
export function suitsItem(rec, specId) {
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
export function classSuitsItem(rec, clsId) {
  return (CLASS_SPECS[clsId] || []).some(function (id) { return suitsItem(rec, id); });
}

/* Does this one class satisfy the role and type filters simultaneously? A token
   surfaces under "Caster + Cloth" only if one and the same class is both -
   Conqueror has a tank (Paladin) and cloth wearers (Priest/Warlock), but no
   cloth tank, so it must not match. */
export function classPasses(cls, skip) {
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
export function entrySpeaksTo(entry, clsId, specId) {
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
export function entrySpec(entry) {
  var form = entry.form && REG.forms[entry.spec] && REG.forms[entry.spec][entry.form];
  return (form && form.spec && REG.specs[form.spec]) ? form.spec : entry.spec;
}

/* The specs an umbrella stands for. FeralDruid covers bear and cat, which gear
   so differently that one BiS set can't serve both, but the priorities name the
   umbrella - so an umbrella answers for whichever of its specs is asked about. */
export function covers(specId) {
  var spec = REG.specs[specId];
  return (spec && spec.covers) || [];
}

/* An empty priority matches nobody, which is how the 23 "whoever needs it" rows
   drop out while a class or spec is selected: the filter asks where you stand in
   a line, and those rows name no line. */
export function priorityHas(rec, clsId, specId) {
  return (effectivePriority(rec) || []).some(function (e) {
    return entrySpeaksTo(e, clsId, specId);
  });
}

/* Which specs of one class the user has narrowed to; empty means the whole class.
   Refining Mage to Fire must not quietly narrow a Warlock picked alongside it, so
   each class is resolved on its own and the results are unioned. */
export function pickedSpecs(clsId) {
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
export function focusOn(id) {
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

export function selectionSpeaksTo(entry) {
  return state.classes.some(function (clsId) {
    var picked = pickedSpecs(clsId);
    if (!picked.length) return entrySpeaksTo(entry, clsId, "");
    return picked.some(function (id) { return entrySpeaksTo(entry, clsId, id); });
  });
}

/* Both of these ask the list actually on screen, not the guide underneath it: with
   a template open, reading rec.priority would filter by his ordering while showing
   yours, and a list you had only just started would go on matching all 195 rows. */
export function selectionHas(rec) {
  return (effectivePriority(rec) || []).some(selectionSpeaksTo);
}

/* The specs the current selection actually stands for: a class with none of its
   specs picked means all of them. Recomputed once per update() rather than per
   record, since matches() runs it across every row for every chip. */
export var SELECTED_SPECS = [];

export function indexSelection() {
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
export function bisOnlyMatch(rec) {
  if (activeIsMine) return false;
  /* Only where the list says NOTHING about the item - no key at all. A key holding an
     empty line is a deliberate "whoever needs it", and 23 of zatar's are exactly that:
     he answered, and the answer was nobody in particular. Bridging those would put a
     row into a filter that asks "where do I stand in this line" when the author's point
     was that there is no line. An absent key is the different thing: not an answer. */
  if (activeTemplate && activeTemplate.priorities[rec.id]) return false;
  return SELECTED_SPECS.some(function (id) { return bisPick(id, rec.id); });
}

export function typeLabel(rec) {
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
export function typeGroup(rec) {
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
export var SORT_KEYS = {
  item: function (r) { return r.item.toLowerCase(); },
  slot: function (r) { return SLOT_ORDER.indexOf(slotGroup(r.slot)); },
  type: function (r) { return typeLabel(r).toLowerCase(); }
};

export var ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large/";

/* The class/spec/race registry, loaded from data/specs.json. Identifiers are
   what the data files store; `name` is display only. Replaces the hardcoded
   SPECS/CLASS_INFO tables that used to live here - a spec is now a data edit,
   not a code edit. */
export var REG = { classes: {}, specs: {}, forms: {}, races: {}, aliases: {} };

/* registry identifier -> the shorthands people type for it. Search-only; see
   priorityText(), which is the one thing that reads it. */
export var ALIAS_WORDS = {};

/* classId -> its spec identifiers, derived rather than stored: it is the same
   fact as spec.class, and two copies of one fact drift. */
export var CLASS_SPECS = {};

export function indexRegistry(doc) {
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
export function resolveEntry(entry) {
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

/* Fold a priority list into 1-based positions: ties share a position. */
export function positions(list) {
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
export function priorityText(list) {
  return (list || []).map(function (entry) {
    var r = resolveEntry(entry);
    if (!r) return "";
    var words = (r.race ? r.race.name + " " : "") + r.name;
    var also = r.id && ALIAS_WORDS[r.id];
    return also ? words + " " + also.join(" ") : words;
  }).join(" ");
}
