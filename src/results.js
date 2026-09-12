/* The results table: the BiS index, rings, priority cells, rows, groups, and update(). */
import { renderTemplateBar } from "./bar.js";
import { renderBossChips, renderClassChips, renderPhaseChips, renderSelects, renderSpecChips, renderZoneChips } from "./controls.js";
import { BOSS_ICON, phaseZones, slotGroup, tierClasses } from "./data.js";
import { clearNote, setNote } from "./editing.js";
import { editablePriorityCell } from "./editor.js";
import { filtered, sortRows, writeUrl } from "./filter.js";
import { NO_BOSS, bossLabel, bossSortKey, escapeHtml, highlight, zoneLabel } from "./helpers.js";
import { CLASS_SPECS, ICON_BASE, REG, SELECTED_SPECS, classPasses, covers, focusOn, indexSelection, pickedSpecs, resolveEntry, selectionSpeaksTo, typeLabel } from "./registry.js";
import { OPERATORS, PHASES, PHASE_IDS, SILENT_VARIANTS, VARIANT_LABEL } from "./rules.js";
import { ALL, activeTemplate, el, state } from "./state.js";
import { showsSpec } from "./store.js";
import { MAX_NOTE, canEdit, effectiveNotes, effectivePriority, inTemplate, visiblePriority } from "./templates.js";

/* ---------- rendering: results ---------- */

export function itemCell(rec) {
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
export function appendText(parent, text, needle) {
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
export var BIS_LONGEVITY = {
  1: { cls: "spec-icon--bis", label: "Phase BiS" },
  2: { cls: "spec-icon--bis2", label: "Multi-phase BiS" },
  3: { cls: "spec-icon--bis3", label: "Expansion BiS" },
  /* Rare blue, Sep 2026. 215 entries a guide listed as "Best" past what the slot can
     hold - by its own row order the second or third choice. They were stored, validated
     and drawn by NOTHING, which is why an item could look unwanted when a guide had
     named it. Blue sits below epic on the same quality ladder the other three borrow,
     so "an alternative" reads as "a rung down" without a new vocabulary. */
  4: { cls: "spec-icon--alt", label: "Alternate BiS" }
};

/* The OTHER axis, and it is independent of the three above: a ring is dotted when the
   guide only ever called the item best under a condition - "Best - Hit", "Regen BiS",
   "BiS - Dagger". Those are real BiS calls and keep their colour; the broken edge is
   what stops an item that is merely the hit-rating choice reading as the flat answer.
   Halberd of Desolation is the case that prompted it: "Best - Hit" in every hunter
   phase, shown as solid gold. */
export var BIS_CONDITIONAL_CLASS = "spec-icon--cond";

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
export var BIS_INDEX = { wowhead: {}, wowsims: {}, custom: {} };

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
/* ONE answer per item, shown in every phase it appears - not "how long does it serve
   from here", which is what this computed until Sep 2026. That version could only ever
   decay down the ladder: gold in P3, gold in P4, purple in P5, because from the last
   phase an item has nothing left to outlive. The colour is read as a property of the
   ITEM, so a ring that changed colour with the phase you were looking at was answering
   a question nobody asked.

   Must stay in step with tier_from() in verify/fetch_bis.py - that writes the stored
   `bis` field, this draws the ring, and a test asserts the rule reproduces every
   stored value. */
export function longevityOf(listedByPhase, phases, itemId) {
  var last = phases[phases.length - 1];
  var seen = 0;
  for (var i = 0; i < phases.length; i++) {
    if (listedByPhase[phases[i]] && listedByPhase[phases[i]][itemId]) seen++;
  }
  if (seen < 2) return 1;
  return (listedByPhase[last] && listedByPhase[last][itemId]) ? 3 : 2;
}

export function indexBis(doc) {
  BIS_INDEX = { wowhead: {}, wowsims: {}, custom: {} };
  indexOneSource(BIS_INDEX.wowhead, (doc && doc.specs) || {}, function (e) {
    /* A guide lists several rows as "Best" in one slot and says which is actually BiS
       through row order. fetch_bis.py marks everything past what the slot holds. A
       near-BiS row is not BiS and still makes no claim about how long anything lasted -
       it just draws a blue ring now instead of nothing at all. */
    if (!e || e.id == null) return null;
    return { id: e.id, variant: e.variant || "",
             conditional: !!e.conditional, near: !!e.near };
  });
  indexOneSource(BIS_INDEX.wowsims, (doc && doc.wowsimsPresets) || {}, function (id) {
    /* a preset is a bare list of item ids - no qualifier, and no ranking to lose */
    return id != null ? { id: id, variant: "" } : null;
  });
}

/* Two passes per spec, and the first is what makes the derivation possible: you cannot
   know how long an item lasts until you have read every phase it might last into. Only
   the phases this source actually holds are considered, in release order. */
export function indexOneSource(into, bySpec, read) {
  Object.keys(bySpec).forEach(function (specName) {
    var raw = bySpec[specName] || {};
    var phases = PHASE_IDS.filter(function (p) { return raw[p]; });

    /* Near-BiS rows are deliberately absent from `listed`: an alternative must not
       prove an item survived a phase, or a third-choice sword would look like the item
       lasting. They ARE indexed below, at longevity 4, because they now draw a blue
       ring - being shown and counting as evidence are different things. */
    var listed = {};
    phases.forEach(function (phase) {
      listed[phase] = {};
      (raw[phase] || []).forEach(function (row) {
        var e = read(row);
        if (e && !e.near) listed[phase][e.id] = true;
      });
    });

    phases.forEach(function (phase) {
      (raw[phase] || []).forEach(function (row) {
        var e = read(row);
        if (!e) return;
        into[phase + "|" + specName + "|" + e.id] = {
          longevity: e.near ? 4 : longevityOf(listed, phases, e.id),
          variant: e.variant,
          conditional: !e.near && !!e.conditional
        };
      });
    });
  });
}

/* Keyed by the registry identifier (ProtWarr), matching data/bis.json, and scoped to
   the phase on screen: a Sunwell item is not BiS for someone reading Phase 3, and a
   ring that ignored the phase would answer "BiS at some point" rather than "BiS for me
   now" - which is the question a loot council is actually asking. */
/* `phase` is optional and almost always omitted - what is BiS is asked about the phase
   on screen. Seeding is the exception: it fills a whole list at once, so it has to ask
   about each item's OWN phase rather than the one you happen to be looking at. */
export function bisAt(specId, itemId, phase) {
  var idx = BIS_INDEX[state.bisSource] || BIS_INDEX.wowhead;
  return idx[(phase || state.phase) + "|" + specId + "|" + itemId] || null;
}

export function bisVariant(specId, itemId) {
  var hit = bisAt(specId, itemId);
  return hit ? hit.variant : "";
}

export function bisTier(specId, itemId, phase) {
  var hit = bisAt(specId, itemId, phase);
  return hit ? hit.longevity : 0;
}

export function bisConditional(specId, itemId, phase) {
  var hit = bisAt(specId, itemId, phase);
  return !!(hit && hit.conditional);
}

/* "Is this item actually BiS for that spec", as opposed to "does it draw a ring".
   Since Sep 2026 bisTier() also answers 4 for a near-BiS alternative, which draws a
   blue ring but is NOT the pick - so it must not seed a list, satisfy the BiS only
   filter, or bridge a row through bisOnlyMatch(). Those all ask the first question;
   only the rendering asks the second. */
export function bisPick(specId, itemId, phase) {
  var t = bisTier(specId, itemId, phase);
  return t >= 1 && t <= 3 ? t : 0;
}

/* What ring an icon should carry, and who it is for. A spec icon answers for
   itself. A class icon answers for the specs behind it: bis.json is keyed by
   spec, but 104 of the 398 priority entries name a class, so an item that is
   BiS for Arcane usually sits on a row that says "Mage" - without this most of
   the file would never appear. The highest tier among those specs wins, and
   the names ride along so the tooltip can say who.

   While a filter is on, only the selected specs count: the ring should answer
   "is this BiS for me", not "for someone in this class". */
export function bisMark(resolved, itemId) {
  var stands_for = covers(resolved.id);

  if (REG.specs[resolved.id] && !stands_for.length) {
    return { tier: bisTier(resolved.id, itemId), specs: [],
             variant: bisVariant(resolved.id, itemId),
             conditional: bisConditional(resolved.id, itemId) };
  }

  /* an umbrella spec aggregates like a class does, over the specs it covers */
  var ids = stands_for.length ? stands_for : (CLASS_SPECS[resolved.id] || []);
  var picked = stands_for.length
    ? stands_for.filter(function (id) { return state.specs.indexOf(id) !== -1; })
    : pickedSpecs(resolved.id);
  if (picked.length) ids = picked;

  /* Same rule as the filter above it, for the same reason: with the meta toggle on, a
     class icon must not ring because of a spec the toggle is hiding - the ring would
     be answering for somebody who is not on the page. Never empties the list, since a
     class with no meta specs left has nothing to ring anyway. */
  ids = ids.filter(showsSpec);

  /* A class icon can stand for two specs wanting the item for opposite reasons - a
     Prot Warrior's threat piece is a Fury Warrior's plain BiS. Only carry a qualifier
     up when every ringed spec behind the icon agrees on it; otherwise the icon would
     claim one spec's reason on behalf of all of them. */
  var tier = 0, names = [], variants = {}, allCond = true;
  ids.forEach(function (id) {
    var t = bisTier(id, itemId);
    if (!t) return;
    /* "Highest" is not the numeric maximum: 4 is the near-BiS blue, which sits BELOW
       the three real tiers rather than above them. Ranking it 0 keeps a class icon
       showing the best thing any of its specs actually has, so an alternative for one
       spec never outranks a genuine expansion pick for another. */
    if (bisRank(t) > bisRank(tier)) tier = t;
    if (!bisConditional(id, itemId)) allCond = false;
    names.push(shortSpecName(id, resolved.name));
    variants[bisVariant(id, itemId)] = 1;
  });
  var agreed = Object.keys(variants);
  /* Dotted only when EVERY spec behind the icon is conditional. If one of them has the
     item outright, the class does have an unconditional pick, and a broken ring would
     understate it - the same reasoning the variant line above already follows. */
  return { tier: tier, specs: names, variant: agreed.length === 1 ? agreed[0] : "",
           conditional: names.length > 0 && allCond };
}

/* Where a longevity sits on the quality ladder. 4 (near-BiS blue) is rare quality,
   below epic, so it ranks under the three BiS tiers rather than over them. */
export function bisRank(t) {
  return t === 4 ? 0.5 : (t || 0);
}

/* These names only ever appear on the icon they belong to, listing what it
   stands for, so repeating that icon's own name after each one says nothing:
   "Discipline Priest" under Priest is "Discipline", and "Feral Druid (cat)"
   under Feral Druid is "cat". Falls back to the full name if neither fits. */
export function shortSpecName(id, parentName) {
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

export function specIcon(spec, bis, forSpecs, variant, conditional) {
  var lasts = BIS_LONGEVITY[bis];
  var img = document.createElement("img");
  img.className = "spec-icon" + (lasts ? " " + lasts.cls : "") +
    (lasts && conditional ? " " + BIS_CONDITIONAL_CLASS : "");
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
  /* "Phase BiS - Hit". The qualifier used to arrive in brackets behind the word
     "Conditional", which named the condition twice; a dash reads as one phrase and puts
     the tier - the thing actually being looked up - at the front.

     The DASHED RING is what says "conditional" now. 18 conditional entries have no
     qualifier to name, because `conditional` is a property of the item and those
     particular listings are the plain one: they show a broken ring and an unadorned
     label, which is the ring carrying it alone. */
  var shown = SILENT_VARIANTS[variant] ? "" : (VARIANT_LABEL[variant] || variant);
  var bisLine = lasts ? lasts.label + (shown ? " - " + shown : "") : "";

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
export function makeFocusable(icon, id) {
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
/* WITH NO LIST OPEN, the column shows what the BiS data knows: every spec this item is
   best-in-slot for, in the phase on screen, from the selected source.

   Without this the whole thing is invisible. Rings hang off spec icons in the priority
   column, and with no list there are no icons - so 1,889 BiS entries and the BIS FROM
   control had nothing to show, while bisOnlyMatch() went on filtering by them. The data
   could narrow the table and could not be looked at, which is a strange pair.

   IT MUST NOT READ AS A RANKING, because nobody has ranked these. Three things keep it
   honest: no operators, which is what makes a priority line an ordering rather than a
   set; registry order rather than any order that implies preference; and a quiet BIS
   label, without which icons under a column headed PRIORITY simply read as a priority.

   Only when NO list is open. With one open, an item it does not rank stays blank - that
   is the list saying nothing, and filling it in would make the list look like it ranks
   things it does not. Deliberately narrower than bisOnlyMatch(), which bridges the
   FILTER whenever a list is silent: a filter that reaches too far shows you an extra
   row, a display that reaches too far tells you something untrue. */
export function bisViewCell(td, rec) {
  /* Shown when NO list is open, and - since Sep 2026 - also when the open list has no
     key for this item at all.

     That second case is not the same as a list holding an empty priority. `[]` is
     somebody answering "whoever needs it", and 23 of zatar's rows are exactly that;
     filling those in would overwrite an answer with a different claim. A MISSING key is
     the list never having mentioned the item - his videos covered Black Temple and Mount
     Hyjal but skipped 13 of their drops - so there is no answer to overwrite.
     inTemplate() is the distinction, and !![] being true is what makes it work.

     It also closes a gap the page had on both sides of: bisOnlyMatch() already let these
     rows through the FILTER on their BiS, so with a spec picked you could land on a row
     that matched BECAUSE it was BiS for you and then showed nothing saying why.

     Never while editing: these icons are not in the list, so they must not look like
     entries you can drag, reorder or delete. An editable empty cell offers its + instead. */
  if (canEdit()) return td;
  if (activeTemplate && inTemplate(rec)) return td;

  var specs = Object.keys(REG.specs).filter(function (id) {
    /* Alternates included, since Sep 2026: this view answers "what is BiS here", and
       a guide's second choice is part of that answer. It draws a blue ring, which is
       a rung down rather than a claim. +30 icons on Phase 3, worst row 9. */
    return bisTier(id, rec.id) && showsSpec(id);
  });
  if (!specs.length) return td;

  var picking = state.classes.length > 0;
  specs.forEach(function (id, i) {
    /* "?" between them - not ranked against each other. The column used to leave them
       bare, which said the same thing by ABSENCE and left the reader to notice it. An
       operator that names the state is the same claim made out loud, and it reads the
       way every other line on the page reads. */
    if (i > 0) {
      var sep = document.createElement("span");
      sep.className = "prio-op";
      sep.textContent = "?";
      sep.dataset.tip = OPERATORS["?"].label;
      td.appendChild(sep);
    }
    var spec = REG.specs[id];
    var icon = specIcon({ id: id, name: spec.name, icon: spec.icon },
                        bisTier(id, rec.id), [], bisVariant(id, rec.id),
                        bisConditional(id, rec.id));
    /* the same "not you" dimming a priority line uses, so a selection reads the same
       way whichever the column is showing */
    if (picking && SELECTED_SPECS.indexOf(id) === -1) {
      icon.classList.add("spec-icon--muted");
    }
    makeFocusable(icon, id);
    td.appendChild(icon);
  });
  return td;
}

export function priorityCell(rec) {
  var td = document.createElement("td");
  td.className = "col-prio";
  var list = effectivePriority(rec);

  if (typeof list === "string") {
    /* pre-migration data, or a bad hand-edit: show it rather than blank the cell */
    if (window.console) console.warn("priority is still a string on " + rec.item);
    appendText(td, list, state.q);
    return td;
  }
  if (!list || !list.length) return bisViewCell(td, rec);

  /* The meta-specs toggle, and the one place it must NOT reach: the editor. Remove,
     the operator menu and every drop target index into the REAL array - setOp(list, at,
     op) takes a position - so acting on a filtered copy would edit the wrong entry, or
     silently delete something that is not on screen. Same reason spec-icon click-to-
     filter is added here rather than in specIcon(): the editor's press starts a drag,
     and a mode should not quietly change what a gesture acts on. */
  if (!canEdit()) list = visiblePriority(list);
  if (!list.length) return td;

  /* The SEEDED tag stood here. It marked lines seed_priority.py wrote from the BiS
     data, and those are gone: every one was exactly the specs bis.json already lists,
     so they duplicated data the page draws as rings anyway. Seeding is an action on a
     list of your own now - see seedPriorities(), which every new list runs once - and a
     line you seeded and then ordered is yours, so there is nothing left to disclaim. */

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
    var icon = specIcon(resolved, mark.tier, mark.specs, mark.variant, mark.conditional);
    if (muted) icon.classList.add("spec-icon--muted");
    makeFocusable(icon, resolved.id);
    td.appendChild(icon);
  });

  return td;
}

export function renderRow(rec) {
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

export function notesCell(rec) {
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
export function editableNotesCell(rec) {
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
export function sortableTh(label, key) {
  var active = state.sort === key;
  var arrow = active ? (state.dir === "asc" ? "▲" : "▼") : "▴▾";
  return '<th class="sortable' + (active ? " is-sorted" : "") + '"' +
    ' data-sort="' + key + '"' +
    ' aria-sort="' + (active ? (state.dir === "asc" ? "ascending" : "descending") : "none") + '"' +
    ' tabindex="0" role="button"' +
    ' title="Sort by ' + escapeHtml(label) + '">' +
    escapeHtml(label) + '<span class="sort-arrow">' + arrow + "</span></th>";
}

export function toggleSort(key) {
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
export function renderGroup(zone, boss, rows) {
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
export function phaseIsEmpty() {
  var zones = phaseZones(state.phase);
  return !ALL.some(function (r) { return zones.indexOf(r.zone) !== -1; });
}

export function phaseLabel(id) {
  for (var i = 0; i < PHASES.length; i++) {
    if (PHASES[i].id === id) return PHASES[i].label;
  }
  return id;
}

export function blankListFiltered() {
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
export function phaseTotal() {
  var zones = phaseZones(state.phase);
  var n = 0;
  for (var i = 0; i < ALL.length; i++) {
    if (zones.indexOf(ALL[i].zone) !== -1) n++;
  }
  return n;
}

export function renderResults() {
  var rows = filtered();
  /* "195 of 195 items - My list". The list's name rides on the count because the
     picker sits in the banner now and the banner scrolls away: this line does not, so
     it is what keeps you from losing track of which list you are reading. A span
     rather than more text, so the name can be dimmer and read as a caption. */
  el.count.textContent = rows.length + " of " + phaseTotal() + " items";
  var openName = activeTemplate ? activeTemplate.name : "No list";
  var who = document.createElement("span");
  who.className = "count-list";
  /* the separator is a text node, not a CSS ::before - this line is aria-live, and a
     generated separator would have it read "195 of 195 itemsMy list" */
  who.textContent = " \u00b7 " + openName;
  el.count.appendChild(who);
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

export function update() {
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
