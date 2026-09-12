/* The editor's gestures: dragging, the add popover, the operator menu. */
import { addEntry, applyEdit, moveEntry, rejectReason, removeEntry, setOp } from "./editing.js";
import { CLASS_SPECS, REG, classSuitsItem, resolveEntry, suitsItem } from "./registry.js";
import { bisMark, specIcon, update } from "./results.js";
import { OPERATORS, OP_LIST } from "./rules.js";
import { ALL, el } from "./state.js";
import { setSmartFilter, smartFilter } from "./store.js";
import { canEdit, effectivePriority } from "./templates.js";

/* ---------- the editor ----------
   Pointer only, by decision. Every action used to have a keyboard form as well, which
   was partly accessibility and partly the only reason the editor was testable - jsdom
   can dispatch a keydown but cannot drag.

   Two consequences to know rather than rediscover. The editor is not keyboard
   operable. And reordering is now drag-only, so **nothing automated covers it** -
   remove, operator and add all still have click paths and stay tested, but a
   reordering regression will only ever be caught by hand at localhost:8642. */

export var editMsg = "";        /* why the last edit was refused, shown under the toolbar */

export var toastTimer = null;

/* Same role="status" element and the same call sites it always had - only where it
   sits has changed. It used to live inside the template bar, so every message pushed
   the buttons along as it appeared and changed length; now it is a toast that affects
   no layout at all.

   `undo` is optional and is what lets the delete confirm stay light: an undo is worth
   more than any confirm, and the deleted record is held in the closure until the
   toast clears. */
export function announce(msg, undo, label) {
  editMsg = msg || "";
  if (!el.editMsg) return;
  clearTimeout(toastTimer);
  el.editMsg.innerHTML = "";
  if (!editMsg) { el.editMsg.hidden = true; return; }

  var text = document.createElement("span");
  text.textContent = editMsg;
  el.editMsg.appendChild(text);

  if (undo) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "toast-undo";
    b.textContent = label || "Undo";
    b.addEventListener("click", function () { announce(""); undo(); });
    el.editMsg.appendChild(b);
  }

  el.editMsg.hidden = false;
  /* An undo needs longer than a status line, and neither should stay forever. */
  toastTimer = setTimeout(function () { announce(""); }, undo ? 12000 : 6000);
}

/* ---------- dragging ----------
   Pointer events rather than HTML5 drag-and-drop: these icons live in a
   table-layout: fixed cell, where HTML5 DnD drop targets are unreliable. This is the
   only way to reorder, so it is also the only part of the editor no test can reach. */

export var DRAG_SLOP = 4;      /* px of movement before a press counts as a drag, not a click */

/* Which gap the pointer is in: 0 is before the first icon, n after the last. */
export function dropSlot(td, clientX) {
  var icons = td.querySelectorAll(".prio-edit");
  for (var i = 0; i < icons.length; i++) {
    var r = icons[i].getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return i;
  }
  return icons.length;
}

export function clearDrops() {
  var marked = el.results.querySelectorAll(".prio-drop, .prio-drop-after, .prio-drop-empty");
  [].forEach.call(marked, function (n) {
    n.classList.remove("prio-drop");
    n.classList.remove("prio-drop-after");
    n.classList.remove("prio-drop-empty");
  });
}

/* Show the gap the icon would land in by marking the icon that follows it. A line
   with no icons has nothing to mark, so the cell itself becomes the target - which
   is every row of a list you have only just started. */
export function markSlot(td, slot) {
  var icons = td.querySelectorAll(".prio-edit");
  if (!icons.length) { td.classList.add("prio-drop-empty"); return; }
  var mark = icons[slot];
  if (mark) mark.classList.add("prio-drop");
  else icons[icons.length - 1].classList.add("prio-drop-after");
}

/* A half-size copy of the icon that follows the pointer. */
export function makeGhost(node, e) {
  var g = node.cloneNode(true);
  g.className = "drag-ghost";
  document.body.appendChild(g);
  moveGhost(g, e);
  return g;
}
export function moveGhost(g, e) {
  g.style.left = e.clientX + "px";
  g.style.top = e.clientY + "px";
}

/* Shared press-drag-release plumbing. onDrop gets the pointer event. */
export function onDrag(node, opts) {
  node.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    var startX = e.clientX, startY = e.clientY, ghost = null;

    function move(ev) {
      if (!ghost) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_SLOP) return;
        ghost = makeGhost(node, ev);
        node.classList.add("prio-dragging");
        if (node.setPointerCapture) node.setPointerCapture(ev.pointerId);
      }
      moveGhost(ghost, ev);
      clearDrops();
      opts.over(ev);
    }
    function done(ev) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      if (!ghost) return;                      /* it was a click; leave that to click */
      ghost.parentNode.removeChild(ghost);
      node.classList.remove("prio-dragging");
      clearDrops();
      ev.preventDefault();
      /* The browser took the gesture off us - a native image drag is how that used
         to happen, and it swallowed every drop without a word. Abandoning is right;
         doing it in silence is what hid the bug. */
      if (ev.type === "pointercancel") {
        if (window.console) console.warn("drag cancelled by the browser, drop abandoned");
        return;
      }
      opts.drop(ev);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  });
}

/* The editable cell under the pointer, if any. */
export function cellUnder(e) {
  var n = document.elementFromPoint(e.clientX, e.clientY);
  return n && n.closest ? n.closest(".col-prio--editing") : null;
}

/* One icon inside an editable line. */
export function editableIcon(rec, list, index, resolved, entry) {
  var wrap = document.createElement("span");
  wrap.className = "prio-edit";
  wrap.dataset.index = String(index);
  wrap.setAttribute("role", "listitem");
  /* The position is still worth announcing - it is the whole meaning of the line -
     but there are no keys left to name. */
  wrap.setAttribute("aria-label",
    resolved.name + ", position " + (index + 1) + " of " + list.length);

  var mark = bisMark(resolved, rec.id);
  wrap.appendChild(specIcon(resolved, mark.tier, mark.specs, mark.variant, mark.conditional));

  var x = document.createElement("button");
  x.type = "button";
  x.className = "prio-x";
  x.textContent = "×";
  x.tabIndex = -1;
  x.setAttribute("aria-hidden", "true");
  x.addEventListener("click", function (e) {
    e.stopPropagation();
    applyEdit(rec, removeEntry(list, index));
    update();
  });
  wrap.appendChild(x);

  /* Drag to reorder. Dropping anywhere but on a line does nothing: taking an icon
     off is the x, deliberately. Dragging clear of the row used to remove it, which
     fired by accident more often than on purpose. */
  onDrag(wrap, {
    over: function (ev) {
      var td = wrap.parentNode;
      if (cellUnder(ev) === td) markSlot(td, dropSlot(td, ev.clientX));
    },
    drop: function (ev) {
      var td = wrap.parentNode;
      if (cellUnder(ev) !== td) return;      /* dropped off its line: it goes home */
      var slot = dropSlot(td, ev.clientX);
      applyEdit(rec, moveEntry(list, index, slot > index ? slot - 1 : slot));
      announce("");
      update();
    }
  });

  return wrap;
}

/* The editable form of a priority cell: same icons, plus handles. */
export function editablePriorityCell(rec) {
  var td = document.createElement("td");
  td.className = "col-prio col-prio--editing";
  td.setAttribute("role", "list");
  var list = effectivePriority(rec) || [];

  list.forEach(function (entry, i) {
    if (i > 0) {
      var op = OPERATORS[entry.op] || OPERATORS[">"];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prio-op prio-op--editing";
      btn.textContent = entry.op || ">";
      btn.dataset.tip = op.label + " - click to change";
      btn.setAttribute("aria-label", op.label + ", click to change");
      btn.setAttribute("aria-haspopup", "true");
      btn.addEventListener("click", function () {
        openOpMenu(rec, list, i, btn);
      });
      td.appendChild(btn);
    }
    var resolved = resolveEntry(entry);
    if (!resolved) return;
    td.appendChild(editableIcon(rec, list, i, resolved, entry));
  });

  var add = document.createElement("button");
  add.type = "button";
  add.className = "prio-add";
  add.textContent = "+";
  add.dataset.tip = "Add a spec - click one, or drag it onto a line";
  add.setAttribute("aria-label", "Add a spec to " + rec.item);
  add.addEventListener("click", function (e) {
    e.stopPropagation();
    openPop(rec, add);
  });
  td.appendChild(add);

  /* There was a per-row "back to zatar's order" here. It reset to rec.priority, and
     the item data holds no priorities now - there is no baseline to go back to, because
     a priority is something a list says. Undoing a change means reopening the list you
     copied from, or not saving; the button would have been a control that could only
     ever clear the row. */

  return td;
}

/* ---------- the add popover ----------
   Every class and spec, opened from the + on a row. One element, created lazily and
   parented to <body> like the tooltip is: inside a table-layout: fixed cell with a
   horizontal scroll container it would be clipped.

   Each icon does two things. Clicking adds it to the row the popover was opened on;
   dragging drops it into a chosen gap on ANY row, because cellUnder() resolves
   whatever is under the pointer and does not care where the drag began. */

export var pop = null;          /* the element */
export var popFor = null;       /* the record it was opened on */
export var popQuery = "";

/* Sit an overlay under its anchor, flipping above when there is no room below and
   clamping to the viewport. Shared by the add popover and the operator menu, which
   otherwise drift into two subtly different versions of the same arithmetic. */
export function placeUnder(node, anchor) {
  var r = anchor.getBoundingClientRect();
  var n = node.getBoundingClientRect();
  var left = r.left;
  var top = r.bottom + 6;
  if (top + n.height > document.documentElement.clientHeight - 4) {
    top = Math.max(4, r.top - n.height - 6);
  }
  var maxLeft = document.documentElement.clientWidth - n.width - 6;
  if (left > maxLeft) left = maxLeft;
  if (left < 6) left = 6;
  node.style.left = Math.round(left) + "px";
  node.style.top = Math.round(top) + "px";
}

export function closePop() {
  popFor = null;
  popQuery = "";
  if (pop) pop.style.display = "none";
}

/* ---------- the operator menu ----------
   Clicking the operator between two icons used to step to the next one, so the
   five were a cycle and "~=" was four clicks away. It picks directly now. Same
   element-per-page, anchor-under, click-outside shape as the add popover. */

export var opMenu = null;
export var opMenuFor = null;      /* { rec, list, index } while it is open */

export function closeOpMenu() {
  opMenuFor = null;
  if (opMenu) opMenu.style.display = "none";
}

export function buildOpMenu() {
  opMenu = document.createElement("div");
  opMenu.className = "prio-menu";
  opMenu.setAttribute("role", "menu");
  opMenu.setAttribute("aria-label", "Choose an operator");
  opMenu.style.display = "none";

  OP_LIST.forEach(function (op) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "prio-menu-item";
    b.dataset.op = op;
    b.setAttribute("role", "menuitemradio");

    var sym = document.createElement("span");
    sym.className = "prio-menu-op";
    sym.textContent = op;
    var label = document.createElement("span");
    label.className = "prio-menu-label";
    label.textContent = OPERATORS[op].label;
    b.appendChild(sym);
    b.appendChild(label);

    b.addEventListener("click", function () {
      if (!opMenuFor) return;
      var at = opMenuFor;
      applyEdit(at.rec, setOp(at.list, at.index, op));
      announce(resolveEntry(at.list[at.index]).name + " is now " + OPERATORS[op].label);
      closeOpMenu();
      update();
    });

    opMenu.appendChild(b);
  });

  opMenu.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closeOpMenu(); }
  });

  document.body.appendChild(opMenu);
}

export function openOpMenu(rec, list, index, anchor) {
  if (!canEdit()) return;
  if (!opMenu) buildOpMenu();
  closePop();                       /* only one overlay at a time */
  opMenuFor = { rec: rec, list: list, index: index };

  var current = list[index] && list[index].op;
  var items = opMenu.querySelectorAll(".prio-menu-item");
  for (var i = 0; i < items.length; i++) {
    var on = items[i].dataset.op === current;
    items[i].setAttribute("aria-checked", on ? "true" : "false");
    items[i].classList.toggle("is-current", on);
  }

  opMenu.style.display = "block";
  placeUnder(opMenu, anchor);

  var pick = opMenu.querySelector(".prio-menu-item.is-current") || items[0];
  if (pick) pick.focus();
}

/* Put entry into rec at slot, or refuse and say why. */
export function place(rec, entry, resolved, slot) {
  var list = effectivePriority(rec) || [];
  var why = rejectReason(rec, list, entry, -1);
  if (why) { announce(resolved.name + ": " + why); return false; }
  applyEdit(rec, addEntry(list, entry, slot));
  announce(resolved.name + " added to " + rec.item);
  update();
  return true;
}

/* Every pickable entry once: each class, then its specs. */
/* Everything pickable, narrowed to what the item suits unless smart filtering is
   off. A class is offered when any of its specs is, matching how a class icon
   already answers for the specs behind it. */
export function pickableEntries(rec) {
  var out = [];
  var smart = rec && smartFilter();

  Object.keys(REG.classes).forEach(function (clsId) {
    if (smart && !classSuitsItem(rec, clsId)) return;
    out.push({ clsId: clsId, entry: { "class": clsId } });
    (CLASS_SPECS[clsId] || []).forEach(function (id) {
      if (smart && !suitsItem(rec, id)) return;
      out.push({ clsId: clsId, entry: { spec: id } });
    });
  });
  return out.filter(function (e) { return !!resolveEntry(e.entry); });
}

export function buildPop() {
  pop = document.createElement("div");
  pop.className = "prio-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Add a spec");

  var field = document.createElement("input");
  field.type = "search";
  field.className = "prio-pop-find";
  field.placeholder = "Type to narrow";
  field.setAttribute("aria-label", "Find a class or spec");
  pop.appendChild(field);

  var body = document.createElement("div");
  body.className = "prio-pop-body";
  pop.appendChild(body);

  /* the escape hatch from smart filtering, in the popover rather than on the bar:
     it is a decision about this pick, made where the picking happens */
  var foot = document.createElement("button");
  foot.type = "button";
  foot.className = "prio-pop-foot";
  foot.addEventListener("click", function () {
    setSmartFilter(!smartFilter());
    fillPop();
    pop.querySelector(".prio-pop-find").focus();
  });
  pop.appendChild(foot);

  document.body.appendChild(pop);

  field.addEventListener("input", function () {
    popQuery = field.value.trim().toLowerCase();
    fillPop();
  });

  field.addEventListener("keydown", function (e) {
    /* Escape only. It closes all five overlays on this page and is not an editing
       gesture - the editor itself is pointer-only. */
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });

  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });

  return pop;
}

export function fillPop() {
  var body = pop.querySelector(".prio-pop-body");
  body.innerHTML = "";

  var groups = {};
  var order = [];
  var shown = 0;

  pickableEntries(popFor).forEach(function (e) {
    var resolved = resolveEntry(e.entry);
    if (popQuery && resolved.name.toLowerCase().indexOf(popQuery) === -1) return;
    if (!groups[e.clsId]) {
      groups[e.clsId] = document.createElement("span");
      groups[e.clsId].className = "prio-pop-group";
      order.push(e.clsId);
    }
    groups[e.clsId].appendChild(popIcon(e.entry, resolved));
    shown++;
  });

  order.forEach(function (id) { body.appendChild(groups[id]); });
  if (!shown) {
    var none = document.createElement("p");
    none.className = "prio-pop-none";
    none.textContent = "Nothing matches that.";
    body.appendChild(none);
  }

  /* Never hide silently: say how many are missing and offer them back. Turning it
     off is how you build something the rules do not expect - a healing warrior. */
  var foot = pop.querySelector(".prio-pop-foot");
  var hidden = popFor ? pickableEntries(null).length - pickableEntries(popFor).length : 0;
  foot.textContent = smartFilter() ? "Show all specs" : "Show only what suits";
  /* nothing to reveal on an item that suits everyone, so the control goes away
     rather than sitting there doing nothing */
  foot.hidden = smartFilter() && !hidden;
}

export function popIcon(entry, resolved) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "prio-pop-icon";
  b.dataset.tip = resolved.name;
  b.setAttribute("aria-label", "Add " + resolved.name);
  b.appendChild(specIcon(resolved, 0));

  /* click: onto the row this was opened on, at the end of its line */
  b.addEventListener("click", function () {
    if (!popFor) return;
    if (place(popFor, entry, resolved, null)) closePop();
  });

  /* drag: onto whichever row you drop it on, in the gap you drop it in */
  onDrag(b, {
    over: function (ev) {
      var td = cellUnder(ev);
      if (td) markSlot(td, dropSlot(td, ev.clientX));
    },
    drop: function (ev) {
      var td = cellUnder(ev);
      if (!td) { announce("Drop it on a row to add it there"); return; }
      var rec = recordFor(td.parentNode.dataset.id);
      if (!rec) return;
      if (place(rec, entry, resolved, dropSlot(td, ev.clientX))) closePop();
    }
  });

  return b;
}

export function recordFor(id) {
  return ALL.filter(function (r) { return String(r.id) === String(id); })[0];
}

/* Anchored under the + that opened it, clamped into the viewport the same way the
   tooltip is. */
export function openPop(rec, anchor) {
  if (!canEdit()) return;
  if (!pop) buildPop();
  popFor = rec;
  popQuery = "";
  pop.setAttribute("aria-label", "Add a spec to " + rec.item);
  pop.querySelector(".prio-pop-find").value = "";
  pop.style.display = "block";
  fillPop();

  placeUnder(pop, anchor);
  pop.querySelector(".prio-pop-find").focus();
}
