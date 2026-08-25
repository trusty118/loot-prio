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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

/* What get_shared_list actually returns. Kept beside the fake and pinned against the
   migration, so the two cannot drift. */
const RPC_COLUMNS = ["id", "name", "created", "v", "base", "priorities", "notes", "author"];

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const settle = () => new Promise((r) => setTimeout(r, 400));

/* ---------- a fake Supabase ----------
   Only the surface app.js actually uses. Deliberately not a mock that records calls:
   it is a working in-memory table, so the assertions below are about behaviour that
   round-trips rather than about which methods were invoked. */
function fakeSupabase() {
  const rows = new Map();
  let session = null;
  const listeners = [];

  const result = (v) => Promise.resolve({ data: v, error: null });

  function from() {
    const q = { _id: null, _single: false };
    q.select = () => q;
    q.order = () => q;
    q.eq = (_col, v) => { q._id = v; return q; };
    q.maybeSingle = () => { q._single = true; return q; };
    q.upsert = (row) => { rows.set(row.id, row); return result(row); };
    q.delete = () => { q._del = true; return q; };
    q.then = (res, rej) => {
      if (q._del) { rows.delete(q._id); return result(null).then(res, rej); }
      if (q._single) return result(rows.get(q._id) || null).then(res, rej);
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
      const hit = [...rows.values()].find((r) => r.shared === true && r.share_token === args.token);
      /* PROJECTED, not returned whole. The real function names its columns, so a field
         the client writes but the SQL never selects arrives as undefined - which is
         exactly how notes shipped broken: saved, apparently fine, absent on every read.
         A fake that hands back the whole row cannot reproduce that. RPC_COLUMNS is
         checked against verify/notes-and-author.sql below. */
      return Promise.resolve({
        data: hit ? [Object.fromEntries(RPC_COLUMNS.map((c) => [c, hit[c]]))] : [],
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
      s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
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
  await settle();
  ok(!shown(w, "sign-in"), "no project configured -> no sign-in button, rather than a broken one");
  ok(!shown(w, "sign-out") && !shown(w, "account"), "and nothing claiming you are signed in");
  ok(w.document.querySelectorAll("#results tr[data-id]").length > 0,
     "and the page still renders every row, which is the whole fail-soft promise");
}

// ---------------------------------------------------------------------------------
// 3. Configured but the CDN never arrived - the realistic outage.
// ---------------------------------------------------------------------------------
{
  const w = boot({ configured: true });          // no window.supabase
  await settle();
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
  await settle();
  ok(!shown(w, "sign-in"), "SDK not loaded yet -> no sign-in button (correct so far)");

  // the deferred <script> finishes: it sets the global, then fires load
  w.supabase = { createClient: () => sdk };
  w.document.getElementById("supabase-sdk").dispatchEvent(new w.Event("load"));
  await settle();

  ok(shown(w, "sign-in"),
     "the SDK arriving late still turns sign-in on - app.js waits for the tag");

  sdk.auth._signIn("Late");
  await settle();
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
      s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  w.eval(source);
  await settle();

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
  await settle();
  ok(shown(w, "sign-in"), "configured and loaded -> the sign-in button appears");
  ok(!shown(w, "sign-out"), "and no sign-out while nobody is signed in");

  // a list made while signed out belongs to this browser
  newList(w);
  await settle();
  ok(w.localStorage.getItem("lootprio.templates").includes("priorities"),
     "signed out, a new list is written to localStorage");
  ok(sdk._rows.size === 0, "and nothing is sent to the account, because there isn't one");

  sdk.auth._signIn("Trusty");
  await settle();
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
  await settle();
  ok(sdk._rows.size === 1, `signed in, a new list is written to the account (got ${sdk._rows.size})`);
  ok(w.localStorage.getItem("lootprio.templates") === localBefore,
     "and localStorage is not touched - the store really did swap");

  // 7. signing out returns you to this browser's lists, losing nothing either side
  const m2 = openAcct(w);
  [...m2.querySelectorAll(".acct-item")].find((b) => b.textContent === "Sign out").click();
  await settle();
  ok(shown(w, "sign-in") && !shown(w, "account"), "signing out returns the sign-in button");
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
  await settle();
  sdk.auth._signIn("Trusty");
  await settle();
  newList(w);
  await settle();

  let copied = "";
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };

  // Copy link, from the list menu
  $(w, "list-trigger").click();
  const menu = w.document.querySelector(".list-menu");
  const share = [...menu.querySelectorAll(".lm-item")].find((b) => /^Share this list/.test(b.textContent));
  ok(share, "before it is shared, the action says it will share rather than just copy");
  share.click();
  await settle();

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

  // once it is public, copying really is just copying, and the label says so
  $(w, "list-trigger").click();
  const m1 = w.document.querySelector(".list-menu");
  ok([...m1.querySelectorAll(".lm-item")].some((b) => b.textContent.trim() === "Copy link"),
     "once shared, the same action is honestly just Copy link");
  ok(!/Share this list/.test(m1.textContent), "and no longer offers to share what is already shared");
  m1.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // Stop sharing
  $(w, "list-trigger").click();
  const m2 = w.document.querySelector(".list-menu");
  const stop = [...m2.querySelectorAll(".lm-item")].find((b) => b.textContent.trim() === "Stop sharing");
  ok(stop, "a live link needs a way to stop being one, so the menu offers it");
  stop.click();
  await settle();
  ok([...sdk._rows.values()][0].shared === false, "which clears the flag");
  const after = await sdk.rpc("get_shared_list", { token });
  ok(after.data.length === 0, "and the link stops opening it, token or not");
}

// ---------------------------------------------------------------------------------
// Signed out there is nothing to point at, so the whole list still travels in the url.
// ---------------------------------------------------------------------------------
{
  const w = boot();
  await settle();
  newList(w);
  await settle();
  let copied = "";
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  $(w, "list-trigger").click();
  const menu = w.document.querySelector(".list-menu");
  [...menu.querySelectorAll(".lm-item")].find((b) => b.textContent.trim() === "Copy link").click();
  await settle();
  ok(/#t=/.test(copied), "signed out, Copy link still puts the whole list in the url");
  ok(!/[?&]s=/.test(copied), "because there is nothing in a database to point at");
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
    share_token: "tok_abc123", shared: true
  });

  const w = boot({ configured: true, sdk, url: "?s=tok_abc123" });
  await settle();

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
  ok(/following this list/i.test(menu.textContent),
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
  await settle();
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
    share_token: "tok_off", shared: false
  });
  const w = boot({ configured: true, sdk, url: "?s=tok_off" });
  await settle();
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
  await settle();
  w.document.getElementById("supabase-sdk").dispatchEvent(new w.Event("error"));
  await settle();

  ok(/could not be opened/i.test($(w, "edit-msg").textContent),
     `a link that cannot be resolved says so ("${$(w, "edit-msg").textContent}")`);
  ok(w.document.querySelectorAll("#results tr[data-id]").length > 0,
     "and the page still works behind the message - it costs the list, not the site");
}

// The same failure without a ?s= link stays silent, because there is nothing the reader
// asked for and did not get.
{
  const w = boot({ configured: true });
  await settle();
  w.document.getElementById("supabase-sdk").dispatchEvent(new w.Event("error"));
  await settle();
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
  await settle();
  sdk.auth._signIn("Trusty");
  await settle();
  newList(w);
  await settle();

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
  await settle();

  const written = Object.values(stored().notes || {}).filter(Boolean);
  ok(written.includes("Ours: Prot Warr first."),
     `the note reached the account, not just memory (${written.length} notes stored)`);

  // and it reaches whoever holds the ?s= link - the other half the SQL controls
  stored().shared = true;
  stored().share_token = "tok-notes";
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
  const upsert = (source.match(/from\("lists"\)\.upsert\(\{([\s\S]*?)\}\)/) || [])[1] || "";
  ["notes", "author", "priorities"].forEach((f) => {
    ok(new RegExp("\\b" + f + ":").test(upsert),
       `the upsert names ${f} - an unnamed column saves silently and reads back empty`);
  });
}

// --- a list made before authors existed picks one up on its next save ---------------
/* Every list that predates the field has a null author, so sharing one showed no byline -
   and those are the lists with work in them. Filling the blank is recording a fact: a list
   in your own store is yours by definition, which is what activeIsMine already means. */
{
  const sdk = fakeSupabase();
  const w = boot({ configured: true, sdk });
  await settle();
  sdk.auth._signIn("Trusty");
  await settle();
  newList(w);
  await settle();

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
  await settle();

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

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
