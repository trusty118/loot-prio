/* Edit mode: building your own priority list.
 *
 * Everything here is driven through the keyboard and click paths, which is both the
 * accessibility requirement and the only way this is testable at all - jsdom cannot
 * drag. Dragging is the pointer equivalent of the same actions and is checked by hand.
 *
 * The shape being asserted: zatar's list is reference, a list of your own is a
 * workspace, and you get one by pressing New or Make a copy.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

function boot(hash) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://x.test/loot-prio/" + (hash || "") });
  const { window } = dom;
  // the platform bits jsdom lacks but every browser has
  Object.assign(window, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response });
  // jsdom gives each instance its own localStorage, and it cannot be reassigned -
  // so the store is read back through the same object the page writes to.
  window.fetch = (u) => {
    const s = String(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  window.eval(source);
  return window;
}

const settle = () => new Promise((r) => setTimeout(r, 400));
const click = (w, n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const key = (w, n, k) => n.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const rowFor = (d, name) => [...d.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name));
const iconsIn = (d, name) => [...rowFor(d, name).querySelectorAll(".prio-edit")];
// works in both modes: the read-only cell has no .prio-edit wrappers, only icons.
// Race icons carry their own modifier and are not part of the ordering.
const namesIn = (d, name) => [...rowFor(d, name).querySelector("td.col-prio")
  .querySelectorAll("img.spec-icon")]
  .filter((i) => !i.classList.contains("spec-icon--race"))
  .map((i) => i.dataset.tip);
const opsIn = (d, name) => [...rowFor(d, name).querySelectorAll(".prio-op")].map((n) => n.textContent);
const saved = (w) => JSON.parse(w.localStorage.getItem("lootprio.templates") || "{}");
const only = (w) => Object.values(saved(w))[0];
const el = (d, id) => d.getElementById(id);

const w = boot();
await settle();
const d = w.document;

// --- zatar's list is reference, not a workspace ---------------------------------
ok(!d.querySelector(".prio-edit"), "the guide's rows are not editable");
ok(el(d, "edit-toggle").hidden, "no Edit button until a list of your own is open");
ok(el(d, "tpl-name").hidden && el(d, "tpl-delete").hidden && el(d, "tpl-share").hidden,
   "and no name field, Delete or Copy link either");
ok(!el(d, "tpl-new").hidden && !el(d, "tpl-copy").hidden,
   "only the two ways to start a list of your own are offered");
ok(el(d, "tpl-list").value === "" && el(d, "tpl-list").options[0].textContent.includes("zatar"),
   "the dropdown says whose list is on screen");

// --- Make a copy -----------------------------------------------------------------
click(w, el(d, "tpl-copy"));
await settle();
const copy = only(w);
ok(Object.keys(copy.priorities).length === data.length,
   `a copy holds all ${data.length} priorities, not a diff (${Object.keys(copy.priorities).length})`);
ok(JSON.stringify(copy.priorities[data[0].id]) === JSON.stringify(data[0].priority || []),
   "and they match the guide's");
ok(copy.base === "zatar", `it records what it was copied from (base: ${copy.base})`);
ok(copy.name === "Copy of zatar's list", `and names itself after it: "${copy.name}"`);
ok(!("dirty" in copy), "no scratch state is written into the store");
ok(!el(d, "edit-toggle").hidden && !el(d, "tpl-name").hidden,
   "a list of your own brings out Edit, the name field and the rest");
ok(el(d, "tpl-list").value === copy.id, "and the dropdown selects it");
ok(d.querySelectorAll(".prio-edit").length > 0,
   "it opens ready to edit - you pressed Make a copy in order to change it");

// --- reordering -------------------------------------------------------------------
const ITEM = "Bulwark of Azzinoth";      // ProtWarr > ProtPal
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   `starts as the guide has it (${namesIn(d, ITEM).join(", ")})`);

key(w, iconsIn(d, ITEM)[0], "ArrowRight");
ok(namesIn(d, ITEM).join(",") === "Protection Paladin,Protection Warrior",
   "ArrowRight moves an icon one place right");

key(w, iconsIn(d, ITEM)[0], "ArrowLeft");
ok(namesIn(d, ITEM).join(",") === "Protection Paladin,Protection Warrior",
   "ArrowLeft at position 0 is a no-op rather than an error");

// --- there is no Save button: an edit is written as it is made ----------------------
await settle();
const bulwark = data.find((r) => r.item === ITEM).id;
ok(JSON.stringify(only(w).priorities[bulwark]) ===
   JSON.stringify([{ spec: "ProtPal" }, { spec: "ProtWarr", op: ">" }]),
   "the reorder is already in the store, with nothing pressed to put it there");
ok(el(d, "tpl-dirty").hidden, "and the unsaved marker has cleared");

// --- operators ---------------------------------------------------------------------
ok(opsIn(d, ITEM).join("") === ">", "one operator between two icons");
key(w, iconsIn(d, ITEM)[1], "Enter");
ok(opsIn(d, ITEM).join("") === ">>", "Enter cycles > to >>");
key(w, iconsIn(d, ITEM)[1], "Enter");
ok(opsIn(d, ITEM).join("") === "~>", "and >> to ~>");

// Clicking picks from a menu rather than stepping: reaching "~=" by cycling took
// four clicks, which was one of the complaints that started this rework.
ok(!d.querySelector(".prio-menu"), "no operator menu until one is asked for");
click(w, rowFor(d, ITEM).querySelector(".prio-op"));
const menu = d.querySelector(".prio-menu");
ok(menu && menu.style.display === "block", "clicking the operator opens the menu");
ok(menu.querySelectorAll(".prio-menu-item").length === 5, "it offers all five operators");
ok([...menu.querySelectorAll(".prio-menu-item")].map((b) => b.dataset.op).join(",") === ">,>>,~>,=,~=",
   "in the documented order");
ok([...menu.querySelectorAll(".prio-menu-label")].map((n) => n.textContent).join("|") ===
   "better than|much better than|roughly better than|equal to|roughly equal to",
   "worded, not just symbols");
ok(menu.querySelector('.prio-menu-item[data-op="~>"]').getAttribute("aria-checked") === "true",
   "the operator currently in the line is marked");

const pick = (op) => click(w, menu.querySelector('.prio-menu-item[data-op="' + op + '"]'));
pick("~=");
ok(opsIn(d, ITEM).join("") === "~=", "one click sets it, no cycling through the others");
ok(menu.style.display === "none", "and the menu closes behind it");
ok(JSON.stringify(only(w).priorities[bulwark][1].op) === '"~="', "the choice reached the store");

// Escape leaves the line alone
click(w, rowFor(d, ITEM).querySelector(".prio-op"));
key(w, menu, "Escape");
ok(menu.style.display === "none" && opsIn(d, ITEM).join("") === "~=",
   "Escape closes it without changing anything");

// the keyboard keeps stepping - there is nothing to aim at on a keyboard
key(w, iconsIn(d, ITEM)[1], "Enter");
ok(opsIn(d, ITEM).join("") === ">", "Enter still cycles, wrapping past the end");
ok(source.includes("function openOpMenu(rec, list, index, anchor) {\n    if (!canEdit()) return;"),
   "the menu is behind canEdit() like every other editing control");

// --- removing -----------------------------------------------------------------------
key(w, iconsIn(d, ITEM)[1], "Delete");
ok(namesIn(d, ITEM).join(",") === "Protection Paladin", "Delete removes an icon");
ok(opsIn(d, ITEM).length === 0, "and its operator goes with it");

// --- the guide's data is never touched ------------------------------------------------
const untouched = data.find((r) => r.item === ITEM).priority;
ok(JSON.stringify(untouched) === JSON.stringify([{ spec: "ProtWarr" }, { spec: "ProtPal", op: ">" }]),
   "loot_data.json in memory is unchanged - the template is an overlay");

// --- reset ----------------------------------------------------------------------------
click(w, rowFor(d, ITEM).querySelector(".prio-reset"));
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   "reset puts the guide's order back");

// --- the add popover, and the repeat rule ----------------------------------------------
const UNIQUE = "Ring of Deceitful Intent";        // unique, Finger
const popIcon = (name) => [...d.querySelectorAll(".prio-pop-icon")]
  .find((b) => b.dataset.tip === name);
const popOpen = () => d.querySelector(".prio-pop") &&
  d.querySelector(".prio-pop").style.display === "block";

ok(!d.querySelector(".prio-pop"), "no popover exists until a + is pressed");
click(w, rowFor(d, UNIQUE).querySelector(".prio-add"));
ok(popOpen(), "the + opens it");
// The popover is anchored under the row's +, so a line naming the item was just
// repeating what you can see. It survives for screen readers, which cannot.
ok(!d.querySelector(".prio-pop-head"), "no line repeating which item you clicked");
ok(d.querySelector(".prio-pop").getAttribute("aria-label").includes(UNIQUE),
   "the item is named to a screen reader instead");
// Smart filtering is on by default, so the popover offers what the item suits
// rather than all 37. UNIQUE is a plate item, so no cloth or leather wearer.
const offered = () => [...d.querySelectorAll(".prio-pop-icon")].map((b) => b.dataset.tip);
const rec = (name) => data.find((r) => r.item.includes(name));
ok(offered().length < 30 && offered().length > 0,
   `it offers what the item suits, not everything: ${offered().length} icons`);
// Ring of Deceitful Intent is a Ring, so nothing is excluded by armour - a mage can
// physically wear any ring. It is the TAG layer that keeps casters off it.
ok(rec(UNIQUE).roles.join() === "Physical,Tank", "the fixture is tagged Physical, Tank");
ok(!offered().includes("Mage") && !offered().includes("Arcane Mage"),
   "the tag layer keeps a Mage off a physical/tank ring");
ok(offered().includes("Warrior"), "but a Warrior, who wants exactly that, is offered");

// --- layer 1: proficiency, on items where armour actually decides ------------------
const PLATE = data.find((r) => r.type === "Plate").item;
const CLOTH = data.find((r) => r.type === "Cloth").item;

click(w, rowFor(d, PLATE).querySelector(".prio-add"));
const onPlate = offered();
ok(!["Mage", "Priest", "Warlock", "Rogue", "Hunter", "Druid", "Shaman"]
     .some((c) => onPlate.includes(c)),
   `plate offers no class that cannot wear it (${onPlate.filter((n) => !n.includes(" ")).join(", ")})`);
ok(onPlate.includes("Warrior") || onPlate.includes("Paladin"), "plate offers the plate wearers");

click(w, rowFor(d, CLOTH).querySelector(".prio-add"));
const onCloth = offered();
ok(!["Rogue", "Hunter", "Warrior"].some((c) => onCloth.includes(c)),
   "cloth offers no physical class - the tags do that, since anyone can wear cloth");
ok(onCloth.includes("Mage") && onCloth.includes("Priest"), "cloth offers casters and healers");

// Prot Paladin is the reason spec roles are wider than raid roles: spellpower was
// its threat stat, so caster gear must reach it.
ok(onCloth.includes("Protection Paladin"),
   "a caster cloth item still offers a Prot Paladin");

// --- the escape hatch --------------------------------------------------------------
const foot = () => d.querySelector(".prio-pop-foot");
ok(foot().textContent === "Show all specs", `the control says what it does: "${foot().textContent}"`);
click(w, foot());
ok(offered().length > 30, `show everything brings all of them back: ${offered().length}`);
ok(offered().includes("Rogue"), "including the ones the item does not suit");
ok(w.localStorage.getItem("lootprio.smartFilter") === "off", "and the choice is remembered");
click(w, foot());
ok(offered().length < 30 && w.localStorage.getItem("lootprio.smartFilter") === "on",
   "clicking again goes back to filtering");

// an item that suits everyone has nothing to reveal, so the control is not there
const OPEN = data.find((r) => r.roles.length >= 3 && !["Cloth","Leather","Mail","Plate"].includes(r.type));
if (OPEN) {
  click(w, rowFor(d, OPEN.item).querySelector(".prio-add"));
  ok(foot().hidden === (offered().length === 37),
     `nothing hidden on ${OPEN.item} means no control (offers ${offered().length})`);
}

// hand the popover back where the next block expects it
click(w, rowFor(d, UNIQUE).querySelector(".prio-add"));

const before = namesIn(d, UNIQUE).length;
click(w, popIcon("Arms Warrior"));
ok(namesIn(d, UNIQUE).length === before + 1, "clicking one adds it to that row");
ok(!popOpen(), "and the popover closes behind it");

click(w, rowFor(d, UNIQUE).querySelector(".prio-add"));
click(w, popIcon("Arms Warrior"));
ok(namesIn(d, UNIQUE).length === before + 1, "a unique item refuses the same spec twice");
ok(/unique/.test(el(d, "edit-msg").textContent),
   `and says why: "${el(d, "edit-msg").textContent}"`);
ok(popOpen(), "a refused add leaves the popover open to try something else");

// --- narrowing it ------------------------------------------------------------------------
const find = d.querySelector(".prio-pop-find");
find.value = "fury";
find.dispatchEvent(new w.Event("input", { bubbles: true }));
const shown = [...d.querySelectorAll(".prio-pop-icon")].map((b) => b.dataset.tip);
ok(shown.length === 1 && shown[0] === "Fury Warrior",
   `typing narrows it: ${shown.join(", ") || "nothing"}`);

key(w, find, "Enter");
ok(namesIn(d, UNIQUE).includes("Fury Warrior"), "Enter takes the first match");

click(w, rowFor(d, UNIQUE).querySelector(".prio-add"));
find.value = "zzzz";
find.dispatchEvent(new w.Event("input", { bubbles: true }));
ok(d.querySelector(".prio-pop-none"), "and it says so when nothing matches");
key(w, d.querySelector(".prio-pop-find"), "Escape");
ok(!popOpen(), "Escape closes it");

const DOUBLE = "Blessed Band of Karabor";         // not unique, Finger, healer ring
// a healer spec, because smart filtering will not offer an Arms Warrior a healer ring -
// and Resto Druid is the spec zatar himself lists on it twice
const TWICE = "Restoration Druid";
click(w, rowFor(d, DOUBLE).querySelector(".prio-add"));
const dbefore = namesIn(d, DOUBLE).length;
click(w, popIcon(TWICE));
click(w, rowFor(d, DOUBLE).querySelector(".prio-add"));
click(w, popIcon(TWICE));
ok(namesIn(d, DOUBLE).length === dbefore + 2,
   "a non-unique ring accepts the same spec twice - you can wear two");

// --- the drag bug this pass was about ------------------------------------------------------
// jsdom cannot drag (elementFromPoint is unimplemented, so cellUnder is out of reach), but
// the cause was one attribute, and that is checkable: an <img> drags natively, and the
// browser's own image drag cancels the pointer sequence the editor runs on.
click(w, rowFor(d, DOUBLE).querySelector(".prio-add"));
const everyIcon = [...d.querySelectorAll(".prio-pop-icon img, .col-prio img.spec-icon")];
ok(everyIcon.length > 30 && everyIcon.every((i) => i.getAttribute("draggable") === "false"),
   `every icon refuses the browser's own drag: ${everyIcon.length} checked`);
key(w, d.querySelector(".prio-pop-find"), "Escape");

ok(!/state\.paletteFor|renderPalette/.test(source), "the palette bar is gone from the source");
ok(!/function overLine|DRAG_OUT/.test(source),
   "and so is drag-clear-of-the-row-to-delete, which fixing the drag would have armed");

// --- Done reads the list without the edit chrome ---------------------------------------
click(w, el(d, "edit-toggle"));
ok(!d.querySelector(".prio-edit") && !d.querySelector(".prio-add"),
   "Done puts the edit chrome away without closing the list");
ok(!el(d, "tpl-name").hidden, "the list is still open - it is yours to read as well as write");
click(w, el(d, "edit-toggle"));

// --- the name field replaces prompt() ---------------------------------------------------
el(d, "tpl-name").value = "MM hunter list";
el(d, "tpl-name").dispatchEvent(new w.Event("input", { bubbles: true }));
await settle();
ok(only(w).name === "MM hunter list", `renaming in the field writes through: "${only(w).name}"`);
ok([...el(d, "tpl-list").options].some((o) => o.textContent === "MM hunter list"),
   "and the dropdown follows");

// --- switching away and back ------------------------------------------------------------
const mine = only(w).id;
const sel = el(d, "tpl-list");
sel.value = "";
sel.dispatchEvent(new w.Event("change", { bubbles: true }));
await settle();
ok(!d.querySelector(".prio-edit") && el(d, "edit-toggle").hidden,
   "back on the guide's list, nothing is editable again");
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   "and the guide's own order is what shows");

sel.value = mine;
sel.dispatchEvent(new w.Event("change", { bubbles: true }));
await settle();
ok(el(d, "tpl-name").value === "MM hunter list", "reopening it brings the name back");
ok(namesIn(d, DOUBLE).length === dbefore + 2, "and the edits are all there");
ok(!d.querySelector(".prio-edit"), "it opens for reading - Edit is how you change it");

// --- Delete asks first ------------------------------------------------------------------
click(w, el(d, "tpl-delete"));
ok(el(d, "tpl-delete").textContent === "Sure?", "Delete asks in place rather than in a dialog");
ok(Object.keys(saved(w)).length === 1, "and has deleted nothing yet");
click(w, el(d, "tpl-copy"));          // anything else on the bar takes the question back
await settle();
ok(el(d, "tpl-delete").textContent === "Delete", "another button takes the question back");

const doomed = only(w) && el(d, "tpl-list").value;
click(w, el(d, "tpl-delete"));
click(w, el(d, "tpl-delete"));
await settle();
ok(!saved(w)[doomed], "asked twice, it deletes");
ok(el(d, "tpl-list").value === "" && el(d, "edit-toggle").hidden,
   "and drops back to the guide's list");

// --- New: a list of nobody's ---------------------------------------------------------------
const w2 = boot();
await settle();
const d2 = w2.document;
click(w2, el(d2, "tpl-new"));
await settle();
const blank = only(w2);
ok(Object.keys(blank.priorities).length === data.length,
   `New still holds all ${data.length} rows (${Object.keys(blank.priorities).length})`);
ok(Object.values(blank.priorities).every((p) => p.length === 0), "with every priority empty");
ok(blank.base === "blank", `and says it started from nothing (base: ${blank.base})`);
ok(d2.querySelectorAll("tbody tr").length === data.length,
   "the table still renders every item - only the priority column is empty");
ok(rowFor(d2, ITEM).querySelector(".prio-add"), "each row offers a + to start filling it in");

// --- and it says why the filters find nobody ------------------------------------------------
const warriorChip = [...d2.querySelectorAll("#class-chips .chip")]
  .find((c) => (c.getAttribute("aria-label") || "").includes("Warrior"));
click(w2, warriorChip);
await settle();
ok(d2.querySelector(".empty") && /empty so far/.test(d2.querySelector(".empty").textContent),
   `a blank list explains its zero results: "${(d2.querySelector(".empty") || {}).textContent || ""}"`);

// --- a shared list is someone else's ----------------------------------------------------------
const shared = { v: 1, name: "Someone's list", created: "2026-08-21", base: "zatar",
  priorities: Object.fromEntries(data.map((r) => [r.id, r.item === ITEM ? [{ spec: "Fury" }] : []])) };
const code = "r" + Buffer.from(JSON.stringify(shared), "utf8").toString("base64url");
const w3 = boot("#t=" + code);
await settle();
const d3 = w3.document;
ok(namesIn(d3, ITEM).join(",") === "Fury Warrior", "a #t= link opens the list it carries");
ok(!d3.querySelector(".prio-edit") && el(d3, "edit-toggle").hidden,
   "read-only on arrival - someone else's list is reference too");
ok(el(d3, "tpl-list").selectedOptions[0].textContent.startsWith("Shared:"),
   "the dropdown says so rather than claiming the guide's list is on screen");
ok(Object.keys(saved(w3)).length === 0, "and nothing of theirs is written into your store");

click(w3, el(d3, "tpl-copy"));
await settle();
ok(only(w3) && JSON.stringify(only(w3).priorities[bulwark]) === JSON.stringify([{ spec: "Fury" }]),
   "Make a copy is how you keep it, and it copies what was on screen");
ok(!el(d3, "edit-toggle").hidden, "now it is yours and editable");

// --- no browser dialogs anywhere ------------------------------------------------------------
ok(!/window\.(prompt|confirm)\s*\(/.test(source),
   "app.js asks nothing through a browser dialog");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
