/* Preferences, the two stores (local and remote), and the account behind the remote one. */
import { REG } from "./registry.js";
import { el, sb, session, state } from "./state.js";

/* ---------- template storage ----------
   Async on purpose even though localStorage is synchronous: the Azure
   implementation that arrives with login is then a drop-in, not a refactor of
   every call site. */

export var STORE_KEY = "lootprio.templates";
export var SMART_KEY = "lootprio.smartFilter";
export var BIS_SOURCE_KEY = "lootprio.bisSource";
export var META_KEY = "lootprio.metaOnly";

/* Where the BiS rings come from. A preference about how you read the page rather than
   a filter on it, so it lives in this browser and NOT in the url: a link you send
   should not silently change somebody else's source out from under them.

   Wowhead is the default because it is the only source that is complete - all five
   phases, all 28 specs. See BIS_SOURCES for what the others hold. */
export var BIS_SOURCES = [
  { id: "wowhead", label: "Wowhead", covers: "all 28 specs, every phase" },
  { id: "wowsims", label: "WoWSims presets", covers: "20 specs, Phase 4-5 only" },
  /* Reserved. Choosing it shows no rings at all, which is the honest rendering of
     "you have not supplied any BiS data yet" - the alternative is a menu entry that
     silently does nothing, which reads as broken rather than as unbuilt. */
  { id: "custom", label: "Custom", covers: "not set up yet - no rings" }
];

export function bisSource() {
  try {
    var v = window.localStorage.getItem(BIS_SOURCE_KEY);
    return BIS_SOURCES.some(function (s) { return s.id === v; }) ? v : "wowhead";
  } catch (e) { return "wowhead"; }
}

export function setBisSource(id) {
  try { window.localStorage.setItem(BIS_SOURCE_KEY, id); }
  catch (e) { /* private browsing: the session still works, it just won't persist */ }
}

/* Smart filtering narrows the add popover to specs the item suits. On by default:
   most of the time the full 37 is noise, and the few real exceptions are reached
   by turning it off rather than by never filtering. */
export function smartFilter() {
  try { return window.localStorage.getItem(SMART_KEY) !== "off"; }
  catch (e) { return true; }
}

export function setSmartFilter(on) {
  try { window.localStorage.setItem(SMART_KEY, on ? "on" : "off"); }
  catch (e) { /* private browsing: the session still works, it just won't persist */ }
}

/* Hides the specs nobody brings - "meta": false in specs.json, seven of the 28. A raid
   leader gearing a real roster is never going to rank Frost Mage, and with no list open
   the BiS view was drawing up to eleven icons on a row.

   Same kind of preference as bisSource, and stored the same way for the same reason: it
   is about how YOU read the page, so it lives in this browser and NOT in the url. A link
   you send must not quietly hide specs from somebody else.

   On by default, which is the one thing here that hides data without being asked. That is
   deliberate and the safeguards are in visiblePriority(): a class entry is never dropped,
   a spec you have explicitly selected is never dropped, and the editor never sees any of
   it. */
export function metaOnly() {
  try { return window.localStorage.getItem(META_KEY) !== "off"; }
  catch (e) { return true; }
}

export function setMetaOnly(on) {
  try { window.localStorage.setItem(META_KEY, on ? "on" : "off"); }
  catch (e) { /* private browsing: the session still works, it just won't persist */ }
}

/* Absent means meta, so the 21 that are stay untouched in specs.json - the exception is
   marked, not the rule, the way `unique` is in loot_data.json. An unknown id is meta:
   specs.json fails soft everywhere else here, and a renamed spec must cost this filter
   rather than the page. */
export function isMeta(specId) {
  var spec = REG.specs[specId];
  return !spec || spec.meta !== false;
}

/* Everything that decides whether a spec is currently showable goes through here, so the
   chip row, both priority columns and the rings cannot drift apart.

   A spec you have SELECTED is always showable: otherwise picking Frost Mage from the chip
   row would narrow the table and then show you nothing, which reads as broken. */
export function showsSpec(specId) {
  if (!metaOnly()) return true;
  if (state.specs.indexOf(specId) !== -1) return true;
  return isMeta(specId);
}

/* How much of a list actually says something. Every list holds all 195 records - a
   template is a full copy, not a diff - so "195 items" was true of every one of them
   and told you nothing. What separates them is how many carry a priority. */
export function filledCount(priorities) {
  if (!priorities) return 0;
  var n = 0;
  Object.keys(priorities).forEach(function (id) {
    if ((priorities[id] || []).length) n++;
  });
  return n;
}

export var localStore = {
  read: function () {
    try {
      return JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}");
    } catch (e) {
      if (window.console) console.warn("saved templates unreadable:", e.message);
      return {};
    }
  },
  write: function (all) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
  },
  list: function () {
    var all = this.read();
    return Promise.resolve(Object.keys(all).map(function (id) {
      return {
        id: id, name: all[id].name, created: all[id].created,
        filled: filledCount(all[id].priorities)
      };
    }));
  },
  load: function (id) {
    return Promise.resolve(this.read()[id] || null);
  },
  save: function (t) {
    var all = this.read();
    all[t.id] = t;
    try {
      this.write(all);
    } catch (e) {
      /* quota is the realistic failure: ~400 templates fit, but say so plainly */
      return Promise.reject(new Error("Could not save: " + e.message));
    }
    return Promise.resolve(t);
  },
  remove: function (id) {
    var all = this.read();
    delete all[id];
    this.write(all);
    return Promise.resolve();
  }
};

/* ---------- the account, and the store behind it ----------

   Signed out is the full product: make lists, edit them, share them by link, all of
   it kept in localStorage. Signing in is an upgrade - your lists follow you between
   machines instead of being trapped in one browser - and never a gate. Friends
   arriving to try the editor should never meet a login wall first.

   Everything here fails soft, the same way specs.json and bis.json do. No config, a
   blocked CDN, a paused project: you lose sign-in, not the page. That is why
   supabaseReady() is checked at every entry point rather than assumed once. */

/* Filled in once the Supabase project exists. The anon key is *designed* to be
   public and belongs in this file: it identifies the project, it does not authorise
   anything. Row-level security is what actually protects a list - a policy of
   `auth.uid() = user_id` means the database itself refuses to hand your rows to
   anyone else, no matter what the client asks for.

   The service-role key is the one that bypasses those policies. It must never appear
   in this repo, in this file, or in any client. */
/* Empty is still a supported state, not a broken one - see docs/login-setup.md. No
   config means no sign-in button and a site that behaves exactly as it did before
   login existed, which is what every test in this repo except test/auth.mjs runs as.

   The publishable key is safe here on one condition, which Supabase states on the
   page it is copied from: RLS is enabled on `lists` and a policy is configured. That
   policy is the only thing standing between this key and every list in the table. */
export var SUPABASE_URL = "https://korqkbphefucdqwxezso.supabase.co";
export var SUPABASE_ANON_KEY = "sb_publishable_JYJyZ_R_0a5_igZkGnY3Vw_S6B9pHrL";

export function supabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/* The SDK is a hotlinked CDN script, like Wowhead's tooltips.js, so it can simply be
   absent - offline, blocked, or in jsdom, which is how the tests run. */
export function supabaseReady() {
  return !!(sb && supabaseConfigured());
}

export function signedIn() {
  return !!(session && session.user);
}

/* The Discord display name, for the bar. Falls back through what Discord actually
   sends before giving up on a label rather than rendering "undefined". */
/* The one image on this page that does not come from wow.zamimg.com, and the only
   one whose URL is chosen by someone else. Built here rather than sitting empty in
   the markup - an <img> with no src is a request for the page itself in some
   browsers - and it removes itself if Discord's CDN will not serve it, leaving the
   name, which was always the part that mattered. */
export function renderAvatar() {
  var have = el.account && el.account.querySelector(".account-avatar");
  var url = accountAvatar();
  if (!url) { if (have) have.remove(); return; }
  if (have && have.getAttribute("src") === url) return;
  if (have) have.remove();
  var img = document.createElement("img");
  img.className = "account-avatar";
  img.alt = "";
  img.setAttribute("onerror", "this.remove()");
  img.src = url;
  el.account.insertBefore(img, el.account.firstChild);
}

export function accountAvatar() {
  if (!signedIn()) return "";
  var m = session.user.user_metadata || {};
  return m.avatar_url || m.picture || "";
}

export function accountName() {
  if (!signedIn()) return "";
  var m = session.user.user_metadata || {};
  return m.full_name || m.name || m.user_name || m.preferred_username ||
         session.user.email || "Signed in";
}

/* One row of the `lists` table is one template. The column names match the template
   shape validateTemplate() already enforces, so nothing about the format changes and
   a list is byte-identical whether it came from here or from localStorage. */
export function rowToTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    created: row.created,
    v: row.v,
    base: row.base,
    priorities: row.priorities,
    /* both default rather than being required: a row written before these columns
       existed returns null, and absent notes already means "the guide's" */
    notes: row.notes || {},
    author: row.author || "",
    /* carried so the menu knows whether to offer Stop sharing, and so a second
       Copy link reuses the token the first one minted rather than orphaning it */
    share_token: row.share_token || null,
    shared: !!row.shared,
    /* The version this copy was read at. Every save is conditional on it, so a
       second person's write cannot be silently overwritten by a stale first. */
    updated_at: row.updated_at || null,
    /* What the share link is currently handing out. Carried so the owner can be
       told how far the draft has moved from it; recipients never see these,
       because get_shared_list returns the published columns AS priorities. */
    published_priorities: row.published_priorities || null,
    published_notes: row.published_notes || null,
    published_at: row.published_at || null
  };
}

/* The same four methods as localStore, same promises, same meanings - which is the
   whole reason edit mode was built against an async store before login existed.
   Nothing that calls these learns which one it is talking to. */
export var remoteStore = {
  /* `priorities` is the heavy column and this pulls it for every list, only to count
     the non-empty entries. It is fine at the scale this runs at - a person has a
     handful of lists, each ~12KB - and it keeps the count honest without a schema
     change. If someone ever has dozens, the fix is a generated column in Postgres
     holding the count, not a lighter select here: the number has to come from the
     priorities either way, and the database can compute it once per write instead of
     the client computing it once per read. */
  list: function () {
    return sb.from("lists").select("id,name,created,priorities,shared")
      .order("updated_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return (res.data || []).map(function (r) {
          return { id: r.id, name: r.name, created: r.created,
                   filled: filledCount(r.priorities), shared: !!r.shared };
        });
      });
  },
  load: function (id) {
    return sb.from("lists").select("*").eq("id", id).maybeSingle()
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        /* a missing id is null, not an error - same as localStore */
        return res.data ? rowToTemplate(res.data) : null;
      });
  },
  save: function (t) {
    /* user_id is left to the column default (auth.uid()); sending it from the client
       would be a claim the database has to check anyway, and the RLS policy is the
       thing that decides. */
    /* Every field the template carries has to be named here. An upsert silently
       drops what it does not mention, so a column missing from this object is not an
       error anywhere - it is a field that saves, appears to work, and is gone on the
       next load. `notes` was exactly that between Aug 2026 and this fix: editable
       notes worked signed out, where localStore writes the whole blob, and vanished
       signed in. */
    var stamp = new Date().toISOString();
    var row = {
      id: t.id,
      name: t.name,
      created: t.created,
      v: t.v,
      base: t.base,
      priorities: t.priorities,
      notes: t.notes || {},
      author: t.author || null,
      share_token: t.share_token || null,
      shared: !!t.shared,
      published_priorities: t.published_priorities || null,
      published_notes: t.published_notes || null,
      published_at: t.published_at || null,
      updated_at: stamp
    };

    function took(res) {
      if (res.error) throw new Error("Could not save: " + res.error.message);
      /* the write is the new baseline, so the next save is guarded against this one */
      t.updated_at = stamp;
      return t;
    }

    /* A list this browser has never read back has no version to guard against, so it
       is an insert. Everything else is conditional. */
    if (!t.updated_at) {
      return sb.from("lists").upsert(row).then(took);
    }

    /* THE GUARD. A blind upsert sends this browser's whole ~21KB copy of the list, so
       two people editing one list meant the second save silently erased the first -
       no error, nothing on screen, found out days later if ever. Matching on the
       updated_at we read means the write only lands if nobody else has written since.
       Zero rows back is not an error from Postgres, so it has to be checked for. */
    return sb.from("lists").update(row)
      .eq("id", t.id).eq("updated_at", t.updated_at).select("id")
      .then(function (res) {
        if (res.error) throw new Error("Could not save: " + res.error.message);
        if (!res.data || !res.data.length) {
          var stale = new Error("This list changed somewhere else while you were editing");
          stale.stale = true;      /* distinguishable, so saveNow can offer a reload */
          throw stale;
        }
        return took(res);
      });
  },
  remove: function (id) {
    return sb.from("lists").delete().eq("id", id).then(function (res) {
      if (res.error) throw new Error(res.error.message);
    });
  }
};

/* The single swap point the whole design turned on. Signed in reads and writes the
   account; signed out reads and writes this browser. */
export function activeStore() {
  return signedIn() && supabaseReady() ? remoteStore : localStore;
}

export var store = localStore;

/* Kept in step with the session rather than resolved at each call site, so `store`
   stays the plain object every existing caller already holds. */
export function syncStore() {
  store = activeStore();
}
