/* SAVE — the progress that survives closing the tab.
 *
 * A game you cannot come back to is not a product, so this is the module that
 * makes the scenario library into a campaign: which scenarios you have cleared,
 * how well, how far the ladder is open, and whether you have already sat
 * through the title screen once.
 *
 * Three rules shape everything below.
 *
 *   1. IT IMPORTS NOTHING. Same discipline as audio.js: no THREE, no state.js,
 *      no DOM. It loads under Node, it cannot be the reason a render breaks, and
 *      scripts/check-imports.mjs can hold it to that. The cost is that anything
 *      order-dependent (which scenario is next) takes the ordered id list as an
 *      ARGUMENT instead of importing SCENARIOS — which also makes those calls
 *      pure, and testable without the game.
 *
 *   2. IT SAVES IDS AND NUMBERS, NEVER LIVE OBJECTS. `GAME` and `S` are being
 *      reshaped by other lanes right now (waves, noise), and a save file that
 *      mirrors their structure would be broken by the next commit. What goes on
 *      disk is a scenario id plus the four numbers the goal is scored on. There
 *      is deliberately NO mid-scenario save/load: a scenario is a few minutes
 *      long, so "resume where you were" would cost a snapshot of the whole
 *      simulation and buy almost nothing.
 *
 *   3. IT NEVER THROWS. localStorage is not a thing you may assume: file://
 *      (which is how the itch.io build is played), private mode, and a storage
 *      quota all raise on access or on write. Every touch is wrapped, and the
 *      first failure demotes the module to an in-memory store that behaves
 *      identically for the rest of the session — you simply lose the progress
 *      when the tab closes, which is exactly what would have happened anyway.
 *
 * ---------------------------------------------------------------- versioning
 * The schema is still moving, so the record carries `version` and a mismatch is
 * DISCARDED rather than migrated. Losing the progress of a development build is
 * cheap; a half-migrated record that crashes the title screen on someone's
 * machine is not. When the shape settles, this is where a migration would go —
 * one `if(raw.version === 1)` step per bump, feeding into the current shape.
 *
 * ---------------------------------------------------------------- one key
 * Everything lives under a single localStorage key, and every flag lives INSIDE
 * that record (`seen.title`, not a second key called `falcoCity.title`). Other
 * sessions are adding their own screens; a nested field cannot collide with a
 * key they invent, and `resetProgress()` is one removeItem.
 *
 * The exception is on purpose: `src/audio.js` already persists mute and volume
 * under its own `falcoCity.audio.v1`, reads it at import time and rewrites it on
 * every setMuted/setVolume. Mirroring those two values here would create two
 * writers for one fact, and the loser would be whichever module happened to
 * load second. So AUDIO PREFS ARE NOT SAVED HERE — audio.js owns that key, this
 * module does not read it, does not write it, and does not include it in an
 * export. See the note on exportProgress().
 *
 * ---------------------------------------------------------------- the record
 * {
 *   "version": 1,
 *   "savedAt": 1753939200000,
 *   "cleared": {
 *     "slow-output": { "detect":6, "of":6, "asks":0, "dropPct":0.42,
 *                      "attempts":3, "at":1753939200000, "clears":2 }
 *   },
 *   "unlocked": ["nodes-are-not-buffers"],
 *   "seen": { "title": true }
 * }
 */

const SAVE_VERSION = 1;
const SAVE_KEY = 'falcoCity.save.v1';

/* ---------------------------------------------------------------- storage
   `localStorage` can throw on ACCESS and not only on use — Safari with cookies
   blocked raises SecurityError on the property read itself — so every touch goes
   through here and nothing above this line has to know.

   Reading and writing are tracked SEPARATELY on purpose. Private mode hands out
   a store whose getItem works and whose setItem raises, and folding those into
   one flag would mean a failed write also threw away our ability to read the
   progress that is already there. */
let access = true;        // localStorage can be reached at all
let writable = null;      // null = not tried yet

function store(){
  if(!access) return null;
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage : null;
    if(!ls){ access = false; return null; }
    return ls;
  } catch(e){ access = false; return null; }
}

/* Will progress outlive the tab? Answered by actually writing, because nothing
   else is proof: the probe uses a key we own and removes it again. The UI may
   want to say so, quietly, rather than promising a save that will not happen. */
function storageOk(){
  if(writable !== null) return writable;
  const ls = store();
  if(!ls){ writable = false; return false; }
  try {
    const k = SAVE_KEY + '.probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    writable = true;
  } catch(e){ writable = false; }
  return writable;
}

function readRaw(){
  const ls = store();
  if(!ls) return null;
  try { return ls.getItem(SAVE_KEY); } catch(e){ access = false; return null; }
}
function writeRaw(s){
  if(!storageOk()) return false;
  const ls = store();
  if(!ls) return false;
  try { ls.setItem(SAVE_KEY, s); return true; } catch(e){ writable = false; return false; }
}
function dropRaw(){
  const ls = store();
  if(!ls) return false;
  try { ls.removeItem(SAVE_KEY); return true; } catch(e){ writable = false; return false; }
}

/* ---------------------------------------------------------------- shape
   Everything that comes back from storage is untrusted input: hand-edited,
   half-written by a crash, or from a build two schemas ago. So nothing is read
   without being coerced first, and a field that cannot be coerced is dropped
   rather than carried as undefined. */
const now = () => Date.now();

const num = (v, dflt) => (typeof v === 'number' && isFinite(v)) ? v : dflt;
const nonNeg = (v, dflt) => { const n = num(v, dflt); return n < 0 ? dflt : n; };
const round2 = v => Math.round(v * 100) / 100;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = v => typeof v === 'string' && /^[a-z0-9-]+$/.test(v);

function emptyRecord(){
  return { version:SAVE_VERSION, savedAt:0, cleared:{}, unlocked:[], seen:{} };
}

/* the stored form of one clear. `of` is carried so a UI can render 6/6 without
   loading the scenario, and so a later schema change to the chain length cannot
   silently turn an old 6 into a worse-looking score. `clears` is how many times
   it has been beaten; the rest is the best run. */
function cleanResult(r){
  if(!isObj(r)) return null;
  const out = {
    detect: nonNeg(r.detect, 0),
    of: nonNeg(r.of, 0),
    asks: nonNeg(r.asks, 0),
    dropPct: round2(nonNeg(r.dropPct, 0)),
    attempts: Math.max(1, Math.round(nonNeg(r.attempts, 1))),
    at: nonNeg(r.at, 0),
    clears: Math.max(1, Math.round(nonNeg(r.clears, 1)))
  };
  if(out.of && out.detect > out.of) out.detect = out.of;
  return out;
}

/* Reject rather than migrate — see the header. A record we refuse is deleted on
   the spot, so the next write starts from a clean shape instead of merging into
   something we already decided we cannot read. */
function parseRecord(raw){
  if(typeof raw !== 'string' || !raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch(e){ return null; }
  if(!isObj(data)) return null;
  if(data.version !== SAVE_VERSION) return null;

  const rec = emptyRecord();
  rec.savedAt = nonNeg(data.savedAt, 0);
  if(isObj(data.cleared)){
    for(const [id, r] of Object.entries(data.cleared)){
      if(!isId(id)) continue;
      const c = cleanResult(r);
      if(c) rec.cleared[id] = c;
    }
  }
  if(Array.isArray(data.unlocked))
    for(const id of data.unlocked)
      if(isId(id) && !rec.unlocked.includes(id)) rec.unlocked.push(id);
  if(isObj(data.seen))
    for(const [k, v] of Object.entries(data.seen))
      if(typeof k === 'string' && k) rec.seen[k] = !!v;
  return rec;
}

/* ---------------------------------------------------------------- the record
   Held in memory and written through. The in-memory copy is the one the game
   reads, so a storage failure changes durability and nothing else. */
let rec = null;
let discarded = false;   // did we throw away a record on load (UI may say so)

function record(){
  if(rec) return rec;
  const raw = readRaw();
  const parsed = parseRecord(raw);
  if(raw && !parsed){ discarded = true; dropRaw(); }
  rec = parsed || emptyRecord();
  return rec;
}

/* Serialise deterministically: sorted scenario ids and a fixed field order, so
   export -> import -> export is byte-identical and a diff of two save files is
   readable. */
function serialise(r){
  const cleared = {};
  for(const id of Object.keys(r.cleared).sort()) cleared[id] = r.cleared[id];
  return JSON.stringify({
    version: SAVE_VERSION,
    savedAt: r.savedAt,
    cleared,
    unlocked: r.unlocked.slice().sort(),
    seen: Object.fromEntries(Object.keys(r.seen).sort().map(k => [k, r.seen[k]]))
  });
}

/* `savedAt` is when the progress last CHANGED, not when it was last written, so
   an import keeps the timestamp it was handed (touch = false). That is what makes
   export -> import -> export byte-identical, which is the only way a player can
   tell that moving a save between machines actually moved all of it. */
function persist(touch){
  const r = record();
  if(touch !== false) r.savedAt = now();
  return writeRaw(serialise(r));
}

/* ---------------------------------------------------------------- grading
   Which of two clears is the better one. Ordered, not summed into a single
   score: a weighted total would need balance work this does not deserve, and
   the priority is not controversial —
     1. detections, because that is the point of the game
     2. asks, the coordination cost the scenario is actually about
     3. drop rate, lower is better
     4. attempts, so getting it first try beats brute force
   Ties keep the record already stored, which makes re-running a cleared
   scenario non-destructive. */
function rankBetter(a, b){
  if(!a) return false;
  if(!b) return true;
  if(a.detect !== b.detect) return a.detect > b.detect;
  if(a.asks !== b.asks) return a.asks < b.asks;
  if(a.dropPct !== b.dropPct) return a.dropPct < b.dropPct;
  if(a.attempts !== b.attempts) return a.attempts < b.attempts;
  return false;
}

/* ---------------------------------------------------------------- attempts
   "Cleared on the third run" is part of the grade, and the count has to reset
   when the player re-enters the scenario rather than being a lifetime total, so
   it lives in memory and only the winning number is ever stored. `plays` is the
   lifetime one and does go on disk. */
const runs = Object.create(null);

function beginScenario(id){
  if(!isId(id)) return 0;
  runs[id] = 0;
  return 0;
}
/* call once per attack run; returns which attempt this is, 1-based */
function noteAttempt(id){
  if(!isId(id)) return 0;
  runs[id] = (runs[id] || 0) + 1;
  return runs[id];
}
const attemptsFor = id => runs[id] || 0;

/* ---------------------------------------------------------------- public API */

/* The whole record, as a copy. Callers get data they cannot use to corrupt the
   store, which matters because this is what a debug panel will print. */
function loadProgress(){
  const r = record();
  const cleared = {};
  for(const [id, c] of Object.entries(r.cleared)) cleared[id] = {...c};
  return { version:SAVE_VERSION, savedAt:r.savedAt, cleared,
           unlocked:r.unlocked.slice(), seen:{...r.seen},
           storage: storageOk(), discarded };
}

/* Record a clear. `result` is the scoreboard, not the game state:
 *   { detect, of, asks, dropPct, attempts }
 * `attempts` defaults to the run count this module has been keeping, so the
 * usual call site does not have to pass it. Returns
 *   { ok, improved, best, first }
 * — `improved` is what a UI needs to say "new best". */
function recordClear(id, result){
  if(!isId(id)) return { ok:false, improved:false, best:null, first:false };
  const r = record();
  const prev = r.cleared[id] || null;
  const next = cleanResult({
    ...result,
    attempts: (result && result.attempts !== undefined)
      ? result.attempts : (attemptsFor(id) || 1),
    at: now(),
    clears: 1
  });
  if(!next) return { ok:false, improved:false, best:prev ? {...prev} : null, first:false };

  /* the count of clears accumulates; the grade is only ever the best one */
  next.clears = (prev ? prev.clears : 0) + 1;

  const improved = rankBetter(next, prev);
  const best = improved ? next : {...prev, clears:next.clears};
  r.cleared[id] = best;
  persist();
  return { ok:true, improved, best:{...best}, first:!prev };
}

const bestFor = id => { const c = record().cleared[id]; return c ? {...c} : null; };
const isCleared = id => !!record().cleared[id];
const clearedIds = () => Object.keys(record().cleared);
const clearedCount = () => Object.keys(record().cleared).length;

/* ---------------------------------------------------------------- progression
   `orderedIds` is SCENARIOS.map(s => s.id) — already in `order` order, because
   scenarios/index.js sorts them. Passing it in is what keeps this module free of
   imports, and these two functions pure.

   The rule: the first scenario is always open, and clearing one opens the next.
   Anything already cleared stays open, and markUnlocked() is the escape hatch
   for a lane that wants to hand out more than that (a demo build, a level
   select) without inventing its own storage. */
function isUnlocked(id, orderedIds){
  const r = record();
  if(r.cleared[id] || r.unlocked.includes(id)) return true;
  if(!Array.isArray(orderedIds) || !orderedIds.length) return true;
  const i = orderedIds.indexOf(id);
  if(i < 0) return true;              /* unknown to the ladder: not ours to gate */
  if(i === 0) return true;
  return !!r.cleared[orderedIds[i - 1]];
}
const unlockedIds = orderedIds =>
  (Array.isArray(orderedIds) ? orderedIds : []).filter(id => isUnlocked(id, orderedIds));

function markUnlocked(id){
  if(!isId(id)) return false;
  const r = record();
  if(r.unlocked.includes(id)) return true;
  r.unlocked.push(id);
  persist();
  return true;
}

/* Everything a picker or a title screen needs in one call, so no UI has to
   reimplement the ladder. `next` is the first unlocked scenario that is not
   cleared — i.e. where the player left off. */
function progressSummary(orderedIds){
  const ids = Array.isArray(orderedIds) ? orderedIds : [];
  const unlocked = unlockedIds(ids);
  const cleared = ids.filter(id => isCleared(id));
  return {
    total: ids.length,
    cleared: cleared.length,
    unlocked: unlocked.length,
    next: unlocked.find(id => !isCleared(id)) || null,
    complete: ids.length > 0 && cleared.length === ids.length
  };
}

/* ---------------------------------------------------------------- flags
   Boolean one-shots, namespaced inside our own record so another session's
   screen can add `seen.tutorial` without either of us picking a key name the
   other also picked. The title lane wants hasSeen('title'). */
const hasSeen = flag => !!record().seen[flag];
function markSeen(flag, value){
  if(typeof flag !== 'string' || !flag) return false;
  const r = record();
  r.seen[flag] = value === undefined ? true : !!value;
  persist();
  return true;
}

/* ---------------------------------------------------------------- transfer
   There is no server (決定21: one HTML file you double-click), so this is the
   ONLY way a player moves progress between machines, and the only way they can
   keep it across a schema bump that this module would otherwise discard.
   Deliberately not including audio prefs: audio.js owns that key. */
function exportProgress(){ return serialise(record()); }

/* Accepts the string exportProgress() produced, or the parsed object. Replaces
   the record wholesale — merging two save files would need a policy for every
   conflicting field, and "the file you just imported is what you get" is the
   one behaviour nobody has to read documentation for.
   Returns { ok, error, cleared } so a UI can report the failure. */
function importProgress(json){
  let raw = json;
  if(isObj(raw)){
    try { raw = JSON.stringify(raw); } catch(e){ return { ok:false, error:'not serialisable', cleared:0 }; }
  }
  if(typeof raw !== 'string' || !raw.trim()) return { ok:false, error:'empty', cleared:0 };
  const parsed = parseRecord(raw);
  if(!parsed)
    return { ok:false, cleared:0,
             error:`not a falco-city save of version ${SAVE_VERSION}` };
  rec = parsed;
  discarded = false;
  persist(false);
  return { ok:true, error:null, cleared:Object.keys(parsed.cleared).length };
}

function resetProgress(){
  rec = emptyRecord();
  discarded = false;
  for(const k of Object.keys(runs)) delete runs[k];
  dropRaw();
  return true;
}

export {
  SAVE_VERSION,
  SAVE_KEY,
  storageOk,
  loadProgress,
  recordClear,
  bestFor,
  isCleared,
  clearedIds,
  clearedCount,
  isUnlocked,
  unlockedIds,
  markUnlocked,
  progressSummary,
  beginScenario,
  noteAttempt,
  attemptsFor,
  hasSeen,
  markSeen,
  exportProgress,
  importProgress,
  resetProgress
};
