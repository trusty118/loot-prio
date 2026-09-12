/* Small pure helpers: escaping, labels, boss ordering. */
import { BOSS_ORDER, ZONE_LABEL } from "./data.js";
import { ZONE_ORDER } from "./rules.js";
import { ALL } from "./state.js";

/* ---------- helpers ---------- */

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Escape first, then wrap search hits in <mark>. */
export function highlight(text, needle) {
  var safe = escapeHtml(text);
  if (!needle) return safe;
  return safe.replace(new RegExp("(" + escapeRegExp(escapeHtml(needle)) + ")", "gi"), "<mark>$1</mark>");
}

export function zoneLabel(zone) {
  return ZONE_LABEL[zone] || zone;
}

/* Crafted items have no boss - the em-dash is a placeholder in the data. They are
   reachable through the Crafted zone, so they get no boss chip and their group is
   headed by the zone instead. */
export var NO_BOSS = "—";

export function bossLabel(boss) {
  return boss;
}

export function orderedBosses(zone) {
  var known = BOSS_ORDER[zone] || [];
  var seen = {};
  var out = [];
  known.forEach(function (b) { seen[b] = true; out.push(b); });
  ALL.forEach(function (r) {
    if (r.zone === zone && !seen[r.boss]) { seen[r.boss] = true; out.push(r.boss); }
  });
  return out;
}

/* Boss names are not unique across zones - both raids have a "Trash". A chip is
   therefore identified by zone + boss, and state.bossZone carries the zone half. */
export var BOSS_SEP = "␟";

export function bossKey(zone, boss) {
  return zone + BOSS_SEP + boss;
}

export function bossZones(boss) {
  var seen = {};
  ALL.forEach(function (r) { if (r.boss === boss) seen[r.zone] = true; });
  return Object.keys(seen);
}

export function bossSortKey(rec) {
  var zi = ZONE_ORDER.indexOf(rec.zone);
  var order = orderedBosses(rec.zone);
  var bi = order.indexOf(rec.boss);
  return (zi < 0 ? 99 : zi) * 1000 + (bi < 0 ? 999 : bi);
}
