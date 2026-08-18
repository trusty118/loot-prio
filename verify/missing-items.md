# Items missing from loot_data.json — audit closed, Aug 2026

The dataset was reconstructed from two videos, so items the creator never mentioned were
simply absent. This file used to say "2 confirmed absent, an ID-block scan suggests 20-30
more". Both halves are now settled, and the answer to the second was **8**, not 20-30.

## How it was settled

Populating `data/bis.json` from Wowhead's per-spec Phase 3 guides gave a second, independent
list of Black Temple and Mount Hyjal loot. `verify/fetch_bis.py` reports every BiS item that
this dataset doesn't list, and each guide row carries its source ("Drop: Teron Gorefiend
(Black Temple)").

That comparison found **71 BiS items sourced to BT or Hyjal that were not in our 182**. But
**62 of them are tier set pieces** — Thunderheart, Skyshatter, Lightbringer, Onslaught,
Slayer's, Absolution, Malefic, Gronnstalker's, Tempest. Those are not drops: they are what a
tier token turns into, and this dataset correctly lists the 15 **tokens** that actually drop.
Counting them as missing loot is what produced the old 20-30 estimate.

Strip the tier armour and 8 genuine drops remain, 1 of which was already logged here.

## Added (13 records, 182 -> 195)

All carry `"unsourced": true`, an empty `priority`, and a note. They render with a
**"not in the guide"** tag, because the whole point of this site is that the priorities are
one person's calls — a row holding none of his must not read as one he had no opinion on.

| Item | ID | Zone | Boss |
|---|---|---|---|
| [Wraps of Precise Flight](https://www.wowhead.com/tbc/item=32251) | 32251 | Black Temple | Supremus |
| [Nether Shadow Tunic](https://www.wowhead.com/tbc/item=32252) | 32252 | Black Temple | Supremus |
| [Myrmidon's Treads](https://www.wowhead.com/tbc/item=32268) | 32268 | Black Temple | Shade of Akama |
| [Shadowmoon Destroyer's Drape](https://www.wowhead.com/tbc/item=32323) | 32323 | Black Temple | Teron Gorefiend |
| [Cowl of Benevolence](https://www.wowhead.com/tbc/item=32329) | 32329 | Black Temple | Teron Gorefiend |
| [Belt of Primal Majesty](https://www.wowhead.com/tbc/item=32339) | 32339 | Black Temple | Gurtogg Bloodboil |
| [Girdle of Mighty Resolve](https://www.wowhead.com/tbc/item=32342) | 32342 | Black Temple | Gurtogg Bloodboil |
| [Dreadboots of the Legion](https://www.wowhead.com/tbc/item=32345) | 32345 | Black Temple | Reliquary of Souls |
| [Furious Shackles](https://www.wowhead.com/tbc/item=30861) | 30861 | Mount Hyjal | Rage Winterchill |
| [Band of the Eternal Defender](https://www.wowhead.com/tbc/item=29297) | 29297 | Mount Hyjal | Trash |
| [Band of the Eternal Champion](https://www.wowhead.com/tbc/item=29301) | 29301 | Mount Hyjal | Trash |
| [Band of the Eternal Sage](https://www.wowhead.com/tbc/item=29305) | 29305 | Mount Hyjal | Trash |
| [Band of the Eternal Restorer](https://www.wowhead.com/tbc/item=29309) | 29309 | Mount Hyjal | Trash |

Two of these needed a judgement call, both recorded in the row's notes:

- **Dreadboots of the Legion** drops from Essence of Anger, which is the third phase of the
  Reliquary of Souls encounter, so it is filed under that boss rather than under a phase name
  that would create a boss the rest of the site doesn't know.
- **The four Bands of the Eternal are Scale of the Sands reputation rewards** (Exalted, the
  Champion's Covenant quest line), not trash drops. They are filed under Hyjal `Trash` because
  that is the catch-all bucket that makes them visible in the Hyjal list; each row's notes say
  how they are actually acquired. All four are `Unique-Equipped: Band of Eternity (1)`, so only
  one can be worn.

11 of the 13 turned out to be BiS for at least one spec, which is a fair sign they belonged in
a T6 loot list. The exceptions are Wraps of Precise Flight and Band of the Eternal Defender.

## Still deliberately out

- **Gems** and **Mother Shahraz's shadow-resistance set** — the creator omitted both as
  situational rather than loot-council calls.
- **Tier set pieces** — the tokens that drop are listed; the armour they become is not, and
  should not be. Anything in the tier lists above is expected to show as "not in this dataset"
  on every `fetch_bis.py` run.
