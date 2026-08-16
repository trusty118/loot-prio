# TBC Loot Priority Site — Handoff

A project to turn a WoW TBC Classic (Tier 6) loot-priority guide into a browsable, filterable static website hosted on **GitHub Pages**.

The data was reconstructed from two YouTube videos by the original creator (see **Attribution**). It is packaged in `loot_data.json`, ready to build a UI on top of.

---

## 1. Goal

A single-page static site where a user can:

1. **(Primary) Filter by raid zone → boss.** Pick a zone (Black Temple / Mount Hyjal), then a boss, and see every item that boss drops with its loot priority. This is the main use case — build it first.
2. **(Secondary) Filter by** role (Physical / Caster / Healer / Tank), item type (Cloth/Leather/Mail/Plate, or weapon class), and slot.
3. **Search** by item name.

Each item row should show: name (linked to Wowhead), slot, type, role, priority, and notes.

Must be hostable on GitHub Pages (static files only, no server/build step required unless you want one).

---

## 2. Data file: `loot_data.json`

A flat JSON array of item records. Flat is deliberate — easy to filter/group in JS. Example record:

```json
{
  "zone": "Black Temple",
  "boss": "Illidan Stormrage",
  "item": "Bulwark of Azzinoth",
  "id": 32375,
  "wowhead": "https://www.wowhead.com/tbc/item=32375",
  "slot": "Off-Hand",
  "type": "Shield",
  "role": "Tank",
  "priority": "Prot Warrior > Prot Paladin",
  "notes": "Warrior never unequips it; pally often swaps shields."
}
```

### Fields
| Field | Meaning |
|---|---|
| `zone` | `"Black Temple"`, `"Mount Hyjal"`, or `"Crafted (Heart of Darkness)"` (a pseudo-zone for craftable BiS pieces). |
| `boss` | Boss name, or `"Trash"`, or `"—"` for crafted. Use this for the primary filter. |
| `item` | Item name (authoritative spelling, cross-referenced to the item DB). |
| `id` | Real TBC item ID. |
| `wowhead` | Direct Wowhead TBC link (`/tbc/item={id}`). |
| `slot` | Equip slot (Head, Shoulder, …, One-Hand, Off-Hand, Ranged, Finger, Trinket, Back, Relic). |
| `type` | Armor class (Cloth/Leather/Mail/Plate) OR weapon/other category (1H Sword, Dagger, Staff, Shield, Wand, Bow, Cloak, Ring, Neck, Trinket, Idol/Totem/Libram, or `Tier Token (...)`). |
| `role` | Physical / Caster / Healer / Tank (primary audience). |
| `priority` | Short arrow notation, e.g. `Ret > Warrior = Rogue`. Class shorthand used in notes: R Shaman/R Druid = resto, H Pal/H Priest = holy, SPriest = shadow priest, Ele = elemental, Boomkin = balance druid, Lock = warlock, Prot = protection, BM = beast mastery. |
| `notes` | Conditions/caveats behind the priority. |
| `verifyBoss` | `true` on items whose **boss attribution is a best-effort guess** and should be confirmed (see §4). Absent = confident. |

**Counts:** 182 records total — Black Temple 109, Mount Hyjal 61, Crafted 12.

---

## 3. What's done

- All items extracted from both videos and matched to **real item IDs** (source: the [wowsims/tbc](https://github.com/wowsims/tbc) item database, `sim/core/items/all_items.go`).
- Auto-caption garbling fixed (e.g. "leggings of paternity" → **Leggings of Eternity**, "zardoom" → **Zhar'doom**, "veil stock girdle" → **Valestalker Girdle**).
- `slot` and `type` pulled from the item DB (authoritative armor classes / weapon types).
- Tier tokens included with verified IDs (item block 31089–31103). *Note: the three BT chest-token IDs (31089/31090/31091) were inferred from the consistent, gapless token block and anchored on a confirmed ID — worth a quick sanity check but very likely correct.*
- Mount Hyjal boss attribution is **confident** (the creator narrated it boss-by-boss).

The same data also exists as a 2-tab spreadsheet (`Loot_Priority.xlsx`) and two Google Sheets in the user's Drive (`WoW > Loot Prio`), but **`loot_data.json` is the source of truth for the site.**

---

## 4. Known gaps / first tasks

1. **Verify boss attribution for the 52 items flagged `verifyBoss: true`** (all in Black Temple, bosses Supremus / Shade of Akama / Teron Gorefiend / Gurtogg Bloodboil / Reliquary of Souls). The creator lumped these mid-instance drops together, so per-boss assignment is a best-effort guess. Confirm against Wowhead: Black Temple = `wowhead.com/tbc/zone=3959`, Hyjal Summit = `wowhead.com/tbc/zone=3606`. (The zone drop tables are JS-rendered, so a plain fetch won't work — use Wowhead's tooltip/data endpoints, an item's "Dropped by" data, or a maintained TBC loot dataset.) BT trash, Naj'entus, Mother Shahraz, Illidari Council, and Illidan are already confident.
2. **Crafted pseudo-zone**: the 12 Heart-of-Darkness craftables are under `zone: "Crafted (Heart of Darkness)"` with `boss: "—"`. Decide how to surface them (own tab, or a filter chip).
3. **Not yet included**: gems, and the pure **shadow-resistance** gear for Mother Shahraz (the SR cloak/wrist/boot/belt/leg set). These were intentionally omitted as situational rather than loot-council calls. Add a third data category if you want completeness — the source transcript covers them.
4. Some low-value items have loose priorities ("biggest upgrade", "whoever", "Skip (bad)") — that's faithful to how the creator called them; render them as-is.

---

## 5. Suggested approach

- **Stack:** plain `index.html` + `style.css` + `app.js` (vanilla) that `fetch`es `loot_data.json`. No build step = trivial GitHub Pages hosting. A light framework (Alpine/Svelte/Vite) is fine if preferred, but not needed.
- **UI shape:** left/top control bar (zone selector → boss selector, plus role/type/slot chips and a search box) driving a filtered list/table. Group results by boss under the chosen zone.
- **Wowhead tooltips (high value, low effort):** include
  ```html
  <script>const whTooltips={colorLinks:true,iconizeLinks:true,renameLinks:true};</script>
  <script src="https://wow.zamimg.com/js/tooltips.js"></script>
  ```
  and point item links at `https://www.wowhead.com/tbc/item={id}` — you get icons + hover tooltips for free.
- **Color by role** (already a natural grouping): Tank/Physical/Caster/Healer.
- **Deploy:** repo → Settings → Pages → deploy from `main` / root (or `/docs`). Done.

---

## 6. Attribution (required)

The priorities and item choices are the work of the original creator, whose site (`tbc.classicwowbuilds.com`) has been offline for ~4 years. Credit them prominently (e.g. a footer + an "About" note):

- Creator's channel / stream: **twitch.tv/zatar_wow** (referenced in both videos as "zatar_wow").
- Source: two YouTube videos (Tier 6 loot priority — Mount Hyjal part 1, Black Temple part 2).
- Hunter bow priorities credited in-video to "Veramos"; arms-warrior input to "Lemonism".

State clearly that this is a community mirror/preservation of their guide, not original analysis.

---

## 7. Handy reference

- Item DB used: `https://raw.githubusercontent.com/wowsims/tbc/master/sim/core/items/all_items.go` (Go source; parse `{Name:..., ID:..., Type:..., ArmorType:..., WeaponType:..., Phase:...}`). Phase 3 = T6 (Hyjal/BT).
- Wowhead item link pattern: `https://www.wowhead.com/tbc/item={id}`.
- Tier token block: 31089–31103 (Chest 31089-91, Gloves 31092-94, Helm 31095-97, Legs 31098-100, Shoulders 31101-103); within most blocks order is Conqueror, Vanquisher, Protector — **except Helm**, which is Vanquisher (31095), Protector (31096), Conqueror (31097).
