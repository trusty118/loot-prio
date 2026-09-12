/* The control panels: chips, art tiles, the selects. */
import { syncOptTrigger } from "./bar.js";
import { BOSS_ICON, HIDDEN_TYPES, JOURNAL, SLOT_ORDER, TYPE_GROUPS, ZONE_ICON, phaseRaids, phaseZones, slotGroup } from "./data.js";
import { countBy, filtered } from "./filter.js";
import { NO_BOSS, bossKey, bossLabel, escapeHtml, orderedBosses, zoneLabel } from "./helpers.js";
import { ICON_BASE, REG, covers, priorityHas, typeGroup } from "./registry.js";
import { bisPick, update } from "./results.js";
import { PHASES } from "./rules.js";
import { el, state } from "./state.js";
import { metaOnly, setMetaOnly, showsSpec } from "./store.js";

/* ---------- rendering: controls ---------- */

/* `iconOnly` drops the text and the count off the chip and moves both into its
   tooltip. 27 spec chips with names and numbers on them read as a wall; the icons
   are the thing being recognised, and the name is one hover away. The fallback if
   an icon 404s is the label, so an icon-only chip can never end up blank. */
export function chip(label, active, count, dataset, icon, iconOnly) {
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
    /* No art at all is a different case from art that fails to load, and the boss rail
       is where it bites: the rail hides .chip-label so a portrait can carry the name, so
       a chip with neither renders as an empty clickable box. Four encounters have no
       journal portrait - Basement, Chess Event, and now Doomwalker and Doom Lord Kazzak
       - and the first two had been invisible in the rail since it was built. */
    if (!icon) b.classList.add("chip--noart");
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
export function allChip(name, active) {
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
export function artChip(opts) {
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
export function phaseChip(ph, active, count) {
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
export function zoneChip(z, active, count) {
  /* A crafted zone is pictured by a square item icon rather than a 2:1 Encounter
     Journal portrait, so cover-cropping it into a wide tile throws most of it away.
     Having no BOSS_ORDER entry is the test, not the name - the same rule the phase
     tiles use to decide which zones get an art strip - so a future crafted-style
     zone gets this for free. */
  /* Whether the ART is a landscape journal portrait or a square item icon, which is
     not the same question as whether the zone has bosses. It used to test BOSS_ORDER,
     on the assumption that anything with bosses has journal art - World Bosses broke
     that: Doomwalker and Doom Lord Kazzak never stood in an instance, so the Encounter
     Journal has nothing for them, and the square icon standing in was being cropped to
     a middle band by object-fit: cover. Same test the boss rail already uses. */
  var cls = "chip--zone" +
    ((ZONE_ICON[z] || "").indexOf(JOURNAL) === 0 ? "" : " chip--emblem");
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

export function renderPhaseChips() {
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

export function renderZoneChips() {
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

export function renderBossChips() {
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
export function renderClassChips() {
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

  renderMetaChip();
}

/* Sits at the end of the CLASS row rather than on the filter bar, because that is the
   row it speaks about - it decides which specs exist as far as the page is concerned,
   and the class strip is where you are already looking when you ask that.

   A chip rather than a button, so it wears the accent when it is on. --gold means
   "selected" everywhere on this page, and a filter that is ON is selected - so this is
   the same vocabulary the class icons beside it already use, which is what makes the
   default-on state read as on rather than as a button someone forgot to press.

   The label states which way it is SET, not what pressing it would do, so the row reads
   as a description of what you are looking at - the way every chip on it does. */
export function renderMetaChip() {
  if (!el.metaZone) return;
  var on = metaOnly();
  var c = chip(on ? "Meta Specs Only" : "All Specs", on, null);
  c.id = "meta-toggle";
  c.classList.add("chip--meta");
  c.dataset.tip = on ? "Showing only meta specs" : "Showing all specs";
  c.setAttribute("aria-label", c.dataset.tip);
  c.addEventListener("click", function () {
    setMetaOnly(!metaOnly());
    update();
  });
  el.metaZone.innerHTML = "";
  el.metaZone.appendChild(c);
}

/* The spec row is hidden until a class is picked: 27 icons with no class chosen
   is a wall, and the question it asks ("which of your specs?") has no meaning
   until the first one is answered. */
export function renderSpecChips() {
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

  /* Grouped by the class order of the row above, not by the registry's spec order -
     and now grouped in the DOM as well, one .spec-group per class. With several picked
     the row was one undifferentiated run: three Warrior specs butting straight against
     three Mage specs, with the grouping only in the order. The break is what makes it
     readable, and the group carries the class name so a hovered gap says whose it is. */
  state.classes.forEach(function (cls) {
    var group = document.createElement("div");
    group.className = "spec-group";
    group.dataset.tip = (REG.classes[cls] || {}).name || cls;

    Object.keys(REG.specs).forEach(function (id) {
      var spec = REG.specs[id];
      if (spec["class"] !== cls) return;
      if (covers(id).length) return;   /* an umbrella is not a spec you can pick */
      /* The meta-specs toggle. showsSpec() keeps a SELECTED spec on the row whatever
         the toggle says, so turning it on can never strand a filter you already set
         with no chip to turn it off again. */
      if (!showsSpec(id)) return;
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
      group.appendChild(c);
    });

    if (group.children.length) el.specChips.appendChild(group);
  });

  /* Only offered once a spec is picked: bis.json is keyed by spec, and a
     class-wide union of nine specs' BiS lists wouldn't mean anything. */
  if (state.specs.length) {
    var bisRows = filtered("bis").filter(function (r) {
      return state.specs.some(function (id) { return bisPick(id, r.id); });
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

export function fillSelect(sel, values, current, counts, allLabel) {
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

export function renderSelects() {
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
