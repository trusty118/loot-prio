import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { until } from "./helpers.mjs";

// resolve the repo root from this file, so it works on any machine or cwd
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(root, "data/loot_data.json"), "utf8"));
const specs = JSON.parse(fs.readFileSync(path.join(root, "data/specs.json"), "utf8"));
const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

async function boot(bisResponse) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/" });
  const { window } = dom;
  window.console = { warn: () => {}, log: () => {} };
  window.fetch = (url) =>
    String(url).includes("bis.json") ? bisResponse() :
    Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve(String(url).includes("specs.json") ? specs : data) });
  window.eval(fs.readFileSync(path.join(root, "app.js"), "utf8"));
  await until(() => window.document.querySelector("tbody tr"));
  return window.document;
}

// 404
let doc = await boot(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("nope")) }));
ok(doc.querySelectorAll("tbody tr").length === 195, `bis.json 404 -> table still renders (${doc.querySelectorAll("tbody tr").length} rows)`);
ok(doc.querySelectorAll(".spec-icon--bis, .spec-icon--bis2, .spec-icon--bis3").length === 0, "404 -> no rings, no crash");
ok(doc.querySelectorAll(".col-prio img").length > 300, "404 -> spec icons still render");

// malformed json
doc = await boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad json")) }));
ok(doc.querySelectorAll("tbody tr").length === 195, "malformed bis.json -> table still renders");

// valid but empty
doc = await boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ specs: {} }) }));
ok(doc.querySelectorAll("tbody tr").length === 195, "empty specs -> table still renders");
ok(doc.querySelectorAll(".spec-icon--bis3").length === 0, "empty specs -> no rings");

// shape without a specs key at all
doc = await boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
ok(doc.querySelectorAll("tbody tr").length === 195, "missing specs key -> table still renders");

// --- a stale alias costs that one word, not the page ------------------------------
/* specs.json fails soft everywhere else here, and its aliases are no different: one
   pointing at an identifier the registry does not know is skipped when the reverse index
   is built. Renaming a spec without sweeping the aliases must not take the site down. */
{
  const bent = JSON.parse(JSON.stringify(specs));
  bent.aliases["Ghost"] = "NoSuchSpec";
  bent.aliases["Wraith"] = { spec: "AlsoMissing", form: "cat" };
  bent.aliases["Empty"] = null;

  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/" });
  const { window } = dom;
  window.console = { warn: () => {}, log: () => {} };
  window.fetch = (url) => Promise.resolve({ ok: true, status: 200,
    json: () => Promise.resolve(String(url).includes("specs.json") ? bent
                              : String(url).includes("bis.json") ? { specs: {} } : data) });
  window.eval(fs.readFileSync(path.join(root, "app.js"), "utf8"));
  await new Promise((r) => setTimeout(r, 400));
  const d = window.document;

  ok(d.querySelectorAll("tbody tr").length === 195,
     `an alias pointing at nothing -> the table still renders (${d.querySelectorAll("tbody tr").length} rows)`);

  const box = d.getElementById("search");
  const find = async (q) => {
    box.value = q; box.dispatchEvent(new window.Event("input"));
    await new Promise((r) => setTimeout(r, 200));
    return d.querySelectorAll("#results tr[data-id]").length;
  };
  ok(await find("Ghost") === 0, "the broken shorthand finds nothing, rather than everything");
  ok(await find("Boomkin") > 0, "and the sound ones beside it still work");
}

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
