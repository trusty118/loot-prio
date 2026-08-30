/* Edit mode: building your own priority list.
 *
 * Everything here is driven through the keyboard and click paths, which is both the
 * accessibility requirement and the only way this is testable at all - jsdom cannot
 * drag. Dragging is the pointer equivalent of the same actions and is checked by hand.
 *
 * The shape being asserted: a bundled list is reference, a list of your own is a
 * workspace, and you get one by pressing New or Make a copy.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { until, sleep } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");
/* the lists that ship with the site - without these the page boots with no
   starting points, and the priority column is empty on every row */
const listIndex = JSON.parse(fs.readFileSync(path.join(root, "data", "lists", "index.json"), "utf8"));
const zatarList = JSON.parse(fs.readFileSync(path.join(root, "data", "lists", "zatar-p3.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cssText = fs.readFileSync(path.join(root, "style.css"), "utf8");
const htmlText = fs.readFileSync(path.join(root, "index.html"), "utf8");

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

/* Defaults to opening the bundled list, the way a link to it would. zatar used to be the
   baseline - "no list open" MEANT his calls - so these tests got them for free. He is a
   starting point you open now, and with nothing open the priority column is legitimately
   empty. Tests that pass their own hash (a #t= link) are opening their own list and get
   no default. */
function boot(hash) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only",
      url: "https://x.test/loot-prio/" + (hash || "#list=zatar-p3") });
  const { window } = dom;
  // the platform bits jsdom lacks but every browser has
  Object.assign(window, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response });
  // jsdom gives each instance its own localStorage, and it cannot be reassigned -
  // so the store is read back through the same object the page writes to.
  window.fetch = (u) => {
    const s = String(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      s.includes("lists/index.json") ? listIndex : s.includes("zatar-p3.json") ? zatarList
      : s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  window.eval(source);
  return window;
}

/* Given a condition, waits only until it holds; given nothing, falls back to the old
   flat nap. Every remaining bare settle() is one where there is nothing to poll for. */
const settle = (cond) => (cond ? until(cond) : sleep(400));
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

/* The bar is two controls now; everything else lives in the list menu. These reach
   into it the way a person does - open it, then find the row or action by its label. */
const openMenu = (w) => { click(w, el(w.document, "list-trigger")); return w.document.querySelector(".list-menu"); };
const menuText = (w) => { const m = openMenu(w); const t = m.textContent; closeMenu(w); return t; };
const closeMenu = (w) => w.document.querySelector(".list-menu").dispatchEvent(
  new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
const act = (w, label) => {
  const m = w.document.querySelector(".list-menu");
  return [...m.querySelectorAll(".lm-item")].find((b) => b.textContent.trim() === label);
};
const row = (w, name) => {
  const m = w.document.querySelector(".list-menu");
  return [...m.querySelectorAll(".lm-row")].find((b) => b.querySelector(".lm-row-name").textContent === name);
};
/* Read the count element, not the row's text. The byline runs straight into the count
   in textContent ("...by zatar159 ranked"), so a \b-anchored match against the whole
   row silently never fires - which is how the first version of this test passed
   nothing and looked like a code bug. */
const rowCount = (w, name) => row(w, name).querySelector(".lm-row-count").textContent;
const doMenu = (w, label) => { openMenu(w); click(w, act(w, label)); };
const triggerName = (d) => el(d, "list-trigger-name").textContent;

const w = boot();
await settle(() => w.document.querySelector("tbody tr"));
const d = w.document;

// --- a bundled list is reference, not a workspace ---------------------------------
ok(!d.querySelector(".prio-edit"), "the guide's rows are not editable");

// --- the no-list warning is on the bar, not inside the menu -------------------------
/* It used to live in the list menu, which meant it only appeared once you had opened the
   thing it was warning you about. A warning nobody sees is not one. */
{
  const warn = el(d, "list-warn");
  ok(warn, "there is a warning element on the bar");
  ok(warn.hidden, "hidden while a list is open, because there is nothing to warn about");
  ok(d.querySelector(".template-bar").parentNode.contains(warn),
     "and it sits in the list zone, under the picker it is about");
  ok(warn.parentNode.lastElementChild === warn,
     "as the zone's last child, which is what lets it take a line of its own");
  /* It used to be flex-basis: 100%, which took the line but ALSO contributed a whole
     warn line to the zone's intrinsic width - enough to wrap the zone off the merged
     filter row in exactly the empty-list state it exists for. Absolute is the stronger
     property: it still takes its own line under the picker, and it cannot widen the row
     at all. jsdom lays nothing out, so the rule is the assertion. */
  const warnRule = (cssText.split(".list-warn {")[1] || "").split("}")[0];
  ok(warnRule.includes("position: absolute") && !warnRule.includes("flex-basis"),
     "the warning is out of flow, so it cannot stretch the row it hangs under");
  ok(warn.querySelector(".list-warn-icon"), "it carries a warning glyph");
  ok(!/No list is open/.test(source),
     "and the menu no longer carries the wording it moved out of");

  /* and the state it exists for: nothing open, so the priority column says nothing */
  const wn = boot("#phase=P3");
  await settle(() => wn.document.querySelector("tbody tr"));
  const dn = wn.document;
  ok(!el(dn, "list-warn").hidden, "with no list open it shows, without opening any menu");
  ok(/no list open/i.test(el(dn, "list-warn").textContent),
     `and says what is wrong: "${el(dn, "list-warn").textContent.trim()}"`);
  ok(triggerName(dn) === "No list", "beside a picker that says there is none");

  /* The column is not blank in this state - it shows what the BiS data knows, so the
     BIS FROM control has something to do and the rings are reachable. The warning has to
     say THAT rather than "priorities are empty", which stopped being true. */
  ok([...dn.querySelectorAll("td.col-prio .prio-from")].length > 0,
     "and the column shows the BiS view rather than nothing at all");
  ok([...dn.querySelectorAll("td.col-prio .prio-op")].every((o) => o.textContent === "?"),
     "separated by ? - not ranked against - so it cannot read as somebody's ordering");
}
// Disabled rather than hidden: a control that vanishes teaches nothing, and the title
// names the way out at the moment you went looking for it.
ok(el(d, "edit-toggle").disabled, "Edit is disabled, not hidden, on a list that is not yours");
ok(!el(d, "edit-toggle").hidden, "and it stays in the bar, so nothing reflows when it becomes usable");
ok(/copy/i.test(el(d, "edit-toggle").title), `and says what to do about it: "${el(d, "edit-toggle").title}"`);
ok(triggerName(d) === "Zatar's Phase 3", `the trigger says whose list is on screen: "${triggerName(d)}"`);

{
  const m = openMenu(w);
  ok(!act(w, "Rename\u2026"), "no Rename on a list that is not yours");
  ok(!act(w, "Delete list\u2026"), "and no Delete either");
  ok(act(w, "Make a copy") && act(w, "+  New list"),
     "but New and Make a copy are both offered");
  /* Sharing left the menu entirely - it has a control on the bar and a popover of its
     own. It was an item four deep in here that most people never opened, and on zatar's
     list it did NOTHING: copyShareLink() returned early when activeTemplate was null, so
     the first share control anyone meets was dead. */
  ok(!/Copy link|Share this|Stop sharing/.test(m.textContent),
     "and nothing about sharing is in this menu any more");
  ok(/Make a copy to change anything/.test(m.textContent),
     "and it says in words why the other two are absent, rather than just omitting them");
  closeMenu(w);
}

// --- Make a copy -----------------------------------------------------------------
doMenu(w, "Make a copy");
await settle(() => only(w));
const copy = only(w);
ok(Object.keys(copy.priorities).length === data.length,
   `a copy holds all ${data.length} priorities, not a diff (${Object.keys(copy.priorities).length})`);
ok(JSON.stringify(copy.priorities[data[0].id]) === JSON.stringify(data[0].priority || []),
   "and they match the guide's");
ok(copy.base === "zatar-p3", `it records what it was copied from (base: ${copy.base})`);
ok(copy.name === "Copy of Zatar's Phase 3", `and names itself after it: "${copy.name}"`);
ok(!("dirty" in copy), "no scratch state is written into the store");
ok(!el(d, "edit-toggle").disabled, "a list of your own makes Edit usable");
ok(triggerName(d) === copy.name, `and the trigger names it: "${triggerName(d)}"`);
ok(d.querySelectorAll(".prio-edit").length > 0,
   "it opens ready to edit - you pressed Make a copy in order to change it");

// --- reordering -------------------------------------------------------------------
// Reordering is drag-only now that the editor is pointer-only, and jsdom cannot drag.
// Nothing below drives it: a reordering regression can only be caught by hand at
// localhost:8642. What is still assertable is that the line starts as the guide has it.
const ITEM = "Bulwark of Azzinoth";      // ProtWarr > ProtPal
const bulwark = data.find((r) => r.item === ITEM).id;
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   `starts as the guide has it (${namesIn(d, ITEM).join(", ")})`);

// --- there is no Save button: an edit is written as it is made ----------------------
// Driven through the operator menu, which is a click path and still reachable.
click(w, rowFor(d, ITEM).querySelector(".prio-op"));
click(w, d.querySelector('.prio-menu-item[data-op="~="]'));
await settle(() => (only(w).priorities[bulwark][1] || {}).op === "~=");
ok(only(w).priorities[bulwark][1].op === "~=",
   "an edit is already in the store, with nothing pressed to put it there");
ok(el(d, "tpl-dirty").hidden, "and the unsaved marker has cleared");

// --- operators ---------------------------------------------------------------------
ok(opsIn(d, ITEM).join("") === "~=", "the operator set above is what the line shows");
click(w, rowFor(d, ITEM).querySelector(".prio-op"));
const menu = d.querySelector(".prio-menu");
ok(menu && menu.style.display === "block", "clicking the operator opens the menu");
ok(menu.querySelectorAll(".prio-menu-item").length === 6, "it offers all six operators");
ok([...menu.querySelectorAll(".prio-menu-item")].map((b) => b.dataset.op).join(",") === ">,>>,~>,=,~=,?",
   "in the documented order, with the unranked one last");
ok([...menu.querySelectorAll(".prio-menu-label")].map((n) => n.textContent).join("|") ===
   "higher than|much higher than|roughly higher than|equal to|roughly equal to|not ranked against",
   "worded, not just symbols");
ok(menu.querySelector('.prio-menu-item[data-op="~="]').getAttribute("aria-checked") === "true",
   "the operator currently in the line is marked");

click(w, menu.querySelector('.prio-menu-item[data-op=">>"]'));
ok(opsIn(d, ITEM).join("") === ">>", "one click sets it, no cycling through the others");
ok(menu.style.display === "none", "and the menu closes behind it");
ok(only(w).priorities[bulwark][1].op === ">>", "the choice reached the store");
ok(source.includes("function openOpMenu(rec, list, index, anchor) {\n    if (!canEdit()) return;"),
   "the menu is behind canEdit() like every other editing control");

// --- removing -----------------------------------------------------------------------
// The x, which is the only way now - the Delete key went with the rest of the keyboard.
click(w, iconsIn(d, ITEM)[1].querySelector(".prio-x"));
ok(namesIn(d, ITEM).join(",") === "Protection Warrior", "the x removes an icon");
ok(opsIn(d, ITEM).length === 0, "and its operator goes with it");

// --- the list you copied FROM is never touched ----------------------------------------
/* It used to be loot_data.json that had to survive editing, because his calls lived
   there. They live in his own list now, and the rule is the same one: copyOfCurrent()
   deep-copies, so editing your copy must not reach back into the thing it came from. */
const untouched = zatarList.priorities[String(data.find((r) => r.item === ITEM).id)];
ok(JSON.stringify(untouched) === JSON.stringify([{ spec: "ProtWarr" }, { spec: "ProtPal", op: ">" }]),
   "the bundled list in memory is unchanged - your copy is an overlay, not a reference");

/* The per-row "back to zatar's order" reset stood here. It restored rec.priority, and the
   item data holds no priorities now - there is no baseline to go back to, because a
   priority is something a LIST says. A button that could only ever clear the row is worse
   than no button. */
ok(!d.querySelector(".prio-reset"),
   "no per-row reset: there is no baseline ordering left to reset to");

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
/* Picked from what is ON THE PAGE, not from the first match in the file. One phase is
   ever rendered, so a plain data.find() lands on whichever zone happens to sit at the
   top of loot_data.json - which moved the moment Phase 1 was imported and the file was
   regrouped into kill order. */
const onPage = (pred) => data.find((r) => pred(r) && rowFor(d, r.item));
const PLATE = onPage((r) => r.type === "Plate").item;
/* Caster cloth specifically. The assertions below want Mage AND Priest offered, and a
   Caster item reaches Priest through Shadow - no cloth piece in the set is tagged both
   Caster and Healer. Picking "the first cloth item" got this by luck until the file was
   regrouped and the luck changed, which is the whole reason it is spelled out now. */
const CLOTH = onPage((r) => r.type === "Cloth" && r.roles.includes("Caster")).item;

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

// The search narrows; clicking is how you take one. Enter-takes-the-first went with
// the rest of the editor's keyboard forms.
click(w, d.querySelector(".prio-pop-icon"));
ok(namesIn(d, UNIQUE).includes("Fury Warrior"), "clicking the one match adds it");

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


// --- Done reads the list without the edit chrome ---------------------------------------
click(w, el(d, "edit-toggle"));
ok(!d.querySelector(".prio-edit") && !d.querySelector(".prio-add"),
   "Done puts the edit chrome away without closing the list");
ok(!el(d, "edit-toggle").disabled, "the list is still open - it is yours to read as well as write");
click(w, el(d, "edit-toggle"));

// --- Rename is a panel in the menu, not a field parked on the bar -----------------------
openMenu(w);
click(w, act(w, "Rename\u2026"));
const field = d.querySelector(".lm-field");
ok(field && field.value === "Copy of Zatar's Phase 3",
   `Rename opens a field holding the current name: "${field && field.value}"`);
field.value = "MM hunter list";
key(w, field, "Enter");
await settle(() => only(w).name === "MM hunter list");
ok(only(w).name === "MM hunter list", `Enter saves it: "${only(w).name}"`);
ok(triggerName(d) === "MM hunter list", "and the trigger follows");
ok(!d.querySelector(".list-menu[style*='block']"), "and the menu closes behind it");

// --- switching away and back ------------------------------------------------------------
const mine = only(w).id;
openMenu(w);
await settle(() => row(w, "Zatar's Phase 3"));
click(w, row(w, "Zatar's Phase 3"));
await settle(() => !d.querySelector(".prio-edit") && el(d, "edit-toggle").disabled);
ok(!d.querySelector(".prio-edit") && el(d, "edit-toggle").disabled,
   "back on the guide's list, nothing is editable again");
ok(namesIn(d, ITEM).join(",") === "Protection Warrior,Protection Paladin",
   "and the guide's own order is what shows");

openMenu(w);
await settle(() => row(w, "MM hunter list"));
click(w, row(w, "MM hunter list"));
await settle(() => triggerName(d) === "MM hunter list");
ok(triggerName(d) === "MM hunter list", "reopening it brings the name back");
ok(namesIn(d, DOUBLE).length === dbefore + 2, "and the edits are all there");
ok(!d.querySelector(".prio-edit"), "it opens for reading - Edit is how you change it");

// --- Delete asks in a panel, not by arming the button you just pressed -------------------
// The old bar turned Delete into "Sure?" in place, so the confirm landed under the cursor
// that had just clicked it and a double-click destroyed a list.
const doomed = only(w).id;
openMenu(w);
click(w, act(w, "Delete list\u2026"));
const panel = d.querySelector(".list-menu");
ok(/MM hunter list/.test(panel.textContent) && /link/.test(panel.textContent),
   "Delete names the list and what else is lost, rather than just asking");
ok(Object.keys(saved(w)).length === 1, "and has deleted nothing yet");

// the safe one is where the cursor already is, and carries the weight
const keep = act(w, "Keep it");
ok(keep && keep.classList.contains("lm-item--primary"),
   "the safe choice is the solid button, so the destructive one has to be aimed at");
click(w, keep);
ok(Object.keys(saved(w)).length === 1, "Keep it leaves the list alone");

openMenu(w);
click(w, act(w, "Delete list\u2026"));
click(w, act(w, "Delete"));
await settle(() => !saved(w)[doomed]);
ok(!saved(w)[doomed], "Delete removes it");
ok(triggerName(d) === "No list" && el(d, "edit-toggle").disabled,
   "and drops back to no list open - a real state now, not a synonym for zatar's");

// an undo is worth more than any confirm, which is why the confirm can stay light
const undo = el(d, "edit-msg").querySelector(".toast-undo");
ok(undo, "and the toast offers Undo");
click(w, undo);
await settle(() => saved(w)[doomed]);
ok(saved(w)[doomed], "which puts the list back");
ok(triggerName(d) === "MM hunter list", "and reopens it");

// --- New: a list of nobody's ---------------------------------------------------------------
const w2 = boot();
await settle(() => w2.document.querySelector("tbody tr"));
const d2 = w2.document;
doMenu(w2, "+  New list");
await settle(() => only(w2));
const blank = only(w2);
ok(Object.keys(blank.priorities).length === data.length,
   `New still holds all ${data.length} rows (${Object.keys(blank.priorities).length})`);
ok(Object.values(blank.priorities).every((p) => p.length === 0), "with every priority empty");
ok(blank.base === "blank", `and says it started from nothing (base: ${blank.base})`);
// every item OF THE OPEN PHASE. These were the same number while Phase 3 was the whole
// dataset; Zul'Aman and Sunwell separated them.
const inPhase = data.filter((r) =>
  ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"].includes(r.zone)).length;
ok(d2.querySelectorAll("tbody tr").length === inPhase,
   `the table still renders every item of the phase - only the priority column is empty (${inPhase})`);
ok(rowFor(d2, ITEM).querySelector(".prio-add"), "each row offers a + to start filling it in");

// --- and it says why the filters find nobody ------------------------------------------------
const warriorChip = [...d2.querySelectorAll("#class-chips .chip")]
  .find((c) => (c.getAttribute("aria-label") || "").includes("Warrior"));
click(w2, warriorChip);
await settle(() => d2.querySelector(".empty"));
ok(d2.querySelector(".empty") && /empty so far/.test(d2.querySelector(".empty").textContent),
   `a blank list explains its zero results: "${(d2.querySelector(".empty") || {}).textContent || ""}"`);

// --- a shared list is someone else's ----------------------------------------------------------
const shared = { v: 1, name: "Someone's list", created: "2026-08-21", base: "zatar",
  priorities: Object.fromEntries(data.map((r) => [r.id, r.item === ITEM ? [{ spec: "Fury" }] : []])) };
const code = "r" + Buffer.from(JSON.stringify(shared), "utf8").toString("base64url");
const w3 = boot("#t=" + code);
await settle(() => w3.document.querySelector("tbody tr"));
const d3 = w3.document;
ok(namesIn(d3, ITEM).join(",") === "Fury Warrior", "a #t= link opens the list it carries");
ok(!d3.querySelector(".prio-edit") && el(d3, "edit-toggle").disabled,
   "read-only on arrival - someone else's list is reference too");
ok(triggerName(d3) === "Someone's list",
   "the dropdown says so rather than claiming the guide's list is on screen");
ok(Object.keys(saved(w3)).length === 0, "and nothing of theirs is written into your store");

doMenu(w3, "Make a copy");
await settle(() => only(w3));
ok(only(w3) && JSON.stringify(only(w3).priorities[bulwark]) === JSON.stringify([{ spec: "Fury" }]),
   "Make a copy is how you keep it, and it copies what was on screen");
ok(!el(d3, "edit-toggle").disabled, "now it is yours and editable");

// --- the rows count what actually differs between lists ---------------------------------------
// Every list is a full copy of all 195 records, so an item count is the same number on
// every row and says nothing. What separates them is how many carry a priority.
{
  const w5 = boot();
  await settle(() => w5.document.querySelector("tbody tr"));
  const d5 = w5.document;
  const zatarRanked = Object.values(zatarList.priorities).filter((p) => p.length).length;

  openMenu(w5);
  ok(rowCount(w5, "Zatar's Phase 3") === zatarRanked + " ranked",
     `zatar's row counts the ${zatarRanked} he actually ranked, not all ${data.length} (got "${rowCount(w5, "Zatar's Phase 3")}")`);
  ok(zatarRanked < data.length,
     `and that is a different number from the dataset size, which is the whole point (${zatarRanked} < ${data.length})`);
  closeMenu(w5);

  doMenu(w5, "+  New list");
  openMenu(w5);
  await settle(() => row(w5, "My list"));
  ok(rowCount(w5, "My list") === "0 ranked",
     `a blank list reads 0, which is the honest answer and the useful one (got "${rowCount(w5, "My list")}")`);
  closeMenu(w5);

  // a copy carries what it copied, not the dataset size
  doMenu(w5, "Make a copy");
  openMenu(w5);
  await settle(() => row(w5, "Copy of My list"));
  ok(rowCount(w5, "Copy of My list") === "0 ranked",
     `copying a blank list copies its emptiness (got "${rowCount(w5, "Copy of My list")}")`);
  closeMenu(w5);
}

// --- the menu closes the way the other overlays do -------------------------------------------
{
  const m = openMenu(w3);
  ok(m.style.display === "block", "the trigger opens the menu");
  m.dispatchEvent(new w3.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(m.style.display === "none", "Escape closes it");

  openMenu(w3);
  d3.dispatchEvent(new w3.MouseEvent("mousedown", { bubbles: true }));
  ok(m.style.display === "none", "and so does a mousedown outside it");

  // The trigger's own toggle and the document's outside-close both fire on the same
  // click; without excluding the trigger the menu shuts and reopens instantly.
  openMenu(w3);
  ok(m.style.display === "block", "clicking the trigger does not immediately close it again");
  closeMenu(w3);
}

// --- Escape backs out one level at a time ------------------------------------------------------
{
  doMenu(w3, "Make a copy");
  await settle(() => only(w3));
  const m = openMenu(w3);
  click(w3, act(w3, "Rename\u2026"));
  ok(m.querySelector(".lm-field"), "Rename swaps the panel in place");
  m.dispatchEvent(new w3.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(m.style.display === "block" && !m.querySelector(".lm-field"),
     "Escape returns to the menu rather than closing it - a mistyped rename should not cost the menu");
  m.dispatchEvent(new w3.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(m.style.display === "none", "and Escape again closes it");
}

// --- the bar does not reflow, which is the whole point ------------------------------------------
// The old bar went from three controls to seven the moment you opened a list of your
// own, and everything jumped sideways. jsdom cannot measure layout, but it can assert
// the mechanism: the same controls are present and visible in both states.
{
  const barKids = (dd) => [...dd.querySelectorAll(".template-bar > *")]
    .map((n) => (n.id || n.className) + (n.hidden ? ":hidden" : ""))
    .join(",");

  const w4 = boot();
  await settle(() => w4.document.querySelector("tbody tr"));
  const onZatar = barKids(w4.document);
  doMenu(w4, "Make a copy");
  await settle(() => only(w4));
  const onMine = barKids(w4.document);
  ok(onZatar === onMine,
     `the bar holds the same controls either way, so nothing moves\n        ${onZatar}`);
  ok(!/:hidden/.test(onZatar.replace(/tpl-dirty:hidden/g, "")),
     "and nothing in it is hidden except the dirty marker");
}

// --- Edit lives with the rows it changes, not with the list controls ---------------------------
{
  const w6 = boot();
  await settle(() => w6.document.querySelector("tbody tr"));
  const d6 = w6.document;
  const bar = d6.querySelector(".controls--refine");
  const tog = el(d6, "edit-toggle");

  /* Edit moved to the banner with the rest of the list controls: the pinned bar had
     eleven things on it, and the test for a place there is "do I reach for this while
     scrolling 699 rows". What pays for it is #edit-pill - fixed, bottom right, present
     only while armed - because the banner scrolls away and there has to be a way out of
     the mode from four hundred rows down. */
  ok(d6.querySelector(".site-header-row").contains(tog),
     "Edit sits with the list it acts on, in the banner");
  ok(el(d6, "edit-pill"), "and a fixed pill is what gets you out of the mode from anywhere");
  ok(!d6.querySelector(".template-bar").contains(tog),
     "and not in the banner, which answers which list rather than change these calls");

  doMenu(w6, "+  New list");
  await settle(() => tog.getAttribute("aria-pressed") === "true");

  // Three signals, because a mode that changes what a click does should be hard to be
  // in without noticing.
  ok(tog.getAttribute("aria-pressed") === "true", "armed: the button says so");
  ok(bar.classList.contains("is-editing"), "armed: the bar it sits in tints");
  ok(!el(d6, "edit-hint").hidden, "armed: and a line of text says what mode you are in");

  // Both labels must produce the same box, or flipping the mode reflows a bar sitting
  // directly above the rows.
  const armed = tog.textContent;
  click(w6, tog);
  ok(!bar.classList.contains("is-editing") && el(d6, "edit-hint").hidden,
     "and all three come off together");
  ok(/min-width:\s*118px/.test(cssText.match(/#edit-toggle\s*\{[^}]*\}/)[0]),
     "the button has a min-width, so the two labels cannot change the bar's width");
  ok(armed !== tog.textContent, `the label changes with the mode ("${tog.textContent}" / "${armed}")`);

  // The hint is fixed text on purpose: variable-length status lives in the toast,
  // because text that changes length here would move the button beside it.
  ok(/id="edit-hint"[^>]*>Editing/.test(htmlText.replace(/\n\s*/g, " ")),
     "and the hint's text is in the markup, not built from a message");
}

// --- notes are yours to edit, on the same terms the priorities are ------------------
// The whole point of tonight's session: start from his calls and his wording, change
// both by discussion, share the result.
{
  const w7 = boot();
  await settle(() => w7.document.querySelector("tbody tr"));
  const d7 = w7.document;

  // A row he actually wrote a note on, found in the DOM rather than hardcoded, so this
  // survives the dataset being re-sourced.
  const noteRow = [...d7.querySelectorAll("tbody tr")]
    .find((tr) => tr.querySelector("td.col-notes").textContent.trim().length > 10);
  const item = noteRow.children[0].textContent.trim();
  const rec = data.find((r) => item.includes(r.item));
  /* his wording lives in his list now, not on the item */
  const his = zatarList.notes[String(rec.id)];

  const cell = (dd) => rowFor(dd, rec.item).querySelector("td.col-notes");
  ok(!cell(d7).querySelector(".note-text"),
     "on a list that is not yours a note is text, not something you can click into");

  doMenu(w7, "Make a copy");
  await settle(() => only(w7) && only(w7).notes);
  ok(Object.keys(only(w7).notes).length === data.length,
     "a copy takes his notes with it, all of them, the way it takes his priorities");
  ok(only(w7).notes[rec.id] === his, "and they start as his wording exactly");

  // Click the note, type, blur. There is no Save button here either.
  const open = () => { click(w7, cell(d7).querySelector(".note-text"));
                       return cell(d7).querySelector(".note-field"); };
  let field = open();
  ok(field, "with a list of your own open, clicking a note opens a field");
  ok(field.value === his, "prefilled with what the row already said");

  const MINE = "Ours: goes to the Prot Warr first, agreed in Thursday's run.";
  field.value = MINE;
  field.dispatchEvent(new w7.Event("blur"));
  await settle(() => only(w7).notes[rec.id] === MINE);

  ok(only(w7).notes[rec.id] === MINE, "blur writes it to the store, with nothing pressed");
  ok(cell(d7).textContent.includes(MINE), "and the row now reads your wording");
  ok(zatarList.notes[String(rec.id)] === his,
     "his own note is untouched - the list you copied from is never mutated");

  // Search reads the same overlay the cell does, or it would keep finding wording that
  // is no longer on the page.
  const q = el(d7, "search");
  q.value = "Thursday's run";
  q.dispatchEvent(new w7.Event("input"));
  await settle(() => rowFor(d7, rec.item));
  ok(rowFor(d7, rec.item), "search finds your note");
  q.value = his.slice(0, 24);
  q.dispatchEvent(new w7.Event("input"));
  await settle(() => !rowFor(d7, rec.item));
  ok(!rowFor(d7, rec.item), "and no longer finds the wording you replaced");
  q.value = "";
  q.dispatchEvent(new w7.Event("input"));
  await settle(() => rowFor(d7, rec.item));

  // Escape abandons rather than commits, so a misclick into a note costs nothing.
  field = open();
  field.value = "typed by accident";
  key(w7, field, "Escape");
  await settle();   /* a real wait: the assertion is that nothing was written, and a
                       poll for "still MINE" would pass before Escape had done anything */
  ok(only(w7).notes[rec.id] === MINE, "Escape leaves the note as it was");

  /* Clearing one note without abandoning the list. It clears YOURS - it does not restore
     anybody else's, because with no baseline there is nobody else's to restore. */
  const priosBefore = only(w7).priorities[rec.id].length;
  const reset = cell(d7).querySelector(".note-reset");
  ok(reset, "a note of your own offers a way to clear it");
  click(w7, reset);
  await settle(() => !(rec.id in (only(w7).notes || {})));
  ok(!(rec.id in only(w7).notes), "which removes it from your list entirely");
  ok(!cell(d7).querySelector(".note-reset"),
     "and the control goes away, because there is nothing left to clear");
  ok(only(w7).priorities[rec.id].length === priosBefore,
     "clearing a note does not touch the priority beside it");

  // A blank list is nobody's list, so it does not arrive carrying his words.
  doMenu(w7, "+  New list");
  await settle(() => Object.values(saved(w7)).find((t) => t.base === "blank"));
  const blank = Object.values(saved(w7)).find((t) => t.base === "blank");
  ok(Object.keys(blank.notes).length === data.length && blank.notes[rec.id] === "",
     "a blank list starts with no notes at all - you asked for nobody's list");
}

// --- the editor never gets the filter click-through --------------------------------
/* In a read row a priority icon filters to whoever it names. In the editor the same
   icon is a drag handle, and a press that also filtered would fight the gesture it is
   already carrying. priorityCell() adds the behaviour, specIcon() stays inert - so the
   two modes cannot drift into sharing it. */
{
  const w9 = boot();
  await settle(() => w9.document.querySelector("tbody tr"));
  const d9 = w9.document;
  const icons = () => [...d9.querySelectorAll("td.col-prio img.spec-icon")];

  ok(icons().some((i) => i.classList.contains("spec-icon--link")),
     "reading the guide, priority icons are controls");

  doMenu(w9, "Make a copy");
  await settle(() => el(d9, "edit-toggle").getAttribute("aria-pressed") === "true");
  ok(el(d9, "edit-toggle").getAttribute("aria-pressed") === "true",
     "a copy opens ready to edit");
  ok(icons().length > 0 && !icons().some((i) => i.classList.contains("spec-icon--link")),
     `editing, none of the ${icons().length} icons is a filter control`);
  ok(!icons().some((i) => i.getAttribute("role") === "button"),
     "and none claims to be a button, so the drag is the only gesture on them");

  const before = [...d9.querySelectorAll("#results tr[data-id]")].length;
  click(w9, icons()[0]);
  await settle();   /* a real wait: the assertion is that the table did NOT refilter */
  ok([...d9.querySelectorAll("#results tr[data-id]")].length === before,
     "clicking one while editing does not filter the table out from under you");

  // and it is added where it can be kept apart, not in the shared icon builder
  ok(!/function specIcon[\s\S]{0,1400}spec-icon--link/.test(source),
     "specIcon() does not add it - priorityCell() does");
}

// --- Load BiS data, the starting point for a list built from scratch -------------------
/* It was an item in the list menu, which is to say nobody found it - the same reason
   sharing got a control of its own. It fills the EMPTY rows of the phase on screen, so it
   can only ever add. */
{
  const wS = boot("#phase=P4");
  await settle(() => wS.document.querySelector("tbody tr"));
  const dS = wS.document;
  const btn = el(dS, "seed-bis");
  const icons = () => dS.querySelectorAll("td.col-prio img.spec-icon").length;

  ok(btn && !btn.hidden, "the control is on the bar, always");
  ok(btn.disabled && /make a copy/i.test(btn.title),
     `disabled with a reason when no list of yours is open: "${btn.title}"`);
  ok(!/Seed empty rows/.test(menuText(wS)),
     "and it has left the list menu, so there is one place it lives");

  doMenu(wS, "+  New list");
  await settle(() => only(wS));
  ok(!btn.disabled, "a list of your own makes it usable");
  ok(icons() === 0, "which starts with nothing in the priority column");

  click(wS, btn);
  await settle(() => icons() > 0);
  ok(icons() > 0, `one press seeds it from the BiS data (${icons()} icons)`);

  /* Flat on purpose: every entry equal, because nothing here ranks them. That is what
     makes it a starting point rather than an answer. */
  const t = only(wS);
  const seeded = Object.values(t.priorities).filter((p) => p.length);
  ok(seeded.length > 0 && seeded.every((p) => p.every((e, i) => i === 0 || e.op === "=")),
     `every seeded line is flat - nothing ranks anyone above anyone (${seeded.length} rows)`);

  /* It fills EMPTY rows, so a second press has nothing left to do - which is the same
     guarantee that stops it overwriting an ordering you made by hand. */
  const before = JSON.stringify(only(wS).priorities);
  click(wS, btn);
  await settle();   /* a real wait: the assertion is that nothing changed */
  ok(JSON.stringify(only(wS).priorities) === before,
     "pressing it again changes nothing - it only ever fills what is empty");
  ok(/nothing to seed/i.test(el(dS, "edit-msg").textContent),
     `and says so rather than appearing to do nothing: "${el(dS, "edit-msg").textContent}"`);
}

// --- no browser dialogs anywhere ------------------------------------------------------------
ok(!/window\.(prompt|confirm)\s*\(/.test(source),
   "app.js asks nothing through a browser dialog");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
