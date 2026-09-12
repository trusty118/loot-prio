/* The page's shared mutable state - `state`, the loaded data, the open list - and the setters other modules must use to change it. */

export var state = {
  phase: "",       // "" = none picked, so only the phase pills show
  zone: "",        // "" = all
  boss: "",        // "" = all
  bossZone: "",    // which zone's boss - only meaningful alongside boss
  classes: [],     // multi-select class identifiers; [] = all
  specs: [],       // multi-select spec identifiers, each refining one of the above
  bisOnly: false,  // narrow to the selected specs' BiS lists
  bisSource: "wowhead",   // which BiS data the rings come from; see BIS_SOURCES
  roles: [],       // multi-select; [] = all
  type: "",
  slot: "",
  q: "",
  editing: false,  // edit mode: priority cells become editable
  sort: "",        // "" = leave rows in source order
  dir: "asc"
};

export var ALL = [];

export var el = {
  phaseChips: document.getElementById("phase-chips"),
  zoneChips: document.getElementById("zone-chips"),
  bossRow: document.getElementById("boss-row"),
  bossChips: document.getElementById("boss-chips"),
  classChips: document.getElementById("class-chips"),
  specChips: document.getElementById("spec-chips"),
  specRow: document.getElementById("spec-row"),
  type: document.getElementById("type-select"),
  slot: document.getElementById("slot-select"),
  search: document.getElementById("search"),
  reset: document.getElementById("reset"),
  metaZone: document.getElementById("meta-zone"),
  count: document.getElementById("count"),
  results: document.getElementById("results"),
  templateBar: document.getElementById("template-bar"),
  listTrigger: document.getElementById("list-trigger"),
  listTriggerName: document.getElementById("list-trigger-name"),
  listWarn: document.getElementById("list-warn"),
  tplDirty: document.getElementById("tpl-dirty"),
  editToggle: document.getElementById("edit-toggle"),
  signIn: document.getElementById("sign-in"),
  account: document.getElementById("account"),
  accountName: document.getElementById("account-name"),
  shareTrigger: document.getElementById("share-trigger"),
  editPill: document.getElementById("edit-pill"),
  editMsg: document.getElementById("edit-msg"),
  editHint: document.getElementById("edit-hint"),
  refine: document.querySelector(".controls--refine")
};

/* Three views, one variable and one flag. zatar's list and a list that arrived on
   a link are reference; only a list in your own store is a workspace. */
export var activeTemplate = null;   /* the list being VIEWED; null means zatar's */
export var activeIsMine = false;    /* is it in your store? false for one from a #t= link */
export var unsaved = false;         /* an edit made but not yet written back */
export var sb = null;            /* the Supabase client, once it exists */
export var session = null;       /* the signed-in session, or null */

/* The ONLY writes to shared state from outside this module go through these. An ES
   module can read another's `export var` as a live binding but cannot assign it, so
   every cross-module write is a call here - which is also the list of what is shared. */
export function setAll(v) { ALL = v; }
export function setActive(t, mine) { activeTemplate = t; activeIsMine = !!mine; }
export function setUnsaved(v) { unsaved = v; }
export function setSession(v) { session = v; }
export function setSb(v) { sb = v; }
