/* Instant tooltips. */
import { el } from "./state.js";

/* ---------- instant tooltips ---------- */

/* One element reused for every icon, parented to <body> so the table's
   overflow-x container can't clip it, and positioned on hover with no delay. */
export var tip = null;

export function showTip(el) {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    document.body.appendChild(tip);
  }
  tip.textContent = el.dataset.tip;

  /* second line, coloured to match the ring drawn on the icon */
  if (el.dataset.tipBis) {
    var line = document.createElement("span");
    line.className = "tip-bis tip-bis--" + (el.dataset.tipTier || "1");
    line.textContent = el.dataset.tipBis;
    tip.appendChild(line);
  }

  tip.style.display = "block";

  var r = el.getBoundingClientRect();
  var t = tip.getBoundingClientRect();

  /* centred above the icon, flipped below when there's no room up there */
  var left = r.left + (r.width - t.width) / 2;
  var top = r.top - t.height - 8;
  if (top < 4) top = r.bottom + 8;

  var maxLeft = document.documentElement.clientWidth - t.width - 6;
  if (left < 6) left = 6;
  if (left > maxLeft) left = maxLeft;

  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
}

export function hideTip() {
  if (tip) tip.style.display = "none";
}

export function bindTips() {
  /* delegated, because every render replaces the icons */
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (el) showTip(el);
  });
  document.addEventListener("mouseout", function (e) {
    var el = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (el) hideTip();
  });
  /* keyboard users get it too */
  document.addEventListener("focusin", function (e) {
    var el = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (el) showTip(el);
  });
  document.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, true);
}
