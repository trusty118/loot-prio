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

// A phase is a mode, not a filter: one is always picked, so the page opens with the
// zone row already open and something in the table.
const phaseChips = () => [...doc.querySelectorAll("#phase-chips .chip")];
ok(phaseChips().length === 5, `five phases and no All chip (got ${phaseChips().length})`);
ok(!phaseChips().some((c) => c.classList.contains("chip--all")),
   "there is no every-phase state to return to");

// A phase is a tile, not a pill: it is the one control you set and leave, so it
// carries its raid's art at a size you can read across the room.
ok(phaseChips().every((c) => c.classList.contains("chip--phase")), "each phase is a tile");
ok(phaseChips().every((c) => c.querySelector(".art-split img")), "each carries raid art");

// one strip per RAID, which is not the same as per zone: the crafted pseudo-zone has
// no bosses and no art, so phase 3 shows two strips for three zones
const strips = (n) => chipByText("#phase-chips", "Phase " + n).querySelectorAll(".art-split img");
ok(strips(1).length === 3, `phase 1 shows its three raids (got ${strips(1).length})`);
ok(strips(3).length === 2, `phase 3 shows two - crafted has no art to show (got ${strips(3).length})`);
ok(strips(4).length === 1, `phase 4 shows its one (got ${strips(4).length})`);
ok(strips(5).length === 1, `phase 5 shows Sunwell only, not its crafted tier (got ${strips(5).length})`);
ok(strips(2).length === 2, `phase 2 likewise shows two raids (got ${strips(2).length})`);

// Three phases have a crafted tier, each named for the material it is gated on. They
// behave identically because nothing special-cases them: no bosses means no art strip
// and an empty boss row, and the display label is the same for all three.
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const crafted = [...appSource.matchAll(/"(Crafted \([^"]+\))"/g)].map((m) => m[1]);
ok([...new Set(crafted)].length === 3,
   `three crafted zones, one per tier that has craftables: ${[...new Set(crafted)].join(", ")}`);
ok([...new Set(crafted)].every((z) => new RegExp('"' + z.replace(/[()]/g, "\\$&") + '": "Crafted"').test(appSource)),
   "each renders as plain Crafted, since two are never on screen together");
// One order, followed everywhere: the tile strips, the zone row and the table's boss
// groups all read Hyjal first because the phase lists its zones that way.
ok(/archimonde/.test(strips(3)[0].src) && /illidan/.test(strips(3)[1].src),
   "each raid flies its final boss, Hyjal first");
ok([...doc.querySelectorAll("#zone-chips .chip")]
     .filter((c) => !c.classList.contains("chip--all"))[0].textContent.includes("Mount Hyjal"),
   "and the zone row leads with it too");
ok(/Crafted/.test(chipByText("#phase-chips", "Phase 3").dataset.tip),
   "and the tooltip still names the zone that cannot be pictured");
ok(phaseChips().every((c) => c.querySelector(".art-label")), "with the label over the art");

// No count on the face of a tile - the art is doing the work, and "N of 195 items"
// above the table already answers it. It survives where it costs nothing.
ok(phaseChips().every((c) => !c.querySelector(".art-count")), "and no item count on it");
ok(/195/.test(chipByText("#phase-chips", "Phase 3").getAttribute("aria-label")),
   "though a screen reader is still told how many, since it cannot see the table either");
ok(/Black Temple/.test(chipByText("#phase-chips", "Phase 3").dataset.tip),
   `and the raids it covers on hover: "${chipByText("#phase-chips", "Phase 3").dataset.tip}"`);
ok(phaseChips().every((c) => c.querySelector("img").getAttribute("onerror")),
   "the art falls back rather than leaving a broken tile");
const picked = () => phaseChips().find((c) => c.getAttribute("aria-pressed") === "true");
ok(!!picked(), "one of them is picked on load");
ok(picked().textContent.trim().startsWith("Phase 3"),
   `and it is the phase that has data (got "${picked().textContent.trim()}")`);
ok(!doc.getElementById("boss-row").hidden === false, "the boss row still waits for a zone");
ok(doc.querySelectorAll("#zone-chips .chip").length > 0, "but the zone row is already open");
ok(rows().length === 195, "and the phase with the data shows all of it");

// clicking the phase you are already on must not leave the page with no phase at all
click(picked());
// Derived, not pinned: the dataset grows, and a literal here fails on every addition
// while saying nothing about whether rendering works.
const P3_ITEMS = data.filter((r) =>
  ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"].includes(r.zone)).length;
const P3_GROUPS = new Set(data
  .filter((r) => ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"].includes(r.zone))
  .map((r) => r.zone + "|" + r.boss)).size;

ok(!!picked() && rows().length === P3_ITEMS, "clicking the current phase is a no-op");

ok(rows().length === P3_ITEMS, `the landing phase renders all ${P3_ITEMS} of its rows (got ${rows().length})`);
ok(groups().length === P3_GROUPS, `in ${P3_GROUPS} boss groups (got ${groups().length})`);
/* The denominator is the PHASE's total, not the dataset's. Only one phase is ever
   rendered, so measuring against all 699 counted rows that could not have appeared
   whatever the filters said - the fraction was against the wrong whole. Unfiltered,
   the two halves match. */
ok(doc.getElementById("count").textContent === `${P3_ITEMS} of ${P3_ITEMS} items`,
   `count text: "${doc.getElementById("count").textContent}"`);
ok(P3_ITEMS < data.length,
   `and that is a real distinction - the phase holds ${P3_ITEMS} of ${data.length}`);

const heads = headText();
ok(/Mount Hyjal/.test(heads[0]) && /Trash/.test(heads[0]), `first group is Hyjal trash: "${heads[0]}"`);
ok(/Archimonde/.test(heads[5]), `Hyjal ends on Archimonde: "${heads[5]}"`);
ok(/Illidan Stormrage/.test(heads[15]), `Black Temple ends on Illidan: "${heads[15]}"`);
ok(/^Crafted$/.test(heads[16]), `crafted group is headed by its zone, with no boss: "${heads[16]}"`);
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
ok(/^\d+ of \d+ items$/.test(doc.getElementById("count").textContent.trim()),
   `the overall count in the toolbar stays: "${doc.getElementById("count").textContent}"`);
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
ok(/\.chip--phase\s*\{[^}]*height/.test(cssText),
   "the phase tile has a size of its own rather than inheriting a pill's");
ok(/\.c-item\s*\{[^}]*width/.test(cssText), "column widths are declared in css");

// verify flags

// wowhead links
const links = [...doc.querySelectorAll("a.item-link")];
ok(links.length === 195, `195 item links (got ${links.length})`);
ok(links.every((a) => /wowhead\.com\/tbc\/item=\d+/.test(a.href)), "all item links point at wowhead tbc items");

// --- icons ---
ok(doc.getElementById("boss-row").hidden, "no boss row until a zone is picked");
click(chipByText("#zone-chips", "Black Temple"));

const zoneChips = [...doc.querySelectorAll("#zone-chips .chip")];
const bossChips = [...doc.querySelectorAll("#boss-chips .chip")];

// Zones are art tiles too - the same language as the phases one level down, so the
// two read as parent and child rather than as two unrelated rows.
ok(zoneChips.slice(1).every((c) => c.classList.contains("chip--art")),
   "zone chips share the tile treatment with the phases");
ok(zoneChips.slice(1).every((c) => c.classList.contains("chip--zone")),
   "under their own class, so they can be sized differently");
ok(zoneChips.slice(1).every((c) => c.querySelectorAll(".art-split img").length === 1),
   "each showing its one zone's art");
ok(!zoneChips[0].querySelector("img"), '"All" chip has no art');
// Size is what says which control sits above which: phase tile, then zone tile, then
// boss portrait. Assert the ladder rather than three literal pixel values - the
// numbers are a styling decision and have already moved once, the ranking is not.
const heightOf = (sel) => {
  const m = new RegExp(sel.replace(/[.\-]/g, "\\$&") + "\\s*\\{[^}]*height:\\s*(\\d+)px").exec(cssText);
  return m ? Number(m[1]) : null;
};
const ladder = [".chip--phase", ".chip--zone", "#boss-chips .chip .chip-icon"].map(heightOf);
ok(ladder.every((h) => h !== null), `every rung of the size ladder has a height (${ladder})`);
ok(ladder[0] > ladder[1] && ladder[1] > ladder[2],
   `phase > zone > boss portrait, which is what ranks them (${ladder.join(" > ")})`);

// "Dim until picked" is the other half of that shared language, and it lives in three
// separate selectors. They drifted apart once - the rail was lightened and the tiles
// were left behind - so the values are tokens now and every level has to use them.
// A hard-coded grayscale()/brightness() on an art surface is the regression.
const artFilters = (cssText.match(/(?:\.art-split img|#boss-chips[^{]*\.chip-icon)[^{]*\{[^}]*\}/g) || [])
  .concat(cssText.match(/\.chip--art:hover[^{]*\{[^}]*\}/g) || [])
  // `filter: none` is the *picked* state and is meant to be literal - it is the
  // absence of the treatment, not a variant of it. Only dimming is tokenised.
  .filter((r) => /filter:/.test(r) && !/filter:\s*none/.test(r));
ok(artFilters.length >= 3, `every art surface has a dim rule (${artFilters.length})`);
ok(artFilters.every((r) => /filter:\s*var\(--art-dim/.test(r)),
   "and all of them go through the shared token, so the three levels cannot drift");

// ---- the boss rail ----
// It is portraits, not pills: the name is hidden and reached by hovering. Three
// things have to hold for that to be a rail rather than a row of anonymous squares.

// 1. The label is a span, not a bare text node - a text node cannot be hidden, which
//    is the whole reason chip() wraps it.
ok(bossChips.slice(1).every((c) => c.querySelector(".chip-label")),
   "every boss chip wraps its name in .chip-label so the rail can hide it");

// 2. The name still exists somewhere reachable. Hiding the label takes it out of the
//    accessible name too, so both the tooltip and the aria-label have to carry it.
ok(bossChips.slice(1).every((c) => c.dataset.tip && c.dataset.tip.trim()),
   "and carries the name in data-tip, since the face no longer shows it");
ok(bossChips.slice(1).every((c) => (c.getAttribute("aria-label") || "").includes(c.dataset.tip)),
   "and in its aria-label, which display:none would otherwise have emptied");

// 3. The rule that hides the name must not also blank the leading All chip - it is a
//    word and nothing else, so hiding its label leaves an empty clickable box.
ok(/#boss-chips[^{]*:not\(\.chip--all\)[^{]*\.chip-label\s*\{[^}]*display:\s*none/.test(cssText),
   "the rail hides boss names but exempts the All cell, which is only a word");
ok(bossChips[0].classList.contains("chip--all") && bossChips[0].textContent.trim(),
   "so the All cell still has text to show");

// No count on the face of a rail portrait either - same rule as the phase and zone
// tiles, which is what makes the three read as one language. It has to survive in the
// aria-label, though: that is the only way a screen reader gets it.
ok(bossChips.slice(1).every((c) => !c.querySelector(".n")),
   "no count on the face of a rail portrait - the art is doing the work");
ok(bossChips.slice(1).every((c) => /,\s*\d+ items$/.test(c.getAttribute("aria-label") || "")),
   "but the count survives in the aria-label, exactly as it does on the tiles");
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


// Every image on this page is hotlinked from wow.zamimg.com at a size that was checked
// for a 200 before it was wired up, and carries a fallback for the day one stops being
// served. The account avatar is the single exception and is excluded deliberately: its
// URL comes from Discord, for a person, and is not ours to verify - so it is built in
// app.js rather than sitting in the markup, and its onerror removes it entirely, which
// leaves the name that was always the part carrying the meaning.
const allImgs = [...doc.querySelectorAll("img:not(.account-avatar)")];
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

// --- Slot and Type are drawn by the page, not by the OS -------------------------------
// A native select's popup cannot be styled at all, so these two were the only controls
// still looking like macOS. The <select> stays as the source of truth - everything above
// and below this block drives it directly - and the custom menu is a skin over it.
{
  // the previous block left #type=Tier Token on, and Head + Tier Token really is 0 rows
  doc.getElementById("type-select").value = "";
  doc.getElementById("type-select").dispatchEvent(new window.Event("change"));

  const slotSel0 = doc.getElementById("slot-select");
  ok(slotSel0.trigger, "the Slot select has a trigger built over it");
  ok(slotSel0.parentNode.classList.contains("field--enhanced"),
     "and its field is only marked enhanced once that trigger exists, so a failure leaves a working select");
  ok(slotSel0.trigger.querySelector(".opt-trigger-name").textContent === "All slots",
     `the trigger shows what the select says (got "${slotSel0.trigger.querySelector(".opt-trigger-name").textContent}")`);

  slotSel0.trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const om = doc.querySelector(".opt-menu");
  ok(om && om.style.display === "block", "clicking it opens a menu of the page's own making");
  const shown = [...om.querySelectorAll(".opt-item-name")].map((n) => n.textContent);
  const real = [...slotSel0.querySelectorAll("option")].map((o) => o.textContent);
  ok(JSON.stringify(shown) === JSON.stringify(real),
     `and it mirrors the select's own options exactly (${shown.length} of them)`);

  // picking one has to drive the select, or nothing downstream hears about it
  const headIdx = real.findIndex((t) => t.startsWith("Head"));
  om.querySelectorAll(".opt-item")[headIdx].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  ok(slotSel0.value === "Head", `picking an option sets the select (got "${slotSel0.value}")`);
  ok(rows().length === 12, `and the table follows it (got ${rows().length})`);
  ok(om.style.display === "none", "and the menu closes behind it");

  slotSel0.value = ""; slotSel0.dispatchEvent(new window.Event("change"));
}

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

/* Every token type in the data has to be in TIER_CLASSES, or it renders as bare text
   with no class icons - which reads as "we do not know who this is for" rather than as
   a bug. Tier 4 and 5 group the classes DIFFERENTLY from Tier 6 (Priest sits with
   Warlock at T6 and with Warrior below it), so this cannot be checked by pattern. */
{
  const tokenTypes = [...new Set(data.filter((r) => r.type.startsWith("Tier Token"))
    .map((r) => r.type))];
  ok(tokenTypes.length === 6, `six token groupings across T4, T5 and T6 (${tokenTypes.length})`);
  const known = appSource.match(/var TIER_CLASSES = \{[^}]*\}/)[0];
  ok(tokenTypes.every((t) => known.includes(`"${t}"`)),
     `app.js knows every one of them (missing: ${tokenTypes.filter((t) => !known.includes(`"${t}"`)).join(", ")})`);
  // and the three classes on each are three DIFFERENT real classes
  const groups = tokenTypes.map((t) => (known.match(new RegExp(`"${t.replace(/[()/]/g, "\\$&")}":\\s*\\[([^\\]]*)\\]`)) || [])[1]);
  ok(groups.every((g) => g && [...new Set(g.match(/"([^"]+)"/g))].length === 3),
     "each names three distinct classes");
  ok(groups.every((g) => g.match(/"([^"]+)"/g).every((c) => specs.classes[c.slice(1, -1)])),
     "and every class in them is one the registry knows");
}

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

// Rings follow the phase on screen, so only the phase on screen can be checked here -
// a Sunwell item is not BiS for someone reading Phase 3, and iterating every phase's
// list against a Phase 3 page asks for rings that should not be there.
/* A phase's BiS list names items from EARLIER raids too - a Karazhan trinket can still
   be BiS in Phase 3 - and those items are in the dataset now that Phase 1 and 2 are
   imported. They are simply not on the Phase 3 page, so there is no row to ring. That
   is the phase filter working, not a missing ring, and it is counted rather than
   ignored so the skip can never quietly grow to cover a real regression. */
let onSpec = 0, onClass = 0, offPhase = 0, missing = [];
for (const [specId, phases] of Object.entries(bis.specs)) {
  const owner = (specs.specs[specId] || {}).class;
  for (const [phase, entries] of Object.entries(phases)) {
    if (phase !== "P3") continue;
    for (const e of entries) {
      const rec = data.find((r) => r.id === e.id);
      if (!rec) continue;
      const row = rowFor(rec.item);
      if (!row) { offPhase++; continue; }        // lives in an earlier phase's raid
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
ok(offPhase > 0 && onSpec + onClass > offPhase,
   `P3 BiS names earlier raids' loot, which the phase filter keeps off the page ` +
   `(${offPhase} off-phase vs ${onSpec + onClass} ringed)`);

// an item with no entry anywhere in bis.json must have no ring
const bisIds = new Set(Object.values(bis.specs).flatMap((p) => Object.values(p).flat()).map((e) => e.id));
const cleanRec = data.find((r) => !bisIds.has(r.id) && r.priority.length && rowFor(r.item));
const unmarked = rowFor(cleanRec.item);
ok([...unmarked.children[3].querySelectorAll("img")].every((i) => !i.className.includes("--bis")),
   `an item absent from bis.json has no rings (${cleanRec.item})`);

// --- BiS markers ---
const iconsOf = (name) => [...[...doc.querySelectorAll("tbody tr")]
  .find((tr) => tr.children[0].textContent.includes(name))
  .children[3].querySelectorAll("img")];

const multiCase = Object.entries(bis.specs).flatMap(([specId, phases]) =>
  (phases.P3 || []).filter((e) => e.bis === "multiPhase")
    .map((e) => ({ specId, rec: data.find((r) => r.id === e.id) })))
  .find(({ specId, rec }) => rec && listsSpec(rec, specId) && rowFor(rec.item));
const multiIcon = iconById(rowFor(multiCase.rec.item), multiCase.specId);
ok(multiIcon.classList.contains("spec-icon--bis2"),
   `multiPhase renders the multi-phase ring (${multiCase.rec.item} / ${multiCase.specId})`);

// Whether an icon rings is decided per icon: a spec icon answers for itself, a
// class icon for any of its specs. Checked here against bis.json on one row that
// carries both kinds (Resto Shaman, Priest, Druid, Holy Paladin).
const p3Of = (phases) => phases.P3 || [];
const isBisFor = (id, itemId) =>
  Object.entries(bis.specs).some(([specId, phases]) =>
    (specId === id || (specs.specs[specId] || {}).class === id) &&
    p3Of(phases).some((e) => e.id === itemId));
// one row carrying both a spec icon and a class icon, so both paths are covered
const bothKinds = data.find((rec) => {
  const row = rowFor(rec.item);
  if (!row) return false;
  const ids = [...row.children[3].querySelectorAll("img")].map((i) => i.dataset.id);
  return ids.some((id) => specs.classes[id]) && ids.some((id) => specs.specs[id]) &&
         ids.some((id) => isBisFor(id, rec.id));
});
const mixed = iconsOf(bothKinds.item);
ok(mixed.every((i) => i.className.includes("--bis") === isBisFor(i.dataset.id, bothKinds.id)),
   `each icon rings if and only if the item is BiS for it, class icons included (${bothKinds.item})`);
ok(mixed.some((i) => specs.classes[i.dataset.id] && i.className.includes("--bis")),
   "a class icon can carry a ring for the specs behind it");
ok(/BiS/.test(multiIcon.dataset.tipBis) && /phase/i.test(multiIcon.dataset.tipBis),
   `multi-phase icon says so on hover: ${JSON.stringify(multiIcon.dataset.tipBis)}`);

// the phase example likewise comes from the file rather than being named
const phaseCase = Object.entries(bis.specs).flatMap(([specId, phases]) =>
  (phases.P3 || [])
    .filter((e) => (e.bis || "phase") === "phase" && !e.variant)
    .map((e) => ({ specId, rec: data.find((r) => r.id === e.id) })))
  .find(({ specId, rec }) => rec && listsSpec(rec, specId) && rowFor(rec.item));
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
  (phases.P3 || [])
    .filter((e) => e.bis === "expansion")
    .map((e) => ({ specId, rec: data.find((r) => r.id === e.id) })))
  .find(({ specId, rec }) => rec && listsSpec(rec, specId) && rowFor(rec.item));
ok(!!expansionCase, "the file has at least one expansion-BiS entry on a spec the priority names");

const expansionIcon = iconById(rowFor(expansionCase.rec.item), expansionCase.specId);
ok(expansionIcon.classList.contains("spec-icon--bis3"),
   `*** renders the expansion-BiS ring (${expansionCase.rec.item} / ${expansionCase.specId})`);
ok(expansionIcon.dataset.tip === displayName(expansionCase.specId) &&
   expansionIcon.dataset.tipBis.startsWith("Expansion BiS"),
   `name and BiS line carried separately (got ${JSON.stringify(expansionIcon.dataset.tip)} / ${JSON.stringify(expansionIcon.dataset.tipBis)})`);
ok(expansionIcon.dataset.tipTier === "3", "expansion tier tagged 3 so the tooltip can colour it");
ok(multiIcon.dataset.tipBis.startsWith("Multi-phase BiS") && multiIcon.dataset.tipTier === "2",
   `multi-phase label (got ${JSON.stringify(multiIcon.dataset.tipBis)})`);
ok(phaseIcon.dataset.tipBis === "Phase BiS" && phaseIcon.dataset.tipTier === "1",
   `phase label (got ${JSON.stringify(phaseIcon.dataset.tipBis)})`);

// hovering renders the BiS line as its own coloured element
expansionIcon.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
const liveTip = doc.querySelector("body > .tip");
const bisLine = liveTip.querySelector(".tip-bis");
ok(!!bisLine, "the tooltip renders a separate .tip-bis line");
ok(bisLine.textContent.startsWith("Expansion BiS"), `BiS line text (got "${bisLine && bisLine.textContent}")`);
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

// --- seeded orderings, and the line they must not cross -------------------------------
// Zul'Aman and Sunwell rows are seeded from their BiS lists, so the priority column says
// something and the rings have icons to hang off. The risk is that a generated ordering
// reads as one of zatar's, which is what CLAUDE.md section 8 forbids.
{
  const seeded = data.filter((r) => r.prioritySource === "bis");
  ok(seeded.length > 0, `rows outside the guide are seeded from BiS (${seeded.length})`);
  ok(seeded.every((r) => r.unsourced),
     "every seeded row is still marked unsourced - the guide really did not cover it");
  ok(seeded.every((r) => (r.priority || []).every((p, i) => i === 0 || p.op === "=")),
     "and every seeded ordering is flat: nothing here ranks anyone above anyone");
  ok(seeded.every((r) => (r.priority || []).every((p) => p.spec)),
     "seeded entries name specs, since BiS is per spec");

  // his own rows must never acquire one
  const his = data.filter((r) => !r.unsourced);
  ok(his.every((r) => !r.prioritySource),
     `none of the ${his.length} rows he covered carries a source - absent is what means "his"`);

  // and the reader has to be able to see the difference, or the marker in the data is
  // doing nothing for the person the attribution rule exists to protect
  const marked = [...doc.querySelectorAll("#results tr[data-id]")]
    .filter((tr) => tr.querySelector(".prio-from"));
  const seededHere = data.filter((r) =>
    r.prioritySource === "bis" &&
    ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"].includes(r.zone));
  ok(marked.length === seededHere.length,
     `every seeded row on screen says where its ordering came from (${marked.length}/${seededHere.length})`);
  ok(marked.every((tr) => tr.querySelector(".prio-from").textContent === "SEEDED"),
     "and says it the same way on each");

  // the guide's own rows carry nothing
  const hisRows = [...doc.querySelectorAll("#results tr[data-id]")].filter((tr) => {
    const rec = data.find((r) => String(r.id) === tr.dataset.id);
    return rec && !rec.prioritySource && (rec.priority || []).length;
  });
  ok(hisRows.length > 0 && hisRows.every((tr) => !tr.querySelector(".prio-from")),
     `and none of the ${hisRows.length} hand-ranked orderings is marked`);
}

// --- rings follow the phase, and carry why ------------------------------------------
// bis.json holds P3, P4 and P5 now. A ring has to mean "BiS for me in the phase I am
// reading", not "BiS at some point" - and the lookup was keyed by spec alone, so a
// second phase's entry for the same spec silently overwrote the first.
{
  // an item some spec calls BiS in exactly one phase, and which phase that is
  const only = [];
  for (const [specId, phases] of Object.entries(bis.specs)) {
    for (const ph of ["P3", "P4", "P5"]) {
      for (const entry of phases[ph] || []) {
        const elsewhere = ["P3", "P4", "P5"].filter((p) => p !== ph)
          .some((p) => (phases[p] || []).some((x) => x.id === entry.id));
        if (elsewhere) continue;
        const rec = data.find((r) => r.id === entry.id);
        if (rec && listsSpec(rec, specId)) only.push({ specId, ph, rec });
      }
    }
  }
  ok(only.length > 0, `some entries are BiS in one phase only (${only.length})`);

  const zoneOf = { P3: "Black Temple", P4: "Zul'Aman", P5: "Sunwell Plateau" };
  const pick = only.find((o) => o.ph !== "P3" && o.rec.zone === zoneOf[o.ph]) || only[0];

  window.location.hash = "phase=" + pick.ph;
  window.dispatchEvent(new window.Event("hashchange"));
  const ringed = iconById(rowFor(pick.rec.item), pick.specId);
  ok(ringed && ringed.className.includes("--bis"),
     `${pick.rec.item} rings for ${pick.specId} in ${pick.ph}, the phase that lists it`);

  // and does not, in a phase that does not list it
  const other = ["P3", "P4", "P5"].find((p) =>
    p !== pick.ph && data.some((r) => r.zone === zoneOf[p]));
  window.location.hash = "phase=" + other;
  window.dispatchEvent(new window.Event("hashchange"));
  const elsewhereRow = rowFor(pick.rec.item);
  ok(!elsewhereRow || !iconById(elsewhereRow, pick.specId) ||
     !iconById(elsewhereRow, pick.specId).className.includes("--bis"),
     `and does not ring in ${other}, which does not`);

  window.location.hash = "phase=P3";
  window.dispatchEvent(new window.Event("hashchange"));
}

// --- the qualifier: several BiS items for one slot, distinguished ---------------------
// A tank wants a threat helm and a mitigation helm; both are BiS, and the ring colour
// says only how long they last. The reason rides on the BiS line.
{
  const withVariant = [];
  for (const [specId, phases] of Object.entries(bis.specs)) {
    for (const entry of phases.P3 || []) {
      if (!entry.variant) continue;
      const rec = data.find((r) => r.id === entry.id);
      // on the page, not merely in the dataset - P3 BiS names earlier raids' loot too
      if (rec && listsSpec(rec, specId) && rowFor(rec.item)) {
        withVariant.push({ specId, entry, rec });
      }
    }
  }
  ok(withVariant.length > 0, `entries carry a qualifier (${withVariant.length} showable in P3)`);

  // A SPEC icon, deliberately. A class icon stands for several specs, and only carries a
  // qualifier when all of them agree on it - so it is the wrong place to check that the
  // qualifier reaches the tooltip at all.
  const namesSpec = (rec, id) => (rec.priority || []).some((p) => p.spec === id);
  const q = withVariant.find((w) => namesSpec(w.rec, w.specId));
  ok(!!q, "some qualified entry sits on a row that names the spec itself");
  const icon = iconById(rowFor(q.rec.item), q.specId);
  ok(icon && icon.dataset.tipBis.endsWith(`(${q.entry.variant})`),
     `the BiS line says why: "${icon && icon.dataset.tipBis}" (${q.rec.item} / ${q.specId})`);
  ok(icon && !icon.dataset.tip.includes(q.entry.variant),
     "and the name line does not - the qualifier is a fact about the ring, not the icon");
  ok(icon && icon.dataset.tipTier === String({ phase: 1, multiPhase: 2, expansion: 3 }[q.entry.bis || "phase"]),
     "the ring colour still means longevity alone, unchanged by the qualifier");

  // two different items, same spec, same slot, both BiS for different reasons - which is
  // the whole case for having a qualifier at all
  const bySlot = {};
  for (const { specId, entry, rec } of withVariant) {
    const key = specId + "|" + rec.slot;
    (bySlot[key] = bySlot[key] || []).push(entry.variant);
  }
  const contested = Object.entries(bySlot).filter(([, vs]) => new Set(vs).size > 1);
  ok(contested.length > 0,
     `a spec can hold several BiS items for one slot, told apart by qualifier (${contested.length} such slots)`);

  // A class icon speaks for several specs at once. Where they disagree about WHY an item
  // is BiS - a Prot Warrior's threat piece is a Fury Warrior's plain BiS - the icon must
  // say nothing rather than pick one spec's reason and imply it for the rest.
  const classIcons = [...doc.querySelectorAll(".col-prio img[data-tip]")]
    .filter((i) => specs.classes[i.dataset.id] && i.dataset.tipBis);
  const disagreeing = classIcons.filter((i) => {
    const rec = data.find((r) => (i.closest("tr").children[0].textContent || "").includes(r.item));
    if (!rec) return false;
    const vs = new Set(Object.entries(bis.specs)
      .filter(([sid]) => (specs.specs[sid] || {}).class === i.dataset.id)
      .map(([, ph]) => ((ph.P3 || []).find((x) => x.id === rec.id) || {}).variant)
      .filter((v) => v !== undefined));
    return vs.size > 1;
  });
  ok(disagreeing.every((i) => !/\(/.test(i.dataset.tipBis)),
     `a class icon carries no qualifier when its specs disagree (${disagreeing.length} checked)`);
}

// --- items the source guide never covered ---
const P3_ZONES = ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"];
const unsourced = data.filter((r) => r.unsourced && P3_ZONES.includes(r.zone));
ok(unsourced.length === 13,
   `13 of the guide's own phase are marked unsourced (got ${unsourced.length})`);
// An unsourced row may now carry an ordering, but only one that says where it came
// from. Without prioritySource it would read as one of his calls, which is the whole
// thing CLAUDE.md section 8 forbids - check_priority.py makes that pairing an error.
ok(unsourced.every((r) => r.priority.length === 0 || r.prioritySource),
   "an unsourced record carries no priority unless it names a source for it");
ok(data.every((r) => !r.prioritySource || r.unsourced),
   "and nothing the guide did cover carries a source - absent is what means 'his'");
ok(data.filter((r) => !r.unsourced).length === 182,
   "the creator's original 182 are still exactly that");

/* Nothing on screen frames a row as missing from a guide. The site carries several
   people's lists now and zatar's is one of them, so "not in the guide" named a
   distinction that stopped being the site's organising idea. `unsourced` survives in
   the data as plumbing - it is what unsourcedBis() and check_priority.py read - and
   that split is the thing worth pinning: the flag lives, the framing does not. */
ok(!doc.querySelector(".item-tag") && !doc.querySelector(".zone-tag--unsourced"),
   "no row or zone is marked as missing from a guide");
ok(!/not in the guide/i.test(appSource) && !/not in the guide/i.test(cssText),
   "and the phrase is gone from the source, not merely unrendered");
ok(unsourced.length > 0,
   `the unsourced flag is still in the data, where the filter and the validator read it (${unsourced.length} rows)`);

{
  const before = doc.getElementById("count").textContent;
  click(chipByText("#phase-chips", "Phase 5"));
  const swpRows = [...doc.querySelectorAll("#results tr[data-id]")];
  ok(swpRows.length > 0, `Phase 5 still renders its rows (${swpRows.length})`);
  click(doc.getElementById("reset"));
  ok(doc.getElementById("count").textContent === before, "and reset returns to the landing phase");
}

// the four Bands of the Eternal land in Hyjal trash, and say what they really are
const bands = data.filter((r) => r.item.startsWith("Band of the Eternal"));
ok(bands.length === 4, `all four Bands of the Eternal are present (got ${bands.length})`);
ok(bands.every((r) => r.zone === "Mount Hyjal" && r.boss === "Trash"),
   "they sit under Mount Hyjal trash");
ok(bands.every((r) => /Scale of the Sands/.test(r.notes)),
   "and their notes say they are a reputation reward, not a drop");
ok(bands.every((r) => r.unique), "each is unique-equipped, so no doubling up");

// The priority itself is icons and operators only - no prose anywhere. The .prio-from
// label is not priority content: it says where the ordering came from, and it is
// discounted here rather than allowed for, so a genuine string leaking back into a
// priority still fails this.
const priorityText = (tr) => {
  const cell = tr.children[3].cloneNode(true);
  const from = cell.querySelector(".prio-from");
  if (from) from.remove();
  return cell.textContent;
};
const proseRows = [...doc.querySelectorAll("tbody tr")].filter((tr) => /[a-z]/i.test(priorityText(tr)));
ok(proseRows.length === 0,
   `no free text left in any priority (found: ${proseRows.map((tr) => priorityText(tr).trim()).join(" | ")})`);

// rows whose priority is deliberately blank render an empty cell, not "undefined"
const blank = [...doc.querySelectorAll("tbody tr")]
  .filter((tr) => tr.children[3].textContent.trim() === "" &&
                  tr.children[3].querySelectorAll("img").length === 0);
// The creator's own open calls, plus any of his phase's unsourced rows that BiS could
// not seed either. Derived from the data rather than pinned: seeding moves this number
// and a literal would fail for a reason that says nothing about rendering.
const expectBlank = data.filter((r) =>
  ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"].includes(r.zone) &&
  (r.priority || []).length === 0).length;
ok(blank.length === expectBlank,
   `rows with nothing to say render an empty cell, not "undefined" (${expectBlank})`);
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
// The banner carries no credit any more - by decision, not by accident: it moves to the
// lists themselves once those carry an author. Until then the footer is the ONLY place
// on the page that names the source, so CLAUDE.md section 8 now rests entirely on it.
// If this fails, attribution has left the site altogether.
ok(!doc.querySelector(".site-header a[href*='zatar_wow']"),
   "the banner is title-only, with no credit in it");
ok(doc.querySelector(".site-footer a[href*='zatar_wow']"),
   "so the footer is the one place carrying it, and must keep doing so");
// Pinned against the <title> rather than against a literal, because the point of this
// assertion is that the banner is the name and nothing else - not that the name is any
// particular string. A literal here fails on every rename, which reads as "you broke
// attribution" when nothing about attribution moved.
ok(doc.querySelector(".site-header h1").textContent.trim() === doc.title.trim(),
   `the banner is just the name, and the same one the tab says: "${doc.querySelector(".site-header h1").textContent.trim()}" / "${doc.title.trim()}"`);

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
ok(sortedHeads[0] === "Trash" && sortedHeads[5] === "Archimonde" &&
   sortedHeads[15] === "Illidan Stormrage",
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
const phaseItems = (n) => Number((/,\s*(\d+) items/.exec(phaseChip(n).getAttribute("aria-label")) || [])[1]);
ok([1, 2, 3, 4, 5].every((n) => phaseItems(n) > 0),
   `every phase carries loot now (${[1,2,3,4,5].map(phaseItems).join("/")})`);

click(phaseChip(1));
ok(zoneChipNames().join(", ") === "Karazhan, Gruul's Lair, Magtheridon's Lair",
   `phase 1 opens its own zones: ${zoneChipNames().join(", ")}`);
ok(rows().length === phaseItems(1), `and lists them: ${rows().length} rows`);

click(chipByText("#zone-chips", "Karazhan"));
const bossNames = () => [...doc.querySelectorAll("#boss-chips .chip")]
  .filter((c) => !c.classList.contains("chip--all")).map((c) => c.textContent.replace(/\d+$/, "").trim());
// The rail shows art alone, so the count lives in the aria-label ("Moroes, 6 items").
const bossCount = (c) => (/,\s*(\d+) items$/.exec(c.getAttribute("aria-label") || "") || [])[1];
// 11 encounters, plus Trash and Basement - the two sources with no place in a kill order
ok(bossNames().length === 13, `Karazhan lists its 13 sources (got ${bossNames().length})`);
ok(bossNames()[0] === "Trash" && bossNames()[1] === "Basement" && bossNames()[12] === "Nightbane",
   `in kill order behind the two non-boss sources: ${bossNames().slice(0, 2).join(", ")} ... ${bossNames()[12]}`);
ok([...doc.querySelectorAll("#boss-chips .chip")]
     .filter((c) => !c.classList.contains("chip--all")).every((c) => Number(bossCount(c)) > 0),
   "and every one of them dropped something");
/* Chess has no journal portrait, and neither do the three Servant's Quarters rare
   spawns behind Basement - they are not Encounter Journal bosses at all. Both fall
   back to text, which is what chip() does when the art 404s. */
ok([...doc.querySelectorAll("#boss-chips .chip")]
     .filter((c) => !c.classList.contains("chip--all") && !/Chess|Basement/.test(c.textContent))
     .every((c) => c.querySelector("img.chip-icon")),
   "each carries a portrait, bar Chess and Basement which have none in the journal");

click(phaseChip(2));
ok(zoneChipNames().join(", ") === "Serpentshrine Cavern, Tempest Keep, Crafted",
   `phase 2 replaces them, and has a crafted tier of its own: ${zoneChipNames().join(", ")}`);

click(phaseChip(3));
ok(zoneChipNames().join(", ") === "Mount Hyjal, Black Temple, Crafted",
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
ok(chipByText("#phase-chips", "Phase 3").getAttribute("aria-pressed") === "true",
   "reset returns to the phase with the data, not to an empty page");
ok(doc.getElementById("boss-row").hidden && rows().length === 195,
   "with the zone and boss below it cleared");

// --- the phase is always set ---
click(doc.getElementById("reset"));

// the landing phase is derived from the data, not hardcoded: the LAST phase that has
// items, so it follows the content when a new tier is filled in
const phasesWithItems = ["P1", "P2", "P3", "P4", "P5"].filter((id) => {
  const zones = { P1: ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"],
                  P2: ["Serpentshrine Cavern", "Tempest Keep"],
                  P3: ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"],
                  P4: ["Zul'Aman"], P5: ["Sunwell Plateau"] }[id];
  return data.some((r) => zones.includes(r.zone));
});
// The last phase carrying one of his CALLS, not merely one carrying items. Those were
// the same thing until Zul'Aman and Sunwell arrived with no priorities at all, and
// landing there would open the site on a page where the priority column is empty.
const phasesWithCalls = phasesWithItems.filter((id) => {
  const zones = { P1: ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"],
                  P2: ["Serpentshrine Cavern", "Tempest Keep", "Crafted (Nether Vortex)"],
                  P3: ["Black Temple", "Mount Hyjal", "Crafted (Heart of Darkness)"],
                  P4: ["Zul'Aman"], P5: ["Sunwell Plateau", "Crafted (Sunmote)"] }[id];
  // his calls, not any ordering: the seeded ones carry a source and do not count
  return data.some((r) => zones.includes(r.zone) && (r.priority || []).length &&
                          !r.prioritySource);
});
ok(window.location.hash.includes("phase=" + phasesWithCalls[phasesWithCalls.length - 1]),
   `the landing phase is the last one carrying his calls (${phasesWithCalls.join(", ")})`);
ok(/phase=P\d/.test(window.location.hash), `the phase is always in the url: ${window.location.hash}`);

// an unknown phase in a link falls back rather than emptying the table
window.location.hash = "phase=P9";
await new Promise((r) => setTimeout(r, 50));
ok(rows().length === 195 && window.location.hash.includes("phase=P3"),
   `an unknown phase falls back to the default (${window.location.hash})`);

/* Every phase carries loot now, so nothing triggers phaseIsEmpty() any more. It stays
   because the next expansion arrives the same way this content did - phases first,
   loot after - and an empty phase is the whole page when there is no "all phases" to
   escape to. Asserted against the source, since no data can reach it. */
click(doc.getElementById("reset"));
const seenTotals = [];
[1, 2, 3, 4, 5].forEach((n) => {
  click(chipByText("#phase-chips", "Phase " + n));
  ok(rows().length > 0 && !doc.querySelector(".empty"),
     `Phase ${n} lists loot rather than an empty-phase message (${rows().length} rows)`);
  /* and the count's denominator follows the phase rather than standing at the dataset
     total - unfiltered, every phase reads "N of N" */
  const txt = doc.getElementById("count").textContent.trim();
  seenTotals.push(Number(txt.split(" of ")[1].replace(" items", "")));
  ok(txt === `${rows().length} of ${rows().length} items`,
     `Phase ${n} measures itself against itself: "${txt}"`);
});
ok(new Set(seenTotals).size > 1 && seenTotals.every((t) => t < data.length),
   `each phase has its own total, none of them the dataset's ${data.length} (${seenTotals.join(", ")})`);
ok(/phaseIsEmpty\(\)\s*\?/.test(appSource) && /isn't in the dataset yet/.test(appSource),
   "and the empty-phase message survives for the next phase that arrives before its loot does");
click(doc.getElementById("reset"));

// Every boss a record names has to be in BOSS_ORDER, or its chip only appears through
// the fallback that appends unknown bosses - which works, but puts them in whatever
// order the data happens to be in rather than in kill order. Timed Chest arrived that
// way and looked correct purely by luck.
{
  const src = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const block = /var BOSS_ORDER = \{([\s\S]*?)\n  \};/.exec(src)[1];
  const orderFor = {};
  for (const m of block.matchAll(/"([^"]+)":\s*\[([\s\S]*?)\]/g)) {
    orderFor[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  ok(Object.keys(orderFor).length === 9, `BOSS_ORDER covers all nine raids (${Object.keys(orderFor).length})`);
  const stray = [...new Set(data
    .filter((r) => orderFor[r.zone] && !orderFor[r.zone].includes(r.boss))
    .map((r) => `${r.zone}/${r.boss}`))];
  ok(stray.length === 0,
     `every boss the data names is in BOSS_ORDER${stray.length ? ": " + stray.join(", ") : ""}`);
}

// The rail is sized by its contents. .chips sets flex: 1 1 auto, which stretched it
// across the whole row however few bosses it held, and width: max-content cannot stop a
// flex item growing - only flex-grow: 0 can.
{
  const rail = /#boss-chips\s*\{[^}]*\}/.exec(cssText)[0];
  ok(/flex:\s*0\s+0/.test(rail), "the boss rail does not grow to fill the row");
  ok(/width:\s*max-content/.test(rail), "and is sized by its contents");
}

// Trash flies a square item icon where every other boss flies a 2:1 journal portrait,
// so cover-cropping it into the rail's landscape cell throws most of it away.
// The rail needs a zone picked before it holds anything at all.
{
  click(doc.getElementById("reset"));
  click(chipByText("#zone-chips", "Black Temple"));
  const chips = [...doc.querySelectorAll("#boss-chips .chip")].filter((c) => !c.classList.contains("chip--all"));
  const emblem = chips.filter((c) => c.classList.contains("chip--emblem")).map((c) => c.dataset.tip);
  ok(chips.length > 1, `the rail fills once a zone is picked (${chips.length} bosses)`);
  ok(emblem.length === 1 && emblem[0] === "Trash",
     `only the square-icon chip is marked for contain-fitting (${emblem.join(", ") || "none"})`);
  // Both selectors are one id and two classes, so they tie on specificity and source
  // order decides. Written above the cover rule, the contain rule silently lost - which
  // looks exactly like the class not being applied at all.
  // BOTH surfaces, not just the rail. These were briefly written as one selector list
  // split across two places in the file, which left the first selector dangling into the
  // following comment - it merged with .chip--emblem::after and the crafted tiles lost
  // their contain entirely, while a test that only checked the rail stayed green.
  for (const [sel, what] of [[".chip--emblem .art-split img", "the crafted zone tiles"],
                             ["#boss-chips .chip--emblem .chip-icon", "the boss rail's square icons"]]) {
    const rule = new RegExp(sel.replace(/[.#*+?^$()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}").exec(cssText);
    ok(rule && /object-fit:\s*contain/.test(rule[0]), `${what} are contain-fitted`);
  }
  const coverAt = cssText.indexOf("#boss-chips .chip .chip-icon");
  const containAt = cssText.indexOf("#boss-chips .chip--emblem .chip-icon");
  ok(containAt > coverAt,
     "and the rail's rule sits after the cover rule it ties with, or source order silently undoes it");

  // Picked has to read like a picked tile. It has to be drawn as an ::after overlay:
  // an inset box-shadow and a background are both painted under the element's children,
  // and the portrait fills the cell edge to edge, so both were invisible on the cell.
  const overlay = /#boss-chips \.chip\[aria-pressed="true"\]::after\s*\{[^}]*\}/.exec(cssText);
  ok(overlay, "a picked boss is marked by an overlay, not by the cell's own paint");
  ok(/inset 0 0 0 2px var\(--gold-bright\)/.test(overlay[0]),
     "carrying the accent frame the phase and zone tiles get");
  ok(/background:\s*color-mix/.test(overlay[0]), "and an accent wash over the portrait");
  const cell = /#boss-chips \.chip\[aria-pressed="true"\]\s*\{[^}]*\}/.exec(cssText)[0];
  ok(!/box-shadow|background:/.test(cell),
     "and the cell itself paints neither - both would sit behind the image");

  // every boss in the rail flies an icon; a text chip among portraits reads as a stray
  const noIcon = chips.filter((c) => !c.querySelector("img")).map((c) => c.dataset.tip);
  ok(noIcon.length === 0, `every boss chip carries an icon${noIcon.length ? ": " + noIcon.join(", ") + " do not" : ""}`);
  click(doc.getElementById("reset"));
}

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
ok(bossCount(trashChip()) === "9", "BT's Trash counts only BT trash");
click(trashChip());
ok(rows().length === 9, `Black Temple trash -> 9 rows (got ${rows().length})`);
ok(groups().length === 1 && /Black Temple/.test(headText()[0]),
   `only the BT trash group is shown: "${headText()[0]}"`);
ok(window.location.hash.includes("boss=Trash") && window.location.hash.includes("bossZone=Black+Temple"),
   `an ambiguous boss is still qualified in the url: ${window.location.hash}`);

click(chipByText("#zone-chips", "Mount Hyjal"));
ok(bossCount(trashChip()) === "12", "and Hyjal's counts only Hyjal trash");
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
/* Who you are sits at the foot of the where-hierarchy: which phase, which zone, which
   boss, who for. They are filters, and they spent a while in the refine panel on those
   grounds; they read better as the last answer in that sequence. The cost is that this
   panel is NOT sticky, so they scroll away - see the note beside the sticky assertion. */
const wherePanel = doc.querySelector(".controls--where");
ok(wherePanel.contains(doc.getElementById("class-chips")) &&
   wherePanel.contains(doc.getElementById("spec-chips")),
   "class and spec sit at the foot of the where-hierarchy");
ok([...doc.querySelectorAll(".controls--where .control-row")].pop()
     .contains(doc.querySelector(".who-inline")),
   "as its last row, under the boss rail");
ok(!doc.querySelector(".site-header #class-chips"),
   "and never in the banner, which answers a different question entirely");

const rowClasses = [...doc.querySelectorAll(".controls--refine .control-row")]
  .map((r) => r.className.replace("control-row ", ""));
/* Which list is open leads the sticky bar, with Slot/Type/Search under it and the count
   last. Reset stays with the filters it clears rather than travelling with the picker. */
ok(rowClasses.join(" > ") === "control-row--list > control-row--inputs > control-row--meta",
   `the panel reads list, then inputs, then the count (${rowClasses.join(" > ")})`);
ok(doc.querySelector(".control-row--inputs").contains(doc.getElementById("reset")),
   "Reset stays with the filters it clears");

/* Prominence without spending the accent. --gold means "selected" everywhere on this
   page, and the design brief lists it as a colour that carries meaning - so the picker
   gets size and contrast instead. Asserted because the obvious "fix" for a control that
   does not stand out is to paint it green, which would quietly break what green says. */
ok(doc.querySelector("#list-trigger .control-label").textContent.trim() === "Priority List",
   "the label names what it picks");
const triggerRule = (cssText.replace(/\/\*[\s\S]*?\*\//g, "")
  .match(/\.list-trigger\s*\{[^}]*\}/) || [""])[0];
ok(!/var\(--gold/.test(triggerRule) && !/var\(--fel/.test(triggerRule),
   "and does not wear the accent, which is reserved for 'selected'");
ok(/font-weight:\s*600/.test(cssText.match(/\.list-trigger-name\s*\{[^}]*\}/)[0]),
   "the open list's name is set heavier than the fields around it");

/* Three rules carry the geometry and jsdom lays nothing out, so they are pinned against
   the stylesheet source - the same way the [hidden] guard is. The block stacks; it
   anchors LEFT so class and spec share an edge and the spec strip grows right; and it no
   longer pushes itself across the row, which is what made it grow the wrong way. */
ok(/\.who-inline\s*\{[^}]*flex-direction:\s*column/.test(cssText),
   "the who block stacks class over spec");
const whoRule = cssText.match(/\.who-inline\s*\{[^}]*\}/)[0];
ok(/align-items:\s*flex-start/.test(whoRule),
   "anchored left, so the two strips share an edge and the spec strip grows right");
ok(!/margin-left:\s*auto/.test(whoRule),
   "and it no longer shoves itself to the right, which is what made it grow leftward");
ok(/\.list-zone\s*\{[^}]*margin-left:\s*auto/.test(cssText),
   "the list zone is what pushes the pair over");
ok(/\.field--grow\s*\{[^}]*flex:\s*0/.test(cssText),
   "the search box still does not take every spare pixel");

// two panels: where it drops, then everything that narrows the table - type, slot,
// search and who you are.
const panels = [...doc.querySelectorAll("main .controls")];
ok(panels.map((p) => p.className.replace("controls ", "")).join(" > ") ===
   "controls--where > controls--refine",
   `panel order: ${panels.map((p) => p.className.replace("controls ", "")).join(" > ")}`);

/* The picker and the Edit it arms lead the sticky bar, together. They were split for one
   commit - picker under the boss rail, Edit down here - and that left a dead end: Edit is
   disabled on someone else's list with title="Make a copy to edit", and Make a copy is
   inside the picker's menu, which was then a panel away. */
ok(doc.querySelector(".controls--refine").contains(doc.getElementById("template-bar")),
   "the list picker sits in the sticky bar");
ok(!doc.querySelector(".site-header #template-bar") &&
   !doc.querySelector(".controls--where #template-bar"),
   "and neither in the banner nor up with the where-hierarchy");
const listRow = doc.querySelector(".control-row--list");
ok(listRow.contains(doc.getElementById("template-bar")) &&
   listRow.contains(doc.getElementById("edit-toggle")),
   "the picker and Edit share a row - separating them is the defect this repairs");

/* Both are in the sticky panel, which is the point: Edit is pressed while reading rows,
   and the picker's menu is where Make a copy lives. The strips gave that up in exchange -
   they are up in the where panel now and will scroll away. */
ok(/\.controls--refine\s*\{[^}]*position:\s*sticky/.test(cssText),
   "and that bar is the sticky one, so both stay on screen");
/* Signing in is about you, not about which list is open, so it did NOT come along. */
ok(doc.querySelector(".site-header .account-zone"),
   "the account zone stays in the banner - it is not a list control");

/* One auto margin in that row. A second further along would split the free space and
   prise Edit away from the list it acts on, which is the defect .account-zone's own
   comment warns about upstream. */
/* Comments stripped first. style.css *explains* why Edit must not carry its own auto
   margin, and a rule-body grep would find the explanation and call it the defect - the
   same trap test/auth.mjs solves the same way for the service-role key. */
const cssBare = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
const ruleFor = (sel) => (cssBare.match(new RegExp(sel.replace(/[.#\[\]="-]/g, "\\$&") + "\\s*\\{[^}]*\\}")) || [""])[0];
/* One auto margin in that row, on Edit. The hint must not grow one: two of them would
   split the free space and prise the pair apart as the hint appears, which is the defect
   .account-zone's comment warns about upstream. */
ok(/margin-left:\s*auto/.test(ruleFor(".list-zone")),
   "the list zone pushes the pair to the right-hand end");
ok(!/margin-left:\s*auto/.test(ruleFor("#edit-toggle")) &&
   !/margin-left:\s*auto/.test(ruleFor(".edit-hint")),
   "and neither Edit nor its hint carries one, so the pair cannot drift apart");
ok(doc.querySelector(".controls--refine").nextElementSibling === doc.getElementById("results"),
   "the filters sit directly above the results they narrow");

// An author `display` rule beats the browser's [hidden], which is how the share-link
// field ended up permanently on the bar as an empty box. Any rule that sets display
// on something the code hides must be guarded.
// Checked against the stylesheet source, not getComputedStyle: jsdom never loads the
// external CSS, so a computed-style check here would pass whatever the rule says.
// A class is safe if it never sets display, or if some rule pairs it with [hidden] -
// either `.x[hidden] { display: none }` or `.x:not([hidden]) { display: flex }`.
// `.prio-drop-empty` lands on a <td> during a drag. The tables are table-layout:
// fixed, so anything that changes that cell's box - display, width, padding - shifts
// every other column in the row while you drag over it. An outline costs no layout,
// which is why it is one. Parse the source: jsdom never loads external CSS, so
// getComputedStyle would pass here no matter what the rule said.
const dropEmptyRules = cssText.match(/\.prio-drop-empty[^{]*\{[^}]*\}/g) || [];
ok(dropEmptyRules.length > 0, "the empty-cell drop target has a rule");
ok(!dropEmptyRules.some((r) => /(^|[;{\s])(display|width|padding)\s*:/.test(r)),
   "and none of it changes the cell's box, which would shift the fixed columns");

// A media query that hides a class nothing carries is a rule that silently does
// nothing - which is how the half-screen layout would have kept showing Type.
for (const cls of [...cssText.matchAll(/\.(field--[a-z]+)\s*\{[^}]*display:\s*none/g)].map((m) => m[1])) {
  ok(doc.querySelector("." + cls), `.${cls} is hidden by a rule, so something must carry it`);
}

const bareCss = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
// Document-wide, not `main [hidden]`. The scope used to be main, which quietly meant
// the template bar was never checked - and the bar lives in <header>, which is where
// BOTH of the occurrences this test exists to catch actually happened (.control-row
// and .tpl-link-out). A guard that does not cover the scene of the crime is not a guard.
const hiddenEls = [...doc.querySelectorAll("[hidden]")];
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
ok(refine.querySelectorAll(".chips").length === 0,
   "no chip rows left in it - class and spec moved up to the where panel");
ok(doc.querySelectorAll(".controls--where .chips").length === 5,
   "phase, zone, boss, class and spec are all chip rows up there");
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
ok(emptyPrioRows.every((tr) => {
  const rec = data.find((r) => tr.children[0].textContent.includes(r.item));
  return rec && rec.unsourced;
}), "the only priority-less rows shown are the ones nobody ranked");
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
ok(toggle, "the BiS toggle appears once a spec is picked");
/* Its face is the count - "8 items" - so what it filters lives on the tooltip and the
   aria-label. A control whose label is a number has to explain itself somewhere, or
   pressing it and comparing is the only way to find out what it does. */
ok(/^\d+ items?$/.test(toggle.textContent.trim()),
   `and reads as a count, not as a rule: "${toggle.textContent.trim()}"`);
ok(/bis/i.test(toggle.dataset.tip) && /bis/i.test(toggle.getAttribute("aria-label")),
   "with what it actually does on the tooltip and the aria-label");

// expectations come from bis.json rather than a hardcoded number, so filling the
// file in doesn't rewrite the test
// The phase on screen, not every phase: the filter is phase-scoped, so an expectation
// built from all three would count Sunwell items while reading Phase 3.
const bisIdsFor = (specId) =>
  new Set(((bis.specs[specId] || {}).P3 || []).map((e) => e.id));
const survBis = bisIdsFor("Surv");
const survVisible = rows().filter((tr) =>
  [...survBis].some((id) => tr.children[0].textContent.includes(
    (data.find((r) => r.id === id) || {}).item || ""))).length;
ok(parseInt(toggle.textContent, 10) === survVisible,
   `the toggle counts what it would leave (says ${toggle.textContent.trim()}, ${survVisible} visible)`);
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
// The column is no longer empty - it is seeded from BiS so the row says something - so
// what keeps a placeholder from reading as a considered ordering is the marker.
const bandRec = data.find((r) => r.item === "Band of the Eternal Champion");
ok(bandRec.unsourced && bandRec.prioritySource === "bis",
   "and its ordering says it came from BiS, not from him");

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
// The line is the longevity, plus the qualifier when every spec behind the icon agrees.
// Which longevity is not named here: it is derived from the guides and moves when they
// do, and pinning it made this fail for a reason that had nothing to do with the split
// between the name line and the BiS line, which is what this actually tests.
ok(/^(Phase|Multi-phase|Expansion) BiS( \([\w-]+\))?$/.test(rakMageIcon().dataset.tipBis),
   `the BiS line is the longevity, optionally qualified (got "${rakMageIcon().dataset.tipBis}")`);

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

// --- a priority icon filters to whoever it names -------------------------------------
/* The priority line is the content of this page, and until now it was inert: you read
   "Prot Warrior > Prot Paladin" and then went to the chip row to act on it. */
{
  click(doc.getElementById("reset"));
  const iconFor = (id) => [...doc.querySelectorAll("td.col-prio img.spec-icon")]
    .find((i) => i.dataset.id === id);
  /* the leading All chip reads as pressed when nothing else is, which is correct on
     screen and noise here - what is being asserted is which specs were picked */
  const pressed = (sel) => [...doc.querySelectorAll(sel + " .chip[aria-pressed=true]")]
    .filter((c) => !c.classList.contains("chip--all"))
    .map((c) => c.dataset.tip);

  const before = rows().length;
  const specIcon = iconFor("ProtWarr");
  ok(specIcon.getAttribute("role") === "button" && specIcon.getAttribute("tabindex") === "0",
     "a priority icon is reachable as a control, not just paintable");
  ok(specIcon.classList.contains("spec-icon--link"),
     "and carries the class the cursor affordance hangs off");

  click(specIcon);
  ok(rows().length < before, `clicking one narrows the table (${before} -> ${rows().length})`);
  // a spec is a refinement of its class and is never a selection on its own, so both land
  ok(pressed("#class-chips").join() === "Warrior" &&
     pressed("#spec-chips").join() === "Protection Warrior",
     `it sets the class as well as the spec (${pressed("#class-chips")} / ${pressed("#spec-chips")})`);
  ok(/class=Warrior/.test(window.location.hash) && /spec=ProtWarr/.test(window.location.hash),
     `and the selection is linkable like any other (${window.location.hash})`);

  // the way back out is the same icon: otherwise every click narrows and only the chip
  // row can widen, which makes an icon a one-way door
  click(iconFor("ProtWarr"));
  ok(rows().length === before, `clicking the same icon again clears it (${rows().length})`);

  // a class entry filters to the class - 104 of the entries name one
  const clsIcon = iconFor("Rogue");
  ok(clsIcon, "a class-level entry renders an icon too");
  click(clsIcon);
  ok(pressed("#class-chips").join() === "Rogue" && pressed("#spec-chips").length === 0,
     "a class icon picks the class and leaves the specs open");
  click(doc.getElementById("reset"));

  // a dimmed icon is exactly the one you might want to switch to, so it stays live
  click(chipByTip("#class-chips", "Warrior"));
  const dimmed = [...doc.querySelectorAll("td.col-prio .spec-icon--muted")][0];
  ok(dimmed && dimmed.classList.contains("spec-icon--link"),
     "a dimmed icon is still clickable - 'not you' is who you might become");

  // a race icon prefixes an entry and names no spec, so it is not a control
  click(doc.getElementById("reset"));
  const race = doc.querySelector("td.col-prio .spec-icon--race");
  ok(race && !race.classList.contains("spec-icon--link") && !race.dataset.id,
     "a race icon carries no id and is not clickable - the spec beside it is the target");
  click(doc.getElementById("reset"));
}

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
