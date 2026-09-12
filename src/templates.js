/* What a template is: the overlay, copying, seeding, encoding to a link, and validation. */
import { allowsRepeat, entryKey } from "./editing.js";
import { REG, resolveEntry } from "./registry.js";
import { bisPick } from "./results.js";
import { OPERATORS, OP_LIST, PHASES } from "./rules.js";
import { ALL, activeIsMine, activeTemplate, state } from "./state.js";
import { accountName, metaOnly, showsSpec, signedIn } from "./store.js";

/* ---------- templates ---------- */

/* A template is a person's own version of the priorities: a full copy, keyed by
   item id. zatar's data in ALL is never touched, so "reset to his" is always one
   step away and a template can be diffed against what it forked from.

   Full copy rather than a sparse overlay was a deliberate call: 11.6 KB of JSON,
   2.1 KB once gzipped and base64'd, which fits in a URL fragment. The cost is that
   a saved template is frozen - later fixes to loot_data.json don't reach it - and
   items added after it was saved simply aren't in it. Both are handled at read
   time rather than hidden: see effectivePriority() and inTemplate(). */

export var TEMPLATE_VERSION = 1;

export function canEdit() {
  return !!activeTemplate && activeIsMine && state.editing;
}

/* The open list's ordering, or nothing. There is no fall-back to the item data any
   more, because the item data holds no priorities: a priority is something a LIST says,
   and with no list open the column is honestly empty. Until Aug 2026 this fell through
   to rec.priority - zatar's - which is what made him the substrate rather than an
   option, and what made an item a template had never heard of quietly render his call
   as if it were yours. */
export function effectivePriority(rec) {
  if (!activeTemplate) return EMPTY;
  return activeTemplate.priorities[rec.id] || EMPTY;
}

/* one shared empty array rather than a fresh [] per row per render - this is called
   for every record on every update, and nothing mutates the result */
export var EMPTY = [];

/* What the priority column DRAWS, once the meta-specs toggle has had its say. Display
   only: effectivePriority() stays the truth, and matches(), selectionHas(),
   bisOnlyMatch() and the search haystack all go on reading that - so no row can vanish
   and no search can stop finding something because of this.

   Two entries are never dropped. A CLASS entry stands for all of its specs, so hiding
   it would say something different rather than something shorter. And a spec you have
   explicitly SELECTED stays, or picking Frost Mage from the chip row would narrow the
   table and then show you nothing.

   Returns the original array when it changes nothing, so the common case allocates
   nothing - this runs for every row on every render. */
export function visiblePriority(list) {
  if (!metaOnly() || !list || list.length < 1) return list || EMPTY;

  var keeps = list.map(function (entry) {
    return !!entry["class"] || showsSpec(entry.spec);
  });
  if (keeps.every(function (k) { return k; })) return list;

  var out = [], pending = null;
  list.forEach(function (entry, i) {
    var op = i ? (entry.op || ">") : null;
    if (!keeps[i]) {
      /* the dropped entry's own incoming operator still has to reach the next
         survivor, or the line would claim a relationship nobody wrote */
      if (op) pending = pending === null ? op : foldOps(pending, op);
      return;
    }
    var copy = {}, k;
    for (k in entry) if (Object.prototype.hasOwnProperty.call(entry, k)) copy[k] = entry[k];
    if (!out.length) {
      /* the first entry carries no operator - the render loop skips it, and
         validateTemplate() and check_priority.py both refuse one that has it */
      delete copy.op;
    } else {
      copy.op = pending === null ? op : foldOps(pending, op);
    }
    out.push(copy);
    pending = null;
  });
  return out;
}

/* Two operators spanning a dropped entry, collapsed into the one relationship that
   survives. "Rogue > Enh > Arms" with Enh hidden is still "Rogue > Arms", because
   higher-than carries through; two holds collapse to "?" rather than to "=", since
   nobody said those two were equal - only that neither was ranked against the thing
   in between. Identical operators keep their exact wording, so ">>" is not quietly
   downgraded when it did not have to be. */
export function foldOps(a, b) {
  if (a === b) return a;
  if (OPERATORS[a].advances || OPERATORS[b].advances) return ">";
  return "?";
}

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
export function effectiveNotes(rec) {
  if (activeTemplate && activeTemplate.notes) {
    var own = activeTemplate.notes[rec.id];
    if (typeof own === "string") return own;
  }
  return rec.notes || "";
}

/* False for an item the active template has never heard of - added to the dataset
   after it was saved. The row still renders, from the guide's data, and says so. */
export function inTemplate(rec) {
  return !activeTemplate || !!activeTemplate.priorities[rec.id];
}

/* Whose list this is, stamped when it is made. Signed out it is empty and stays empty:
   a list with no author claims none, which is not the same as claiming to be anonymous.

   A COPY takes YOUR name, not the name of the list it came from. That is the whole
   point - a copy is your list from the moment you make it, which is the same rule
   `base` already records the other half of. */
export function makeTemplate(name, base, priorities, notes) {
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
export function attestedAuthor(t) {
  if (!t || !t.author) return "";
  if (t === activeTemplate && !activeIsMine && !t.sharedFrom) return "";
  return t.author;
}

/* A copy of whatever is on screen. effectivePriority() already answers "what is
   this row showing", so one function copies the guide's list, one of yours, or one
   that arrived on a link, without branching on which of the three it is. */
export function copyOfCurrent(name) {
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
/* The seeding primitive. Fills only the EMPTY entries, so it can never overwrite a call
   that is already there, and returns how many it filled.

   It walks EVERY phase, and asks about each item under the phase that item belongs to.
   Both halves are load-bearing and neither is visible from the screen: seeded on the
   phase you happened to be looking at, a list would read as empty the moment you changed
   phase - and asking bisTier() without a phase would silently do exactly that, since it
   defaults to state.phase. A list is a full copy of all 699 rows; seeding has to match. */
export function seedPriorities(priorities) {
  var order = Object.keys(REG.specs);
  var phaseOf = {};
  PHASES.forEach(function (p) {
    p.zones.forEach(function (z) { phaseOf[z] = p.id; });
  });

  var filled = 0;
  ALL.forEach(function (rec) {
    if ((priorities[rec.id] || []).length) return;
    var phase = phaseOf[rec.zone];
    if (!phase) return;
    /* Seeded meta-only while the toggle is on, so a new list never CONTAINS the lines
       rather than merely hiding them - which is what stops them reappearing the day
       somebody turns the toggle off. Seeding already reads state.bisSource; this is the
       second preference it honours, for the same reason. */
    var specs = order.filter(function (id) {
      return bisPick(id, rec.id, phase) && showsSpec(id);
    });
    if (!specs.length) return;
    priorities[rec.id] = specs.map(function (id, i) {
      return i ? { spec: id, op: "=" } : { spec: id };
    });
    filled++;
  });
  return filled;
}

/* Seeded from BiS, not blank - a list you start now arrives with every item that is BiS
   for somebody already ranked flat-equal, as a starting point to drag into order.

   `base` stays "blank" because it records where the list CAME FROM - nobody's list - and
   that is still true; the BiS ordering is a starting point laid on top, not a source. It
   is also stored in every saved list and in every `#t=` link, so it is not free to redefine.

   Notes are still not seeded, and that has not changed: you asked for nobody's list, and
   the guide's wording is somebody's. BiS is a computed fact about an item; a note is a
   person's sentence about it. */
export function newBlankTemplate(name) {
  var priorities = {}, notes = {};
  ALL.forEach(function (rec) {
    priorities[rec.id] = [];
    notes[rec.id] = "";
  });
  seedPriorities(priorities);
  return makeTemplate(name || "My list", "blank", priorities, notes);
}

/* ---------- sharing ----------
   gzip via CompressionStream where the browser has it (11.6 KB -> ~2.1 KB), plain
   base64 where it doesn't. The marker byte says which, so a link made in one
   browser opens in another. It all lives in the hash, which never leaves the
   browser, so only browser URL limits apply. */

export function bytesToB64(bytes) {
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64ToBytes(b64) {
  var bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* btoa only speaks latin-1, so text has to become bytes first. TextEncoder is the
   obvious way and is present in every browser; the fallback keeps this working
   under jsdom, where it isn't. */
export function utf8ToBytes(str) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(str);
  var bin = unescape(encodeURIComponent(str));
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToUtf8(bytes) {
  if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes);
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(bin));
}

export function encodeTemplate(t) {
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

export function decodeTemplate(text) {
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
export var MAX_NOTE = 600;

/* Long enough for any Discord display name, short enough that it cannot be used to
   smuggle a paragraph into a byline. */
export var MAX_AUTHOR = 60;

export function validateTemplate(doc) {
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
