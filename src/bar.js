/* The bar: the list picker and its menu, signing in, the account menu, the option menus. */
import { saveNow } from "./editing.js";
import { announce, closeOpMenu, closePop, placeUnder } from "./editor.js";
import { readUrl } from "./filter.js";
import { OOTB, ootbCache, ootbForPhase, openOotb } from "./lists.js";
import { update } from "./results.js";
import { hasShareToken, loadSharedByToken, shareServerSide, toggleSharePop } from "./share.js";
import { activeIsMine, activeTemplate, el, sb, setActive, setSb, setSession, setUnsaved, state, unsaved } from "./state.js";
import { BIS_SOURCES, SUPABASE_ANON_KEY, SUPABASE_URL, accountName, filledCount, renderAvatar, setBisSource, signedIn, store, supabaseConfigured, supabaseReady, syncStore } from "./store.js";
import { attestedAuthor, copyOfCurrent, encodeTemplate, newBlankTemplate, validateTemplate } from "./templates.js";

/* ---------- the list bar ----------

   [ List v ] [ name____ ]  New  Make a copy  Edit  Copy link  Delete

   What it offers follows what is on screen. zatar's list, and a list that arrived
   on a link, are someone else's work: they get New and Make a copy and nothing
   more. The rest appears once a list of your own is open. No browser dialogs -
   naming, opening and deleting all happen in the page. */

export var savedLists = [];        /* store.list() is async; this is its cached answer */

/* ---------- signing in ----------
   Discord only. Every raider has one, it is the easiest of the three OAuth flows,
   and Supabase implements the token exchange - so the two places a project this size
   usually grows a security hole (the exchange, and "can this user read this row")
   are both somebody else's tested code rather than ours. */

export var RETURN_KEY = "lootprio.returnTo";

/* Come back to the page you left, not to the site root - the phase, zone and filters
   all live in the hash, and losing them across a login is a small betrayal that is
   entirely avoidable.

   The hash cannot simply ride along in redirectTo: Supabase appends `?code=` to that
   URL, and a query has to sit before a fragment, so a redirectTo that already ends in
   one composes into nonsense. Park it instead, and put it back on the way in. */
export function stashReturn() {
  try { window.sessionStorage.setItem(RETURN_KEY, location.hash); }
  catch (e) { /* private browsing: you lose your filters, not your sign-in */ }
}

export function restoreReturn() {
  var h = "";
  try {
    h = window.sessionStorage.getItem(RETURN_KEY) || "";
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch (e) { return false; }
  if (!h || h === location.hash) return false;
  history.replaceState(null, "", location.pathname + location.search + h);
  readUrl();
  return true;
}

export function signIn() {
  if (!supabaseReady()) { announce("Sign-in is unavailable right now."); return; }
  stashReturn();
  sb.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: location.origin + location.pathname }
  }).then(function (res) {
    if (res && res.error) announce("Could not sign in: " + res.error.message);
  });
}

/* ---------- the account menu ----------
   The third overlay on this page, and built like the other two: created once,
   parented to <body> so no scroll container can clip it, positioned by placeUnder()
   rather than by arithmetic of its own, and closed by Escape or a click away. */

export var acctMenu = null;

export function closeAcctMenu() {
  if (acctMenu) acctMenu.style.display = "none";
  if (el.account) el.account.setAttribute("aria-expanded", "false");
}

export function buildAcctMenu() {
  acctMenu = document.createElement("div");
  acctMenu.className = "acct-menu";
  acctMenu.setAttribute("role", "menu");
  acctMenu.setAttribute("aria-label", "Account and settings");
  acctMenu.style.display = "none";
  acctMenu.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closeAcctMenu(); el.account.focus(); }
  });
  document.body.appendChild(acctMenu);
}

/* Rebuilt on each open rather than toggled in place: what belongs here depends on
   whether you are signed in, and on whether signing in is even possible. */
export function renderAcctMenu() {
  acctMenu.innerHTML = "";

  if (signedIn()) {
    /* Who you are, stated rather than actionable - the button that opened this shows a
       name, and a menu whose first line repeats it without saying what it is reads as
       a thing you should click. */
    var who = document.createElement("div");
    who.className = "acct-who";
    var w1 = document.createElement("span");
    w1.className = "acct-who-label";
    w1.textContent = "Signed in as";
    var w2 = document.createElement("span");
    w2.className = "acct-who-name";
    w2.textContent = accountName();
    who.appendChild(w1);
    who.appendChild(w2);
    acctMenu.appendChild(who);

    var out = document.createElement("button");
    out.type = "button";
    out.className = "acct-item";
    out.setAttribute("role", "menuitem");
    out.textContent = "Sign out";
    out.addEventListener("click", function () { closeAcctMenu(); signOut(); });
    acctMenu.appendChild(out);
    acctMenu.appendChild(document.createElement("hr"));
  }

  /* BIS DATA SOURCE, and the sublines are the point. The two sources are wildly
     asymmetric - Wowhead has every phase and all 28 specs, wowsims has Phase 4-5 for
     20 - and the bare <select> this replaces never said so, which is why choosing
     wowsims on a Phase 3 page read as broken rather than as empty. The numbers come
     from the table in CLAUDE.md section 2. */
  var head = document.createElement("div");
  head.className = "acct-section";
  head.textContent = "BiS data source";
  acctMenu.appendChild(head);

  BIS_SOURCES.forEach(function (src) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "acct-item acct-item--src";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", state.bisSource === src.id ? "true" : "false");
    b.dataset.src = src.id;

    var tick = document.createElement("span");
    tick.className = "acct-tick";
    tick.textContent = state.bisSource === src.id ? "\u2713" : "";
    var name = document.createElement("span");
    name.className = "acct-src-name";
    name.textContent = src.label;
    var note = document.createElement("span");
    note.className = "acct-src-note";
    note.textContent = src.covers;

    b.appendChild(tick);
    b.appendChild(name);
    b.appendChild(note);
    b.addEventListener("click", function () {
      state.bisSource = src.id;
      setBisSource(src.id);
      closeAcctMenu();
      update();
    });
    acctMenu.appendChild(b);
  });

  /* Signing in lives here too when it is possible, so the menu is one place rather
     than two. It is still ALSO a button on the bar - that is the call to action, and
     burying it would make the upgrade harder to find than the setting. */
  if (supabaseReady() && !signedIn()) {
    acctMenu.appendChild(document.createElement("hr"));
    var inBtn = document.createElement("button");
    inBtn.type = "button";
    inBtn.className = "acct-item";
    inBtn.setAttribute("role", "menuitem");
    inBtn.textContent = "Sign in with Discord";
    inBtn.addEventListener("click", function () { closeAcctMenu(); signIn(); });
    acctMenu.appendChild(inBtn);
  }
}

export function toggleAcctMenu() {
  if (!acctMenu) buildAcctMenu();
  if (acctMenu.style.display === "block") { closeAcctMenu(); return; }
  closePop();                       /* only one overlay at a time */
  closeOpMenu();
  renderAcctMenu();
  acctMenu.style.display = "block";
  el.account.setAttribute("aria-expanded", "true");
  placeUnder(acctMenu, el.account);
  var first = acctMenu.querySelector(".acct-item");
  if (first) first.focus();
}

export function signOut() {
  if (!supabaseReady()) return;
  closeAcctMenu();
  sb.auth.signOut().then(function () {
    /* Back to this browser's own lists. Nothing of theirs is deleted either side of
       the line: the account keeps its rows, localStorage keeps its own. */
    openTemplate(null, false);
    refreshLists();
  });
}

/* Wiring the session to the store. Runs on load and on every auth change, which is
   also how a redirect back from Discord is picked up - the SDK parses the URL,
   restores the session, and fires this. */
/* The SDK is very often not there yet when this first runs, and the reason is worth
   writing down because it looks like it should be fine.

   app.js is a classic script at the end of <body>, so it executes *during* parsing.
   The SDK is deferred, so it executes *after* parsing. app.js therefore always runs
   first, and initAuth() is called from the data-fetch .then() - which over localhost
   resolves in a couple of milliseconds, long before 212KB has arrived from a CDN.

   So checking window.supabase once and giving up means the sign-in button never
   appears at all, on exactly the machine where you would be testing it. Wait for the
   tag instead. Checking the global first matters: if the script has already run, its
   load event has already fired and will never fire again. */
export function whenSupabaseReady(cb, onFail) {
  if (window.supabase) { cb(); return; }
  var tag = document.getElementById("supabase-sdk");
  /* absent by design - jsdom, or someone stripped the tag. Not an error. */
  if (!tag) { if (onFail) onFail(); return; }
  tag.addEventListener("load", function () { if (window.supabase) cb(); else if (onFail) onFail(); });
  tag.addEventListener("error", function () {
    if (window.console) console.warn("sign-in unavailable: the Supabase SDK did not load");
    if (onFail) onFail();
  });
}

export function initAuth() {
  if (!supabaseConfigured()) return;
  /* Losing sign-in is allowed to be quiet: the button is simply absent, which says
     "no accounts here" well enough. A shared link is not, because the visitor asked
     for one specific list and would otherwise be looking at a different one with
     nothing to explain the swap. */
  whenSupabaseReady(startAuth, function () {
    if (hasShareToken()) {
      announce("That shared link could not be opened right now - try again in a moment");
      update();
    }
  });
}

export function startAuth() {
  try {
    /* PKCE puts the answer in `?code=`, where the implicit flow puts it in the hash
       fragment. This whole site drives its state from the hash, so the implicit flow
       would have us and Supabase writing to the same place on the same page load.
       Different storage, no collision, and a code in a query survives a redirect
       chain that a fragment does not. */
    setSb(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true }
    }));
  } catch (err) {
    if (window.console) console.warn("sign-in unavailable:", err.message);
    return;
  }

  sb.auth.onAuthStateChange(function (event, next) {
    var was = signedIn();
    setSession(next);
    syncStore();
    /* the lists on screen belonged to whoever was signed in a moment ago */
    if (was !== signedIn()) openTemplate(null, false);
    refreshLists();
    /* the filters you left behind, now that the round trip is over */
    if (!was && signedIn() && restoreReturn()) update();
    renderTemplateBar();
  });

  sb.auth.getSession().then(function (res) {
    setSession((res && res.data && res.data.session) || null);
    syncStore();
    refreshLists();
    renderTemplateBar();
    /* A ?s= link is resolved against Supabase, so it cannot be read at boot - the SDK
       is still arriving then. loadSharedTemplate() reports it as handled and this is
       where it actually happens. */
    if (!activeTemplate) loadSharedByToken();
  });
}
export var nameTimer = null;
export var SHARED_VALUE = "__shared__";   /* template ids are t+base36, so no collision */

/* Refreshes the dropdown's contents. Renders the bar directly and never calls
   update(), which is what calls renderTemplateBar in the first place. */
export function refreshLists() {
  return store.list().then(function (all) {
    savedLists = all;
    renderTemplateBar();
  }, function () { savedLists = []; });
}

/* The one place the view changes. Editing never survives it: a list opens for
   reading, and you say when you want to change it. */
export function openTemplate(t, mine) {
  setActive(t, mine);
  setUnsaved(false);
  state.editing = false;
  closePop();
  closeOpMenu();
  clearTimeout(nameTimer);
  if (el.tplLinkOut) el.tplLinkOut.hidden = true;
}

/* Back to no list open, which is now a real state rather than a synonym for zatar:
   the loot table with an empty priority column. */
export function closeList() { openTemplate(null, false); }

export function option(value, label) {
  var o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

export function show(node, on) {
  if (node) node.hidden = !on;
}

/* Two controls, in every state. The bar's old defect was that it reflowed: opening a
   list of your own unhid four more buttons at once and everything jumped sideways.
   Nothing here hides, so nothing moves. */
export function renderTemplateBar() {
  if (!el.listTrigger) return;

  /* No list open is a real state now, not a synonym for zatar's - the priority column
     is empty and the trigger says so rather than naming somebody. */
  el.listTriggerName.textContent =
    activeTemplate ? activeTemplate.name : "No list";

  /* Disabled, never hidden, and the title says what to do about it - a control that
     vanishes teaches nothing. Weight stays constant across both states and the button
     has a min-width, because a weight flip alone moves the row about a pixel, which
     is the same defect this whole rewrite exists to remove. */
  el.editToggle.disabled = !activeIsMine;
  el.editToggle.title = activeIsMine ? "" : "Make a copy to edit";

  el.editToggle.setAttribute("aria-pressed", state.editing ? "true" : "false");
  el.editToggle.textContent = state.editing ? "Done editing" : "Edit priorities";
  /* the fourth signal, and the only one reachable from the bottom of the table */
  show(el.editPill, state.editing);

  /* Three signals for the armed state, because a mode that changes what a click does
     should be impossible to be in without noticing: the button fills, the bar it sits
     in tints, and a line of fixed text says so. The class is what carries the second
     and, through it, the wash on the editable rows. */
  if (el.refine) el.refine.classList.toggle("is-editing", !!state.editing);
  show(el.editHint, !!state.editing);

  show(el.tplDirty, activeIsMine && unsaved);
  /* the one state where the table cannot say anything about who gets what */
  show(el.listWarn, !activeTemplate);

  /* No sign-in button at all when it could not work - an unconfigured project or a
     blocked CDN should read as "this site has no accounts", not as a broken button. */
  show(el.signIn, supabaseReady() && !signedIn());

  /* The menu is ALWAYS here, whatever Supabase is doing, because it holds a setting
     that has nothing to do with accounts: which BiS data the rings come from. It is
     per-browser, deliberately out of the url, and set about once - and CLAUDE.md is
     explicit that signed out is the whole product rather than a trial, so a preference
     that lives only behind a login has nowhere to live for exactly the people the site
     is for. Signed in it is the account button and says your name; otherwise it says
     Settings and holds the source alone. One mechanism either way. */
  show(el.account, true);

  if (signedIn()) {
    if (el.accountName) el.accountName.textContent = accountName();
    renderAvatar();
  } else if (el.accountName) {
    /* Signed out it is a settings button and nothing more. The avatar has to be taken
       off by hand: renderAvatar() adds an <img> that no re-render removes. */
    el.accountName.textContent = "Settings";
    var stale = el.account.querySelector(".account-avatar");
    if (stale) stale.remove();
  }

  if (listMenu && listMenu.style.display === "block") renderListMenu();
}

/* ---------- the option menus ----------
   A native <select>'s popup is drawn by the operating system, not the page: its
   background, its highlight and its font are all unreachable from CSS. So Slot and
   Type looked like macOS while every other menu on the page looked like this site.
   The only way to match is to draw the list ourselves.

   The <select> stays and remains the source of truth - it is what app.js reads, what
   fillSelect() rebuilds, and what the tests drive. This is a skin over it, so if the
   enhancement ever fails to build, the field is still a working select rather than
   nothing at all: the native one is only hidden once its trigger exists.

   Fifth overlay, same shell and the same placeUnder() as the other four. */

export var optMenu = null;
export var optFor = null;          /* the <select> the open menu belongs to */

export function closeOptMenu() {
  if (optMenu) optMenu.style.display = "none";
  if (optFor && optFor.trigger) optFor.trigger.setAttribute("aria-expanded", "false");
  optFor = null;
}

export function buildOptMenu() {
  optMenu = document.createElement("div");
  optMenu.className = "list-menu opt-menu";
  optMenu.setAttribute("role", "listbox");
  optMenu.style.display = "none";
  document.body.appendChild(optMenu);
}

export function optItems() {
  return [].slice.call(optMenu.querySelectorAll(".opt-item"));
}

/* Arrow keys, Home/End, Enter and Escape - everything the native control gave away
   for free and has to be paid back by hand. */
export function optKeydown(e) {
  var items = optItems();
  var at = items.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); var t = optFor.trigger; closeOptMenu(); t.focus(); return; }
  if (e.key === "ArrowDown") { e.preventDefault(); (items[at + 1] || items[0]).focus(); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); (items[at - 1] || items[items.length - 1]).focus(); return; }
  if (e.key === "Home") { e.preventDefault(); items[0].focus(); return; }
  if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
}

export function openOptMenu(sel) {
  if (!optMenu) { buildOptMenu(); optMenu.addEventListener("keydown", optKeydown); }
  if (optFor === sel) { closeOptMenu(); return; }
  closePop();
  closeOpMenu();
  closeAcctMenu();
  closeListMenu();
  optFor = sel;
  optMenu.innerHTML = "";

  [].forEach.call(sel.options, function (o) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "opt-item" + (o.value === sel.value ? " opt-item--current" : "");
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", o.value === sel.value ? "true" : "false");

    var tick = document.createElement("span");
    tick.className = "lm-tick";
    tick.textContent = o.value === sel.value ? "\u2713" : "";
    tick.setAttribute("aria-hidden", "true");
    var name = document.createElement("span");
    name.className = "opt-item-name";
    name.textContent = o.textContent;
    b.appendChild(tick);
    b.appendChild(name);

    b.addEventListener("click", function () {
      sel.value = o.value;
      closeOptMenu();
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      sel.trigger.focus();
    });
    optMenu.appendChild(b);
  });

  optMenu.style.display = "block";
  sel.trigger.setAttribute("aria-expanded", "true");
  placeUnder(optMenu, sel.trigger);
  var current = optMenu.querySelector(".opt-item--current") || optMenu.querySelector(".opt-item");
  if (current) current.focus();
}

/* The trigger shows whatever the select currently says, so everything that already
   rebuilds the options - fillSelect(), the url, Reset - keeps working untouched. */
export function syncOptTrigger(sel) {
  if (!sel || !sel.trigger) return;
  var o = sel.options[sel.selectedIndex];
  sel.trigger.querySelector(".opt-trigger-name").textContent = o ? o.textContent : "";
}

export function enhanceSelect(sel, label) {
  if (!sel || !sel.parentNode) return;
  var b = document.createElement("button");
  b.type = "button";
  b.className = "opt-trigger";
  b.setAttribute("aria-haspopup", "listbox");
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-label", label);
  b.innerHTML = '<span class="opt-trigger-name"></span>' +
                '<span class="opt-trigger-caret" aria-hidden="true">&#9662;</span>';
  b.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
  b.addEventListener("click", function (ev) { ev.stopPropagation(); openOptMenu(sel); });

  sel.trigger = b;
  sel.parentNode.insertBefore(b, sel);
  /* only now is the native one redundant - if any of the above had thrown, the field
     would still be a working select */
  sel.parentNode.classList.add("field--enhanced");
  syncOptTrigger(sel);
}

/* ---------- the list menu ----------
   The third overlay built on the same machinery as .prio-pop and .prio-menu: created
   once, parented to <body> so no scroll container can clip it, positioned by
   placeUnder() rather than by arithmetic of its own, closed by Escape or a click
   away. docs/edit-mode-plan.md extracted placeUnder() precisely so overlays could not
   drift into two versions of the same sum; this must not become the version that does.

   It has three faces - the list, the rename field, the delete confirm - because a
   panel that swaps in place keeps one Escape target and one anchor. */

export var listMenu = null;
export var menuFace = "list";      /* "list" | "rename" | "delete" */

export function closeListMenu() {
  if (listMenu) listMenu.style.display = "none";
  menuFace = "list";
  if (el.listTrigger) el.listTrigger.setAttribute("aria-expanded", "false");
}

export function buildListMenu() {
  listMenu = document.createElement("div");
  listMenu.className = "list-menu";
  listMenu.setAttribute("role", "menu");
  listMenu.setAttribute("aria-label", "Lists");
  listMenu.style.display = "none";

  /* One level at a time: Escape out of rename or delete returns to the list, and only
     Escape from the list closes the menu. A mistyped rename should not cost you the
     menu as well. */
  listMenu.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (menuFace !== "list") { menuFace = "list"; renderListMenu(); return; }
    closeListMenu();
    el.listTrigger.focus();
  });

  document.body.appendChild(listMenu);
}

export function menuSection(title) {
  var h = document.createElement("div");
  h.className = "lm-section";
  h.textContent = title;
  return h;
}

export function menuItem(label, cls, onClick) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "lm-item" + (cls ? " " + cls : "");
  b.setAttribute("role", "menuitem");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/* A list row: the name, what it holds, and a tick on the one you are reading. The
   count is what confirms you picked the right list - the same argument that keeps
   counts on the boss chips. */
export function listRow(name, count, current, byline, onClick) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "lm-row" + (current ? " lm-row--current" : "");
  b.setAttribute("role", "menuitemradio");
  b.setAttribute("aria-checked", current ? "true" : "false");

  var tick = document.createElement("span");
  tick.className = "lm-tick";
  tick.textContent = current ? "\u2713" : "";
  tick.setAttribute("aria-hidden", "true");

  var main = document.createElement("span");
  main.className = "lm-row-main";
  var n = document.createElement("span");
  n.className = "lm-row-name";
  n.textContent = name;
  main.appendChild(n);
  if (byline) {
    var by = document.createElement("span");
    by.className = "lm-row-by";
    by.textContent = byline;
    main.appendChild(by);
  }

  var c = document.createElement("span");
  c.className = "lm-row-count";
  /* "ranked", not "items": every list holds all 195 records, so an item count is the
     same number on every row. This is the one that differs. */
  c.textContent = count == null ? "" : count + " ranked";

  b.appendChild(tick);
  b.appendChild(main);
  b.appendChild(c);
  b.addEventListener("click", onClick);
  return b;
}

export function renderListMenu() {
  if (menuFace === "rename") return renderRenamePanel();
  if (menuFace === "delete") return renderDeletePanel();

  listMenu.innerHTML = "";

  if (savedLists.length) {
    listMenu.appendChild(menuSection("Your lists"));
    savedLists.forEach(function (t) {
      /* the open list is the one being edited, so take its count live rather than
         from the cache, which is only as fresh as the last write */
      var n = (activeIsMine && activeTemplate && activeTemplate.id === t.id)
        ? filledCount(activeTemplate.priorities) : t.filled;
      listMenu.appendChild(listRow(
        /* no byline under Your lists - it would be your own name on every row, which
           says nothing. Whose a list is only becomes a question once it is someone
           else's, and that is the Following section below. */
        t.name, n,
        activeIsMine && activeTemplate && activeTemplate.id === t.id, "",
        function () { closeListMenu(); openById(t.id); }));
    });
  }

  /* The lists that ship with the site, for the phase on screen. zatar used to be
     hardcoded here as THE thing you were following when no template was open; he is one
     entry in data/lists/index.json now, and a phase with no bundled list simply shows
     no rows here. */
  var bundled = ootbForPhase();
  if (bundled.length) {
    listMenu.appendChild(menuSection("Starting points"));
    bundled.forEach(function (entry) {
      var loaded = ootbCache[entry.id];
      listMenu.appendChild(listRow(
        entry.name,
        loaded ? filledCount(loaded.priorities) : null,
        !!(activeTemplate && activeTemplate.id === entry.id),
        entry.author ? "by " + entry.author : "",
        function () { closeListMenu(); openOotb(entry); }));
    });
  }

  /* a list that arrived on a link is not in the store, so it needs a row of its own or
     the menu would claim a bundled list was the one on screen.

     This is where the credit CLAUDE.md section 8 promised actually lands: someone opens
     your link and the menu says whose calls they are reading. Only where the server
     attested it - see attestedAuthor(). Where it did not, the row falls back to saying
     how the list arrived rather than claiming a name nobody checked. */
  var isBundled = activeTemplate && OOTB.some(function (e) { return e.id === activeTemplate.id; });
  if (activeTemplate && !activeIsMine && !isBundled) {
    listMenu.appendChild(menuSection("Following"));
    var who = attestedAuthor(activeTemplate);
    listMenu.appendChild(listRow(activeTemplate.name, filledCount(activeTemplate.priorities),
      true, who ? "by " + who : "shared with you",
      function () { closeListMenu(); }));
  }

  listMenu.appendChild(document.createElement("hr"));
  listMenu.appendChild(menuItem("+  New list", "lm-item--new", function () {
    closeListMenu();
    startList(newBlankTemplate(),
              "Seeded from BiS, all equal - drag each line to put it in order");
  }));

  listMenu.appendChild(document.createElement("hr"));
  listMenu.appendChild(menuSection(activeIsMine ? "This list" :
    activeTemplate ? activeTemplate.name : "No list open"));

  /* Said once, plainly, instead of silently offering fewer buttons and leaving the
     reader to notice what is missing. */
  if (!activeIsMine) {
    var note = document.createElement("p");
    note.className = "lm-note";
    /* The no-list case is said on the bar now (#list-warn), not in here: a warning you
       have to open a menu to find is not doing the job. */
    note.textContent = "You're reading this list. Make a copy to change anything.";
    if (activeTemplate) listMenu.appendChild(note);
  }

  if (activeIsMine) {
    listMenu.appendChild(menuItem("Rename\u2026", "", function () {
      menuFace = "rename"; renderListMenu();
    }));
  }
  listMenu.appendChild(menuItem("Make a copy", "", function () {
    closeListMenu();
    var from = activeTemplate ? activeTemplate.name : "the loot table";
    startList(copyOfCurrent("Copy of " + from), "Copied " + from);
  }));
  /* Nothing about sharing lives here any more. It has its own control on the bar and
     its own popover, because an item four deep in a dropdown is not something people
     find - and Stop sharing belongs next to the link it stops, not next to Delete. */

  if (activeIsMine) {
    listMenu.appendChild(document.createElement("hr"));
    listMenu.appendChild(menuItem("Delete list\u2026", "lm-item--danger", function () {
      menuFace = "delete"; renderListMenu();
    }));
  }
}

export function renderRenamePanel() {
  listMenu.innerHTML = "";
  listMenu.appendChild(menuSection("Rename list"));

  var field = document.createElement("input");
  field.type = "text";
  field.className = "lm-field";
  field.value = activeTemplate ? activeTemplate.name : "";
  field.setAttribute("aria-label", "List name");
  listMenu.appendChild(field);

  var row = document.createElement("div");
  row.className = "lm-actions";
  row.appendChild(menuItem("Cancel", "", function () { menuFace = "list"; renderListMenu(); }));

  var save = menuItem("Save", "lm-item--primary", function () { commitRename(field.value); });
  row.appendChild(save);
  listMenu.appendChild(row);

  field.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(field.value); }
  });
  field.focus();
  field.select();
  placeUnder(listMenu, el.listTrigger);
}

/* The same path the old name field's blur used, so the dirty marker and the store
   write are unchanged - this is a bar rewrite, not a model change. */
export function commitRename(name) {
  if (!activeIsMine) return;
  var next = (name || "").trim();
  if (!next) { announce("A list needs a name"); return; }
  activeTemplate.name = next;
  setUnsaved(true);
  closeListMenu();
  announce("Renamed to " + next);
  update();
  saveNow().then(refreshLists);
}

export function renderDeletePanel() {
  listMenu.innerHTML = "";
  listMenu.appendChild(menuSection("Delete list"));

  var p = document.createElement("p");
  p.className = "lm-note";
  var n = filledCount(activeTemplate.priorities);
  p.textContent = "Delete \u201c" + activeTemplate.name + "\u201d and the " + n +
    (n === 1 ? " item" : " items") + " you have ranked? Anyone you sent the link to will lose it.";
  listMenu.appendChild(p);

  var row = document.createElement("div");
  row.className = "lm-actions";
  /* The safe one sits where the cursor already is - under the row that was just
     clicked - and carries the weight; the destructive one is quiet and off to the
     right, so it has to be aimed at. The old bar armed the same button in place,
     which meant a double-click destroyed a list. */
  row.appendChild(menuItem("Keep it", "lm-item--primary", function () {
    menuFace = "list"; renderListMenu();
  }));
  row.appendChild(menuItem("Delete", "lm-item--danger", doDelete));
  listMenu.appendChild(row);
  placeUnder(listMenu, el.listTrigger);
}

export function doDelete() {
  if (!activeIsMine) return;
  var doomed = activeTemplate;
  closeListMenu();
  store.remove(doomed.id).then(function () {
    closeList();
    update();
    refreshLists();
    /* An undo is worth more than any confirm, which is why the confirm above can stay
       light. The record is held in memory until the toast clears. */
    announce("Deleted " + doomed.name, function () {
      store.save(doomed).then(function () {
        openTemplate(doomed, true);
        announce("Restored " + doomed.name);
        update();
        refreshLists();
      });
    });
  });
}

export function toggleListMenu() {
  if (!listMenu) buildListMenu();
  if (listMenu.style.display === "block") { closeListMenu(); return; }
  closePop();
  closeOpMenu();
  closeAcctMenu();
  menuFace = "list";
  listMenu.style.display = "block";
  el.listTrigger.setAttribute("aria-expanded", "true");
  renderListMenu();
  placeUnder(listMenu, el.listTrigger);
}

export function openById(id) {
  store.load(id).then(function (t) {
    var why = t ? validateTemplate(t) : "it is not there any more";
    if (why) { announce("That list will not open: " + why); renderTemplateBar(); return; }
    openTemplate(t, true);
    announce("Opened " + t.name);
    update();
  });
}

/* Would pressing Share PUBLISH something, or is there already a link to hand over?
   The popover asks this to decide which face to open on, and the answer is also what
   stops it publishing as a side effect of being looked at. */
/* The publish face is for a list with nothing to hand out yet. That is now two
   conditions rather than one: never shared, or shared but never published - the
   second is what a list looks like between minting a link and deciding the draft is
   ready, and its link resolves to nothing until it is. */
export function shareWouldPublish() {
  return !!(activeTemplate && activeIsMine && signedIn() && supabaseReady()
            && (!activeTemplate.shared || !activeTemplate.published_at));
}

/* The link for whatever is on screen, as a promise. Three cases, and the third used to
   be a silent no-op: copyShareLink() opened with `if (!activeTemplate) return;`, so on
   zatar's list the menu offered Copy link, you pressed it, and nothing happened at all -
   no clipboard write, no message, no error. That is the first share control most people
   ever meet, since it is what you see before you have made a list of your own. */
export function shareLink() {
  /* Nobody's list: the page itself, filters and all. location.hash already carries
     phase, zone, boss, class, spec and the search - "here is what I am looking at" is
     a real thing to send someone, and it is what the dead item was pretending to do. */
  /* No list, or one that ships with the site: the page URL says it all. The hash
     carries the phase, the filters and now list=, so the recipient opens exactly what
     is on screen - and encoding a bundled list into #t= would send someone a 5,700
     character copy of a list they already have. */
  if (!activeTemplate || OOTB.some(function (e) { return e.id === activeTemplate.id; })) {
    return Promise.resolve(location.origin + location.pathname + location.hash);
  }
  var server = shareServerSide();
  if (server) return server.then(function (url) { refreshLists(); return url; });
  /* Signed out there is nothing in the database to point at, so the whole list travels
     in the link exactly as it always has. It is capped and frozen, and that is the
     honest trade for a site that has to work without a backend. */
  return encodeTemplate(activeTemplate).then(function (code) {
    return location.origin + location.pathname + "#t=" + code;
  });
}

/* What the link DOES, which differs by how it was made. Said next to the link rather
   than only in a toast, because it is the thing a person needs before sending it. */
export function shareBlurb(url) {
  if (!activeTemplate) return "Opens the page on the phase, zone and filters you have set.";
  if (url.indexOf("?s=") !== -1) {
    return "Anyone with this link can read the list, and sees your edits as you make them.";
  }
  return "This link carries the whole list, frozen as it is now - " +
         url.length + " characters, so it may be too long for some chat apps.";
}

export function copyToClipboard(url) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(url).then(
      function () { announce("Link copied"); },
      function () { announce("Could not reach the clipboard - copy it from the box"); });
  }
  announce("Copy the link from the box");
  return Promise.resolve();
}

/* New and Make a copy differ only in what they seed. Both write the list at once,
   so it is in the dropdown from birth and there is nothing to forget to press. */
export function startList(t, said) {
  openTemplate(t, true);
  state.editing = true;      /* you made it in order to change it */
  announce(said);
  update();
  saveNow().then(refreshLists);
}

export function bindTemplateBar() {
  if (!el.listTrigger) return;

  /* Both halves of the gesture have to be kept off the document handler, or the
     trigger's own mousedown closes the menu and its click reopens it - which looks
     like the menu ignoring every second press. */
  el.listTrigger.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });

  if (el.editPill) {
    el.editPill.addEventListener("click", function () {
      state.editing = false;
      update();
    });
  }

  if (el.shareTrigger) {
    /* both halves, for the same reason the list trigger does it: without the mousedown
       guard the document handler closes the popover and the click reopens it */
    el.shareTrigger.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    el.shareTrigger.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleSharePop();
    });
  }
  el.listTrigger.addEventListener("click", function (ev) {
    ev.stopPropagation();
    toggleListMenu();
  });

  if (el.signIn) el.signIn.addEventListener("click", signIn);
  if (el.account) el.account.addEventListener("click", function (ev) {
    ev.stopPropagation();
    toggleAcctMenu();
  });

  el.editToggle.addEventListener("click", function () {
    if (!activeIsMine) return;
    state.editing = !state.editing;
    if (!state.editing) { closePop(); closeOpMenu(); }
    announce("");
    update();
  });
}
