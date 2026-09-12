/* The editing rules and the actions that change a list. */
import { renderTemplateBar } from "./bar.js";
import { announce } from "./editor.js";
import { resolveEntry } from "./registry.js";
import { DOUBLE_SLOTS, OP_LIST } from "./rules.js";
import { activeIsMine, activeTemplate, setUnsaved } from "./state.js";
import { accountName, signedIn, store } from "./store.js";
import { MAX_NOTE } from "./templates.js";

/* ---------- editing rules ----------
   The same rules verify/check_priority.py enforces, applied while editing so the
   editor cannot produce data the validator would reject. */

/* You can only be told to take two of something you could equip twice. */
export function allowsRepeat(rec) {
  return !rec.unique && !!DOUBLE_SLOTS[rec.slot];
}

export function entryKey(entry) {
  return [entry.spec || entry["class"] || "", entry.form || "", entry.race || ""].join("|");
}

/* Why a change is refused, or null if it is fine. Returned as a message because
   the editor says it out loud rather than silently ignoring the drop. */
export function rejectReason(rec, list, entry, replacingIndex) {
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
export function normaliseList(list) {
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

export function moveEntry(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list;
  var out = list.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return normaliseList(out);
}

export function removeEntry(list, at) {
  var out = list.slice();
  out.splice(at, 1);
  return normaliseList(out);
}

export function addEntry(list, entry, at) {
  var out = list.slice();
  out.splice(at == null ? out.length : at, 0, entry);
  return normaliseList(out);
}

/* Set the operator linking entry `at` to the one before it. */
export function setOp(list, at, op) {
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
export function applyEdit(rec, list) {
  if (!activeTemplate || !activeIsMine) return;
  activeTemplate.priorities[rec.id] = normaliseList(list);
  setUnsaved(true);
  saveNow();
}

/* There is no Save button. A list is written when it is made and again on every
   edit: localStorage is synchronous and a whole template is ~12 KB, which is
   nothing next to losing an afternoon's list by forgetting to press something.
   `unsaved` is stored out here rather than on the template so it never travels
   into the store or into a share link. */
export function saveNow() {
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
    if (activeTemplate === t) { setUnsaved(false); renderTemplateBar(); }
  }, function (err) {
    /* A stale write is the one failure the person can actually act on, and the one
       that used to happen in silence. unsaved deliberately stays true: the edit is
       still on screen and still unsaved, and saying otherwise is the lie this whole
       guard exists to stop telling. */
    if (err.stale) {
      /* Asserted rather than assumed: another save may have resolved in between, and
         whatever it did, THIS edit did not land. The marker has to say so. */
      setUnsaved(true);
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
export function setNote(rec, text) {
  if (!activeTemplate || !activeIsMine) return;
  if (!activeTemplate.notes) activeTemplate.notes = {};
  if (activeTemplate.notes[rec.id] === text) return;
  activeTemplate.notes[rec.id] = text.slice(0, MAX_NOTE);
  setUnsaved(true);
  saveNow();
}

/* Clears YOUR note rather than restoring anybody's. The key is deleted rather than set
   to "", so effectiveNotes() falls back properly - on the handful of rows carrying a
   fact about the item ("Also drops from Eredar Twins") that fact reappears, which is
   right, because it was never yours to overwrite in the first place. */
export function clearNote(rec) {
  if (!activeTemplate || !activeIsMine || !activeTemplate.notes) return;
  if (!(rec.id in activeTemplate.notes)) return;
  delete activeTemplate.notes[rec.id];
  setUnsaved(true);
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
