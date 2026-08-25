/* Saving, sharing and loading a template.
 *
 * A shared template is untrusted input - anyone can hand-craft a #t= link - so the
 * refusals matter as much as the happy path.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

/* expose the internals this file is about; the app keeps them private otherwise */
const EXPOSE = "window.__api = { copyOfCurrent, newBlankTemplate, encodeTemplate, decodeTemplate," +
  " validateTemplate, store, addEntry, moveEntry, removeEntry, normaliseList }; })();";

function boot(hash) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://x.test/loot-prio/" + (hash || "") });
  const { window } = dom;
  Object.assign(window, { TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response });
  window.fetch = (u) => {
    const s = String(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      s.includes("bis.json") ? bis : s.includes("specs.json") ? specs : data) });
  };
  window.eval(fs.readFileSync(path.join(root, "app.js"), "utf8").replace("})();", EXPOSE));
  return window;
}
const settle = () => new Promise((r) => setTimeout(r, 400));

/* A fixed sleep is a race, and this one lost about 40% of the time on a loaded
   machine: booting a shared list means fetches, promises and a gzip round trip through
   DecompressionStream, and 400ms is not a guarantee of anything. Worse, it fails as an
   unrelated assertion, so the natural reading is "the change I just made broke sharing"
   rather than "the test did not wait long enough".

   Wait for the condition instead. Same speed when things are quick, and it only spends
   the time when it has to. */
async function waitFor(cond, what, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log(`FAIL  timed out after ${ms}ms waiting for ${what}`);
  fail.push(`timed out waiting for ${what}`);
  return false;
}

const w = boot();
await settle();
const api = w.__api;

// --- what a template is --------------------------------------------------------
const t = api.copyOfCurrent("Test list");
ok(Object.keys(t.priorities).length === data.length,
   `a template is a full copy: ${Object.keys(t.priorities).length} of ${data.length} items`);
ok(t.v === 1 && t.base === "zatar", "it records its version and what it forked from");

t.priorities["32375"] = api.addEntry(t.priorities["32375"], { spec: "Arms" });
ok(JSON.stringify(data.find((r) => r.id === 32375).priority).indexOf("Arms") === -1,
   "editing the copy does not reach the loaded data");

// --- a blank list is a template like any other ----------------------------------
const blank = api.newBlankTemplate("Blank list");
ok(Object.keys(blank.priorities).length === data.length,
   `New copies all ${data.length} rows, it just leaves them empty`);
ok(Object.values(blank.priorities).every((p) => Array.isArray(p) && p.length === 0),
   "with nothing in any of them");
ok(blank.base === "blank", "and it says it started from nothing rather than from him");
ok(api.validateTemplate(blank) === null, "an empty priority is valid, not a broken one");
const blankCode = await api.encodeTemplate(blank);
ok(api.validateTemplate(await api.decodeTemplate(blankCode)) === null,
   `and it shares like any other list: ${blankCode.length} characters`);

// --- storage round-trip ---------------------------------------------------------
await api.store.save(t);
const listed = await api.store.list();
ok(listed.length === 1 && listed[0].name === "Test list", "saved templates are listable");
const back = await api.store.load(t.id);
ok(JSON.stringify(back.priorities) === JSON.stringify(t.priorities), "and load back byte-identical");
await api.store.remove(t.id);
ok((await api.store.list()).length === 0, "and can be deleted");

// --- url round-trip -------------------------------------------------------------
const code = await api.encodeTemplate(t);
ok(code[0] === "z", "encodes gzipped where the browser supports it");
/* A full copy of every record, gzipped and base64url'd. It grows with the dataset -
   2,263 characters at 195 items, ~4,700 at 706 - and that is the honest cost of a link
   that carries the list itself. It stays workable because it rides in the HASH: a
   fragment never reaches a server, so no 414 is possible and the only real ceiling is
   the browser's address bar, which is tens of thousands of characters everywhere.

   The signed-in path does not pay this at all - ?s= carries a ~30 character token
   whatever the list holds, which is why unbounded notes were possible in the first
   place. The cap here is loose on purpose: it exists to catch the encoding breaking,
   not to police a size that is expected to move whenever loot is added. */
ok(code.length < 20000, `a whole ${Object.keys(t.priorities).length}-item list fits a url: ${code.length} characters`);
const decoded = await api.decodeTemplate(code);
ok(JSON.stringify(decoded.priorities) === JSON.stringify(t.priorities), "and survives the round trip");
ok(api.validateTemplate(decoded) === null, "the decoded template validates");

// --- untrusted input ------------------------------------------------------------
const bad = (mutate, why) => {
  const doc = JSON.parse(JSON.stringify({ v: t.v, name: t.name, base: t.base, priorities: t.priorities }));
  mutate(doc);
  const msg = api.validateTemplate(doc);
  ok(typeof msg === "string" && msg.length > 0, `${why} -> refused: ${msg}`);
};
bad((d) => { d.priorities["32375"] = [{ spec: "NotASpec" }]; }, "unknown spec id");
bad((d) => { d.priorities["32375"] = [{ spec: "ProtWarr" }, { spec: "Arms", op: "!!" }]; }, "unknown operator");
bad((d) => { d.priorities["32375"] = [{ spec: "ProtWarr", op: ">" }]; }, "operator on the first entry");
bad((d) => { d.priorities["32248"] = [{ spec: "Arms" }, { spec: "Arms", op: ">" }]; }, "same spec twice on a two-hander");
bad((d) => { d.priorities["32252"] = [{ class: "Rogue" }, { class: "Rogue", op: ">" }]; }, "same spec twice on a chest");
bad((d) => { d.priorities["32375"] = [{ spec: "ProtWarr", class: "Warrior" }]; }, "spec and class together");
bad((d) => { d.v = 99; }, "a version we don't understand");
bad((d) => { delete d.priorities; }, "no priorities at all");

/* Notes travel on a shared list too, and are just as untrusted. The cell renders through
   highlight(), which escapes - these are the model's own rules, before that. */
bad((d) => { d.notes = [1, 2]; }, "notes that are not an object");
bad((d) => { d.notes = { 32375: 42 }; }, "a note that is not a string");
bad((d) => { d.notes = { 32375: "x".repeat(5000) }; }, "a note long enough to break the link");

/* notes is optional and absent means "the guide's", which is the whole reason v did not
   have to move: every list saved before tonight, and every link already sent, still opens. */
ok(api.validateTemplate({ v: t.v, name: t.name, base: t.base, priorities: t.priorities }) === null,
   "a template with no notes at all still opens - absent means his");

const junk = await api.decodeTemplate("z!!!!not-base64!!!!").then(() => null, (e) => e.message);
ok(typeof junk === "string", `a damaged link is refused: ${junk}`);

// --- loading a shared link -------------------------------------------------------
const shared = boot("#t=" + code);
const name = () => shared.document.getElementById("list-trigger-name").textContent;
await waitFor(() => name() === "Test list", "the shared list to open");
ok(name() === "Test list", `a #t= link opens that list on load: "${name()}"`);
ok(shared.document.getElementById("edit-toggle").disabled,
   "and it opens as reference - someone else's list is not yours to edit in place");

/* Make a copy is how you keep it, and it lives in the list menu now. */
shared.document.getElementById("list-trigger").click();
const menu = shared.document.querySelector(".list-menu");
ok([...menu.querySelectorAll(".lm-item")].some((b) => b.textContent.trim() === "Make a copy"),
   "Make a copy is how you keep it");
ok(/following this list/i.test(menu.textContent),
   "and the menu says so plainly rather than silently offering fewer actions");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
