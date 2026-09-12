/* Filtering and sorting the rows, and the url state that drives it. */
import { defaultPhase, phaseZones, slotGroup, tierClasses } from "./data.js";
import { bossZones } from "./helpers.js";
import { OOTB } from "./lists.js";
import { REG, SORT_KEYS, bisOnlyMatch, classPasses, priorityText, selectionHas, typeGroup, typeLabel } from "./registry.js";
import { bisPick } from "./results.js";
import { ALL, activeIsMine, activeTemplate, state } from "./state.js";
import { effectiveNotes, effectivePriority } from "./templates.js";

/* ---------- filtering ---------- */

/* `skip` lets us count a facet as if its own filter weren't applied. */
export function matches(rec, skip) {
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
        !state.specs.some(function (id) { return bisPick(id, rec.id); })) return false;
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

export function filtered(skip) {
  return ALL.filter(function (r) { return matches(r, skip); });
}

/* Sorts within a boss group - the grouping itself always stays in kill order. */
export function sortRows(rows) {
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

export function countBy(skip, keyFn) {
  var counts = {};
  filtered(skip).forEach(function (r) {
    var k = keyFn(r);
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

/* ---------- URL state ---------- */

export function writeUrl() {
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

export function readUrl() {
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
