/* Waiting, without guessing how long.
 *
 * Every file here used to nap a flat 400ms after each interaction, whether the thing
 * it was waiting for took 2ms or 200ms. That cost about 30 of the suite's 47 seconds,
 * and it is the flaky-test pattern besides: too short and it fails on a slow machine,
 * too long and nobody ever learns it was too short.
 *
 * until() polls the condition the test is actually waiting for and carries on the
 * moment it holds.
 *
 * It RESOLVES on timeout rather than throwing, which is the important part. The
 * assertion that follows is left to fail with the message it already has, so a broken
 * test reports exactly what it reported before - only a passing one gets faster.
 * Never let this hang, and never let it swallow a failure.
 *
 * Two things it cannot do, both of which mean "keep a real wait":
 *   - assert that something did NOT happen. There is no condition to poll, and until()
 *     would return on the first tick and check a state that had not settled. A test
 *     like that turned into an until() always passes, which is worse than a slow one.
 *   - wait out a debounce whose only effect is one you are asserting the absence of.
 */

export const UNTIL_TIMEOUT = 2000;   /* generous: only ever paid on the way to a failure */
const STEP = 5;

export function until(predicate, timeout = UNTIL_TIMEOUT) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve) => {
    (function poll() {
      let held = false;
      try {
        held = !!predicate();
      } catch (e) {
        /* the DOM the predicate reaches for may not exist yet - that is a "not ready",
           not an error, right up until the deadline */
        held = false;
      }
      if (held || Date.now() >= deadline) return resolve(held);
      setTimeout(poll, STEP);
    })();
  });
}

/* For the cases above, where there is genuinely nothing to poll for. Named so that
   every remaining fixed wait in the suite says out loud that it is deliberate. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The site's data files, read once, and a fetch() that serves them by url.
 *
 * Every test file used to carry its own copy of this stub - nine of them, each a chain of
 * `u.includes("bis.json") ? bis : ...` falling through to loot_data for anything it did
 * not name. That fall-through is the trap: a NEW data file arriving at the page got
 * answered with the loot array, silently, in nine places. rules.json was the one that
 * made it a helper.
 *
 * `overrides` maps a filename fragment to either a body or a function returning a
 * Response-like, for the tests that bend one file on purpose (bis-fallback.mjs). Anything
 * the page asks for that is neither here nor in overrides is a 404 - which is what a
 * missing file IS, and lets the fail-soft paths be tested honestly.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, "data", rel), "utf8"));

export const site = {
  data:      readJson("loot_data.json"),
  rules:     readJson("rules.json"),
  bis:       readJson("bis.json"),
  specs:     readJson("specs.json"),
  listIndex: readJson("lists/index.json"),
  zatarList: readJson("lists/zatar-p3.json")
};

const FILES = [
  ["lists/index.json", "listIndex"], ["zatar-p3.json", "zatarList"], ["rules.json", "rules"],
  ["bis.json", "bis"], ["specs.json", "specs"], ["loot_data.json", "data"]
];

export function siteFetch(overrides = {}) {
  return (url) => {
    const u = String(url);
    for (const key of Object.keys(overrides)) {
      if (u.includes(key)) {
        const o = overrides[key];
        return typeof o === "function" ? o()
          : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      }
    }
    const hit = FILES.find(([frag]) => u.includes(frag));
    if (!hit) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("404 " + u)) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(site[hit[1]]) });
  };
}

/* The app, two ways.
 *
 * appBundle() is what the page RUNS: src/main.js bundled by esbuild into the same single
 * IIFE that ships, built once per test run in memory. Every test that evals the app uses
 * this, so a module that fails to bundle fails every file at once rather than being
 * discovered by a browser.
 *
 * appSource() is what a person WROTE: the src/*.js files concatenated, comments intact.
 * Assertions about structure - "specIcon() does not add the link class", "no
 * window.prompt" - grep this, never the bundle, which esbuild has stripped of comments and
 * so is denser than the source in ways a distance-based regex notices.
 */
import esbuild from "esbuild";

const srcDir = path.join(root, "src");
let bundleCache = null;

export function appBundle() {
  if (bundleCache === null) {
    bundleCache = esbuild.buildSync({
      entryPoints: [path.join(srcDir, "main.js")],
      bundle: true, format: "iife", target: "es2017", write: false, logLevel: "silent"
    }).outputFiles[0].text;
  }
  return bundleCache;
}

export function appSource() {
  return fs.readdirSync(srcDir).filter((f) => f.endsWith(".js")).sort()
    .map((f) => fs.readFileSync(path.join(srcDir, f), "utf8")).join("\n");
}
