/* Signing in, and the store behind it.
 *
 * Two things are being pinned here, and the second matters more than the first.
 *
 * 1. Signed out is the whole product. No config, a blocked CDN, an offline machine -
 *    the page works exactly as it always has and keeps lists in this browser. jsdom is
 *    itself the "SDK absent" case, so every other test file is already asserting this
 *    by simply passing.
 *
 * 2. remoteStore and localStore are the same contract. The editor was built against an
 *    async store *before* login existed precisely so that login would be a swap and not
 *    a refactor - so the two are tested against one shared list of assertions rather
 *    than separately, because "the same contract" is the property that has to hold.
 *
 * The OAuth redirect itself cannot happen in jsdom. It is verified by hand, like the
 * drag gesture.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { until, sleep } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");
/* the lists that ship with the site - without these the page boots with no
   starting points, and the priority column is empty on every row */
const listIndex = JSON.parse(fs.readFileSync(path.join(root, "data", "lists", "index.json"), "utf8"));
const zatarList = JSON.parse(fs.readFileSync(path.join(root, "data", "lists", "zatar-p3.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

/* What get_shared_list actually returns. Kept beside the fake and pinned against the
   migration, so the two cannot drift. */
const RPC_COLUMNS = ["id", "name", "created", "v", "base", "priorities", "notes", "author"];

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
/* Given a condition, waits only until it holds; given nothing, falls back to the old
   flat nap. Every remaining bare settle() is one where there is nothing to poll for. */
const settle = (cond) => (cond ? until(cond) : sleep(400));

/* ---------- a fake Supabase ----------
   Only the surface app.js actually uses. Deliberately not a mock that records calls:
   it is a working in-memory table, so the assertions below are about behaviour that
   round-trips rather than about which methods were invoked. */
function fakeSupabase() {
  const rows = new Map();
  let session = null;
  const listeners = [];

  const result = (v) => Promise.resolve({ data: v, error: null });

  /* eq() keeps every condition rather than collapsing them onto the id. The guarded
     save is .update().eq("id").eq("updated_at"), and a fake that ignored the second
     one would match every time - which is precisely the bug being guarded against. */
  function from() {
    const q = { _eq: {}, _single: false };
    q.select = () => q;
    q.order = () => q;
    q.eq = (col, v) => { q._eq[col] = v; return q; };
    q.maybeSingle = () => { q._single = true; return q; };
    q.upsert = (row) => { rows.set(row.id, row); return result(row); };
    q.update = (row) => { q._update = row; return q; };
    q.delete = () => { q._del = true; return q; };
    const hits = () => [...rows.values()].filter((r) =>
      Object.entries(q._eq).every(([c, v]) => r[c] === v));
    q.then = (res, rej) => {
      if (q._del) { rows.delete(q._eq.id); return result(null).then(res, rej); }
      if (q._update) {
        /* Postgres updates the rows the WHERE matched, and reports how many. Zero is
           not an error - it is the answer, and the client has to notice it. */
        const matched = hits();
        matched.forEach((r) => rows.set(r.id, Object.assign({}, r, q._update)));
        return result(matched.map((r) => ({ id: r.id }))).then(res, rej);
      }
      if (q._single) return result(rows.get(q._eq.id) || null).then(res, rej);
      return result([...rows.values()]).then(res, rej);
    };
    return q;
  }

  return {
    _rows: rows,
    from,
    /* The real one is a security-definer function: the lists table stays unreadable to
       an anonymous caller, and this can only ever return a row that is both flagged
       shared and matched by an exact token. The fake enforces the same two conditions,
       because a fake that is laxer than the thing it stands for tests nothing. */
    rpc: (name, args) => {
      if (name !== "get_shared_list") return Promise.resolve({ data: null, error: { message: "no such function" } });
      /* Three conditions now, matching verify/draft-publish.sql: flagged shared, exact
         token, AND published. A list nobody has published has no version to hand out,
         which is what "locked until we are happy" actually means. */
      const hit = [...rows.values()].find((r) => r.shared === true &&
        r.share_token === args.token && r.published_at);
      /* PROJECTED, not returned whole. The real function names its columns, so a field
         the client writes but the SQL never selects arrives as undefined - which is
         exactly how notes shipped broken: saved, apparently fine, absent on every read.
         A fake that hands back the whole row cannot reproduce that. RPC_COLUMNS is
         checked against verify/notes-and-author.sql below. */
      /* The SQL selects published_priorities AS priorities. A fake that served the live
         draft here would pass every assertion below while the real thing served the
         snapshot - the two would differ precisely where it matters. */
      const served = hit && Object.assign({}, hit, {
        priorities: hit.published_priorities,
        notes: hit.published_notes
      });
      return Promise.resolve({
        data: served ? [Object.fromEntries(RPC_COLUMNS.map((c) => [c, served[c]]))] : [],
        error: null
      });
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: {} } }; },
      signInWithOAuth: () => Promise.resolve({ error: null }),
      signOut: () => { session = null; listeners.forEach((f) => f("SIGNED_OUT", null)); return Promise.resolve({}); },
      /* the test's lever: what the redirect back from Discord would have caused */
      _signIn: (name) => {
        session = { user: { id: "u1", user_metadata: { full_name: name || "Testy" } } };
        listeners.forEach((f) => f("SIGNED_IN", session));
        return session;
      }
    }
  };
}

/* `configured` decides whether the page believes it has a project to talk to. The keys
   are consts inside the IIFE, which is the right place for them - so the test edits the
   source rather than app.js growing a hook that exists only for tests. */
function boot({ configured = false, sdk = null, url = "" } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://x.test/loot-prio/" + url });
  const { window } = dom;
  Object.assign(window, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response });
  window.fetch = (u) => {
    const s = String(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      s.includes("lists/index.json") ? listIndex : s.includes("zatar-p3.json") ? zatarList
      : s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  if (sdk) window.supabase = { createClient: () => sdk };

  let src = source;
  if (configured) {
    src = src.replace('var SUPABASE_URL = "";', 'var SUPABASE_URL = "https://p.supabase.co";')
             .replace('var SUPABASE_ANON_KEY = "";', 'var SUPABASE_ANON_KEY = "anon-test-key";');
  }
  window.eval(src);
  return window;
}

const $ = (w, id) => w.document.getElementById(id);
const shown = (w, id) => { const n = $(w, id); return !!n && !n.hidden; };
const acctName = (w) => ($(w, "account-name") || {}).textContent || "";
/* New lives in the list menu now, so making one means opening it first. */
/* the popover fills the field asynchronously, so the assertion reads it back rather
   than racing it */
const copiedFieldValue = (w) => w.document.querySelector(".share-field").value;

const newList = (w) => {
  $(w, "list-trigger").click();
  const m = w.document.querySelector(".list-menu");
  [...m.querySelectorAll(".lm-item")].find((b) => /New list/.test(b.textContent)).click();
};
/* Sign out lives in the account menu now, so reaching it means opening that first -
   which is itself the thing worth asserting. */
const openAcct = (w) => { $(w, "account").click(); return w.document.querySelector(".acct-menu"); };

// ---------------------------------------------------------------------------------
// 1. The anon key is publishable; the service key never is.
// ---------------------------------------------------------------------------------
ok(/SUPABASE_ANON_KEY/.test(source), "the anon key is a named constant, not scattered");

// Comments stripped first: app.js *explains* why the service-role key is dangerous, and
// matching that prose would be a test that fails on its own documentation. What must
// never appear is the key itself, or code reaching for one.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok(!/service[_-]?role/i.test(code),
   "no service-role key in app.js code - that one bypasses row-level security");

// Supabase has two key formats in the wild and the privileged key looks different in
// each: a service_role JWT (eyJ...) in the legacy scheme, sb_secret_... in the current
// one. Both are rejected, because the day this matters is the day someone copies the
// wrong row out of a dashboard that shows them side by side.
ok(!/sb_secret_/.test(code), "no sb_secret_ key - the current format of the same danger");
ok(!/["'`]eyJ[A-Za-z0-9_-]{20,}/.test(code), "and no legacy JWT literal pasted in by hand");

// ---------------------------------------------------------------------------------
// 2. Unconfigured: no accounts exist as far as the page is concerned.
// ---------------------------------------------------------------------------------
{
  const w = boot();
  await settle(() => w.document.querySelector("tbody tr"));
  ok(!shown(w, "sign-in"), "no project configured -> no sign-in button, rather than a broken one");
  /* The menu button is always there - it holds the BiS source, which has nothing to do
     with accounts and must stay reachable when Supabase cannot be reached at all. What
     it must not do is claim you are signed in. */
  ok(!shown(w, "sign-out"), "and nothing claiming you are signed in");
  ok(shown(w, "account") && $(w, "account-name").textContent === "Settings",
     "the menu is still there, as settings - the BiS source lives in it");
  ok(w.document.querySelectorAll("#results tr[data-id]").length > 0,
     "and the page still renders every row, which is the whole fail-soft promise");
}

// ---------------------------------------------------------------------------------
// 3. Configured but the CDN never arrived - the realistic outage.
// ---------------------------------------------------------------------------------
{
  const w = boot({ configured: true });          // no window.supabase
  await settle(() => w.document.querySelector("tbody tr"));
  ok(!shown(w, "sign-in"), "configured but SDK blocked -> still no sign-in button");
  ok(w.document.querySelectorAll("#results tr[data-id]").length > 0,
     "and the page is unaffected: a blocked CDN costs sign-in, not the site");
}

// ---------------------------------------------------------------------------------
// 3b. The SDK arrives LATE, which is the normal case rather than the edge case.
//
//     app.js is a classic script at the end of <body> and runs during parsing; the SDK
//     is deferred and runs after. app.js is therefore always first, and over localhost
//     the data fetches resolve before 212KB has come back from a CDN. Checking
//     window.supabase once and giving up meant the button never appeared at all - on
//     exactly the machine you would be testing on. This is that bug, pinned.
// ---------------------------------------------------------------------------------
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true });          // no window.supabase at boot
  await settle(() => w.document.querySelector("tbody tr"));
  ok(!shown(w, "sign-in"), "SDK not loaded yet -> no sign-in button (correct so far)");

  // the deferred <script> finishes: it sets the global, then fires load
  w.supabase = { createClient: () => sdk };
  w.document.getElementById("supabase-sdk").dispatchEvent(new w.Event("load"));
  await settle(() => shown(w, "sign-in"));

  ok(shown(w, "sign-in"),
     "the SDK arriving late still turns sign-in on - app.js waits for the tag");

  sdk.auth._signIn("Late");
  await settle(() => shown(w, "account") && acctName(w) === "Late");
  ok(shown(w, "account") && acctName(w) === "Late",
     "and signing in works normally afterwards");
}

// ---------------------------------------------------------------------------------
// 3c. writeUrl() must not eat the query string.
//
//     It used to rebuild the URL from location.pathname alone, dropping location.search
//     entirely. Nothing on this site uses the query string, so it went unnoticed for
//     the life of the project - right up until an OAuth redirect came back as `?code=`
//     and update() deleted Discord's answer at boot, before the SDK had even loaded.
//     Sign-in then did nothing, silently, with no error anywhere.
// ---------------------------------------------------------------------------------
{
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://x.test/loot-prio/?code=abc123#phase=P3" });
  const { window: w } = dom;
  Object.assign(w, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response });
  w.fetch = (u) => {
    const s = String(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      s.includes("lists/index.json") ? listIndex : s.includes("zatar-p3.json") ? zatarList
      : s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  w.eval(source);
  await settle();   /* a real wait: the assertion is that writeUrl did NOT eat the OAuth
                       code, and the code is already there to begin with */

  ok(w.location.search === "?code=abc123",
     `an OAuth code survives boot, when update() rewrites the url (got "${w.location.search}")`);
  ok(w.location.hash.includes("phase=P3"),
     `and the page's own hash state is still written (got "${w.location.hash}")`);
}

// ---------------------------------------------------------------------------------
// 4. Configured and present: sign in, and the store follows the session.
// ---------------------------------------------------------------------------------
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle(() => w.document.querySelector("tbody tr"));
  ok(shown(w, "sign-in"), "configured and loaded -> the sign-in button appears");
  ok(!shown(w, "sign-out"), "and no sign-out while nobody is signed in");

  // a list made while signed out belongs to this browser
  newList(w);
  await settle(() => w.localStorage.getItem("lootprio.templates") && w.localStorage.getItem("lootprio.templates").includes("priorities"));
  ok(w.localStorage.getItem("lootprio.templates").includes("priorities"),
     "signed out, a new list is written to localStorage");
  ok(sdk._rows.size === 0, "and nothing is sent to the account, because there isn't one");

  sdk.auth._signIn("Trusty");
  await settle(() => shown(w, "account"));
  ok(shown(w, "account") && acctName(w) === "Trusty",
     `signed in, the bar shows who you are (got "${acctName(w)}")`);
  ok(!shown(w, "sign-in"), "and stops offering to sign in");

  // The account control is a menu, not two more buttons on an already busy bar.
  const menu = openAcct(w);
  ok(menu && menu.style.display === "block", "clicking the account opens a menu");
  ok($(w, "account").getAttribute("aria-expanded") === "true", "and says so on aria-expanded");
  ok(/Signed in as/.test(menu.textContent) && /Trusty/.test(menu.textContent),
     "which states who you are rather than offering your own name as a button");
  ok([...menu.querySelectorAll(".acct-item")].some((b) => b.textContent === "Sign out"),
     "and carries Sign out");

  // Escape closes it, like the other two overlays
  menu.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(menu.style.display === "none", "Escape closes it, as it does the other two overlays");

  // 5. Signing in does not touch what this browser had. There is deliberately no
  //    "copy my local lists up" offer: the two stores are simply separate, and a list
  //    made signed out stays where it was made rather than following you around.
  ok(sdk._rows.size === 0, "signing in copies nothing into the account by itself");
  ok(w.localStorage.getItem("lootprio.templates").includes("priorities"),
     "and leaves this browser's lists exactly where they were");

  // 6. a list made while signed in goes to the account, not to this browser
  const localBefore = w.localStorage.getItem("lootprio.templates");
  newList(w);
  await settle(() => w.localStorage.getItem("lootprio.templates") && w.localStorage.getItem("lootprio.templates").includes("priorities"));
  ok(sdk._rows.size === 1, `signed in, a new list is written to the account (got ${sdk._rows.size})`);
  ok(w.localStorage.getItem("lootprio.templates") === localBefore,
     "and localStorage is not touched - the store really did swap");

  // 7. signing out returns you to this browser's lists, losing nothing either side
  const m2 = openAcct(w);
  [...m2.querySelectorAll(".acct-item")].find((b) => b.textContent === "Sign out").click();
  await settle(() => shown(w, "sign-in") && $(w, "account-name").textContent === "Settings");
  ok(shown(w, "sign-in"), "signing out returns the sign-in button");
  ok($(w, "account-name").textContent === "Settings",
     "and the menu drops back to plain settings rather than still naming you");
  ok(sdk._rows.size === 1, "the account keeps its lists");
  ok(w.localStorage.getItem("lootprio.templates") === localBefore, "and this browser keeps its own");
}

// ---------------------------------------------------------------------------------
// Live shared links. The whole template used to travel in the URL, which capped what a
// list could hold; this carries a token instead, so length stops being a question.
// ---------------------------------------------------------------------------------
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle(() => w.document.querySelector("tbody tr"));
  sdk.auth._signIn("Trusty");
  await settle(() => shown(w, "account"));
  newList(w);
  await settle(() => w.localStorage.getItem("lootprio.templates") && w.localStorage.getItem("lootprio.templates").includes("priorities"));

  let copied = "";
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };

  /* Sharing has its own control now, and its own popover - it is not in the list menu.
     On an unshared list of yours the popover opens on a face that says what publishing
     does and offers a button, so that LOOKING at it never publishes. */
  $(w, "share-trigger").click();
  await settle(() => w.document.querySelector(".share-pop"));
  let pop = w.document.querySelector(".share-pop");
  ok(pop && pop.style.display === "block", "the share button opens a popover");
  ok(!pop.querySelector(".share-field"),
     "which does not show a link yet - opening it must not publish anything");
  ok([...sdk._rows.values()][0].shared !== true,
     "and nothing has been published by merely opening it");
  const go = pop.querySelector(".share-go");
  ok(go, "it offers to share, and says so before doing it");
  go.click();
  await settle(() => { const c = pop.querySelector(".share-copy"); return c && !c.disabled; });

  ok(pop.querySelector(".share-field").value === copiedFieldValue(w),
     "then the link appears in a field you can select");
  pop.querySelector(".share-copy").click();
  await settle(() => copied);

  ok(/[?&]s=/.test(copied), `signed in, the link carries a token rather than the list (${copied.slice(0, 60)}\u2026)`);
  ok(copied.length < 200, `and it is short whatever the list holds (${copied.length} chars)`);
  ok(!/#t=/.test(copied), "so nothing of the list itself is in the url");

  const row = [...sdk._rows.values()][0];
  ok(row.shared === true, "sharing flags the row, so the read function will return it");
  ok(row.share_token && row.share_token.length >= 20,
     `and mints a long random token (${row.share_token && row.share_token.length} chars)`);
  ok(row.share_token !== row.id,
     "never the list id, which is four hex characters and could simply be guessed");

  // the token resolves for someone else, and only while it is shared
  const token = row.share_token;
  const seen = await sdk.rpc("get_shared_list", { token });
  ok(seen.data.length === 1, "the token opens the list for someone who has the link");
  const wrong = await sdk.rpc("get_shared_list", { token: "not-the-token" });
  ok(wrong.data.length === 0, "and a token that is not it opens nothing");

  // once it is public there is nothing left to publish, so the popover skips that face
  $(w, "share-trigger").click();   // close
  $(w, "share-trigger").click();   // and reopen
  await settle(() => {
    const p = w.document.querySelector(".share-pop");
    return p && p.style.display === "block" && p.querySelector(".share-stop");
  });
  pop = w.document.querySelector(".share-pop");
  ok(pop.querySelector(".share-field") && !pop.querySelector(".share-go"),
     "reopened on a shared list it goes straight to the link - there is nothing left to publish");

  // Stop sharing lives next to the link it stops, not next to Delete
  const stop = pop.querySelector(".share-stop");
  ok(stop, "a live link needs a way to stop being one, and it sits with the link");
  ok(!/Stop sharing/.test(w.document.querySelector(".list-menu") ?
      w.document.querySelector(".list-menu").textContent : ""),
     "and no longer clutters the list menu");
  stop.click();
  await settle(() => [...sdk._rows.values()][0] && [...sdk._rows.values()][0].shared === false);
  ok([...sdk._rows.values()][0].shared === false, "which clears the flag");
  const after = await sdk.rpc("get_shared_list", { token });
  ok(after.data.length === 0, "and the link stops opening it, token or not");
}

// ---------------------------------------------------------------------------------
// Signed out there is nothing to point at, so the whole list still travels in the url.
// ---------------------------------------------------------------------------------
{
  const w = boot();
  await settle(() => w.document.querySelector("tbody tr"));
  newList(w);
  await settle(() => w.localStorage.getItem("lootprio.templates") && w.localStorage.getItem("lootprio.templates").includes("priorities"));
  let copied = "";
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  /* Signed out there is nothing to publish, so the popover opens straight onto the link */
  $(w, "share-trigger").click();
  /* the link is built asynchronously either way, and .share-copy stays disabled with
     its listener unattached until it is ready */
  await settle(() => {
    const c = w.document.querySelector(".share-pop .share-copy");
    return c && !c.disabled;
  });
  const pop = w.document.querySelector(".share-pop");
  ok(pop.querySelector(".share-field") && !pop.querySelector(".share-go"),
     "signed out the popover shows the link at once - nothing to publish");
  pop.querySelector(".share-copy").click();
  await settle(() => copied);
  ok(/#t=/.test(copied), "signed out, the link still puts the whole list in the url");
  ok(!/[?&]s=/.test(copied), "because there is nothing in a database to point at");
  /* and it says so, because that link is long enough to be refused by some chat apps */
  ok(/frozen|characters/.test(pop.querySelector(".share-note").textContent),
     `the panel warns what kind of link it is: "${pop.querySelector(".share-note").textContent}"`);
  ok(!pop.querySelector(".share-stop"),
     "and offers no Stop sharing - nothing was published to stop");
}

// ---------------------------------------------------------------------------------
// The recipient, signed out. This is the primary path through sharing - most people
// who open a link will never have a Discord account - and it was the one path with no
// test at all. Nothing below calls _signIn().
// ---------------------------------------------------------------------------------
const BULWARK = "Bulwark of Azzinoth", BULWARK_ID = 32375;
{
  const sdk = fakeSupabase();
  sdk._rows.set("t_shared", {
    id: "t_shared", name: "Trusty's raid list", created: "2026-08-23", v: 1, base: "zatar",
    priorities: Object.fromEntries(data.map((r) => [r.id, r.item === BULWARK ? [{ spec: "Fury" }] : []])),
    published_priorities: Object.fromEntries(data.map((r) => [r.id, r.item === BULWARK ? [{ spec: "Fury" }] : []])),
    published_notes: {},
    published_at: "2026-08-23T00:00:00.000Z",
    share_token: "tok_abc123", shared: true
  });

  const w = boot({ configured: true, sdk, url: "?s=tok_abc123" });
  await settle(() => w.document.querySelector("tbody tr"));

  ok($(w, "list-trigger-name").textContent === "Trusty's raid list",
     `a ?s= link opens the list with no account at all (got "${$(w, "list-trigger-name").textContent}")`);
  ok(w.document.querySelector(`tr[data-id="${BULWARK_ID}"] .spec-icon`),
     "and it is the sharer's list that renders, not the guide's");

  // reference, not a workspace
  ok($(w, "edit-toggle").disabled, "it opens read-only - someone else's list is not yours to edit");
  ok(!w.localStorage.getItem("lootprio.templates"),
     "and nothing of theirs is written into this browser's store");
  ok(shown(w, "sign-in"), "the recipient is still offered sign-in, but never required to");

  $(w, "list-trigger").click();
  const menu = w.document.querySelector(".list-menu");
  ok(/reading this list/i.test(menu.textContent),
     "the menu says plainly that this is someone else's");
  ok([...menu.querySelectorAll(".lm-item")].some((b) => b.textContent.trim() === "Make a copy"),
     "and Make a copy is how you keep it");
  ok(![...menu.querySelectorAll(".lm-item")].some((b) => /Delete|Rename/.test(b.textContent)),
     "with no Rename or Delete, because it is not yours to change");
}

// A token that is not a token opens nothing, and says so rather than silently
// showing the guide's list as though the link had been fine.
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk, url: "?s=not-a-real-token" });
  await settle(() => w.document.querySelector("tbody tr"));
  ok(!$(w, "list-trigger-name").textContent.includes("raid"), "an unknown token opens no list");
  ok(/does not open a list/i.test($(w, "edit-msg").textContent),
     `and says so rather than silently showing the guide's ("${$(w, "edit-msg").textContent}")`);
  ok(w.document.querySelectorAll("#results tr[data-id]").length > 0,
     "while the page itself still works - a dead link costs the list, not the site");
}

// Stop sharing has to be honoured on the recipient's side, not just hidden from the
// sharer's menu. This is the assertion standing between that button and a link that
// keeps working anyway.
{
  const sdk = fakeSupabase();
  sdk._rows.set("t_off", {
    id: "t_off", name: "Unshared list", created: "2026-08-23", v: 1, base: "zatar",
    priorities: Object.fromEntries(data.map((r) => [r.id, []])),
    published_priorities: Object.fromEntries(data.map((r) => [r.id, []])),
    published_at: "2026-08-23T00:00:00.000Z",
    share_token: "tok_off", shared: false
  });
  const w = boot({ configured: true, sdk, url: "?s=tok_off" });
  await settle(() => w.document.querySelector("tbody tr"));
  ok($(w, "list-trigger-name").textContent !== "Unshared list",
     "a token whose list has been unshared opens nothing");
  ok(/does not open a list/i.test($(w, "edit-msg").textContent),
     "and the recipient is told, rather than left looking at the wrong list");
}

// A shared link that cannot be resolved has to say so. Losing sign-in is allowed to be
// quiet - the absent button says "no accounts here" well enough - but a visitor who
// followed a link to one specific list would otherwise be looking at a different one
// with nothing at all to explain the swap.
{
  const w = boot({ configured: true, url: "?s=tok_abc123" });   // configured, but no SDK
  await settle(() => w.document.querySelector("tbody tr"));
  w.document.getElementById("supabase-sdk").dispatchEvent(new w.Event("error"));
  await settle(() => /could not be opened/i.test($(w, "edit-msg").textContent));

  ok(/could not be opened/i.test($(w, "edit-msg").textContent),
     `a link that cannot be resolved says so ("${$(w, "edit-msg").textContent}")`);
  ok(w.document.querySelectorAll("#results tr[data-id]").length > 0,
     "and the page still works behind the message - it costs the list, not the site");
}

// The same failure without a ?s= link stays silent, because there is nothing the reader
// asked for and did not get.
{
  const w = boot({ configured: true });
  await settle(() => w.document.querySelector("tbody tr"));
  w.document.getElementById("supabase-sdk").dispatchEvent(new w.Event("error"));
  await settle();   /* a real wait: the assertion is that nothing was said at all */
  ok(!$(w, "edit-msg").textContent,
     "with no shared link in play, a failed SDK says nothing - losing sign-in is not news");
}

// --- notes and author survive the round trip through the account -------------------
/* The bug this covers: remoteStore.save()'s upsert never named a `notes` column, so a
   signed-in edit saved, appeared to work, and was gone on the next load - while working
   perfectly signed out, where localStore writes the whole blob. Nothing errored. The
   missing assertion was this one, driven the way a person does it: edit the note in the
   table and look at what reached the account. */
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle(() => w.document.querySelector("tbody tr"));
  sdk.auth._signIn("Trusty");
  await settle(() => shown(w, "account"));
  newList(w);
  await settle(() => w.localStorage.getItem("lootprio.templates") && w.localStorage.getItem("lootprio.templates").includes("priorities"));

  const stored = () => sdk._rows.values().next().value;
  ok(stored(), "signed in, a new list is written to the account");
  ok(stored().notes !== undefined && stored().author !== undefined,
     "the upsert names notes and author - an unnamed column saves silently and reads back empty");
  ok(stored().author === "Trusty", `and the list records who made it (${JSON.stringify(stored().author)})`);

  // now edit a note through the table, exactly as the editor does
  const d = w.document;
  const cell = [...d.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td.col-notes"))
    .find((td) => td && td.querySelector(".note-text"));
  ok(cell, "a list of your own opens with the notes editable");
  cell.querySelector(".note-text").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const field = cell.querySelector(".note-field");
  field.value = "Ours: Prot Warr first.";
  field.dispatchEvent(new w.Event("blur"));
  await settle(() => Object.values((stored() || {}).notes || {}).some(Boolean));

  const written = Object.values(stored().notes || {}).filter(Boolean);
  ok(written.includes("Ours: Prot Warr first."),
     `the note reached the account, not just memory (${written.length} notes stored)`);

  // and it reaches whoever holds the ?s= link - the other half the SQL controls.
  // Publishing is what puts it there now: the draft is what you edit, the snapshot is
  // what the link hands out, so flipping `shared` alone would resolve to nothing.
  stored().shared = true;
  stored().share_token = "tok-notes";
  stored().published_priorities = stored().priorities;
  stored().published_notes = stored().notes;
  stored().published_at = new Date().toISOString();
  const seen = await sdk.rpc("get_shared_list", { token: "tok-notes" });
  const row = seen.data[0];
  ok(row.notes && Object.values(row.notes).includes("Ours: Prot Warr first."),
     "and a ?s= recipient reads your notes, not the guide's");
  ok(row.author === "Trusty", "and is told whose list it is");
}

/* The fake projects the columns the real function returns. If those two lists drift, a
   field can be written by the client, stored, and silently absent for every recipient -
   which is the shape of the notes bug. Pinned against the migration itself. */
{
  const sql = fs.readFileSync(path.join(root, "verify", "notes-and-author.sql"), "utf8");
  const declared = (sql.match(/returns table \(([\s\S]*?)\)\s*\n/) || [])[1] || "";
  const cols = declared.split(",").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
  ok(cols.join() === RPC_COLUMNS.join(),
     `the fake returns exactly what get_shared_list declares (${cols.join(", ")})`);
  /* The write payload is a named object now, because the save is a guarded update as
     well as an insert and both send the same row. What is pinned is unchanged: a column
     the template carries but the write never names is not an error anywhere - it is a
     field that saves, looks fine, and is gone on the next load. */
  const upsert = (source.split("var row = {")[1] || "").split("      };")[0];
  ["notes", "author", "priorities", "updated_at"].forEach((f) => {
    ok(new RegExp("\\b" + f + ":").test(upsert),
       `the write names ${f} - an unnamed column saves silently and reads back empty`);
  });
}

// --- a list made before authors existed picks one up on its next save ---------------
/* Every list that predates the field has a null author, so sharing one showed no byline -
   and those are the lists with work in them. Filling the blank is recording a fact: a list
   in your own store is yours by definition, which is what activeIsMine already means. */
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle(() => w.document.querySelector("tbody tr"));
  sdk.auth._signIn("Trusty");
  await settle(() => shown(w, "account"));
  newList(w);
  await settle(() => w.localStorage.getItem("lootprio.templates") && w.localStorage.getItem("lootprio.templates").includes("priorities"));

  const stored = () => sdk._rows.values().next().value;
  // rewind it to what an old row looks like, then make an edit
  stored().author = null;
  const d = w.document;
  const cell = [...d.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td.col-notes"))
    .find((td) => td && td.querySelector(".note-text"));
  cell.querySelector(".note-text").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const field = cell.querySelector(".note-field");
  field.value = "backfill me";
  field.dispatchEvent(new w.Event("blur"));
  await settle(() => (stored() || {}).author === "Trusty");

  ok(stored().author === "Trusty",
     `an authorless list of yours picks your name up on its next save (${JSON.stringify(stored().author)})`);
}

/* It fills a blank and never overwrites, so copying someone else's list cannot quietly
   relabel it, and the guard is on the source rather than on the caller. */
ok(/if \(!t\.author && signedIn\(\)\) t\.author = accountName\(\);/.test(source),
   "the backfill only fires on a missing author, and only while signed in");

// --- an author is only shown where something attested it ---------------------------
/* A #t= link carries whatever the sender put in it, so its author is unverified: someone
   could stamp it "zatar" and pass their calls off as his, which is what CLAUDE.md
   section 8 exists to prevent. attestedAuthor() is what refuses to render that. */
ok(/function attestedAuthor/.test(source) && /sharedFrom/.test(source),
   "there is a gate between 'an author is set' and 'an author is shown'");
ok(/row\.sharedFrom = "server"/.test(source),
   "and only the server-resolved path sets the marker that opens it");

// --- a second writer cannot silently overwrite the first ---------------------------
/* The whole row travels on every save - about 21KB of priorities and notes - so before
   this guard the second officer to save simply sent their ten-minute-old copy over the
   top of the first one's work. No error, nothing on screen, and you would find out days
   later if at all. It is the same silent-write shape as the notes bug above. */
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle(() => w.document.querySelector("tbody tr"));
  sdk.auth._signIn("Trusty");
  await settle(() => shown(w, "account"));
  newList(w);
  await settle(() => sdk._rows.size === 1);

  const id = [...sdk._rows.keys()][0];
  const firstStamp = sdk._rows.get(id).updated_at;
  ok(!!firstStamp, "a saved list carries the version it was written at");

  /* somebody else saves the same list from another browser */
  sdk._rows.set(id, Object.assign({}, sdk._rows.get(id),
    { name: "Kayla's edit", updated_at: "2099-01-01T00:00:00.000Z" }));

  /* now edit here, on a copy that no longer matches */
  const cell = [...w.document.querySelectorAll("td.col-notes")]
    .find((td) => td && td.querySelector(".note-text"));
  cell.querySelector(".note-text").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const field = cell.querySelector(".note-field");
  field.value = "mine, written against a stale copy";
  field.dispatchEvent(new w.Event("blur"));
  await settle(() => /reload/i.test($(w, "edit-msg").textContent));

  ok(sdk._rows.get(id).name === "Kayla's edit",
     "the stale save does not land - the other writer's row is untouched");
  ok(/reload/i.test($(w, "edit-msg").textContent),
     `and it says so out loud: "${$(w, "edit-msg").textContent.slice(0, 72)}"`);
  ok(/still on screen/i.test($(w, "edit-msg").textContent),
     "telling you the edit is not lost, because it is still in front of you");
  ok(!!w.document.querySelector(".toast-undo"),
     "and offers the way out rather than describing it");
  ok(w.document.querySelector(".toast-undo").textContent === "Reload",
     `the action is a reload, not an undo (got "${w.document.querySelector(".toast-undo").textContent}")`);
  ok(!$(w, "tpl-dirty").hidden,
     "the list still reads as unsaved, because it is - claiming otherwise is the lie this guard removes");

  /* and a save that IS current still goes through */
  const w2 = boot({ configured: true, sdk: fakeSupabase() });
  await settle(() => w2.document.querySelector("tbody tr"));
  const sdk2 = w2.supabase.createClient();
  sdk2.auth._signIn("Trusty");
  await settle(() => shown(w2, "account"));
  newList(w2);
  await settle(() => sdk2._rows.size === 1);
  const id2 = [...sdk2._rows.keys()][0];
  const before2 = sdk2._rows.get(id2).updated_at;
  const cell2 = [...w2.document.querySelectorAll("td.col-notes")]
    .find((td) => td && td.querySelector(".note-text"));
  cell2.querySelector(".note-text").dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  const f2 = cell2.querySelector(".note-field");
  f2.value = "nobody else is editing";
  f2.dispatchEvent(new w2.Event("blur"));
  await settle(() => Object.values(sdk2._rows.get(id2).notes || {}).some(Boolean));
  ok(Object.values(sdk2._rows.get(id2).notes).includes("nobody else is editing"),
     "an uncontested save still lands, so the guard is not just refusing everything");
  ok(sdk2._rows.get(id2).updated_at !== before2,
     "and moves the version on, so the next save is guarded against this one");
}

// --- draft and published: the guild reads what you chose, not what you are doing ------
/* The point of the whole thing. A ?s= link used to serve the row as it stood that
   instant, so officers reshuffling at 8pm did it on everyone's screen. Now the link
   carries a token pointing at the row, and the row decides which of its two faces to
   hand over - so the URL never changes and the content only moves when you say so. */
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle(() => w.document.querySelector("tbody tr"));
  sdk.auth._signIn("Trusty");
  await settle(() => shown(w, "account"));
  newList(w);
  await settle(() => sdk._rows.size === 1);
  const id = [...sdk._rows.keys()][0];
  const stored = () => sdk._rows.get(id);

  ok(!stored().published_at, "a new list is a draft - nothing has been published");

  /* the popover opens on the publish face, because there is nothing to hand out yet */
  $(w, "share-trigger").click();
  await settle(() => w.document.querySelector(".share-pop .share-go"));
  const pop = w.document.querySelector(".share-pop");
  ok(!pop.querySelector(".share-field"),
     "so it offers to publish rather than showing a link - looking must not publish");
  ok(/until you publish again/i.test(pop.textContent),
     "and says the edits after it stay private until you publish again");

  pop.querySelector(".share-go").click();
  await settle(() => stored().published_at);
  ok(!!stored().published_at, "publishing stamps the snapshot");
  await settle(() => {
    const c = w.document.querySelector(".share-pop .share-copy");
    return c && !c.disabled;
  });
  const link = w.document.querySelector(".share-field").value;
  ok(/[?&]s=/.test(link), `and hands back a token link (${link.slice(0, 46)}…)`);

  /* now move the draft on, and check the link does NOT move with it */
  const before = JSON.stringify(stored().published_priorities);
  const cell = [...w.document.querySelectorAll("td.col-notes")]
    .find((td) => td && td.querySelector(".note-text"));
  cell.querySelector(".note-text").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const field = cell.querySelector(".note-field");
  field.value = "still arguing about this one";
  field.dispatchEvent(new w.Event("blur"));
  await settle(() => Object.values(stored().notes || {}).some(Boolean));

  ok(JSON.stringify(stored().published_priorities) === before,
     "editing the draft does not touch the published snapshot");
  const mid = await sdk.rpc("get_shared_list", { token: stored().share_token });
  ok(!Object.values(mid.data[0].notes || {}).includes("still arguing about this one"),
     "so the link still serves the old version - the guild is not watching you think");

  /* and the panel says how far apart they have drifted */
  $(w, "share-trigger").click();
  $(w, "share-trigger").click();
  await settle(() => {
    const c = w.document.querySelector(".share-pop .share-copy");
    return c && !c.disabled && /changed since/i.test(w.document.querySelector(".share-pop").textContent);
  });
  const panel = w.document.querySelector(".share-pop");
  ok(/1 item has changed since/i.test(panel.textContent),
     `the panel counts what is waiting to be sent: "${panel.querySelector(".share-note").textContent}"`);
  const again = [...panel.querySelectorAll(".share-go")]
    .find((b) => b.textContent === "Publish changes");
  ok(!!again, "and offers to send them");

  const url1 = w.document.querySelector(".share-field").value;
  const tokenBefore = stored().share_token;
  again.click();
  await settle(() => Object.values(stored().published_notes || {}).some(Boolean));
  const after = await sdk.rpc("get_shared_list", { token: stored().share_token });
  ok(Object.values(after.data[0].notes || {}).includes("still arguing about this one"),
     "publishing again moves what the link serves");

  /* The token is the claim, not the whole url: the url also carries the phase and
     filters from location.hash, which move for reasons that have nothing to do with
     publishing. What must never change is where the link points. */
  ok(stored().share_token === tokenBefore && url1.indexOf(tokenBefore) !== -1,
     "and it still points at the same token - the guild pins the link once, not once per publish");
}

// --- a shared but unpublished list hands out nothing ---------------------------------
/* "Locked until we are happy", in the only place it can actually be enforced. */
{
  const sdk = fakeSupabase();
  sdk._rows.set("t_draft", {
    id: "t_draft", name: "Officers only", created: "2026-08-28", v: 1, base: "zatar",
    priorities: Object.fromEntries(data.map((r) => [r.id, []])),
    share_token: "tok_draft", shared: true          /* flagged, but never published */
  });
  const seen = await sdk.rpc("get_shared_list", { token: "tok_draft" });
  ok(seen.data.length === 0, "a shared list nobody has published resolves to nothing");

  const w = boot({ configured: true, sdk, url: "?s=tok_draft" });
  await settle(() => w.document.querySelector("tbody tr"));
  ok(!$(w, "list-trigger-name").textContent.includes("Officers"),
     "so the link does not open it, however it was flagged");
  ok(w.document.querySelectorAll("tbody tr").length > 0,
     "and the page still works behind that - a dead link costs the list, not the site");
}

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
