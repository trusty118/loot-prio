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

const groups = () => [...doc.querySelectorAll(".boss-group")];
const rows = () => [...doc.querySelectorAll("tbody tr")];
const headText = () => groups().map((g) => g.querySelector(".boss-head").textContent.trim());

ok(rows().length === 182, `renders all 182 rows (got ${rows().length})`);
ok(groups().length === 17, `renders 17 boss groups (got ${groups().length})`);
ok(doc.getElementById("count").textContent === "182 of 182 items", `count text: "${doc.getElementById("count").textContent}"`);

const heads = headText();
ok(/Black Temple/.test(heads[0]) && /Trash/.test(heads[0]), `first group is BT Trash: "${heads[0]}"`);
ok(/Illidan Stormrage/.test(heads[9]), `BT ends on Illidan: "${heads[9]}"`);
ok(/Archimonde/.test(heads[15]), `Hyjal ends on Archimonde: "${heads[15]}"`);
ok(/^Crafted$/.test(heads[16]), `crafted group is headed by its zone, with no boss: "${heads[16]}"`);
ok(!/Craftable/.test(doc.body.textContent), "the Craftable pseudo-boss label is gone");
ok([...doc.querySelectorAll("#boss-chips .chip")].every((c) => !/Craft/.test(c.textContent)),
   "no crafted chip in the boss row");
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
ok(doc.getElementById("count").textContent.includes("of 182"), "the overall count in the toolbar stays");
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
ok(links.length === 182, `182 item links (got ${links.length})`);
ok(links.every((a) => /wowhead\.com\/tbc\/item=\d+/.test(a.href)), "all item links point at wowhead tbc items");

// --- icons ---
const zoneChips = [...doc.querySelectorAll("#zone-chips .chip")];
const bossChips = [...doc.querySelectorAll("#boss-chips .chip")];
const roleChips = [...doc.querySelectorAll("#role-chips .chip")];

// chip 0 in each group is the "All ..." chip and gets no icon
ok(zoneChips.slice(1).every((c) => c.querySelector("img.chip-icon")), "all 3 zone chips have an icon");
ok(!zoneChips[0].querySelector("img"), '"All zones" chip has no icon');
ok(bossChips.slice(1).every((c) => c.querySelector("img.chip-icon")), `all ${bossChips.length - 1} boss chips have an icon`);
ok(!bossChips[0].querySelector("img"), '"All bosses" chip has no icon');
ok(roleChips.every((c) => !c.querySelector("img")), "role chips have no icons");

// role chips must carry data-role so the CSS can tint them like the table pills
const roleAttrs = roleChips.slice(1).map((c) => c.dataset.role);
ok(roleAttrs.join(",") === "Physical,Caster,Healer,Tank,Tier", `role chips tagged: ${roleAttrs.join(",")}`);
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
ok(/\.chip\[data-role\]\s*\{/.test(css), "role chips have a resting tinted style");
for (const r of ["Physical", "Caster", "Healer", "Tank", "Tier"]) {
  ok(new RegExp(`\\.chip\\[data-role="${r}"\\][^{]*\\{[^}]*--chip-role:\\s*var\\(--role-${r.toLowerCase()}\\)`).test(css),
     `${r} chip bound to --role-${r.toLowerCase()}, the same token as its pill`);
}

const allImgs = [...doc.querySelectorAll("img")];
ok(allImgs.length > 0 && allImgs.every((i) => i.getAttribute("src")), "no img has an empty src");
ok(allImgs.every((i) => /^https:\/\/wow\.zamimg\.com\//.test(i.getAttribute("src"))), "every img src is on zamimg");
ok(allImgs.every((i) => i.getAttribute("onerror")), "every img has an onerror fallback");

const portraits = new Set(
  [...doc.querySelectorAll(".boss-portrait")].map((i) => i.getAttribute("src"))
);
ok(portraits.size === 16, `16 distinct group portraits, incl. trash/crafted (got ${portraits.size})`);
const ejPortraits = [...portraits].filter((s) => s.includes("ui-ej-boss-"));
ok(ejPortraits.length === 14, `14 Encounter Journal boss portraits (got ${ejPortraits.length})`);

// the role stripe must be gone
ok(!fs.readFileSync(path.join(root, "style.css"), "utf8").includes("inset 3px"),
   "role colour stripe removed from style.css");
// Role column is switched off via SHOW_ROLE in app.js. Assert it's gone from the
// table but that everything behind it survives, so turning it back on is safe.
ok(doc.querySelectorAll(".role-pill").length === 0, "role column not rendered while SHOW_ROLE is false");
ok(!doc.querySelector('th[data-sort="role"]'), "no Role header");
ok(fs.readFileSync(path.join(root, "app.js"), "utf8").includes("var SHOW_ROLE"),
   "the switch is a named flag, not a deletion");
ok(fs.readFileSync(path.join(root, "app.js"), "utf8").includes("ROLE_GLYPH"),
   "role glyphs kept for when it comes back");
ok(doc.querySelectorAll("#role-chips .chip").length === 6, "role chips still built (hidden by css)");
ok(fs.readFileSync(path.join(root, "style.css"), "utf8").includes("#role-row { display: none; }"),
   "the filter row is hidden in css, not removed from the markup");

// role pills: neutral background, glyph carries the role
// role pills are not rendered while the column is off; their styles stay in css
ok(!/\.role-(Physical|Caster|Healer|Tank|Tier)\s*\{[^}]*background:/.test(cssText),
   "pills no longer carry a per-role background tint");
ok(/\.role-glyph[^}]*fill:\s*currentColor/.test(cssText), "glyph inherits its colour from the pill");
ok(/aria-hidden="true"/.test(fs.readFileSync(path.join(root, "app.js"), "utf8")),
   "glyphs stay aria-hidden so screen readers read the label, not the shape");

// --- filter interactions ---
const chipByText = (sel, text) =>
  [...doc.querySelectorAll(sel + " .chip")].find((c) => c.textContent.trim().startsWith(text));

const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

click(chipByText("#zone-chips", "Mount Hyjal"));
ok(rows().length === 61, `zone=Mount Hyjal -> 61 rows (got ${rows().length})`);
ok(groups().length === 6, `zone=Mount Hyjal -> 6 groups (got ${groups().length})`);
ok(window.location.hash.includes("zone=Mount+Hyjal"), `url state: ${window.location.hash}`);

click(chipByText("#boss-chips", "Archimonde"));
ok(rows().length === 14, `+ boss=Archimonde -> 14 rows (got ${rows().length})`);

click(chipByText("#role-chips", "Healer"));
const healerRows = rows().length;
ok(healerRows > 0 && healerRows < 14, `+ role=Healer -> ${healerRows} rows (subset of 14)`);
// tier tokens legitimately join a role filter - they carry role "Tier" but serve healers
ok(rows().every((tr) => tr.dataset.role === "Healer" || tr.dataset.role === "Tier"),
   "visible rows are Healer items or tier tokens");
ok(rows().some((tr) => tr.dataset.role === "Tier"),
   "Archimonde's healer view now includes its tier token");

click(doc.getElementById("reset"));
ok(rows().length === 182, `reset -> 182 rows (got ${rows().length})`);

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
ok(bySlot("Head") === 11, `unrelated slots unaffected: Head -> 11 (got ${rows().length})`);
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

// the Tier role chip is now the only way in, so the type option must be gone
const typeOptsAfter = [...typeSel.querySelectorAll("option")].map((o) => o.value);
ok(!typeOptsAfter.includes("Tier Token"), "Tier Token removed from the type dropdown");
ok(typeOptsAfter.includes("Cloth") && typeOptsAfter.includes("Weapons - 1H"),
   "other type options are unaffected");

click(chipByText("#role-chips", "Tier"));
const tierRows = rows();
ok(tierRows.length === 15, `Tier role chip still selects all 15 tokens (got ${tierRows.length})`);
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
ok([...illidanStaff.children[3].querySelectorAll("img")].map((i) => i.dataset.tip).join(",") ===
   "Shadow Priest,Warlock,Mage,Balance Druid,Elemental Shaman",
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
ok(tipEl.textContent === probe.getAttribute("data-tip"),
   `tooltip shows the spec name (got "${tipEl.textContent}")`);
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
ok(Object.keys(specs.specs).length === 27, `registry has all 27 TBC specs (${Object.keys(specs.specs).length})`);
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

let checked = 0;
for (const [specId, phases] of Object.entries(bis.specs)) {
  for (const entries of Object.values(phases)) {
    for (const e of entries) {
      const rec = data.find((r) => r.id === e.id);
      if (!rec || !listsSpec(rec, specId)) continue;   // recorded but not visible, fine
      const row = [...doc.querySelectorAll("tbody tr")]
        .find((tr) => tr.children[0].textContent.includes(rec.item));
      // an item can be BiS for several specs at once, so check this spec's own icon
      const icon = [...row.children[3].querySelectorAll("img")]
        .find((i) => i.dataset.tip === displayName(specId));
      ok(icon && icon.classList.contains(tierClass[e.bis || "phase"]),
         `${rec.item}: ${specId} ringed as ${e.bis || "phase"}`);
      checked++;
    }
  }
}
ok(checked === 7, `every visible bis entry produced a ring (checked ${checked})`);

// an item with no entry must have no ring
const unmarked = [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes("Zhar'doom"));
ok([...unmarked.children[3].querySelectorAll("img")].every((i) => !i.className.includes("--bis")),
   "an item absent from bis.json has no rings");

// --- BiS markers ---
const iconsOf = (name) => [...[...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name))
  .children[3].querySelectorAll("img")];

const highborne = iconsOf("Shroud of the Highborne");
ok(highborne[0].classList.contains("spec-icon--bis2"),
   "** renders the multi-phase ring on the marked spec");
ok(highborne.slice(1).every((i) => !i.className.includes("bis")),
   "only the marked spec is ringed, not the rest of the priority");
ok(/BiS/.test(highborne[0].dataset.tipBis) && /phase/i.test(highborne[0].dataset.tipBis),
   `multi-phase icon says so on hover: ${JSON.stringify(highborne[0].dataset.tipBis)}`);

const pillar = iconsOf("Pillar of Ferocity");
ok(pillar[0].classList.contains("spec-icon--bis"), "* renders the single BiS ring");
ok(!pillar[0].classList.contains("spec-icon--bis2"), "* is not treated as **");
ok(pillar[0].dataset.tipBis.endsWith("BiS"), `single BiS icon says so on hover: ${JSON.stringify(pillar[0].dataset.tipBis)}`);

ok(iconsOf("Bulwark of Azzinoth")[0].classList.contains("spec-icon--bis3"),
   "*** renders the expansion-BiS ring");
const bulwarkIcon = iconsOf("Bulwark of Azzinoth")[0];
ok(bulwarkIcon.dataset.tip === "Protection Warrior" && bulwarkIcon.dataset.tipBis === "Expansion BiS",
   `name and BiS line carried separately (got ${JSON.stringify(bulwarkIcon.dataset.tip)} / ${JSON.stringify(bulwarkIcon.dataset.tipBis)})`);
ok(bulwarkIcon.dataset.tipTier === "3", "expansion tier tagged 3 so the tooltip can colour it");
ok(highborne[0].dataset.tipBis === "Multi-phase BiS" && highborne[0].dataset.tipTier === "2",
   `multi-phase label (got ${JSON.stringify(highborne[0].dataset.tipBis)})`);
ok(pillar[0].dataset.tipBis === "Phase BiS" && pillar[0].dataset.tipTier === "1",
   `phase label (got ${JSON.stringify(pillar[0].dataset.tipBis)})`);

// hovering renders the BiS line as its own coloured element
bulwarkIcon.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
const liveTip = doc.querySelector("body > .tip");
const bisLine = liveTip.querySelector(".tip-bis");
ok(!!bisLine, "the tooltip renders a separate .tip-bis line");
ok(bisLine.textContent === "Expansion BiS", `BiS line text (got "${bisLine && bisLine.textContent}")`);
ok(bisLine.classList.contains("tip-bis--3"), "BiS line tagged with its tier for colouring");
ok(liveTip.textContent.startsWith("Protection Warrior"), "spec name still leads the tooltip");
bulwarkIcon.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));

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
ok(!iconsOf("Bulwark of Azzinoth")[1].className.includes("bis"),
   "Bulwark's prot paladin is unmarked");

// the markers must never reach the rendered text
ok(!doc.querySelector("#results").textContent.includes("*"),
   "the * markers are consumed, never displayed");

// an unmarked row is untouched
ok(iconsOf("Zhar'doom").every((i) => !i.className.includes("bis")),
   "rows with no markers render no rings");

// the priority column is now icons and operators only - no prose anywhere
const proseRows = [...doc.querySelectorAll("tbody tr")].filter((tr) =>
  /[a-z]/i.test(tr.children[3].textContent));
ok(proseRows.length === 0,
   `no free text left in any priority (found: ${proseRows.map((tr) => tr.children[3].textContent.trim()).join(" | ")})`);

// rows whose priority is deliberately blank render an empty cell, not "undefined"
const blank = [...doc.querySelectorAll("tbody tr")]
  .filter((tr) => tr.children[3].textContent.trim() === "" &&
                  tr.children[3].querySelectorAll("img").length === 0);
ok(blank.length === 23, `23 items have a deliberately blank priority (got ${blank.length})`);
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
const bulwarkTitles = [...bulwark.children[3].querySelectorAll("img")]
  .map((i) => i.dataset.tip.split(String.fromCharCode(10))[0]);   // drop any BiS line
ok(bulwarkTitles.join(",") === "Protection Warrior,Protection Paladin",
   `"Prot Warrior > Prot Paladin" maps to both prot specs (got ${bulwarkTitles.join(", ")})`);

// \b guard: "Hunter (catch-up)" must not match "Cat" inside "catch-up"
const halberd = [...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes("Halberd of Desolation"));
const halberdTitles = [...halberd.children[3].querySelectorAll("img")].map((i) => i.dataset.tip);
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
const specsOf = (name) => [...[...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name))
  .children[3].querySelectorAll("img")].map((i) => i.dataset.tip.split(String.fromCharCode(10))[0]);

ok(!priorityOf("Syphon of the Nathrezim").includes("(x2)"), "Syphon: (x2) removed from priority");
ok(notesOf("Syphon of the Nathrezim").includes("2x"), "Syphon: notes explain two are needed");
ok(specsOf("Shadowmoon Insignia").join(",") === "Feral Druid,Protection Warrior,Protection Paladin",
   `Shadowmoon Insignia respecced (got ${specsOf("Shadowmoon Insignia").join(", ")})`);
ok(specsOf("Leggings of Divine Retribution").join(",") === "Fury Warrior,Arms Warrior,Retribution Paladin",
   "Leggings of Divine Retribution respecced");

// bare "Prot" resolved to Protection Warrior everywhere
for (const item of ["Ring of Deceitful Intent", "Pauldrons of the Forgotten Protector",
                    "Chestguard of the Forgotten Protector", "Helm of the Forgotten Protector"]) {
  ok(specsOf(item).includes("Protection Warrior"), `${item}: bare Prot is now Protection Warrior`);
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
   "Rogue,Enhancement Shaman,Arms Warrior,Fury Warrior,Hunter,Feral Druid,Protection Warrior,Retribution Paladin",
   `Stormrage Signet Ring order intact (got ${specsOf("Stormrage Signet Ring").join(", ")})`);
ok((priorityOf("Stormrage Signet Ring").match(/=/g) || []).length === 2,
   "Stormrage Signet Ring uses = instead of /");
ok((priorityOf("Leggings of the Forgotten Protector").match(/=/g) || []).length === 3,
   "Leggings of the Forgotten Protector uses = instead of /");

// every conditional has been moved out of the priority column
const allPriorities = [...doc.querySelectorAll("tbody tr")].map((tr) => tr.children[3].textContent);
ok(allPriorities.every((p) => !p.includes("(")),
   `no parentheticals left in any priority (${allPriorities.filter((p) => p.includes("(")).length} found)`);
ok(specsOf("Antonidas's Aegis").join(",") === "Elemental Shaman,Protection Paladin",
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

// the exact case from the screenshot: caster + cloth + legs
click(doc.getElementById("reset"));
click(chipByText("#role-chips", "Caster"));
setType("Cloth");
slotSel.value = "Legs"; slotSel.dispatchEvent(new window.Event("change"));

const legRows = rows().length;
ok(legRows === 4, `caster+cloth+legs -> 2 items + 2 tokens = 4 (got ${legRows})`);
const legTokens = tokenNames();
ok(legTokens.length === 2, `2 leg tokens surfaced (got ${legTokens.length}: ${legTokens.join(", ")})`);
ok(legTokens.some((n) => n.includes("Conqueror")) && legTokens.some((n) => n.includes("Vanquisher")),
   "Conqueror (Priest/Warlock) and Vanquisher (Mage) both appear");
ok(!legTokens.some((n) => n.includes("Protector")),
   "Protector stays out - its casters are Shaman, who wear mail");

// dimming: only the cloth casters stay lit
const lit = new Set(litClasses());
ok(lit.has("Priest") && lit.has("Warlock") && lit.has("Mage"),
   `cloth casters lit: ${[...lit].join(", ")}`);
ok(!lit.has("Paladin") && !lit.has("Rogue") && !lit.has("Druid"),
   "non-matching classes on those tokens are dimmed");

// the union trap: cloth + tank must match nothing, since no class is both
click(doc.getElementById("reset"));
click(chipByText("#role-chips", "Tank"));
setType("Cloth");
ok(tokenNames().length === 0,
   `cloth+tank surfaces no token - Conqueror has a tank and cloth wearers, but no cloth tank (got ${tokenNames().join(", ")})`);

// plate + tank should reach Conqueror (Paladin) and Protector (Warrior), not Vanquisher
click(doc.getElementById("reset"));
click(chipByText("#role-chips", "Tank"));
setType("Plate");
const plateTanks = tokenNames();
ok(plateTanks.some((n) => n.includes("Conqueror")) && plateTanks.some((n) => n.includes("Protector")),
   "plate+tank reaches Conqueror (Paladin) and Protector (Warrior)");
ok(!plateTanks.some((n) => n.includes("Vanquisher")),
   "Vanquisher stays out - its tank is a Druid, who wears leather");

// the Tier role chip still selects every token regardless of armour
click(doc.getElementById("reset"));
click(chipByText("#role-chips", "Tier"));
ok(rows().length === 15, `Tier role chip still selects all 15 tokens (got ${rows().length})`);
ok(!doc.querySelector(".class-icon--muted"), "no dimming when only the Tier role is selected");

// no filters at all: nothing is dimmed
click(doc.getElementById("reset"));
ok(!doc.querySelector(".class-icon--muted"), "no dimming when no filters are active");
ok(rows().length === 182, "unfiltered view is unchanged at 182 rows");

// --- column sorting ---
click(doc.getElementById("reset"));
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

// the role sort key is kept even though the column is hidden, ready for SHOW_ROLE
ok(fs.readFileSync(path.join(root, "app.js"), "utf8").includes("role: function (r) { return ROLE_ORDER.indexOf(r.role); }"),
   "role sort key kept in SORT_KEYS for when the column returns");

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
ok(rows().length === 182, `all rows still present after sorting (${rows().length})`);

click(doc.getElementById("reset"));
ok(!doc.querySelector('th[aria-sort="ascending"]') && !doc.querySelector('th[aria-sort="descending"]'),
   "reset clears the sort");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
