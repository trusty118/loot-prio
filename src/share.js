/* Sharing: the popover, tokens, publishing, and loading a shared list. */
import { closeAcctMenu, closeListMenu, copyToClipboard, openTemplate, renderTemplateBar, shareBlurb, shareLink, shareWouldPublish } from "./bar.js";
import { saveNow } from "./editing.js";
import { announce, closeOpMenu, closePop, placeUnder } from "./editor.js";
import { update } from "./results.js";
import { activeIsMine, activeTemplate, el, sb, setUnsaved } from "./state.js";
import { signedIn, supabaseReady } from "./store.js";
import { decodeTemplate, validateTemplate } from "./templates.js";

/* ---------- the share popover ----------
   The seventh overlay, and built like the other six: created once, parented to <body>
   so no scroll container can clip it, positioned by placeUnder() rather than by
   arithmetic of its own, closed by Escape and by an outside mousedown.

   Two faces, swapped in place, the way the list menu swaps rename and delete:

     "publish"  a list of yours, signed in, not shared yet. States what sharing does,
                and a button to do it. This face exists so that OPENING the popover
                never publishes - looking at a thing must not change it.
     "link"     the link in a field with Copy beside it, plus Stop sharing where there
                is something to stop. Everything else opens straight onto this: signed
                out, zatar's list, or a list already shared has nothing to publish. */

export var sharePop = null;

export function closeSharePop() {
  if (sharePop) sharePop.style.display = "none";
  if (el.shareTrigger) el.shareTrigger.setAttribute("aria-expanded", "false");
}

export function buildSharePop() {
  sharePop = document.createElement("div");
  sharePop.className = "share-pop";
  sharePop.setAttribute("role", "dialog");
  sharePop.setAttribute("aria-label", "Share this list");
  sharePop.style.display = "none";
  document.body.appendChild(sharePop);

  sharePop.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); closeSharePop(); el.shareTrigger.focus(); }
  });
}

export function renderSharePublishFace() {
  sharePop.innerHTML = "";
  var head = document.createElement("p");
  head.className = "share-head";
  head.textContent = "Share \u201c" + activeTemplate.name + "\u201d";
  sharePop.appendChild(head);

  var body = document.createElement("p");
  body.className = "share-note";
  /* It used to say readers "will see your edits as you make them", which stopped
     being true the moment publishing became a snapshot. A share panel that describes
     the wrong behaviour is worse than one that says nothing. */
  body.textContent = "Publishing gives you a short link to this list as it is right " +
    "now. Carry on editing afterwards - nobody sees those changes until you publish " +
    "again. You can stop sharing at any time.";
  sharePop.appendChild(body);

  var go = document.createElement("button");
  go.type = "button";
  go.className = "share-go";
  go.textContent = "Publish this list";
  go.addEventListener("click", function () {
    go.disabled = true;
    publishNow().then(function () { renderShareLinkFace(); });
  });
  sharePop.appendChild(go);
  go.focus();
}

/* Which render of this face is current. shareLink() is async, and the face is rebuilt
   whenever it is reopened or republished - so without this an earlier call resolving
   late writes its url into a field that has already been thrown away, and the one on
   screen stays on "Preparing..." for good. */
export var shareRender = 0;

export function renderShareLinkFace() {
  var mine = ++shareRender;
  sharePop.innerHTML = "";
  var head = document.createElement("p");
  head.className = "share-head";
  head.textContent = activeTemplate ? "Link to \u201c" + activeTemplate.name + "\u201d"
                                    : "Link to this view";
  sharePop.appendChild(head);

  var row = document.createElement("div");
  row.className = "share-row";
  var field = document.createElement("input");
  field.type = "text";
  field.className = "share-field";
  field.readOnly = true;
  field.value = "Preparing\u2026";
  field.setAttribute("aria-label", "Share link");
  var copy = document.createElement("button");
  copy.type = "button";
  copy.className = "share-copy";
  copy.textContent = "Copy";
  copy.disabled = true;
  row.appendChild(field);
  row.appendChild(copy);
  sharePop.appendChild(row);

  var note = document.createElement("p");
  note.className = "share-note";
  sharePop.appendChild(note);

  shareLink().then(function (url) {
    if (mine !== shareRender) return;   /* a newer render owns the panel now */
    field.value = url;
    /* On a list of your own the useful line is not how long the link is, it is how
       far the draft has drifted from what the guild is actually reading. */
    /* Only on the account path. Signed out there is nothing to publish - the link IS
       the list - so that case keeps the warning about how long it is. */
    note.textContent = (activeTemplate && activeIsMine && signedIn() && supabaseReady())
      ? publishedBlurb(activeTemplate) : shareBlurb(url);
    copy.disabled = false;
    copy.addEventListener("click", function () {
      field.select();
      copyToClipboard(url);
    });
    field.focus();
    field.select();
    /* the link is longer than the field once published, and the panel is anchored
       under a button whose position has not moved - re-place in case it grew */
    placeUnder(sharePop, el.shareTrigger);

    /* Offered only when there is something to send, so the button is never a no-op */
    if (activeTemplate && activeIsMine && changedSincePublish(activeTemplate)) {
      var again = document.createElement("button");
      again.type = "button";
      again.className = "share-go";
      again.textContent = "Publish changes";
      again.addEventListener("click", function () {
        again.disabled = true;
        publishNow().then(function () { renderShareLinkFace(); });
      });
      sharePop.appendChild(again);
    }

    if (activeTemplate && activeIsMine && activeTemplate.shared) {
      var stop = document.createElement("button");
      stop.type = "button";
      stop.className = "share-stop";
      stop.textContent = "Stop sharing";
      stop.addEventListener("click", function () {
        closeSharePop();
        stopSharing();
      });
      sharePop.appendChild(stop);
    }
  }, function (err) {
    if (mine !== shareRender) return;
    field.value = "";
    note.textContent = "Could not make a link: " + err.message;
  });
}

export function toggleSharePop() {
  if (!sharePop) buildSharePop();
  if (sharePop.style.display === "block") { closeSharePop(); return; }
  closePop();                       /* only one overlay at a time */
  closeOpMenu();
  closeListMenu();
  closeAcctMenu();
  sharePop.style.display = "block";
  el.shareTrigger.setAttribute("aria-expanded", "true");
  if (shareWouldPublish()) renderSharePublishFace();
  else renderShareLinkFace();
  placeUnder(sharePop, el.shareTrigger);
}

export function makeShareToken() {
  var b = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(b);
  var s = "";
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* A link that carries a token instead of the list. The whole template used to travel
   in the URL, which capped what a list could hold - the notes are what would have
   broken it. This carries about thirty characters no matter how much the list says.

   It is also live: the recipient reads the row, so a call you fix reaches everyone
   holding the link. That is a real change from the frozen copy `#t=` gives, and it is
   why Stop sharing exists - a live link needs a way to stop being one. */
export function shareServerSide() {
  if (!activeTemplate) return null;
  if (!(signedIn() && supabaseReady() && activeIsMine)) return null;
  if (!activeTemplate.share_token) activeTemplate.share_token = makeShareToken();
  activeTemplate.shared = true;
  setUnsaved(true);
  return saveNow().then(function () {
    return location.origin + location.pathname + "?s=" +
      encodeURIComponent(activeTemplate.share_token) + location.hash;
  });
}

/* ---------- publishing ----------

   A list has two faces: the draft its owner edits, and the snapshot the share link
   hands out. Publishing copies one onto the other. The link never changes - it
   carries a token pointing at the row, and the row decides which version to serve.

   This is a plain update run as the signed-in owner, under the existing
   `auth.uid() = user_id` policy. It must NEVER become a security-definer function
   taking a share token: that would let anyone holding the read link publish over the
   draft, which is the one way this feature could be got badly wrong. */

export function publishNow() {
  if (!activeTemplate || !activeIsMine) return Promise.resolve();
  var t = activeTemplate;
  /* deep-copied, so later edits to the draft cannot reach into what was published */
  t.published_priorities = JSON.parse(JSON.stringify(t.priorities || {}));
  t.published_notes = JSON.parse(JSON.stringify(t.notes || {}));
  t.published_at = new Date().toISOString();
  setUnsaved(true);
  return saveNow();
}

/* How far the draft has moved from what the guild is reading. Counts items, not
   keystrokes, because "23 items changed" is the number a council can act on. */
export function changedSincePublish(t) {
  if (!t || !t.published_at) return 0;
  var pubP = t.published_priorities || {}, pubN = t.published_notes || {};
  var liveP = t.priorities || {}, liveN = t.notes || {};
  var ids = {}, count = 0;
  Object.keys(liveP).forEach(function (k) { ids[k] = 1; });
  Object.keys(pubP).forEach(function (k) { ids[k] = 1; });
  Object.keys(liveN).forEach(function (k) { ids[k] = 1; });
  Object.keys(pubN).forEach(function (k) { ids[k] = 1; });
  Object.keys(ids).forEach(function (k) {
    var pChanged = JSON.stringify(liveP[k] || []) !== JSON.stringify(pubP[k] || []);
    var nChanged = (liveN[k] || "") !== (pubN[k] || "");
    if (pChanged || nChanged) count++;
  });
  return count;
}

export function publishedBlurb(t) {
  if (!t || !t.published_at) return "Not published yet - nobody can open the link.";
  var changed = changedSincePublish(t);
  var when = String(t.published_at).slice(0, 10);
  return changed
    ? "Published " + when + ". " + changed + (changed === 1 ? " item has" : " items have")
      + " changed since - publish again to send them."
    : "Published " + when + ". The link is up to date.";
}

export function stopSharing() {
  if (!activeTemplate || !activeIsMine) return;
  activeTemplate.shared = false;
  setUnsaved(true);
  saveNow().then(function () {
    announce("Stopped sharing \u201c" + activeTemplate.name + "\u201d - the link no longer opens it");
    renderTemplateBar();
  });
}

/* Someone else's list, fetched by token. The table itself stays unreadable to an
   anonymous caller - this goes through a security-definer function that can only
   return a row that is both flagged shared and matched by an exact token. */
export function hasShareToken() {
  return /[?&]s=([^&]+)/.test(location.search);
}

export function loadSharedByToken() {
  var m = /[?&]s=([^&]+)/.exec(location.search);
  if (!m) return false;
  if (!supabaseReady()) return true;    /* handled, just not yet - see initAuth */
  sb.rpc("get_shared_list", { token: decodeURIComponent(m[1]) }).then(function (res) {
    var row = res.data && res.data.length ? res.data[0] : null;
    if (res.error || !row) {
      /* A paused project fails as a transport error rather than an empty answer, and
         the raw message is a Postgres string nobody outside this repo can act on.
         Empty means the token is wrong or the list was unshared - both of which are
         the same thing to whoever is holding the link. */
      announce(res.error ? "That shared link could not be opened right now - try again in a moment"
                         : "That link does not open a list any more");
      update();
      return;
    }
    var why = validateTemplate(row);
    if (why) { announce("That shared list will not load: " + why); update(); return; }
    /* the server said so, not the payload - which is what lets its author be shown */
    row.sharedFrom = "server";
    openTemplate(row, false);
    announce("Opened shared list: " + row.name + " - Make a copy to change it");
    update();
  });
  return true;
}

export function loadSharedTemplate() {
  if (loadSharedByToken()) return;
  var m = /(?:^|&)t=([^&]+)/.exec(location.hash.replace(/^#/, ""));
  if (!m) return;
  decodeTemplate(decodeURIComponent(m[1])).then(function (doc) {
    var why = validateTemplate(doc);
    if (why) { announce("That shared list will not load: " + why); update(); return; }
    openTemplate({
      v: doc.v,
      id: "t" + Date.now().toString(36),
      name: doc.name || "Shared list",
      created: new Date().toISOString().slice(0, 10),
      base: doc.base || "zatar",
      priorities: doc.priorities
    }, false);
    announce("Opened shared list: " + activeTemplate.name + " - Make a copy to change it");
    update();
  }, function (err) {
    announce("That shared link did not work: " + err.message);
    update();
  });
}
