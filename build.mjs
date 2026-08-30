/* Builds dist/ - the only thing GitHub Pages should ever serve.
 *
 * This site had no build step for most of its life, deliberately: Pages served the repo
 * root, so what was live was byte-for-byte what was in the repo, and a deploy was a merge.
 * That stopped being tenable once the repo got big. Serving the root meant serving
 * CLAUDE.md (102 KB of internal engineering notes, bug post-mortems included), the test
 * suite, the verify/ scrapers and docs/ - all of it publicly readable at the site's own
 * URL. .gitignore already reasoned about exactly this hazard for zip files; the logic had
 * just never been extended to the docs.
 *
 * So the rule this file breaks is a real one, and what replaced the property it protected
 * is `npm run serve:dist`: when it matters, you can serve and inspect the actual artifact
 * rather than the source it came from.
 *
 * TWO jobs, and the second is the one that would go unnoticed if it broke:
 *
 *   1. minify - 44% of the front-end bytes were comments (app.js 41%, style.css 51%,
 *      index.html 53%), ~52 KB of it gzipped.
 *   2. ship ONLY what the page needs. Anything not copied here is not public. That is the
 *      point of the change, so test/build.mjs asserts the absence rather than trusting it -
 *      one stray copy line is all it would take to put the notes back on the internet.
 */
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

/* Exactly what the page references, verified rather than assumed: index.html links only
   style.css and app.js, and app.js fetches only these four data paths. Wowhead's tooltip
   script and the Supabase SDK are external CDN URLs and need nothing from here. */
export const SHIPPED = ["index.html", "style.css", "app.js", "data"];

/* Identifier renaming is safe on app.js and was checked, not assumed: no eval, no
   `new Function`, nothing reads a function's .name, and the whole file is one
   self-contained IIFE exporting no globals. test/build.mjs is what keeps that true - it
   boots the built file and asserts the page still renders, which is the only thing that
   can catch a minifier breaking the app. */
async function buildJs() {
  const out = await esbuild.build({
    entryPoints: [path.join(root, "app.js")],
    outfile: path.join(dist, "app.js"),
    minify: true,
    /* A classic script, not a module: app.js is loaded with a plain <script> tag and
       executes during parsing, which is load-bearing for the Supabase race described in
       CLAUDE.md section 4. Bundling or wrapping it as ESM would change when it runs. */
    format: "iife",
    target: "es2017",
    legalComments: "none",
    write: true,
    metafile: true
  });
  return out;
}

async function buildCss() {
  await esbuild.build({
    entryPoints: [path.join(root, "style.css")],
    outfile: path.join(dist, "style.css"),
    minify: true,
    loader: { ".css": "css" },
    legalComments: "none"
  });
}

/* Deliberately conservative. esbuild does not do HTML, and a general minifier is not worth
   a new dependency for one file - but nor is a clever regex worth the risk, so this only
   removes comments and collapses the blank lines they leave behind.

   The inline <script> holding whTooltips must not be touched. There are no conditional
   comments here and nothing containing "<!--" inside a script or style block; if that ever
   changes, this needs a real parser rather than a bigger regex. */
function buildHtml() {
  const src = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const out = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n");
  fs.writeFileSync(path.join(dist, "index.html"), out);
}

/* Copied verbatim, not minified. JSON cannot carry comments, so there is nothing to hide,
   and the gzipped saving from stripping whitespace is small. These files are also the one
   part of the site genuinely worth leaving legible to anyone curious enough to look. */
function copyData() {
  fs.cpSync(path.join(root, "data"), path.join(dist, "data"), { recursive: true });
}

export async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const js = await buildJs();
  await buildCss();
  buildHtml();
  copyData();
  return js;
}

/* Only report when run directly - test/build.mjs imports build() and wants it quiet. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build();
  const kb = (p) => (fs.statSync(path.join(dist, p)).size / 1024).toFixed(1) + " KB";
  const was = (p) => (fs.statSync(path.join(root, p)).size / 1024).toFixed(1) + " KB";
  for (const f of ["index.html", "style.css", "app.js"]) {
    console.log(`  ${f.padEnd(12)} ${was(f).padStart(9)} -> ${kb(f).padStart(9)}`);
  }
  console.log(`\n  dist/ holds ${SHIPPED.join(", ")} and nothing else.`);
}
