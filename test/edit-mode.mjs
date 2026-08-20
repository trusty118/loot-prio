/* Edit mode: building your own priority list.
 *
 * Everything here is driven through the keyboard and click paths, which is both the
 * accessibility requirement and the only way this is testable at all - jsdom cannot
 * drag. Dragging is the pointer equivalent of the same actions and is checked by hand.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://x.test/loot-prio/" });
  const { window } = dom;
  // the platform bits jsdom lacks but every browser has
  Object.assign(window, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response });
  const mem = {};
  window.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
  window.fetch = (u) => {
    const s = String(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  window.eval(fs.readFileSync(path.join(root, "app.js"), "utf8"));
  return window;
}

const settle = () => new Promise((r) => setTimeout(r, 400));
const click = (w, n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const key = (w, n, k) => n.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const rowFor = (d, name) => [...d.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name));
const iconsIn = (d, name) => [...rowFor(d, name).querySelectorAll(".prio-edit")];
const namesIn = (d, name) => iconsIn(d, name).map((n) => n.querySelector("img").dataset.tip);
const opsIn = (d, name) => [...rowFor(d, name).querySelectorAll(".prio-op")].map((n) => n.textContent);

const w = boot();
await settle();
const d = w.document;

// --- entering edit mode -------------------------------------------------------
ok(d.getElementById("palette").hidden, "palette hidden before editing");
ok(!d.querySelector(".prio-edit"), "cells are not editable before editing");

click(w, d.getElementById("edit-toggle"));
ok(d.getElementById("edit-toggle").getAttribute("aria-pressed") === "true", "Edit toggles on");
ok(!d.getElementById("palette").hidden, "palette appears while editing");
ok(d.querySelectorAll(".prio-edit").length > 0, "priority cells become editable");
ok(d.getElementById("edit-toggle").textContent === "Done", "the toggle now offers Done");

// --- reordering ---------------------------------------------------------------
const ITEM = "Bulwark of Azzinoth";      // ProtWarr > ProtPal
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   `starts as the guide has it (${namesIn(d, ITEM).join(", ")})`);

key(w, iconsIn(d, ITEM)[0], "ArrowRight");
ok(namesIn(d, ITEM).join(",") === "Protection Paladin,Protection Warrior",
   "ArrowRight moves an icon one place right");
ok(d.getElementById("template-name").textContent.includes("unsaved"),
   "the first edit forks a template, marked unsaved");

key(w, iconsIn(d, ITEM)[0], "ArrowLeft");
ok(namesIn(d, ITEM).join(",") === "Protection Paladin,Protection Warrior",
   "ArrowLeft at position 0 is a no-op rather than an error");

// --- operators ----------------------------------------------------------------
ok(opsIn(d, ITEM).join("") === ">", "one operator between two icons");
key(w, iconsIn(d, ITEM)[1], "Enter");
ok(opsIn(d, ITEM).join("") === ">>", "Enter cycles > to >>");
key(w, iconsIn(d, ITEM)[1], "Enter");
ok(opsIn(d, ITEM).join("") === "~>", "and >> to ~>");
click(w, rowFor(d, ITEM).querySelector(".prio-op"));
ok(opsIn(d, ITEM).join("") === "=", "clicking the operator cycles it too");

// --- removing -----------------------------------------------------------------
key(w, iconsIn(d, ITEM)[1], "Delete");
ok(namesIn(d, ITEM).join(",") === "Protection Paladin", "Delete removes an icon");
ok(opsIn(d, ITEM).length === 0, "and its operator goes with it");

// --- the guide's data is never touched -----------------------------------------
const untouched = data.find((r) => r.item === ITEM).priority;
ok(JSON.stringify(untouched) === JSON.stringify([{ spec: "ProtWarr" }, { spec: "ProtPal", op: ">" }]),
   "loot_data.json in memory is unchanged - the template is an overlay");

// --- reset --------------------------------------------------------------------
click(w, rowFor(d, ITEM).querySelector(".prio-reset"));
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   "reset puts the guide's order back");

// --- the palette, and the repeat rule ------------------------------------------
const UNIQUE = "Ring of Deceitful Intent";        // unique, Finger
click(w, rowFor(d, UNIQUE).querySelector(".prio-add"));
const paletteBtn = (name) => [...d.querySelectorAll(".palette-icon")]
  .find((b) => b.dataset.tip === name);
const before = namesIn(d, UNIQUE).length;
click(w, paletteBtn("Arms Warrior"));
ok(namesIn(d, UNIQUE).length === before + 1, "clicking a palette icon appends it");

click(w, rowFor(d, UNIQUE).querySelector(".prio-add"));
click(w, paletteBtn("Arms Warrior"));
ok(namesIn(d, UNIQUE).length === before + 1, "a unique item refuses the same spec twice");
ok(/unique/.test(d.getElementById("edit-msg").textContent),
   `and says why: "${d.getElementById("edit-msg").textContent}"`);

const DOUBLE = "Blessed Band of Karabor";         // not unique, Finger
click(w, rowFor(d, DOUBLE).querySelector(".prio-add"));
const dbefore = namesIn(d, DOUBLE).length;
click(w, paletteBtn("Arms Warrior"));
click(w, rowFor(d, DOUBLE).querySelector(".prio-add"));
click(w, paletteBtn("Arms Warrior"));
ok(namesIn(d, DOUBLE).length === dbefore + 2,
   "a non-unique ring accepts the same spec twice - you can wear two");

// --- the palette without a chosen row -------------------------------------------
click(w, d.getElementById("edit-toggle"));      // off
click(w, d.getElementById("edit-toggle"));      // and on again, clearing the target
ok(d.querySelectorAll(".palette-icon").length > 30,
   `the palette shows every class and spec up front: ${d.querySelectorAll(".palette-icon").length} icons`);
ok(/[Dd]rag/.test(d.querySelector(".palette-head").textContent),
   `and says how to use them: "${d.querySelector(".palette-head").textContent}"`);
click(w, paletteBtn("Arms Warrior"));
ok(/\+|drag/i.test(d.getElementById("edit-msg").textContent),
   "clicking one with no row chosen explains what to do rather than doing nothing");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
