/* The built artifact, which is the only thing Pages serves.
 *
 * A build step adds a failure mode the other five files cannot see: they all read the
 * SOURCE, which is correct - the source is the truth, and test/auth.mjs's service-role-key
 * grep in particular has to scan the unminified file. But that leaves nothing at all
 * checking the thing that actually reaches users. Without this file we would have traded
 * readable source for an untested deploy.
 *
 * Two jobs, matching the two the build does:
 *
 *   1. the minified page still works. Identifier renaming is safe on app.js today - no
 *      eval, no `new Function`, nothing reading a function's .name, one self-contained
 *      IIFE - but "safe today" is a property of the current source, and this is what
 *      notices when it stops being true.
 *   2. dist/ holds ONLY the site. This is the whole reason the build exists: the repo root
 *      was being served, so CLAUDE.md, the test suite and the verify/ scrapers were public
 *      at the site's own URL. One stray copy line would put them back, and nothing else
 *      would complain.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { until } from "./helpers.mjs";
import { build, SHIPPED } from "../build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await build();

// --- dist holds only the site -----------------------------------------------------------
{
  const got = fs.readdirSync(dist).sort();
  ok(got.join() === [...SHIPPED].sort().join(),
     `dist holds exactly what the page needs (${got.join(", ")})`);

  /* Named individually rather than inferred from the list above, because these are the
     specific things that were public and the assertion should say so by name. */
  for (const leaked of ["CLAUDE.md", "README.md", "test", "verify", "docs",
                        "package.json", "package-lock.json", "node_modules"]) {
    ok(!fs.existsSync(path.join(dist, leaked)), `${leaked} is not published`);
  }

  /* The comments are the other half. A minifier that silently stopped stripping them
     would leave the notes in app.js while every other assertion here still passed. */
  const js = fs.readFileSync(path.join(dist, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dist, "style.css"), "utf8");
  const htmlOut = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  ok(!js.includes("/*") && !css.includes("/*"), "no block comments survive in the JS or CSS");
  ok(!htmlOut.includes("<!--"), "and none in the HTML");

  const src = fs.statSync(path.join(root, "app.js")).size;
  ok(fs.statSync(path.join(dist, "app.js")).size < src / 2,
     `app.js is less than half its source size (${(src / 1024).toFixed(0)} KB source)`);

  /* The data is copied verbatim on purpose - JSON carries no comments, so there is
     nothing to hide, and it is the one part worth leaving legible. */
  ok(fs.readFileSync(path.join(dist, "data/loot_data.json"), "utf8")
     === fs.readFileSync(path.join(root, "data/loot_data.json"), "utf8"),
     "the data is copied byte-for-byte, not minified");
}

// --- the minified page still renders ----------------------------------------------------
/* The assertion that catches a minifier breaking the app. Booted from dist/index.html and
   dist/app.js, never the source. */
{
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dist, "data", f), "utf8"));
  const data = rd("loot_data.json"), bis = rd("bis.json"), specs = rd("specs.json");
  const listIndex = rd("lists/index.json"), zatarList = rd("lists/zatar-p3.json");

  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/loot-prio/" });
  const { window } = dom;
  window.fetch = (url) => {
    const u = String(url);
    const body = u.includes("lists/index.json") ? listIndex
               : u.includes("zatar-p3.json") ? zatarList
               : u.includes("bis.json") ? bis : u.includes("specs.json") ? specs : data;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  window.eval(fs.readFileSync(path.join(dist, "app.js"), "utf8"));

  const d = window.document;
  await until(() => d.querySelector("tbody tr"));
  ok(d.querySelectorAll("tbody tr").length > 100,
     `the minified page renders its rows (${d.querySelectorAll("tbody tr").length})`);

  /* The BiS view, which exercises the registry, the BiS index and the icon builder - the
     machinery most likely to notice a renaming bug. */
  ok(d.querySelectorAll("td.col-prio img.spec-icon").length > 100,
     "and the priority column draws its icons");

  /* Opening a list goes through the store, the menu overlay and a re-render: the widest
     path available without a pointer. */
  d.getElementById("list-trigger").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  [...d.querySelectorAll(".list-menu .lm-row")].find((r) => /Zatar/.test(r.textContent))
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await until(() => d.getElementById("list-trigger-name").textContent === "Zatar's Phase 3");
  ok(d.getElementById("list-trigger-name").textContent === "Zatar's Phase 3",
     "the list menu still opens a list");

  /* Filtering is where the minified code does most of its work per keystroke. */
  const before = d.querySelectorAll("tbody tr").length;
  const warrior = [...d.querySelectorAll("#class-chips .chip")]
    .find((c) => (c.getAttribute("aria-label") || "").includes("Warrior"));
  warrior.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await until(() => d.querySelectorAll("tbody tr").length < before);
  ok(d.querySelectorAll("tbody tr").length < before,
     `and the filters still narrow the table (${before} -> ${d.querySelectorAll("tbody tr").length})`);
}

console.log(fail.length ? `\n${fail.length} FAILURES` : "\nAll checks passed");
process.exit(fail.length ? 1 : 0);
