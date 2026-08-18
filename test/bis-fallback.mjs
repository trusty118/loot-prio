import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  await new Promise((r) => setTimeout(r, 400));
  return window.document;
}

// 404
let doc = await boot(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("nope")) }));
ok(doc.querySelectorAll("tbody tr").length === 182, `bis.json 404 -> table still renders (${doc.querySelectorAll("tbody tr").length} rows)`);
ok(doc.querySelectorAll(".spec-icon--bis, .spec-icon--bis2, .spec-icon--bis3").length === 0, "404 -> no rings, no crash");
ok(doc.querySelectorAll(".col-prio img").length > 300, "404 -> spec icons still render");

// malformed json
doc = await boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad json")) }));
ok(doc.querySelectorAll("tbody tr").length === 182, "malformed bis.json -> table still renders");

// valid but empty
doc = await boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ specs: {} }) }));
ok(doc.querySelectorAll("tbody tr").length === 182, "empty specs -> table still renders");
ok(doc.querySelectorAll(".spec-icon--bis3").length === 0, "empty specs -> no rings");

// shape without a specs key at all
doc = await boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
ok(doc.querySelectorAll("tbody tr").length === 182, "missing specs key -> table still renders");

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
