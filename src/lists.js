/* The lists that ship with the site. */
import { openTemplate } from "./bar.js";
import { FRESH, LISTS_URL } from "./data.js";
import { announce } from "./editor.js";
import { update } from "./results.js";
import { state } from "./state.js";
import { validateTemplate } from "./templates.js";

/* ---------- the lists that ship with the site ----------
   Starting points somebody can open and copy - zatar's Phase 3 calls today, guest
   lists for other phases later. NOT a baseline: nothing falls back to them, and with
   none open the priority column is empty.

   Fails soft like bis.json. A missing or malformed index costs the options, not the
   page, and one list failing to load costs that one. */

export var OOTB = [];          /* index entries: id, name, phase, author, file */
export var ootbCache = {};     /* id -> the loaded template */

export function loadOotb() {
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
export function openOotb(entry) {
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

export function ootbForPhase() {
  return OOTB.filter(function (e) { return !e.phase || e.phase === state.phase; });
}
