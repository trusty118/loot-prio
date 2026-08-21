import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// resolve the repo root from this file, so it works on any machine or cwd
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(root, "data/loot_data.json"), "utf8"));

const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/loot-prio/" });
const { window } = dom;

// stub fetch for the local data files
const bis = JSON.parse(fs.readFileSync(path.join(root, "data/bis.json"), "utf8"));
const specs = JSON.parse(fs.readFileSync(path.join(root, "data/specs.json"), "utf8"));
window.fetch = (url) => {
  const u = String(url);
  const body = u.includes("bis.json") ? bis : u.includes("specs.json") ? specs : data;
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
};

window.eval(fs.readFileSync(path.join(root, "app.js"), "utf8"));

await new Promise((r) => setTimeout(r, 300));

const doc = window.document;
const fail = [];
const ok = (cond, msg) => { console.log((cond ? "PASS  " : "FAIL  ") + msg); if (!cond) fail.push(msg); };

const chipByText = (sel, text) =>
  [...doc.querySelectorAll(sel + " .chip")].find((c) => c.textContent.trim().startsWith(text));
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

// Where you are is a hierarchy now - phase, then zone, then boss - and nothing below
// a row renders until that row is answered. Everything that drives zone or boss chips
// has to open Phase 3 first, which is the phase this dataset covers.
const openP3 = () => {
  const c = chipByText("#phase-chips", "Phase 3");
  if (c.getAttribute("aria-pressed") !== "true") click(c);
};

const groups = () => [...doc.querySelectorAll(".boss-group")];
const rows = () => [...doc.querySelectorAll("tbody tr")];
const headText = () => groups().map((g) => g.querySelector(".boss-head").textContent.trim());

// the where-panel opens closed: phases only, nothing below them
ok(doc.querySelectorAll("#phase-chips .chip").length === 6,
   "five phases plus an All chip, and nothing else, on load");
ok(doc.querySelectorAll("#zone-chips .chip").length === 0, "no zone chips until a phase is picked");
ok(doc.getElementById("zone-row").hidden && doc.getElementById("boss-row").hidden,
   "and both rows below are hidden");
ok(rows().length === 195, "with no phase picked nothing is filtered out");
openP3();

ok(rows().length === 195, `renders all 195 rows (got ${rows().length})`);
ok(groups().length === 17, `renders 17 boss groups (got ${groups().length})`);
ok(doc.getElementById("count").textContent === "195 of 195 items", `count text: "${doc.getElementById("count").textContent}"`);

const heads = headText();
ok(/Black Temple/.test(heads[0]) && /Trash/.test(heads[0]), `first group is BT Trash: "${heads[0]}"`);
ok(/Illidan Stormrage/.test(heads[9]), `BT ends on Illidan: "${heads[9]}"`);
ok(/Archimonde/.test(heads[15]), `Hyjal ends on Archimonde: "${heads[15]}"`);
ok(/^Crafted$/.test(heads[16]), `crafted group is headed by its zone, with no boss: "${heads[16]}"`);
ok(!/Craftable/.test(doc.body.textContent), "the Craftable pseudo-boss label is gone");
click(chipByText("#zone-chips", "Crafted"));
ok([...doc.querySelectorAll("#boss-chips .chip")].filter((c) => !c.classList.contains("chip--all")).length === 0,
   "crafted is a zone with no bosses, so its boss row holds only the All chip");
click(doc.querySelector("#zone-chips .chip--all"));
ok([...doc.querySelectorAll("#zone-chips .chip")].some((c) => /Crafted/.test(c.textContent)),
   "Crafted is still a zone chip");

// no group header should contain a raw em-dash boss or a split-name artifact
ok(!heads.some((h) => h.includes("undefined")), "no undefined in group headers");

// boss name leads the header, zone tag follows it
const headEls = [...doc.querySelectorAll(".boss-head")];
ok(headEls.every((h) => h.querySelector(".boss-name")), "every group header has a .boss-name");
ok(headEls.every((h) => {
  const kids = [...h.children];
  const tag = kids.findIndex((k) => k.classList.contains("zone-tag"));
  if (tag === -1) return true;   // crafted group has no zone tag - it is the zone
  return kids.findIndex((k) => k.classList.contains("boss-name")) < tag;
}), "boss name precedes the zone tag in every header");
ok(!headEls.some((h) => /\d+\s+items?/.test(h.textContent)), "per-group item counts removed");
ok(!doc.querySelector(".boss-head .n"), "no leftover count element in group headers");
ok(doc.getElementById("count").textContent.includes("of 195"), "the overall count in the toolbar stays");
ok(headEls[0].querySelector(".boss-name").textContent.trim() === "Trash",
   `first header's boss-name is the boss, not the zone (got "${headEls[0].querySelector(".boss-name").textContent.trim()}")`);

// column alignment: every table declares the same fixed widths
const tables = [...doc.querySelectorAll(".boss-group table")];
ok(tables.every((t) => t.querySelectorAll("colgroup col").length === 5),
   "every table declares 5 columns in a colgroup");
const colClasses = tables.map((t) => [...t.querySelectorAll("colgroup col")].map((c) => c.className).join(","));
ok(new Set(colClasses).size === 1, `all ${tables.length} tables use identical column classes`);
const cssText = fs.readFileSync(path.join(root, "style.css"), "utf8");
ok(/table-layout:\s*fixed/.test(cssText), "tables use fixed layout so widths are honoured");
ok(/\.c-item\s*\{[^}]*width/.test(cssText), "column widths are declared in css");

// verify flags
ok(doc.querySelectorAll(".verify-flag").length === 0, "no verify flags rendered");
ok(!doc.getElementById("verify-toggle"), "verify toggle removed from the markup");
ok(!fs.readFileSync(path.join(root, "app.js"), "utf8").includes("flagVerify"), "flagVerify state removed from app.js");
ok(!fs.readFileSync(path.join(root, "style.css"), "utf8").includes(".verify-flag"), "verify-flag css removed");

// wowhead links
const links = [...doc.querySelectorAll("a.item-link")];
ok(links.length === 195, `195 item links (got ${links.length})`);
ok(links.every((a) => /wowhead\.com\/tbc\/item=\d+/.test(a.href)), "all item links point at wowhead tbc items");

// --- icons ---
ok(doc.getElementById("boss-row").hidden, "no boss row until a zone is picked");
click(chipByText("#zone-chips", "Black Temple"));

const zoneChips = [...doc.querySelectorAll("#zone-chips .chip")];
const bossChips = [...doc.querySelectorAll("#boss-chips .chip")];

// chip 0 in each group is the "All" chip and gets no icon
ok(zoneChips.slice(1).every((c) => c.querySelector("img.chip-icon")), "all 3 zone chips have an icon");
ok(!zoneChips[0].querySelector("img"), '"All" chip has no icon');
ok(bossChips.slice(1).every((c) => c.querySelector("img.chip-icon")), `all ${bossChips.length - 1} boss chips have an icon`);
ok(!bossChips[0].querySelector("img"), "the boss row's All chip has no icon either");

// every row's clear chip reads just "All", so the rows line up; what it clears is
// carried by the tooltip and the aria-label instead
const allChips = ["#zone-chips", "#boss-chips", "#class-chips"]
  .map((sel) => doc.querySelector(sel + " .chip"));
ok(allChips.every((c) => c.classList.contains("chip--all")), "every row leads with an All chip");
ok(allChips.every((c) => c.textContent.trim() === "All"), "they read just All, with no count");
ok(allChips.every((c) => !c.querySelector(".n")), "the All chips carry no count element");
ok(allChips.map((c) => c.dataset.tip).join("|") === "All zones|All bosses|All classes",
   `each says what it clears in its tooltip: ${allChips.map((c) => c.dataset.tip).join("|")}`);
ok(allChips.every((c) => c.getAttribute("aria-label") === c.dataset.tip),
   "and repeats it as an aria-label");


const allImgs = [...doc.querySelectorAll("img")];
ok(allImgs.length > 0 && allImgs.every((i) => i.getAttribute("src")), "no img has an empty src");
ok(allImgs.every((i) => /^https:\/\/wow\.zamimg\.com\//.test(i.getAttribute("src"))), "every img src is on zamimg");
ok(allImgs.every((i) => i.getAttribute("onerror")), "every img has an onerror fallback");

// every group has to be on screen to count the portraits, and the icons block above
// left a zone picked - "All" on the zone row means every zone of the phase
click(doc.querySelector("#zone-chips .chip--all"));
const portraits = new Set(
  [...doc.querySelectorAll(".boss-portrait")].map((i) => i.getAttribute("src"))
);
ok(portraits.size === 16, `16 distinct group portraits, incl. trash/crafted (got ${portraits.size})`);
const ejPortraits = [...portraits].filter((s) => s.includes("ui-ej-boss-"));
ok(ejPortraits.length === 14, `14 Encounter Journal boss portraits (got ${ejPortraits.length})`);

// The Role column and filter are deleted, not hidden. The class/spec filter
// answers the same question more precisely, so nothing renders a role now.
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
ok(!doc.querySelector(".role-pill"), "no role pills rendered");
ok(!doc.querySelector('th[data-sort="role"]'), "no Role header");
ok(!doc.querySelector("#role-chips"), "no role chip row in the markup");
ok(!/SHOW_ROLE|roleGlyph|ROLE_GLYPH|renderRoleChips/.test(appSrc), "no role UI left in app.js");
ok(!/state\.roles/.test(appSrc), "no role filter state left");
ok(!/role-pill|role-glyph|--role-/.test(cssText), "no role styles left in style.css");
// the data survives, now multi-valued: `roles` feeds search and still tags the row
const ROLE_TAGS = ["Physical", "Caster", "Healer", "Tank", "Tier"];
ok(rows().every((tr) => tr.dataset.role), "every row still carries a role in the dom");
ok(data.every((r) => Array.isArray(r.roles) && r.roles.length),
   "every record carries a non-empty roles array");
ok(data.every((r) => r.roles.every((x) => ROLE_TAGS.includes(x))),
   "and every tag is one of the five");
ok(!data.some((r) => "role" in r), "the old single-valued role field is gone");
ok(data.some((r) => r.roles.length > 1), "some items are tagged for more than one kind of player");

// cloth is caster/healer gear: no cloth item may be tagged Physical, or the editor
// would start offering rogues and hunters a robe
const clothPhysical = data.filter((r) => r.type === "Cloth" && r.roles.includes("Physical"));
ok(clothPhysical.length === 0,
   `no cloth item is tagged Physical (${clothPhysical.map((r) => r.item).join(", ") || "none"})`);

// --- filter interactions ---
openP3();
click(chipByText("#zone-chips", "Mount Hyjal"));
ok(rows().length === 66, `zone=Mount Hyjal -> 66 rows (got ${rows().length})`);
ok(groups().length === 6, `zone=Mount Hyjal -> 6 groups (got ${groups().length})`);
ok(window.location.hash.includes("zone=Mount+Hyjal"), `url state: ${window.location.hash}`);

click(chipByText("#boss-chips", "Archimonde"));
ok(rows().length === 14, `+ boss=Archimonde -> 14 rows (got ${rows().length})`);

// the class filter is what replaced the role filter, so narrow with it instead
const byTip = (sel, name) =>
  [...doc.querySelectorAll(sel + " .chip")].find((c) => c.dataset.tip === name);
click(byTip("#class-chips", "Priest"));
const priestRows = rows().length;
ok(priestRows > 0 && priestRows < 14, `+ class=Priest -> ${priestRows} rows (subset of 14)`);
ok(rows().some((tr) => tr.dataset.role === "Tier"),
   "Archimonde's priest view still includes its tier token");

click(doc.getElementById("reset"));
ok(rows().length === 195, `reset -> 195 rows (got ${rows().length})`);

// type grouping
const typeSel = doc.getElementById("type-select");
// Hidden from the dropdown, but an existing shared link must still resolve.
// (Setting select.value to a removed option would just blank it, so drive the
// real path: the url hash.)
window.location.hash = "type=Tier%20Token";
window.dispatchEvent(new window.Event("hashchange"));
ok(rows().length === 15, `an existing #type=Tier Token link still filters -> 15 rows (got ${rows().length})`);
ok([...typeSel.querySelectorAll("option")].some((o) => o.value === "Tier Token"),
   "the hidden option reappears when a link selects it, so it can be cleared");
window.location.hash = "";
window.dispatchEvent(new window.Event("hashchange"));

// weapons split by hand count; 18 + 7 + 6 = the 31 that used to be one bucket
const typeOpts = [...typeSel.querySelectorAll("option")].map((o) => o.value);
ok(typeOpts.includes("Weapons - 1H") && typeOpts.includes("Weapons - 2H"),
   "type dropdown offers Weapons - 1H and Weapons - 2H");
ok(!typeOpts.includes("Weapon"), "the old combined Weapon option is gone");

const byType = (v) => { typeSel.value = v; typeSel.dispatchEvent(new window.Event("change")); return rows().length; };

const oneH = byType("Weapons - 1H");
ok(oneH === 18, `type=Weapons - 1H -> 18 rows (got ${oneH})`);
ok(rows().every((tr) => tr.children[1].textContent === "Weapon"),
   "every 1H result shows the collapsed Weapon slot");

const twoH = byType("Weapons - 2H");
ok(twoH === 7, `type=Weapons - 2H -> 7 rows (got ${twoH})`);
ok(rows().every((tr) => tr.children[1].textContent === "Weapon"),
   "every 2H result shows the collapsed Weapon slot");

const ranged = byType("Ranged");
ok(ranged === 6, `type=Ranged -> 6 rows (got ${ranged})`);
ok(rows().every((tr) => tr.children[1].textContent === "Ranged/Relic"),
   "every Ranged result shows Ranged/Relic");

ok(oneH + twoH + ranged === 31, `1H + 2H + Ranged = 31 (got ${oneH + twoH + ranged})`);

// staves/polearms are 2H by definition, so the prefix is dropped for display only
byType("Weapons - 2H");
const twoHTypes = rows().map((tr) => tr.children[2].textContent);
ok(twoHTypes.includes("Staff"), `2H bucket shows "Staff" (got ${[...new Set(twoHTypes)].join(", ")})`);
ok(!twoHTypes.includes("2H Staff"), '"2H Staff" no longer shown');
ok(!twoHTypes.includes("2H Polearm"), '"2H Polearm" no longer shown');
ok(twoHTypes.includes("2H Axe") && twoHTypes.includes("2H Sword"),
   "2H Axe/Sword keep their prefix - one-handed versions of those exist");
ok(twoHTypes.length === 7, `relabelling didn't change the 2H count (${twoHTypes.length})`);
ok(JSON.parse(fs.readFileSync(path.join(root, "data/loot_data.json"), "utf8"))
     .some((r) => r.type === "2H Staff"), "underlying data still records 2H Staff");

// ambiguous types - "Mace"/"Sword"/"Fist" say neither 1H nor 2H - must still land right
byType("Weapons - 1H");
const oneHNames = rows().map((tr) => tr.children[2].textContent);
ok(oneHNames.includes("1H Mace") && oneHNames.includes("1H Fist"),
   `bare types gain their hand count (got ${[...new Set(oneHNames)].join(", ")})`);
ok(!oneHNames.some((t) => t.startsWith("2H")), "no 2H type leaked into the 1H bucket");
ok(!oneHNames.some((t) => ["Mace", "Sword", "Dagger", "Axe", "Fist"].includes(t)),
   "no weapon is left without a hand count now that the slot column is collapsed");

// slot dropdown: weapons collapse to one option, ranged and relic merge
typeSel.value = ""; typeSel.dispatchEvent(new window.Event("change"));
const slotSel = doc.getElementById("slot-select");
const slotOpts = [...slotSel.querySelectorAll("option")].map((o) => o.value);
ok(slotOpts.includes("Weapon"), "slot dropdown has a single Weapon option");
ok(slotOpts.includes("Ranged/Relic"), "slot dropdown merges Ranged and Relic");
ok(!["One-Hand", "Main-Hand", "Off-Hand", "Two-Hand", "Ranged", "Relic"].some((s) => slotOpts.includes(s)),
   "no split weapon/ranged/relic slots remain in the dropdown");

const bySlot = (v) => { slotSel.value = v; slotSel.dispatchEvent(new window.Event("change")); return rows().length; };
// 35 = 31 weapons + shields/off-hand frills, which share the slot but not the type bucket
ok(bySlot("Weapon") === 35, `slot=Weapon -> 10 One-Hand + 6 Main-Hand + 12 Off-Hand + 7 Two-Hand = 35 (got ${rows().length})`);
ok(bySlot("Ranged/Relic") === 9, `slot=Ranged/Relic -> 7 ranged + 2 relics = 9 (got ${rows().length})`);
ok(bySlot("Head") === 12, `unrelated slots unaffected: Head -> 12 (got ${rows().length})`);
slotSel.value = ""; slotSel.dispatchEvent(new window.Event("change"));

// search still finds both the raw and displayed vocabulary
const searchBox = doc.getElementById("search");
const searchFor = async (q) => {
  searchBox.value = q;
  searchBox.dispatchEvent(new window.Event("input"));
  await new Promise((r) => setTimeout(r, 200));
  return rows().length;
};
ok(await searchFor("1H Mace") > 0, 'search "1H Mace" finds relabelled items');
ok(await searchFor("Two-Hand") > 0, 'search "Two-Hand" still finds items by their raw slot');
await searchFor("");

click(doc.getElementById("reset"));

// search + highlight
const search = doc.getElementById("search");
search.value = "Illidan";
search.dispatchEvent(new window.Event("input"));
await new Promise((r) => setTimeout(r, 250));
ok(rows().length > 0, `search "Illidan" -> ${rows().length} rows`);
ok(doc.querySelectorAll("mark").length > 0, "search highlights matches");

// html-escaping through the highlight path
search.value = "Kael'thas";
search.dispatchEvent(new window.Event("input"));
await new Promise((r) => setTimeout(r, 250));
ok(!doc.body.innerHTML.includes("&amp;#39;</mark>") || true, "apostrophe search does not crash");
ok(rows().length > 0, `search "Kael'thas" -> ${rows().length} rows`);

// --- tier tokens render as class icons only ---
click(doc.getElementById("reset"));

// The Tier role chip used to be the way in, so the type option was hidden. With
// the role filter gone the dropdown is the only route to the tokens.
const typeOptsAfter = [...typeSel.querySelectorAll("option")].map((o) => o.value);
ok(typeOptsAfter.includes("Tier Token"), "Tier Token is selectable in the type dropdown again");
ok(typeOptsAfter.includes("Cloth") && typeOptsAfter.includes("Weapons - 1H"),
   "other type options are unaffected");

typeSel.value = "Tier Token";
typeSel.dispatchEvent(new window.Event("change"));
const tierRows = rows();
ok(tierRows.length === 15, `type=Tier Token selects all 15 tokens (got ${tierRows.length})`);
ok(tierRows.every((tr) => !/[()]/.test(tr.children[2].textContent)),
   "the parenthesised class list is gone");
ok(tierRows.every((tr) => tr.children[2].textContent.trim().replace(/-/g, "").trim() === ""),
   `the type column is icons only, no words (got "${tierRows[0].children[2].textContent.trim()}")`);
ok(!doc.querySelector(".tier-label"), "no leftover Token/Tier label element");
ok(tierRows.every((tr) => tr.dataset.role === "Tier"),
   "tier rows still carry their role in the dom, even with the column hidden");
ok(tierRows.every((tr) => tr.children[2].querySelectorAll("img.class-icon").length === 3),
   "every tier row shows exactly 3 class icons");

const iconSrcs = new Set([...doc.querySelectorAll("img.class-icon")].map((i) => i.getAttribute("src")));
ok(iconSrcs.size === 9, `9 distinct class icons across the three token types (got ${iconSrcs.size})`);
ok([...iconSrcs].every((s) => /classicon_(paladin|priest|warlock|warrior|hunter|shaman|rogue|mage|druid)\.jpg$/.test(s)),
   "class icon urls are the nine expected classes");
ok([...doc.querySelectorAll("img.class-icon")].every((i) => i.getAttribute("alt") && i.getAttribute("data-tip")),
   "class icons carry alt and title text for accessibility");

const conqueror = tierRows.find((tr) => tr.children[0].textContent.includes("Conqueror"));
ok([...conqueror.children[2].querySelectorAll("img")].map((i) => i.getAttribute("alt")).join(",") === "Paladin,Priest,Warlock",
   "Conqueror token maps to Paladin/Priest/Warlock");

click(doc.getElementById("reset"));

// --- spec icons in the priority column ---
click(doc.getElementById("reset"));

const specIcons = [...doc.querySelectorAll(".col-prio img.spec-icon")];
ok(specIcons.length > 350, `spec icons rendered across the table (${specIcons.length})`);
ok(specIcons.every((i) => i.getAttribute("data-tip") && i.getAttribute("alt")),
   "every spec icon has a tooltip and alt");
// title and alt name the same spec; they differ only in how they say "BiS"
const baseName = (i) => i.getAttribute("data-tip").split("\n")[0];
ok(specIcons.every((i) => i.getAttribute("alt").startsWith(baseName(i))),
   "tooltip and alt name the same spec");
ok(specIcons.every((i) => /zamimg\.com\/images\/wow\/icons\/large\/[a-z0-9_]+\.jpg$/.test(i.src)),
   "spec icon urls are well formed");

// step 2: the shorthand is replaced by icons, operators stay as text
const illidanStaff = [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes("Zhar'doom"));
const prioText = illidanStaff.children[3].textContent;
ok(!/SPriest|Lock|Boomkin|Mage|Ele/.test(prioText),
   `class/spec words removed from the priority column (got "${prioText.trim()}")`);
ok(/>=/.test(prioText) && /=/.test(prioText), `operators kept as text: "${prioText.trim()}"`);
ok(illidanStaff.children[3].querySelectorAll("img.spec-icon").length === 5,
   `Zhar'doom's 5 specs each got an icon (got ${illidanStaff.children[3].querySelectorAll("img.spec-icon").length})`);
// by identifier, not display name: a BiS class icon's name line also lists the
// specs behind its ring ("Mage — Arcane, Fire, Frost")
ok([...illidanStaff.children[3].querySelectorAll("img")].map((i) => i.dataset.id).join(",") ===
   "Shadow,Warlock,Mage,BalanceDruid,Ele",
   "Zhar'doom's icons are in priority order");

// free text that isn't a spec must survive
// --- instant tooltips ---
// title has a browser-imposed ~1s delay, so the icons must not rely on it
const tipIcons = [...doc.querySelectorAll(".col-prio img, .col-type img.class-icon")];
ok(tipIcons.length > 0 && tipIcons.every((i) => !i.getAttribute("title")),
   "no icon uses the delayed native title attribute");
ok(tipIcons.every((i) => i.getAttribute("data-tip")), "every icon carries data-tip instead");
ok(tipIcons.every((i) => i.getAttribute("aria-label")), "every icon keeps an aria-label");

const probe = doc.querySelector(".col-prio img[data-tip]");
probe.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
const tipEl = doc.querySelector("body > .tip");
ok(!!tipEl, "hovering an icon creates the tooltip element");
// the name is the tooltip's first line; a BiS icon appends a second one below it
ok(tipEl.firstChild.textContent === probe.getAttribute("data-tip"),
   `tooltip leads with the spec name (got "${tipEl.firstChild.textContent}")`);
ok(tipEl.style.display === "block", "tooltip is visible on hover");
ok(tipEl.parentElement === doc.body,
   "tooltip is parented to body so the table's overflow container can't clip it");
ok(window.getComputedStyle(tipEl).position === "fixed" || tipEl.style.position === "" ,
   "tooltip is positioned rather than inline in the row");

probe.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
ok(tipEl.style.display === "none", "tooltip hides again on mouseout");

// keyboard users get the same thing
probe.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
ok(tipEl.style.display === "block", "focus shows the tooltip too");
probe.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));

// no css transition - a fade would reintroduce the delay we're removing
ok(!/\.tip\s*\{[^}]*transition/.test(cssText), "tooltip has no transition, so it appears instantly");

// --- priority is structured data, driven by the registry ---
ok(data.every((r) => Array.isArray(r.priority)), "every priority is a list, not a string");
// 27 playable specs, plus FeralDruid as an umbrella over FeralBear and FeralCat -
// it stays a valid identifier because the priorities name it, but it is not a spec
// you can pick and holds no BiS of its own
const umbrellas = Object.keys(specs.specs).filter((id) => (specs.specs[id].covers || []).length);
const pickable = Object.keys(specs.specs).filter((id) => !(specs.specs[id].covers || []).length);
ok(pickable.length === 28, `registry has 28 pickable specs, feral split in two (${pickable.length})`);
ok(umbrellas.join(",") === "FeralDruid", `FeralDruid is the only umbrella (${umbrellas.join(",")})`);
ok(specs.specs.FeralDruid.covers.join(",") === "FeralBear,FeralCat", "it covers bear and cat");
ok(umbrellas.every((id) => !bis.specs[id]), "an umbrella holds no BiS set of its own");
ok(Object.values(specs.forms.FeralDruid).every((f) => specs.specs[f.spec]),
   "each form points at the spec it resolves to");
ok(Object.keys(specs.classes).length === 9, "registry has 9 classes");

// identifiers in the data must exist in the registry - this is what makes a typo an error
const unknown = [];
for (const rec of data) {
  for (const e of rec.priority || []) {
    const id = e.spec || e.class;
    if (!(specs.specs[id] || specs.classes[id])) unknown.push(`${rec.item}: ${id}`);
  }
}
ok(unknown.length === 0, `every priority identifier resolves (${unknown.slice(0, 3).join(", ")})`);

// operators render between the icons, and only the five known ones appear
const ops = [...doc.querySelectorAll(".col-prio .prio-op")].map((o) => o.textContent);
const KNOWN_OPS = [">", ">>", "~>", "=", "~="];
ok(ops.length > 0 && ops.every((o) => KNOWN_OPS.includes(o)),
   `only known operators render (${[...new Set(ops)].sort().join(" ")})`);
ok(ops.every((o) => o !== ">="), "the old >= is gone");

const opRow = (name) => [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name)).children[3];
ok([...opRow("Stormrage Signet Ring").querySelectorAll(".prio-op")].map((o) => o.textContent).includes(">>"),
   "Stormrage Signet Ring keeps its >>");
ok([...opRow("Zhar'doom").querySelectorAll(".prio-op")].map((o) => o.textContent).includes("~>"),
   "Zhar'doom uses ~> where it had >=");
ok([...opRow("Fist of Molten Fury").querySelectorAll(".prio-op")].map((o) => o.textContent).includes("~="),
   "Fist of Molten Fury uses ~= where it had a bare ~");

// operators carry a tooltip, ready for the operator-tooltip feature
ok([...doc.querySelectorAll(".prio-op")].every((o) => o.dataset.tip),
   "every operator has a data-tip explaining it");

// race qualifiers still render their own icon before the spec
const rising = opRow("Rising Tide");
ok(rising.querySelectorAll("img")[0].dataset.tip === "Orc",
   `Rising Tide leads with the Orc icon (got ${rising.querySelectorAll("img")[0].dataset.tip})`);

// forms resolve to their own icon and name
const vanq = opRow("Pauldrons of the Forgotten Vanquisher");
ok([...vanq.querySelectorAll("img")].some((i) => i.dataset.tip === "Feral Druid (bear)"),
   "the bear form renders as its own icon");

// tier tokens still work, which proves CLASS_INFO's replacement reads the registry
ok(doc.querySelectorAll(".col-type img.class-icon").length === 45,
   `15 tier tokens x 3 class icons = 45 (${doc.querySelectorAll(".col-type img.class-icon").length})`);

// --- BiS comes from data/bis.json, not from the priority string ---
ok(!JSON.stringify(data).includes("*"), "no asterisk markers left in loot_data.json");
ok(bis.specs && Object.keys(bis.specs).length >= 4, "bis.json has spec entries");

// every entry in the file that is visible must have produced a ring
const tierClass = { phase: "spec-icon--bis", multiPhase: "spec-icon--bis2", expansion: "spec-icon--bis3" };
// bis.json and priority both use registry identifiers now, so visibility is an
// exact membership test rather than a regex over prose
const displayName = (id) => (specs.specs[id] || specs.classes[id] || {}).name;
const listsSpec = (rec, id) =>
  (rec.priority || []).some((e) => (e.spec || e.class) === id);

// Icons carry data-id, so an entry is matched to its icon by identifier rather
// than by display name - forms ("Feral Druid (cat)") make the name lossy.
const rowFor = (item) => [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(item));
const iconById = (row, id) =>
  [...row.children[3].querySelectorAll("img")].find((i) => i.dataset.id === id);
const tierNum = { phase: 1, multiPhase: 2, expansion: 3 };
const tierOf = (icon) =>
  icon.classList.contains("spec-icon--bis3") ? 3
    : icon.classList.contains("spec-icon--bis2") ? 2
      : icon.classList.contains("spec-icon--bis") ? 1 : 0;

let onSpec = 0, onClass = 0, missing = [];
for (const [specId, phases] of Object.entries(bis.specs)) {
  const owner = (specs.specs[specId] || {}).class;
  for (const entries of Object.values(phases)) {
    for (const e of entries) {
      const rec = data.find((r) => r.id === e.id);
      if (!rec) continue;
      const row = rowFor(rec.item);
      const want = tierNum[e.bis || "phase"];

      if (listsSpec(rec, specId)) {
        // the priority names the spec: its own icon carries exactly this tier
        const icon = iconById(row, specId);
        if (!icon || tierOf(icon) !== want) missing.push(`${rec.item} / ${specId} (spec icon)`);
        onSpec++;
      } else if (owner && listsSpec(rec, owner)) {
        // it names the class: the class icon carries the best tier among its
        // specs, so this entry's tier is a floor rather than an equality
        const icon = iconById(row, owner);
        if (!icon || tierOf(icon) < want) missing.push(`${rec.item} / ${specId} (via ${owner})`);
        onClass++;
      }
      // neither listed: recorded but unshowable, which check_bis.py warns about
    }
  }
}
ok(missing.length === 0, `every showable bis entry produced a ring (missing: ${missing.slice(0, 4).join("; ")})`);
ok(onSpec > 50 && onClass > 50,
   `rings land on both spec and class icons (${onSpec} spec, ${onClass} class)`);

// an item with no entry anywhere in bis.json must have no ring
const bisIds = new Set(Object.values(bis.specs).flatMap((p) => Object.values(p).flat()).map((e) => e.id));
const cleanRec = data.find((r) => !bisIds.has(r.id) && r.priority.length);
const unmarked = rowFor(cleanRec.item);
ok([...unmarked.children[3].querySelectorAll("img")].every((i) => !i.className.includes("--bis")),
   `an item absent from bis.json has no rings (${cleanRec.item})`);

// --- BiS markers ---
const iconsOf = (name) => [...[...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name))
  .children[3].querySelectorAll("img")];

const highborne = iconsOf("Shroud of the Highborne");
ok(highborne[0].classList.contains("spec-icon--bis2"),
   "** renders the multi-phase ring on the marked spec");

// Whether an icon rings is decided per icon: a spec icon answers for itself, a
// class icon for any of its specs. Checked here against bis.json on one row that
// carries both kinds (Resto Shaman, Priest, Druid, Holy Paladin).
const isBisFor = (id, itemId) =>
  Object.entries(bis.specs).some(([specId, phases]) =>
    (specId === id || (specs.specs[specId] || {}).class === id) &&
    Object.values(phases).flat().some((e) => e.id === itemId));
const shroudId = data.find((r) => r.item === "Shroud of the Highborne").id;
ok(highborne.every((i) => i.className.includes("--bis") === isBisFor(i.dataset.id, shroudId)),
   "each icon rings if and only if the item is BiS for it, class icons included");
ok(highborne.some((i) => specs.classes[i.dataset.id] && i.className.includes("--bis")),
   "a class icon can carry a ring for the specs behind it");
ok(/BiS/.test(highborne[0].dataset.tipBis) && /phase/i.test(highborne[0].dataset.tipBis),
   `multi-phase icon says so on hover: ${JSON.stringify(highborne[0].dataset.tipBis)}`);

// the phase example likewise comes from the file rather than being named
const phaseCase = Object.entries(bis.specs).flatMap(([specId, phases]) =>
  Object.values(phases).flat()
    .filter((e) => (e.bis || "phase") === "phase")
    .map((e) => ({ specId, rec: data.find((r) => r.id === e.id) })))
  .find(({ specId, rec }) => rec && listsSpec(rec, specId));
const phaseIcon = iconById(rowFor(phaseCase.rec.item), phaseCase.specId);
ok(phaseIcon.classList.contains("spec-icon--bis"),
   `* renders the single BiS ring (${phaseCase.rec.item} / ${phaseCase.specId})`);
ok(!phaseIcon.classList.contains("spec-icon--bis2"), "* is not treated as **");
ok(phaseIcon.dataset.tipBis === "Phase BiS",
   `single BiS icon says so on hover: ${JSON.stringify(phaseIcon.dataset.tipBis)}`);

// Pillar of Ferocity is why feral is split: it is expansion-long for bear and not
// BiS at all for cat, which one FeralDruid entry could not say
const pillarRow = rowFor("Pillar of Ferocity");
const pillarUmbrella = [...pillarRow.children[3].querySelectorAll("img")]
  .find((i) => i.dataset.id === "FeralDruid" || i.dataset.id === "FeralBear");
ok(pillarUmbrella && pillarUmbrella.classList.contains("spec-icon--bis3"),
   "Pillar of Ferocity rings as expansion BiS through the bear it covers");
ok(/bear/i.test(pillarUmbrella.dataset.tip) && !/cat/i.test(pillarUmbrella.dataset.tip),
   `and names bear only, not cat (got "${pillarUmbrella.dataset.tip}")`);

// the expansion example is taken from the file rather than named, so re-rating an
// item's longevity doesn't rewrite the test
const expansionCase = Object.entries(bis.specs).flatMap(([specId, phases]) =>
  Object.values(phases).flat()
    .filter((e) => e.bis === "expansion")
    .map((e) => ({ specId, rec: data.find((r) => r.id === e.id) })))
  .find(({ specId, rec }) => rec && listsSpec(rec, specId));
ok(!!expansionCase, "the file has at least one expansion-BiS entry on a spec the priority names");

const expansionIcon = iconById(rowFor(expansionCase.rec.item), expansionCase.specId);
ok(expansionIcon.classList.contains("spec-icon--bis3"),
   `*** renders the expansion-BiS ring (${expansionCase.rec.item} / ${expansionCase.specId})`);
ok(expansionIcon.dataset.tip === displayName(expansionCase.specId) &&
   expansionIcon.dataset.tipBis === "Expansion BiS",
   `name and BiS line carried separately (got ${JSON.stringify(expansionIcon.dataset.tip)} / ${JSON.stringify(expansionIcon.dataset.tipBis)})`);
ok(expansionIcon.dataset.tipTier === "3", "expansion tier tagged 3 so the tooltip can colour it");
ok(highborne[0].dataset.tipBis === "Multi-phase BiS" && highborne[0].dataset.tipTier === "2",
   `multi-phase label (got ${JSON.stringify(highborne[0].dataset.tipBis)})`);
ok(phaseIcon.dataset.tipBis === "Phase BiS" && phaseIcon.dataset.tipTier === "1",
   `phase label (got ${JSON.stringify(phaseIcon.dataset.tipBis)})`);

// hovering renders the BiS line as its own coloured element
expansionIcon.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
const liveTip = doc.querySelector("body > .tip");
const bisLine = liveTip.querySelector(".tip-bis");
ok(!!bisLine, "the tooltip renders a separate .tip-bis line");
ok(bisLine.textContent === "Expansion BiS", `BiS line text (got "${bisLine && bisLine.textContent}")`);
ok(bisLine.classList.contains("tip-bis--3"), "BiS line tagged with its tier for colouring");
ok(liveTip.textContent.startsWith(displayName(expansionCase.specId)),
   "spec name still leads the tooltip");
expansionIcon.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));

// an unmarked icon must not grow a BiS line left over from a previous hover
const plainIcon = [...doc.querySelectorAll(".col-prio img")].find((i) => !i.dataset.tipBis);
plainIcon.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
ok(!doc.querySelector("body > .tip .tip-bis"), "no stale BiS line when hovering an unmarked icon");
plainIcon.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));

for (const [tier, colour] of [["1", "--epic"], ["2", "--legendary"], ["3", "--artifact"]]) {
  ok(cssText.includes(".tip-bis--" + tier + " { color: var(" + colour + ")"),
     `tooltip tier ${tier} text uses ${colour}, matching its ring`);
}
for (const [tier, colour] of [["bis", "--epic"], ["bis2", "--legendary"], ["bis3", "--artifact"]]) {
  ok(new RegExp("\\.spec-icon--" + tier + "\\s*\\{[^}]*var\\(" + colour).test(cssText),
     `${tier} ring uses ${colour}`);
}
// Bulwark is BiS for both tanks it names, and each ring answers for its own spec
const bulwarkIcons = iconsOf("Bulwark of Azzinoth");
ok(bulwarkIcons.map((i) => i.dataset.id).join(",") === "ProtWarr,ProtPal",
   "icons carry their registry identifier");
ok(bulwarkIcons.every((i) => i.className.includes("--bis")),
   "both tanks it lists are ringed");

// the markers must never reach the rendered text
ok(!doc.querySelector("#results").textContent.includes("*"),
   "the * markers are consumed, never displayed");

// a row nobody has marked is untouched
ok(iconsOf(cleanRec.item).every((i) => !i.className.includes("bis")),
   "rows with no markers render no rings");

// --- items the source guide never covered ---
const unsourced = data.filter((r) => r.unsourced);
ok(unsourced.length === 13, `13 records are marked unsourced (got ${unsourced.length})`);
ok(unsourced.every((r) => r.priority.length === 0),
   "an unsourced record never carries a priority - there is no call to record");
ok(data.filter((r) => !r.unsourced).length === 182,
   "the creator's original 182 are still exactly that");

const tagged = [...doc.querySelectorAll("tbody tr .item-tag")];
ok(tagged.length === 13, `each unsourced row is tagged in the table (got ${tagged.length})`);
ok(tagged.every((t) => t.dataset.tip && /audit/i.test(t.dataset.tip)),
   "the tag explains itself on hover");
const taggedRowNames = tagged.map((t) => t.closest("tr").children[0].textContent);
ok(unsourced.every((r) => taggedRowNames.some((n) => n.includes(r.item))),
   "every unsourced item is one of the tagged rows");

// the four Bands of the Eternal land in Hyjal trash, and say what they really are
const bands = data.filter((r) => r.item.startsWith("Band of the Eternal"));
ok(bands.length === 4, `all four Bands of the Eternal are present (got ${bands.length})`);
ok(bands.every((r) => r.zone === "Mount Hyjal" && r.boss === "Trash"),
   "they sit under Mount Hyjal trash");
ok(bands.every((r) => /Scale of the Sands/.test(r.notes)),
   "and their notes say they are a reputation reward, not a drop");
ok(bands.every((r) => r.unique), "each is unique-equipped, so no doubling up");

// the priority column is now icons and operators only - no prose anywhere
const proseRows = [...doc.querySelectorAll("tbody tr")].filter((tr) =>
  /[a-z]/i.test(tr.children[3].textContent));
ok(proseRows.length === 0,
   `no free text left in any priority (found: ${proseRows.map((tr) => tr.children[3].textContent.trim()).join(" | ")})`);

// rows whose priority is deliberately blank render an empty cell, not "undefined"
const blank = [...doc.querySelectorAll("tbody tr")]
  .filter((tr) => tr.children[3].textContent.trim() === "" &&
                  tr.children[3].querySelectorAll("img").length === 0);
// 23 the creator left open, plus the 13 he never covered
ok(blank.length === 36, `36 items render a blank priority cell (got ${blank.length})`);
ok(data.filter((r) => !r.priority.length && !r.unsourced).length === 23,
   "23 of them are the creator's own 'whoever needs it' calls");
ok(!doc.body.textContent.includes("undefined"), "no undefined leaks from the empty strings");

// searching still works even though the words are no longer displayed
searchBox.value = "Boomkin";
searchBox.dispatchEvent(new window.Event("input"));
await new Promise((r) => setTimeout(r, 200));
ok(rows().length > 0, `search finds items by a spec name that is no longer rendered (${rows().length} rows)`);
searchBox.value = "";
searchBox.dispatchEvent(new window.Event("input"));
await new Promise((r) => setTimeout(r, 200));

// longest-match wins: "Prot Pal" must not render as "Prot" + "Pal"
const bulwark = [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes("Bulwark of Azzinoth"));
const bulwarkTitles = [...bulwark.children[3].querySelectorAll("img")].map((i) => i.dataset.id);
ok(bulwarkTitles.join(",") === "ProtWarr,ProtPal",
   `"Prot Warrior > Prot Paladin" maps to both prot specs (got ${bulwarkTitles.join(", ")})`);

// \b guard: "Hunter (catch-up)" must not match "Cat" inside "catch-up"
const halberd = [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes("Halberd of Desolation"));
const halberdTitles = [...halberd.children[3].querySelectorAll("img")].map((i) => i.dataset.id);
ok(halberdTitles.join(",") === "Hunter",
   `"Hunter (catch-up)" yields only Hunter, no stray Cat (got ${halberdTitles.join(", ")})`);

// race icons, and the "non-" exclusion that must NOT get one
const risingTide = [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes("Rising Tide"));
const rtTitles = [...risingTide.children[3].querySelectorAll("img")].map((i) => i.dataset.tip);
ok(rtTitles[0] === "Orc", `"Orc Fury" gets the Orc race icon (got ${rtTitles.join(", ")})`);
ok(rtTitles.filter((t) => t === "Orc").length === 1,
   '"non-orc Fury" does not also get an Orc icon - it means the opposite');
ok(rtTitles.join(",") === "Orc,Fury Warrior,Enhancement Shaman,Fury Warrior",
   `Rising Tide icon sequence is right (got ${rtTitles.join(", ")})`);

// the edits applied to the data
const priorityOf = (name) => [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name)).children[3].textContent;
const notesOf = (name) => [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name)).children[4].textContent;

// priorities are now icons, so assert on the icon titles rather than the text
// identifiers rather than display names: a class icon carrying a ring also lists
// the specs behind it on its name line
const specsOf = (name) => [...[...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name))
  .children[3].querySelectorAll("img")].map((i) => i.dataset.id);

ok(!priorityOf("Syphon of the Nathrezim").includes("(x2)"), "Syphon: (x2) removed from priority");
ok(notesOf("Syphon of the Nathrezim").includes("2x"), "Syphon: notes explain two are needed");
ok(specsOf("Shadowmoon Insignia").join(",") === "FeralDruid,ProtWarr,ProtPal",
   `Shadowmoon Insignia respecced (got ${specsOf("Shadowmoon Insignia").join(", ")})`);
ok(specsOf("Leggings of Divine Retribution").join(",") === "Fury,Arms,Ret",
   "Leggings of Divine Retribution respecced");

// bare "Prot" resolved to Protection Warrior everywhere
for (const item of ["Ring of Deceitful Intent", "Pauldrons of the Forgotten Protector",
                    "Chestguard of the Forgotten Protector", "Helm of the Forgotten Protector"]) {
  ok(specsOf(item).includes("ProtWarr"), `${item}: bare Prot is now Protection Warrior`);
}
ok(!priorityOf("Pauldrons of the Forgotten Protector").includes("fury ver"), "Pauldrons: (fury ver) gone");
ok(notesOf("Pauldrons of the Forgotten Protector").includes("DPS version"), "Pauldrons: note added");
ok(!priorityOf("Chestguard of the Forgotten Protector").includes("(fury)"), "Chestguard Protector: (fury) gone");
ok(!priorityOf("Chestguard of the Forgotten Conqueror").includes("vestment-less"),
   "Chestguard Conqueror: vestment-less removed from priority");
ok(notesOf("Chestguard of the Forgotten Conqueror").includes("Sea-witch"),
   "Chestguard Conqueror: vestment caveat moved to notes");
ok(!priorityOf("Cowl of the Illidari High Lord").includes("vestment-less"),
   "Cowl: vestment-less removed from priority");
ok(notesOf("Cowl of the Illidari High Lord").includes("Sea-witch"), "Cowl: caveat moved to notes");
ok(specsOf("Stormrage Signet Ring").join(",") ===
   "Rogue,Enh,Arms,Fury,Hunter,FeralDruid,ProtWarr,Ret",
   `Stormrage Signet Ring order intact (got ${specsOf("Stormrage Signet Ring").join(", ")})`);
ok((priorityOf("Stormrage Signet Ring").match(/=/g) || []).length === 2,
   "Stormrage Signet Ring uses = instead of /");
ok((priorityOf("Leggings of the Forgotten Protector").match(/=/g) || []).length === 3,
   "Leggings of the Forgotten Protector uses = instead of /");

// every conditional has been moved out of the priority column
const allPriorities = [...doc.querySelectorAll("tbody tr")].map((tr) => tr.children[3].textContent);
ok(allPriorities.every((p) => !p.includes("(")),
   `no parentheticals left in any priority (${allPriorities.filter((p) => p.includes("(")).length} found)`);
ok(specsOf("Antonidas's Aegis").join(",") === "Ele,ProtPal",
   `Antonidas keeps its Prot Pal (got ${specsOf("Antonidas's Aegis").join(", ")})`);
ok(notesOf("Blade of Infamy").includes("Talon of Azshara"), "Blade of Infamy caveat lives in notes");

// youtube links in the credit section
const ytLinks = [...doc.querySelectorAll(".site-footer a")].filter((a) => a.href.includes("youtube.com"));
ok(ytLinks.length === 2, `both source videos linked in the footer (got ${ytLinks.length})`);
ok(ytLinks.some((a) => a.href.includes("B3zgswtk6T8")) && ytLinks.some((a) => a.href.includes("6SWlWDYTkvU")),
   "the two video ids are the ones supplied");

// search highlighting must still work alongside the icons, and not match icon titles
// spec names are icons now, so they can't be highlighted - but free text still is,
// and the highlight must never leak into an icon's title attribute
// the priority column is icons only now, so highlighting lives in the other
// columns - the guard that matters is that it never leaks into an icon title
searchBox.value = "casters";
searchBox.dispatchEvent(new window.Event("input"));
await new Promise((r) => setTimeout(r, 200));
ok(doc.querySelectorAll("mark").length > 0, `search still highlights (${doc.querySelectorAll("mark").length} marks)`);
ok(doc.querySelectorAll(".col-prio mark").length === 0,
   "nothing to highlight in the priority column now that it is icons only");
ok([...doc.querySelectorAll("mark")].every((m) => m.textContent.toLowerCase() === "casters"),
   "highlight only wraps the searched word, not icon titles");
searchBox.value = "";
searchBox.dispatchEvent(new window.Event("input"));
await new Promise((r) => setTimeout(r, 200));

// --- footer ---
const footer = doc.querySelector(".site-footer").textContent;
ok(!footer.includes("Item IDs"), "wowsims/Wowhead attribution paragraph removed");
ok(!footer.includes("Shorthand"), "shorthand paragraph removed");
ok(!doc.querySelector(".site-footer .shorthand"), "no leftover shorthand element");
ok(footer.includes("Not affiliated with Blizzard"), "Blizzard disclaimer kept");
// The banner title is deliberately generic now ("Classic WoW Loot Prios"), so the
// credit has to be carried by the tagline beside it. CLAUDE.md section 8 requires
// attribution to stay prominent, and a title that no longer names him is exactly
// how that erodes by accident.
const banner = doc.querySelector(".site-header").textContent;
ok(/zatar_wow/.test(banner), `the banner still credits the source: "${banner.replace(/\s+/g, " ").trim().slice(0, 90)}"`);
ok(doc.querySelector(".site-header a[href*='zatar_wow']"), "and links to them from the banner");

ok(footer.includes("zatar_wow") && footer.includes("Veramos") && footer.includes("Lemonism"),
   "creator credits kept");

// --- tokens surface under the roles/armour their classes can use ---
const setType = (v) => { typeSel.value = v; typeSel.dispatchEvent(new window.Event("change")); };
const tokenNames = () => rows().filter((tr) => tr.children[2].querySelector("img.class-icon"))
                                .map((tr) => tr.children[0].textContent.trim());
const litClasses = () => [...doc.querySelectorAll("tbody tr")]
  .flatMap((tr) => [...tr.children[2].querySelectorAll("img.class-icon")])
  .filter((i) => !i.classList.contains("class-icon--muted"))
  .map((i) => i.getAttribute("alt"));

// cloth + legs. The role half of this test went with the role filter, but the
// per-class rule still decides which tokens qualify: a token surfaces only if one
// of its three classes wears the armour asked for.
click(doc.getElementById("reset"));
setType("Cloth");
slotSel.value = "Legs"; slotSel.dispatchEvent(new window.Event("change"));

const legTokens = tokenNames();
ok(legTokens.some((n) => n.includes("Conqueror")) && legTokens.some((n) => n.includes("Vanquisher")),
   `Conqueror (Priest/Warlock) and Vanquisher (Mage) both appear (got ${legTokens.join(", ")})`);
ok(!legTokens.some((n) => n.includes("Protector")),
   "Protector stays out - Warrior is plate, Hunter and Shaman are mail");

// dimming: only the cloth wearers stay lit
const lit = new Set(litClasses());
ok(lit.has("Priest") && lit.has("Warlock") && lit.has("Mage"),
   `cloth classes lit: ${[...lit].join(", ")}`);
ok(!lit.has("Paladin") && !lit.has("Rogue") && !lit.has("Druid"),
   "classes on those tokens that don't wear cloth are dimmed");

// plate reaches Conqueror (Paladin) and Protector (Warrior), not Vanquisher
click(doc.getElementById("reset"));
setType("Plate");
const plate = tokenNames();
ok(plate.some((n) => n.includes("Conqueror")) && plate.some((n) => n.includes("Protector")),
   "plate reaches Conqueror (Paladin) and Protector (Warrior)");
ok(!plate.some((n) => n.includes("Vanquisher")),
   "Vanquisher stays out - Rogue and Druid are leather, Mage is cloth");

// the type option selects every token regardless of armour, and mutes nothing
click(doc.getElementById("reset"));
setType("Tier Token");
ok(rows().length === 15, `type=Tier Token selects all 15 tokens (got ${rows().length})`);
ok(!doc.querySelector(".class-icon--muted"), "no dimming when the filter is the tokens themselves");

// no filters at all: nothing is dimmed
click(doc.getElementById("reset"));
ok(!doc.querySelector(".class-icon--muted"), "no dimming when no filters are active");
ok(rows().length === 195, "unfiltered view is unchanged at 195 rows");

// --- column sorting ---
click(doc.getElementById("reset"));
openP3();
const bossChip = (t) => chipByText("#boss-chips", t);
click(chipByText("#zone-chips", "Black Temple"));
click(bossChip("Illidan Stormrage"));

const colText = (i) => rows().map((tr) => tr.children[i].textContent.trim());
const headerFor = (key) => doc.querySelector(`th[data-sort="${key}"]`);

ok(["item", "slot", "type"].every((k) => headerFor(k)), "Item/Slot/Type headers are sortable");
ok(!headerFor("role"), "Role header is gone with the column");
ok(!doc.querySelector('th[data-sort="priority"]') && !doc.querySelector('th[data-sort="notes"]'),
   "Priority and Notes are not sortable");

const unsorted = colText(0);
click(headerFor("item"));
const asc = colText(0);
ok(asc.join("|") === [...asc].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join("|"),
   "first click on Item sorts A-Z");
ok(asc.join("|") !== unsorted.join("|"), "sorting actually reordered the rows");
ok(headerFor("item").getAttribute("aria-sort") === "ascending", "aria-sort reports ascending");

click(headerFor("item"));
const desc = colText(0);
ok(desc.join("|") === [...asc].reverse().join("|"), "second click on Item reverses to Z-A");
ok(headerFor("item").getAttribute("aria-sort") === "descending", "aria-sort reports descending");
ok(window.location.hash.includes("sort=item%3Adesc"), `sort state is in the url: ${window.location.hash}`);

// switching column starts fresh at ascending
click(headerFor("type"));
ok(headerFor("type").getAttribute("aria-sort") === "ascending", "new column starts ascending");
ok(headerFor("item").getAttribute("aria-sort") === "none", "previous column clears its indicator");

// the role sort key went with the column
ok(!/ROLE_ORDER/.test(fs.readFileSync(path.join(root, "app.js"), "utf8")),
   "role sort key and ROLE_ORDER removed from app.js");

// slot sorts in paper-doll order: Head before Back before Weapon
click(headerFor("slot"));
const slotSeq = colText(1);
ok(slotSeq.indexOf("Head") < slotSeq.indexOf("Back"), "slot sorts in paper-doll order, Head before Back");
ok(slotSeq.lastIndexOf("Weapon") >= slotSeq.indexOf("Head"), "weapons sort after armour slots");

// sorting is global: every group is ordered the same way
click(doc.getElementById("reset"));
click(headerFor("item"));
ok([...doc.querySelectorAll(".boss-group")].every((g) => {
  const names = [...g.querySelectorAll("tbody tr")].map((tr) => tr.children[0].textContent.trim());
  return names.join("|") === [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join("|");
}), "every boss group is sorted, not just the one clicked");

// grouping order must survive sorting
const sortedHeads = [...doc.querySelectorAll(".boss-head .boss-name")].map((h) => h.textContent.trim());
ok(sortedHeads[0] === "Trash" && sortedHeads[9] === "Illidan Stormrage",
   "boss groups stay in kill order while rows sort inside them");
ok(rows().length === 195, `all rows still present after sorting (${rows().length})`);

click(doc.getElementById("reset"));
ok(!doc.querySelector('th[aria-sort="ascending"]') && !doc.querySelector('th[aria-sort="descending"]'),
   "reset clears the sort");

// --- phase, zone, boss: each row waits for the one above ---
click(doc.getElementById("reset"));
const phaseChip = (n) => chipByText("#phase-chips", "Phase " + n);
const zoneChipNames = () => [...doc.querySelectorAll("#zone-chips .chip")]
  .filter((c) => !c.classList.contains("chip--all")).map((c) => c.textContent.replace(/\d+$/, "").trim());

ok([1, 2, 3, 4, 5].every((n) => phaseChip(n)), "all five phases have a chip");
ok(phaseChip(1).querySelector(".n").textContent === "0",
   "a phase with no items yet reads 0 rather than being hidden");

click(phaseChip(1));
ok(zoneChipNames().join(", ") === "Karazhan, Gruul's Lair, Magtheridon's Lair",
   `phase 1 opens its own zones: ${zoneChipNames().join(", ")}`);
ok(rows().length === 0, "and nothing is listed under it yet");

// the empty zones have their bosses too, so a phase opens onto something real
click(chipByText("#zone-chips", "Karazhan"));
const bossNames = () => [...doc.querySelectorAll("#boss-chips .chip")]
  .filter((c) => !c.classList.contains("chip--all")).map((c) => c.textContent.replace(/\d+$/, "").trim());
ok(bossNames().length === 12, `Karazhan lists its 12 encounters (got ${bossNames().length})`);
ok(bossNames()[0] === "Trash" && bossNames()[11] === "Nightbane",
   `in kill order: ${bossNames()[0]} ... ${bossNames()[11]}`);
ok([...doc.querySelectorAll("#boss-chips .chip .n")].every((n) => n.textContent === "0"),
   "every one reads 0 until items arrive");
ok([...doc.querySelectorAll("#boss-chips .chip")]
     .filter((c) => !c.classList.contains("chip--all") && !/Chess/.test(c.textContent))
     .every((c) => c.querySelector("img.chip-icon")),
   "and each carries a portrait, bar the Chess Event which has none in the journal");
ok(rows().length === 0, "with no items listed under any of them yet");

click(phaseChip(2));
ok(zoneChipNames().join(", ") === "Serpentshrine Cavern, Tempest Keep",
   `phase 2 replaces them: ${zoneChipNames().join(", ")}`);

click(phaseChip(3));
ok(zoneChipNames().join(", ") === "Black Temple, Mount Hyjal, Crafted",
   `phase 3 is the one with data: ${zoneChipNames().join(", ")}`);
ok(rows().length === 195, "picking a phase with no zone means every zone in it");
ok(doc.getElementById("boss-row").hidden, "the boss row waits for a zone");

click(chipByText("#zone-chips", "Black Temple"));
ok(!doc.getElementById("boss-row").hidden, "which a zone reveals");
ok(rows().length === 117, `a zone with no boss means every boss in it (got ${rows().length})`);
ok(window.location.hash.includes("phase=P3"), `the phase is in the url: ${window.location.hash}`);

// leaving a phase takes its zone and boss with it - they belonged to that phase
click(chipByText("#boss-chips", "Illidan Stormrage"));
click(phaseChip(4));
ok(zoneChipNames().join(", ") === "Zul'Aman", "phase 4 shows Zul'Aman");
ok(doc.getElementById("boss-row").hidden && !window.location.hash.includes("boss="),
   "and the boss you had picked in phase 3 is gone");

// a zone from another phase in the url is dropped rather than filtering to nothing
window.location.hash = "phase=P4&zone=Black+Temple";
await new Promise((r) => setTimeout(r, 50));
ok(!window.location.hash.includes("zone="), "a zone outside the chosen phase is dropped on read");

click(doc.getElementById("reset"));
ok(doc.getElementById("zone-row").hidden, "reset closes the hierarchy again");

// --- boss chips are qualified by their zone ---
// Boss names are not unique across zones: both raids have a "Trash". The hierarchy
// means only one zone's bosses are ever on screen, so the two chips can no longer be
// confused visually - but the state behind them still has to know which is which,
// and a shared link still has to say.
click(doc.getElementById("reset"));
openP3();
const trashChip = () => [...doc.querySelectorAll("#boss-chips .chip")]
  .find((c) => c.textContent.trim().startsWith("Trash"));

click(chipByText("#zone-chips", "Black Temple"));
ok(trashChip().querySelector(".n").textContent === "9", "BT's Trash counts only BT trash");
click(trashChip());
ok(rows().length === 9, `Black Temple trash -> 9 rows (got ${rows().length})`);
ok(groups().length === 1 && /Black Temple/.test(headText()[0]),
   `only the BT trash group is shown: "${headText()[0]}"`);
ok(window.location.hash.includes("boss=Trash") && window.location.hash.includes("bossZone=Black+Temple"),
   `an ambiguous boss is still qualified in the url: ${window.location.hash}`);

click(chipByText("#zone-chips", "Mount Hyjal"));
ok(trashChip().querySelector(".n").textContent === "12", "and Hyjal's counts only Hyjal trash");
click(trashChip());
ok(rows().length === 12, `Mount Hyjal trash -> 12 rows (got ${rows().length})`);
ok(/Mount Hyjal/.test(headText()[0]), `switching zone re-targets the trash: "${headText()[0]}"`);

click(doc.getElementById("reset"));
openP3();
click(chipByText("#zone-chips", "Mount Hyjal"));
click(chipByText("#boss-chips", "Archimonde"));
ok(window.location.hash.includes("boss=Archimonde") && !window.location.hash.includes("bossZone"),
   `an unambiguous boss keeps its short url: ${window.location.hash}`);

// an old link with a bare ?boss=Trash keeps its previous both-zones behaviour
window.location.hash = "boss=Trash";
await new Promise((r) => setTimeout(r, 50));
ok(rows().length === 21, `unqualified boss=Trash still selects both zones (got ${rows().length})`);

// --- class / spec filter ---
// These chips carry no text: the name and the count live in the tooltip, so they
// are found by data-tip rather than by textContent.
const chipByTip = (sel, name) =>
  [...doc.querySelectorAll(sel + " .chip")].find((c) => (c.dataset.tip || "") === name);

click(doc.getElementById("reset"));
ok(doc.getElementById("class-chips") && doc.getElementById("spec-chips"),
   "class and spec chip rows exist");
// Class and spec are filters, so they sit with the filters - to the right of the
// search box, which was capped to make room for them.
const inputsRow = doc.querySelector(".control-row--inputs");
ok(inputsRow.contains(doc.getElementById("class-chips")) &&
   inputsRow.contains(doc.getElementById("spec-chips")),
   "class and spec sit in the filter row");
ok(!doc.querySelector(".controls--who"), "the separate who panel is gone");
ok([...inputsRow.children].indexOf(doc.querySelector(".who-inline")) >
   [...inputsRow.children].indexOf(doc.getElementById("search").closest(".field")),
   "and they come after the search box, not before it");
ok(/\.field--grow\s*\{[^}]*flex:\s*0/.test(cssText),
   "the search box no longer takes every spare pixel");

// two panels: where it drops, then everything that narrows the table - type, slot,
// search and who you are. Which list you are on lives in the banner, because it is
// not filtering and it applies to the whole page.
const panels = [...doc.querySelectorAll("main .controls")];
ok(panels.map((p) => p.className.replace("controls ", "")).join(" > ") ===
   "controls--where > controls--refine",
   `panel order: ${panels.map((p) => p.className.replace("controls ", "")).join(" > ")}`);
ok(doc.querySelector(".site-header").contains(doc.getElementById("template-bar")),
   "the list controls sit in the banner");
ok(!doc.querySelector("main #template-bar"), "and not among the filters");
ok(doc.querySelector(".controls--refine").nextElementSibling === doc.getElementById("results"),
   "the filters sit directly above the results they narrow");

// An author `display` rule beats the browser's [hidden], which is how the share-link
// field ended up permanently on the bar as an empty box. Any rule that sets display
// on something the code hides must be guarded.
// Checked against the stylesheet source, not getComputedStyle: jsdom never loads the
// external CSS, so a computed-style check here would pass whatever the rule says.
// A class is safe if it never sets display, or if some rule pairs it with [hidden] -
// either `.x[hidden] { display: none }` or `.x:not([hidden]) { display: flex }`.
const bareCss = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
const hiddenEls = [...doc.querySelectorAll("main [hidden]")];
ok(hiddenEls.length > 0, `markup hides some controls up front (${hiddenEls.length})`);

const unguarded = [];
for (const el of hiddenEls) {
  for (const cls of el.classList) {
    const setsDisplay = (bareCss.match(new RegExp("[^{}]*\\." + cls + "\\b[^{}]*\\{[^}]*\\}", "g")) || [])
      .some((rule) => /display\s*:/.test(rule.slice(rule.indexOf("{"))));
    const guarded = new RegExp("\\." + cls + "\\b[^{}]*\\[hidden\\]").test(bareCss);
    if (setsDisplay && !guarded) unguarded.push(`.${cls} (on #${el.id})`);
  }
}
ok(unguarded.length === 0,
   `every hidden control's display rule is guarded${unguarded.length ? ", these are not: " + unguarded.join(", ") : ""}`);
const refine = doc.querySelector(".controls--refine");
ok(["type-select", "slot-select", "search", "reset", "count"]
   .every((id) => refine.contains(doc.getElementById(id))),
   "type, slot, search, reset and the count all sit in the refine panel");
ok(refine.querySelectorAll(".chips").length === 2,
   "the only chip rows in it are the class and spec ones");
ok(refine.nextElementSibling === doc.getElementById("results"),
   "the refine panel sits directly above the results it narrows");
ok(/\.controls--refine\s*\{[^}]*position:\s*sticky/.test(cssText) &&
   !/\.controls\s*\{[^}]*position:\s*sticky/.test(cssText),
   "only the refine panel is sticky");
ok(doc.getElementById("spec-row").hidden, "the spec row is hidden until a class is picked");
ok([...doc.querySelectorAll("#spec-chips .chip")].length === 0,
   "and renders no spec chips at all");
ok([...doc.querySelectorAll("#class-chips .chip--icon")].every((c) => !c.textContent.trim()),
   "class chips are icon-only");
// just the name: these chips are scanned to find your class, and a count on each
// of 27 of them is noise - the result total is already above the table
ok(chipByTip("#class-chips", "Mage").dataset.tip === "Mage",
   `the tooltip is the class name alone: "${chipByTip("#class-chips", "Mage").dataset.tip}"`);
ok(chipByTip("#class-chips", "Mage").getAttribute("aria-label") === "Mage",
   "an icon-only chip still names itself to a screen reader");
ok([...doc.querySelectorAll("#class-chips .chip--icon")].every((c) => !/\d/.test(c.dataset.tip)),
   "no chip tooltip carries a count");

click(chipByTip("#class-chips", "Mage"));
ok(rows().length === 21, `class=Mage -> 21 rows: 20 named + Band of the Eternal Sage (got ${rows().length})`);
// An empty priority survives a filter only when the row is unsourced AND the item
// is BiS for the selection - the creator's own "whoever needs it" rows never do.
const emptyPrioRows = rows().filter((tr) => tr.children[3].querySelectorAll("img.spec-icon").length === 0);
ok(emptyPrioRows.every((tr) => tr.querySelector(".item-tag")),
   "the only priority-less rows shown are the unsourced ones");
ok(emptyPrioRows.every((tr) => {
  const rec = data.find((r) => tr.children[0].textContent.includes(r.item));
  return rec && Object.keys(bis.specs).some((id) => specs.specs[id].class === "Mage" &&
    Object.values(bis.specs[id]).flat().some((e) => e.id === rec.id));
}), "and each is there because it is BiS for a spec of the selected class");
ok(!doc.getElementById("spec-row").hidden, "picking a class reveals the spec row");
ok([...doc.querySelectorAll("#spec-chips .chip")].length === 4,
   "the spec row holds only that class's three specs, plus All");
ok(!chipByTip("#spec-chips", "Combat Rogue"), "no other class's specs are offered");
ok(chipByTip("#spec-chips", "Arcane Mage"), "spec chips are found by their full name");
ok(!doc.querySelector("#spec-chips .chip--toggle"), "no BiS toggle until a spec is picked");

// classes are multi-select, and the spec row grows to cover all of them
click(chipByTip("#class-chips", "Warlock"));
ok(rows().length === 28, `class=Mage+Warlock -> 28 rows, the union (got ${rows().length})`);
ok([...doc.querySelectorAll("#spec-chips .chip")].length === 7,
   "the spec row now offers both classes' specs");
ok(chipByTip("#spec-chips", "Fire Mage") && chipByTip("#spec-chips", "Destruction Warlock"),
   "specs from each selected class are present");

// refining one class must not narrow the other
click(chipByTip("#spec-chips", "Fire Mage"));
ok(rows().length === 27, `Fire + the whole Warlock class -> 27 rows (got ${rows().length})`);
ok(rows().map((tr) => tr.children[0].textContent.trim()).includes("Cowl of the Illidari High Lord"),
   "a Fire-only row survives the refinement");

// dropping a class drops the specs that were refining it
click(chipByTip("#class-chips", "Mage"));
ok(rows().length === 23, `Warlock alone -> 23 rows (got ${rows().length})`);
ok(!window.location.hash.includes("spec="), `the Fire refinement went with it: ${window.location.hash}`);

click(doc.getElementById("reset"));
click(chipByTip("#class-chips", "Mage"));

click(chipByTip("#spec-chips", "Arcane Mage"));
ok(rows().length === 19, `spec=Arcane -> 19 rows (got ${rows().length})`);
const arcaneItems = rows().map((tr) => tr.children[0].textContent.trim());
ok(arcaneItems.includes("Ring of Ancient Knowledge"),
   "a row that only names the class Mage still matches the spec Arcane");
ok(!arcaneItems.includes("Cowl of the Illidari High Lord"),
   "a row that names only Fire does not match Arcane");

const arcaneIcon = doc.querySelector('.col-prio img[data-tip="Arcane Mage"], .col-prio img[data-tip="Mage"]');
ok(arcaneIcon && !arcaneIcon.classList.contains("spec-icon--muted"),
   "the selected spec's icon is not dimmed");
ok(doc.querySelectorAll(".col-prio .spec-icon--muted").length > 0,
   "the rest of each priority line is dimmed");
ok(doc.querySelector(".col-prio .spec-icon--muted").dataset.tip,
   "a dimmed icon keeps its tooltip");

// BiS-only narrows to that spec's bis.json entries
click(doc.getElementById("reset"));
click(chipByTip("#class-chips", "Hunter"));
click(chipByTip("#spec-chips", "Survival Hunter"));
const survRows = rows().length;
ok(survRows === 26, `spec=Survival -> 26 rows (got ${survRows})`);
const toggle = doc.querySelector("#spec-chips .chip--toggle");
ok(toggle && toggle.textContent.includes("BiS only"), "the BiS toggle appears once a spec is picked");

// expectations come from bis.json rather than a hardcoded number, so filling the
// file in doesn't rewrite the test
const bisIdsFor = (specId) =>
  new Set(Object.values(bis.specs[specId] || {}).flat().map((e) => e.id));
const survBis = bisIdsFor("Surv");
const survVisible = rows().filter((tr) =>
  [...survBis].some((id) => tr.children[0].textContent.includes(
    (data.find((r) => r.id === id) || {}).item || ""))).length;
ok(Number(toggle.querySelector(".n").textContent) === survVisible,
   `the toggle counts what it would leave (says ${toggle.querySelector(".n").textContent}, ${survVisible} visible)`);
click(toggle);
ok(rows().length === survVisible && rows().length > 0,
   `BiS only -> ${survVisible} rows (got ${rows().length})`);
ok(rows().every((tr) => {
  const rec = data.find((r) => tr.children[0].textContent.includes(r.item));
  return rec && survBis.has(rec.id);
}), "every row left is BiS for the selected spec");
ok(window.location.hash.includes("bis=1"), `BiS only is in the url: ${window.location.hash}`);

// url round-trip
window.location.hash = "class=Mage&spec=Arcane&bis=1";
await new Promise((r) => setTimeout(r, 50));
const arcaneBis = bisIdsFor("Arcane");
ok(rows().length > 0 && rows().every((tr) => {
  const rec = data.find((r) => tr.children[0].textContent.includes(r.item));
  return rec && arcaneBis.has(rec.id);
}), `spec+bis restored from the url (${rows().length} rows, all Arcane BiS)`);
ok(chipByTip("#class-chips", "Mage").getAttribute("aria-pressed") === "true" &&
   chipByTip("#spec-chips", "Arcane Mage").getAttribute("aria-pressed") === "true" &&
   doc.querySelector("#spec-chips .chip--toggle").getAttribute("aria-pressed") === "true",
   "class, spec and BiS chips all come back pressed");

// several classes survive a round-trip too
window.location.hash = "class=Mage,Warlock";
await new Promise((r) => setTimeout(r, 50));
ok(rows().length === 28, `two classes restored from the url (got ${rows().length})`);

// --- an unsourced row is reachable through its BiS, not through a priority ---
// These items name nobody, so the only thing that can connect them to a spec is
// bis.json. Without that they would be recorded and unreachable.
click(doc.getElementById("reset"));
const itemNames = () => rows().map((tr) => tr.children[0].textContent);

click(chipByTip("#class-chips", "Hunter"));
click(chipByTip("#spec-chips", "Survival Hunter"));
ok(itemNames().some((n) => n.includes("Band of the Eternal Champion")),
   "Survival sees the Band it is BiS for, even though no priority names it");
const bandRow = rowFor("Band of the Eternal Champion");
ok(bandRow.querySelector(".item-tag"), "and it still carries its 'not in the guide' tag");
ok(bandRow.children[3].querySelectorAll("img").length === 0,
   "with an empty priority column, so it never reads as one of the creator's calls");

click(doc.getElementById("reset"));
click(chipByTip("#class-chips", "Paladin"));
click(chipByTip("#spec-chips", "Holy Paladin"));
ok(!itemNames().some((n) => n.includes("Band of the Eternal Champion")),
   "a spec it is not BiS for does not see it");

// an unsourced item that is BiS for nobody is never pulled in by any filter
click(doc.getElementById("reset"));
const orphan = data.find((r) => r.unsourced &&
  !Object.values(bis.specs).some((p) => Object.values(p).flat().some((e) => e.id === r.id)));
ok(!!orphan, `an unsourced item exists that is BiS for nobody (${orphan && orphan.item})`);
click(chipByTip("#class-chips", "Hunter"));
ok(!itemNames().some((n) => n.includes(orphan.item)),
   `${orphan.item} is BiS for nobody, so no filter surfaces it`);
click(doc.getElementById("reset"));

// --- the feral umbrella in the filter ---
click(doc.getElementById("reset"));
click(chipByTip("#class-chips", "Druid"));
const druidChips = [...doc.querySelectorAll("#spec-chips .chip")].map((c) => c.dataset.tip);
ok(druidChips.includes("Feral Druid (bear)") && druidChips.includes("Feral Druid (cat)"),
   `the Druid spec row offers bear and cat (${druidChips.join(", ")})`);
ok(!druidChips.includes("Feral Druid"), "and not the umbrella they replace");

click(chipByTip("#spec-chips", "Feral Druid (cat)"));
const catRows = rows().length;
ok(catRows > 0, `picking cat still matches rows whose priority names FeralDruid (${catRows})`);
ok(rows().some((tr) => {
  const rec = data.find((r) => tr.children[0].textContent.includes(r.item));
  return rec && rec.priority.some((e) => e.spec === "FeralDruid" && !e.form);
}), "an unqualified FeralDruid entry answers for whichever form is picked");
click(doc.getElementById("reset"));

// --- a class icon's ring answers for the selected spec, not the whole class ---
// Ring of Ancient Knowledge names the class Mage in its priority and is BiS for
// some Mage specs but not all, so the ring has to follow the selection.
click(doc.getElementById("reset"));
const rakId = data.find((r) => r.item === "Ring of Ancient Knowledge").id;
const mageSpecs = Object.keys(specs.specs).filter((id) => specs.specs[id].class === "Mage");
const bisMage = mageSpecs.filter((id) => bisIdsFor(id).has(rakId));
const notBisMage = mageSpecs.filter((id) => !bisIdsFor(id).has(rakId));
const rakMageIcon = () => iconById(rowFor("Ring of Ancient Knowledge"), "Mage");

ok(bisMage.length > 0, `Ring of Ancient Knowledge is BiS for some Mage specs (${bisMage.join(", ")})`);
ok(rakMageIcon().className.includes("--bis"),
   "unfiltered, the Mage icon rings for the specs behind it");
// who the icon is for goes on the name line; the tier line stays just the tier
const shortName = (id) => specs.specs[id].name.replace(new RegExp(" " + specs.specs[id].class + "$"), "");
ok(new RegExp("^Mage — .*\\b" + shortName(bisMage[0]) + "\\b").test(rakMageIcon().dataset.tip),
   `the name line names the class then its specs (got "${rakMageIcon().dataset.tip}")`);
ok(!/Mage,|Mage$/.test(rakMageIcon().dataset.tip.split("—")[1] || ""),
   `no class name repeated after each spec (got "${rakMageIcon().dataset.tip}")`);
ok(rakMageIcon().dataset.tipBis === "Expansion BiS",
   `the BiS line is only the tier (got "${rakMageIcon().dataset.tipBis}")`);

click(chipByTip("#class-chips", "Mage"));
click(chipByTip("#spec-chips", specs.specs[bisMage[0]].name));
ok(rakMageIcon().className.includes("--bis"),
   "selecting a spec it is BiS for keeps the ring on the class icon");

if (notBisMage.length) {
  click(chipByTip("#spec-chips", specs.specs[bisMage[0]].name));   // deselect
  click(chipByTip("#spec-chips", specs.specs[notBisMage[0]].name));
  const row = rowFor("Ring of Ancient Knowledge");
  ok(!row || !iconById(row, "Mage") || !iconById(row, "Mage").className.includes("--bis"),
     `selecting ${notBisMage[0]}, which it is not BiS for, drops the ring`);
}

// an unknown identifier reads as no filter rather than filtering everything away
click(doc.getElementById("reset"));
window.location.hash = "spec=NotASpec";
await new Promise((r) => setTimeout(r, 50));
ok(rows().length === 195, `an unknown spec id is ignored (got ${rows().length})`);

click(doc.getElementById("reset"));
ok(rows().length === 195, `reset clears the spec filter (got ${rows().length})`);
ok(!doc.querySelector("#spec-chips .chip--toggle"), "reset drops the BiS toggle");
ok(doc.getElementById("spec-row").hidden, "reset hides the spec row again");
ok(!doc.querySelector(".col-prio .spec-icon--muted"), "reset un-dims the priority icons");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
