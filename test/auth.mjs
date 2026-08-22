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
function boot({ configured = false, sdk = null } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://x.test/loot-prio/" });
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
  $(w, "tpl-new").click();
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
  $(w, "tpl-new").click();
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

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
