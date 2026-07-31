/* CAMPAIGNS — attack campaigns, generated instead of written.
 *
 * PURE DATA + PURE FUNCTIONS. This module imports NOTHING: not campaign.js, not
 * vulns.js, not state.js. Everything it needs arrives as an argument, so it can
 * be run in plain Node, serialised to JSON, and ported to Unity without dragging
 * the engine behind it. What it returns is plain data too — strings, numbers,
 * arrays — never a closure and never a live reference.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Nine hand-written scenarios are nine situations. Replayability cannot come
 * from writing a tenth (SHIP-GATE §3 already ruled that out), so it comes from
 * here: the production phase generates the attack from the situation.
 *
 * AND IT IS NOT RANDOM. Three things decide what comes, in this order:
 *
 *   1. WHAT IS POSSIBLE      a step whose needsCaps the environment does not
 *                            satisfy is not "missed", it cannot happen. It is
 *                            never generated. (The regression harness draws the
 *                            same line: INVARIANTS 3.8 / 3.10.)
 *   2. WHERE THE HOLES ARE   a step the current posture cannot catch scores far
 *                            above one it can. An attacker probing until
 *                            something works is not a difficulty setting, it is
 *                            what an attacker is — and it makes the generated
 *                            attack a QUESTION ABOUT YOUR CONFIGURATION rather
 *                            than a dice roll.
 *   3. WHAT IS NEW           freshly disclosed vulnerabilities outrank old ones,
 *                            so the attack surface moves with game time. This is
 *                            the keystone: without it "never upgrade, never
 *                            patch" wins (GAME-DESIGN §3 要点 4).
 *
 * The seeded RNG only breaks ties (±JITTER). Same seed, same posture, same
 * vulnerabilities → byte-identical campaign.
 *
 * MATERIAL: THE EXISTING CHAIN
 * ----------------------------
 * A generated step is built by COPYING needs / needsCaps / needsSyscalls from a
 * step of the hand-written CHAIN (campaign.js). Nothing here invents a
 * requirement, so campaign.js's evaluate() scores a generated campaign with no
 * change at all — evaluate(chain, opts) already takes the chain as an argument.
 * campaign.js is the rules lane's file; this module reads it through a parameter
 * and never imports or modifies it.
 *
 * FAIRNESS IS CHECKED, NOT ASSUMED
 * --------------------------------
 * auditCampaign() proves every generated step has at least one move that would
 * have caught it, and that closing the whole campaign takes no more than
 * FAIRNESS.maxRemedies distinct moves — one turn's worth. A generated attack you
 * cannot answer is a bug in this file, and it is the bug this file is most
 * likely to have.
 */


/* ---------------------------------------------------------------- totality
   THIS MODULE NEVER THROWS. It returns an answer, or an empty one.
 *
 * The contract (CONTRACT-datalayer.md §1) says a bad input comes back as an
 * ERROR VALUE and not as an exception, and this file was breaking that:
 * `normalisePosture({caps:5})` threw `TypeError: number 5 is not iterable`
 * because `new Set(5)` does. The inspection lane hit it while writing the F6
 * checks — i.e. the first caller that was not us hit it immediately.
 *
 * Fuzzing all eight files afterwards found 115 more of the same shape, so this
 * is not one bug; it is a missing idiom. These four coercions are that idiom,
 * and every public entry point below runs its arguments through them. Callers
 * that want to KNOW the input was wrong ask `postureErrors()`.
 *
 * `str()` also absorbs Symbol, which `String()` throws on. Cheap, so it is in. */
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const num = (v, d = 0) => Number.isFinite(v) ? v : d;
const str = v => typeof v === 'string' ? v
               : (v == null || typeof v === 'symbol') ? '' : String(v);

/* ---------------------------------------------------------------- rng
   mulberry32. Seeded, tiny, and identical across engines — the harness in
   scripts/harness/env.mjs pins Math.random with the same one. */
function makeRng(seedIn = 1){
  let a = (num(seedIn, 1) | 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- phases
   The order an intrusion actually goes in, so a generated campaign reads as one
   story rather than a bag of steps. Keyed by CHAIN step id: adding a step to the
   chain without adding it here costs nothing (it falls back to 'access'), which
   is the same tolerance layout.js gives a new district. */
const PHASES = [
  { id:'recon',  jp:'偵察' },
  { id:'access', jp:'侵入' },
  { id:'creds',  jp:'資格情報' },
  { id:'persist',jp:'永続化' },
  { id:'exfil',  jp:'持ち出し' }
];
const PHASE_OF = {
  k8sapi:'recon', exec:'access', shadow:'creds', imds:'creds',
  cron:'persist', dropbin:'persist', cloud:'exfil'
};
const phaseOf = st => PHASE_OF[obj(st).id] || (obj(st).response ? 'exfil' : 'access');
const phaseRank = id => { const i = PHASES.findIndex(p => p.id === id); return i < 0 ? 1 : i; };

/* ---------------------------------------------------------------- intents
   The shape of a campaign, as the player reads it. Chosen from what the
   generated steps turned out to be — never chosen first and then filled in,
   because then the label could disagree with the attack. */
const INTENTS = [
  { id:'fresh-exploit', jp:'公開直後の脆弱性を踏む',
    blurb:'新しく公開された穴を、まだ手が回っていないうちに踏みに来る。' },
  { id:'blind-probe', jp:'計測されていない道を通る',
    blurb:'鳴らない道を探して通る。ドロップも上がらないので、HUD は最後まで健全に見える。' },
  { id:'credential-theft', jp:'資格情報を集めて外へ出る',
    blurb:'読める資格情報を集め、別のソースへ渡って出ていく。' },
  { id:'persistence', jp:'居座る',
    blurb:'落とす・書く・戻ってくる。止められなければ次の波でも同じ道を使う。' },
  { id:'sweep', jp:'ひととおり試す',
    blurb:'目立った穴が無いので、通る道を上から順に試している。' }
];
const intentById = id => INTENTS.find(i => i.id === id) || INTENTS[4];

/* ---------------------------------------------------------------- posture
   The configuration a campaign is generated AGAINST, as plain data. The rules
   lane builds one of these from GAME / S in a few lines (see BOARD §2); nothing
   in here reads live state.

     built        district ids that are standing AND working (state.js working())
     caps         capabilities the deployment has (kernelPath / apiServer / ...)
     tracedOff    syscalls a NEGATIVE base_syscalls.custom_set has switched off
                  (campaign.js negatedSyscalls())
     following    falcoctl is fetching AND following the artifacts. false models
                  the standing-but-stale case campaign.js already has a
                  requirement for (REQUIREMENTS.falcoctl follow-refs)
     rulesetTick  the tick the ruleset was last updated at, or null for "current".
                  A detection that shipped later than this is not on the node yet
     patched      vulnerability ids that are closed
     stack        'oss' | 'sysdig'. Affects PRIORITISATION only, never detection
     profile      the archetype id, and which chain steps its business is
                  exposed to. Optional.
     forbidden    REMEDY KINDS THIS SITUATION CANNOT PERFORM — 'follow', 'update',
                  'untrace', 'build', 'patch'. Not a difficulty setting: it is
                  archetypes.js §policy.unsatisfiable made legible to the
                  generator. 製造業 can stand falcoctl up but cannot reach an OCI
                  registry, so `artifact.follow.refs` never comes true and every
                  incubating / sandbox detection is permanently out of reach.
                  WITHOUT THIS FIELD THE GENERATOR CANNOT TELL A CEILING FROM A
                  DEAD END, and it produced campaigns where four of five steps had
                  no answer at all (measured: 製造業 dropped to 20% coverage with
                  0 moves available at tick 12–24). See §fairness pass 3. */
const POSTURE_DEFAULTS = {
  built:[], caps:['kernelPath'], tracedOff:[], following:true,
  rulesetTick:null, patched:[], stack:'oss', profile:null, focus:[], forbidden:[]
};
function normalisePosture(postureIn = {}){
  const p = { ...POSTURE_DEFAULTS, ...obj(postureIn) };
  /* every list is coerced, never spread blind: `new Set(5)` throws and a posture
     assembled from live state is exactly where a stray number comes from */
  return {
    built:[...new Set(arr(p.built).map(str).filter(Boolean))],
    caps:[...new Set(arr(p.caps).map(str).filter(Boolean))],
    tracedOff:[...new Set(arr(p.tracedOff).map(str).filter(Boolean))],
    following: p.following !== false,
    rulesetTick: Number.isFinite(p.rulesetTick) ? p.rulesetTick : null,
    patched:[...new Set(arr(p.patched).map(str).filter(Boolean))],
    stack: p.stack === 'sysdig' ? 'sysdig' : 'oss',
    profile: p.profile ? str(p.profile) : null,
    focus:[...new Set(arr(p.focus).map(str).filter(Boolean))],
    forbidden:[...new Set(arr(p.forbidden).map(str).filter(Boolean))]
  };
}

/* WHAT WAS WRONG WITH THE POSTURE, as data. Same shape and same reason as
   timeline.js §timelineErrors and score.js §scoreErrors: `normalisePosture()`
   is total so the game keeps running, and this is how a caller finds out it
   handed over something it did not mean to. Empty is the healthy answer. */
function postureErrors(postureIn, label){
  const name = label || 'posture';
  const out = [];
  if(postureIn === undefined || postureIn === null) return out;   /* defaults are fine */
  if(typeof postureIn !== 'object' || Array.isArray(postureIn))
    return [`${name}: must be an object`];
  for(const k of ['built','caps','tracedOff','patched','focus','forbidden'])
    if(postureIn[k] !== undefined && !Array.isArray(postureIn[k]))
      out.push(`${name}.${k}: must be an array of ids, got ${typeof postureIn[k]}`);
  for(const k of ['built','caps','tracedOff','patched','focus','forbidden'])
    for(const [i, v] of arr(postureIn[k]).entries())
      if(typeof v !== 'string' || !v)
        out.push(`${name}.${k}[${i}]: must be a non-empty string id`);
  if(postureIn.rulesetTick !== undefined && postureIn.rulesetTick !== null
     && !Number.isFinite(postureIn.rulesetTick))
    out.push(`${name}.rulesetTick: must be a finite number or null`);
  if(postureIn.stack !== undefined && !['oss','sysdig'].includes(postureIn.stack))
    out.push(`${name}.stack: must be 'oss' or 'sysdig'`);
  for(const k of Object.keys(postureIn))
    if(!(k in POSTURE_DEFAULTS)) out.push(`${name}: unknown key "${k}"`);
  return out;
}

/* ---------------------------------------------------------------- steps
   A vulnerability becomes a step by borrowing the CHAIN step named in its
   `detect.via`: same needs, same needsCaps, same needsSyscalls. Two additions,
   both of them requirements the model already has:

     'falcoctl' in needs      when detect.newRule is true. The detection is an
                              incubating / sandbox artifact, so it is not in the
                              default package (INVARIANTS 4.1 / 4.5) — you do not
                              have it until 09 ルール配布 fetches it.
     ruleSince                the tick that artifact became available. A player
                              whose ruleset is older than this does not have the
                              rule even with falcoctl standing. Today's engine
                              expresses the coarse version of this through the
                              follow-refs requirement; `ruleSince` is here so the
                              rules lane can make it per-rule without this file
                              changing (see BOARD §2). */
function vulnStep(vuln, chainSteps){
  const v = obj(vuln), d = obj(v.detect);
  if(!v.id || !d.via) return null;
  const via = arr(chainSteps).find(s => obj(s).id === d.via);
  if(!via) return null;
  const newRule = !!d.newRule;
  const needs = [...new Set([...arr(via.needs), ...(newRule ? ['falcoctl'] : [])])];
  return {
    id:`v-${v.id}`,
    jp:`${v.code} を踏む — ${v.jp}`,
    rule: d.rule || via.rule,
    needs,
    needsCaps:[...arr(via.needsCaps)],
    needsSyscalls:[...arr(via.needsSyscalls)],
    /* generated-step metadata. Prefixed so nothing can confuse it with the
       hand-written chain's own fields. */
    gen:true,
    via: via.id,
    vuln: v.id,
    mw: v.mw,
    sev: v.sev,
    maturity: d.maturity || 'stable',
    newRule,
    since: num(v.t),
    ruleSince: newRule ? num(v.t) + 1 : 0,
    why: newRule
      ? `${v.why} この検知は <b>${d.maturity}</b> なので既定パッケージに入っていない — `+
        '<code>falcoctl</code> が取得して<b>追従している</b>ことが条件。'
      : v.why
  };
}
/* a plain chain step, copied so the caller's CHAIN is never mutated */
function baseStep(st){
  const s = obj(st);
  return { ...s, needs:[...arr(s.needs)],
           needsCaps:[...arr(s.needsCaps)],
           needsSyscalls:[...arr(s.needsSyscalls)],
           gen:false, since:0, ruleSince:0, newRule:false };
}

/* ---------------------------------------------------------------- evasion
   Why a step would get through the CURRENT posture, and what would have stopped
   it. Checked in the order the event meets them, which is the order
   campaign.js's evaluate() checks them in — so the two cannot disagree about
   the cause.

   A missing capability is NOT evasion. It means the behaviour cannot occur in
   this environment at all, and generating it would blame the platform role for
   something the model never did (campaign.js §needsCaps). Those steps are
   filtered out before this is ever called. */
const REMEDY_TEXT = {
  build:'を建てる',
  follow:'ルールの追従を有効にする（<code>artifact.follow.refs</code>）',
  untrace:'を <code>base_syscalls.custom_set</code> の負の指定から外す',
  patch:'にパッチを当てる',
  update:'ルールセットを更新する'
};
/* possible in this environment at all */
const possibleHere = (st, caps) =>
  arr(obj(st).needsCaps).every(c => arr(caps).includes(c));

const DISTRICT_ROLE = {                /* campaign.js OWNER, by id not by import */
  driver:'platform', state:'platform', ring:'sre',
  rules:'detect', plugins:'detect', falcoctl:'detect',
  outputs:'soc', sysdig:'soc', workloads:null
};
/* campaign.js BUILD_ORDER, by id rather than by import: the MOST UPSTREAM gap is
   the one that actually stopped the event, so it is the one to name. Unknown ids
   sort last, which is the same tolerance PHASE_OF gives a new step. */
const DISTRICT_ORDER = ['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'];
const upstreamFirst = ids => ids.slice().sort((a, b) => {
  const x = DISTRICT_ORDER.indexOf(a), y = DISTRICT_ORDER.indexOf(b);
  return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
});
function evadesPosture(stIn, postureIn){
  const st = obj(stIn);
  const p = normalisePosture(postureIn);
  /* a behaviour this environment cannot produce is not a miss and not a hole —
     it is a non-event (campaign.js §needsCaps). Named so a caller that changed
     the environment after generating cannot silently score it as caught. */
  if(!possibleHere(st, p.caps))
    return { evades:false, cause:'impossible', target:null, remedy:null };
  const missing = upstreamFirst(arr(st.needs).filter(k => !p.built.includes(k)));
  if(missing.length)
    return { evades:true, cause:'unbuilt', target:missing[0],
             remedy:{ kind:'build', target:missing[0], role:DISTRICT_ROLE[missing[0]] || null,
                      jp:`<b>${missing[0]}</b>${REMEDY_TEXT.build}` } };
  if(arr(st.needs).includes('falcoctl') && !p.following)
    return { evades:true, cause:'stale', target:'falcoctl',
             remedy:{ kind:'follow', target:'falcoctl', role:'detect', jp:REMEDY_TEXT.follow } };
  if(st.ruleSince && p.rulesetTick != null && p.rulesetTick < st.ruleSince)
    return { evades:true, cause:'stale', target:'falcoctl',
             remedy:{ kind:'update', target:'falcoctl', role:'detect', jp:REMEDY_TEXT.update } };
  const need = arr(st.needsSyscalls);
  if(need.length && need.every(n => p.tracedOff.includes(n)))
    return { evades:true, cause:'blind', target:need[0],
             remedy:{ kind:'untrace', target:need[0], role:'sre',
                      jp:`<code>!${need[0]}</code>${REMEDY_TEXT.untrace}` } };
  return { evades:false, cause:null, target:null, remedy:null };
}

/* Every move that would have answered this step. More than one usually exists —
   that is what keeps a generated attack fair — and patching is listed as one of
   them precisely so the player can see the choice the whole design is about:
   CLOSE IT, OR CATCH IT.

   `vulnIndex` maps vulnerability id -> the vulnerability, and the only field read
   off it is `blocked`: whether a patch move exists for that component at all
   (vulns.js vulnsFor() resolves it). When it is true, patching is not an answer,
   and detection is the only control left — which is the manufacturing case, and
   it has to fall out of the data rather than out of a special case here. */
function remediesForStep(stIn, postureIn, vulnIndex){
  const st = obj(stIn);
  const p = normalisePosture(postureIn);
  const out = [];
  const ev = evadesPosture(st, p);
  if(ev.remedy) out.push(ev.remedy);
  if(st.vuln){
    const lookup = vulnIndex && typeof vulnIndex.get === 'function' ? vulnIndex : null;
    const v = lookup ? lookup.get(st.vuln) : null;
    const blocked = !!(v && v.blocked);
    if(!p.patched.includes(st.vuln))
      out.push({ kind:'patch', target:st.vuln, role:'app', blocked,
                 jp:`<b>${st.vuln}</b>${REMEDY_TEXT.patch}`
                    + (blocked ? '（<b>この構成では当てられない</b>）' : '') });
  }
  return out;
}

/* ---------------------------------------------------------------- scoring
   Structure first, dice last. JITTER is small enough that it can only reorder
   candidates that are already equivalent — if it could outrank a blind spot the
   generator would be random, and a random generator teaches nothing. */
const WEIGHT = {
  evades:100,        // a hole is what an attacker is looking for
  fresh:20,          // newly disclosed outranks old
  freshDecay:2,      // per tick of age
  severity:15,       // crit > high > med, scaled by weight
  focus:8,           // this industry is exposed to this behaviour
  inUse:6,           // vulnerable code that is actually loaded
  jitter:3
};
function scoreStep(st, ctx){
  const p = ctx.posture;
  let s = 0;
  const ev = evadesPosture(st, p);
  if(ev.evades) s += WEIGHT.evades;
  if(st.gen){
    const age = Math.max(0, ctx.tick - st.since);
    s += Math.max(0, WEIGHT.fresh - WEIGHT.freshDecay * age);
    s += WEIGHT.severity * (ctx.sevWeight[st.sev] ?? 0.3);
    const v = ctx.vulnIndex.get(st.vuln);
    if(v && v.inUse) s += WEIGHT.inUse;
  }
  if(p.focus.includes(st.via || st.id)) s += WEIGHT.focus;
  s += ctx.rng() * WEIGHT.jitter;
  return { st, s, ev };
}

/* ---------------------------------------------------------------- fairness */
const FAIRNESS = {
  maxRemedies:3,     // distinct moves needed to close one campaign: one turn
  minCatchable:1,    // the player has to see that the campaign happened
  minSteps:2,
  maxSteps:5,
  /* A CEILING IS CONTENT. A DEAD END IS A BUG.
     製造業 genuinely cannot obtain an incubating detection: falcoctl stands but
     `artifact.follow.refs` never resolves on an isolated network, and every one
     of its components has `patch.blocked`. So SOME steps have no answer, and that
     is the lesson the archetype exists to teach — GAME-DESIGN §4 ① calls it
     「パッチが使えない → 検知が唯一の統制」 and archetypes.js declares the resulting
     ceiling as `goal.detect:4` out of seven.
     What is NOT the lesson is a whole campaign of them. Measured before this cap:
     製造業 sat at 20% coverage with ZERO available moves from tick 12 onward —
     four of five steps unanswerable, nothing to do, no way to read why. That is
     不条理, and GATE-FREEPLAY F6 is the line. One per campaign keeps the ceiling
     visible and keeps the turn playable. */
  maxUnanswerable:1
};

/* ---------------------------------------------------------------- generate
   opts:
     chain      the CHAIN from campaign.js (array of steps). REQUIRED.
     vulns      resolved vulnerabilities (vulns.js vulnsFor → each with .t).
                Only ones disclosed by `tick` and not patched are used.
     posture    see §posture
     tick       game time
     seed       reproducibility
     size       how many steps to send (clamped to FAIRNESS)
   returns plain data. */
function generateCampaign(optsIn = {}){
  const opts = obj(optsIn);
  const chainSteps = arr(opts.chain);
  const tickNo = num(opts.tick);
  const p = normalisePosture(opts.posture);
  const seedIn = num(opts.seed, 1);
  const rng = makeRng(hashSeed(`${seedIn}#${tickNo}#${p.profile || ''}`));
  const sevW = obj(opts.sevWeight).crit !== undefined
             ? obj(opts.sevWeight) : { crit:1.0, high:0.6, med:0.3 };

  /* which vulnerabilities are actually in play */
  const live = arr(opts.vulns).map(obj)
    .filter(v => !!v.id && num(v.t) <= tickNo && !p.patched.includes(v.id));
  const vulnIndex = new Map(live.map(v => [v.id, v]));

  /* candidates: the library, plus one per live vulnerability */
  const candidates = [];
  for(const s of chainSteps){
    if(s.response) continue;
    const st = baseStep(s);
    if(possibleHere(st, p.caps)) candidates.push(st);
  }
  for(const v of live){
    const st = vulnStep(v, chainSteps);
    if(st && possibleHere(st, p.caps)) candidates.push(st);
  }
  if(!candidates.length)
    return emptyCampaign(tickNo, seedIn, p, 'この環境ではどの段も成立しない');

  const ctx = { posture:p, tick:tickNo, rng, sevWeight:sevW, vulnIndex };
  const ranked = candidates.map(st => scoreStep(st, ctx))
                           .sort((x, y) => y.s - x.s
                                        || phaseRank(phaseOf(x.st)) - phaseRank(phaseOf(y.st))
                                        || (x.st.id < y.st.id ? -1 : 1));

  const want = Math.max(FAIRNESS.minSteps,
                Math.min(FAIRNESS.maxSteps, opts.size ?? 4, ranked.length));

  /* --- selection: rank order, capped on steps with no answer at all -------
     `answerable` asks the question auditCampaign() asks, at generation time, so
     the generator cannot produce what the audit will then call a dead end. It has
     to consult `p.forbidden` — without it a step whose only remedy is
     `follow` looks answerable to the generator and unanswerable to the audit,
     and the two disagreeing is what let 製造業 ship at 20% coverage. */
  const answerable = x => {
    if(!x.ev.evades) return true;
    return remediesForStep(x.st, p, vulnIndex)
      .some(r => !r.blocked && !p.forbidden.includes(r.kind));
  };
  let picked = [], dead = 0;
  for(const x of ranked){
    if(picked.length >= want) break;
    if(!answerable(x)){
      if(dead >= FAIRNESS.maxUnanswerable) continue;
      dead++;
    }
    picked.push(x);
  }
  /* If the ceiling really is all there is, SAY SO rather than pad the campaign
     with steps that do not exist. `ceiling` rides out on the return value so the
     debrief can name it — silence here would be the same bug one layer up. */
  const ceiling = picked.length < FAIRNESS.minSteps;
  if(ceiling)
    for(const x of ranked){
      if(picked.length >= Math.min(want, ranked.length)) break;
      if(!picked.includes(x)) picked.push(x);
    }

  /* --- fairness pass 1: one turn has to be enough to close the campaign ---- */
  const distinct = list => new Set(list
    .map(x => x.ev.remedy)
    .filter(Boolean)
    .map(r => `${r.kind}:${r.target}`)).size;
  while(picked.length > FAIRNESS.minSteps && distinct(picked) > FAIRNESS.maxRemedies){
    /* drop the cheapest evading st, not the newest one: the campaign keeps its
       point and the player keeps a closable turn */
    let idx = -1;
    for(let i = picked.length - 1; i >= 0; i--) if(picked[i].ev.evades){ idx = i; break; }
    if(idx < 0) break;
    picked.splice(idx, 1);
  }
  /* --- fairness pass 2: something has to land, or the player learns nothing -
     unless the pipeline genuinely is not there, in which case silence IS the
     lesson and inventing a detection would be the lie. */
  const pipelineUp = ['driver','ring','state','rules','outputs'].every(k => p.built.includes(k));
  if(pipelineUp && picked.every(x => x.ev.evades)){
    const catchable = ranked.find(x => !x.ev.evades);
    if(catchable) picked[picked.length-1] = catchable;
  }

  /* --- waves: causal order, not shuffle ----------------------------------- */
  picked = picked.sort((x, y) =>
    phaseRank(phaseOf(x.st)) - phaseRank(phaseOf(y.st)) || y.s - x.s);
  const waves = [];
  for(const x of picked){
    const ph = phaseOf(x.st);
    const last = waves[waves.length-1];
    if(last && last.phase === ph && last.steps.length < 3) last.steps.push(x.st);
    else waves.push({ phase:ph, jp:(PHASES.find(q => q.id === ph) || PHASES[1]).jp,
                      steps:[x.st] });
  }
  waves.forEach((w, i) => { w.jp = `波 ${i+1} · ${w.jp}`; });

  /* --- label the campaign from what it turned out to be ------------------- */
  const steps = picked.map(x => x.st);
  const intent = pickIntent(steps, picked, tickNo);
  const targets = [...new Set(steps.filter(s => s.vuln).map(s => s.vuln))];
  const evading = picked.filter(x => x.ev.evades);

  return {
    id:`c${tickNo}-${seedIn}`,
    tick:tickNo,
    seed:seedIn,
    profile:p.profile,
    intent:intent.id,
    jp:`${intent.jp}`,
    brief:intent.blurb,
    waves,
    steps,
    targets,
    /* what the generator was aiming at, so a debrief can say it out loud
       instead of the player having to guess */
    aim: evading.map(x => ({ step:x.st.id, cause:x.ev.cause, target:x.ev.target })),
    novel: steps.filter(s => s.newRule).map(s => s.id),
    /* steps this situation structurally cannot answer, and whether that is ALL
       there was. `unanswerable` is expected to be 0 or 1 (§FAIRNESS.maxUnanswerable);
       `ceiling:true` means the environment offered nothing else, which is a real
       state for 製造業 and a bug report for anyone else. */
    unanswerable: picked.filter(x => !answerable(x)).map(x => x.st.id),
    ceiling,
    fairness:{ ...FAIRNESS }
  };
}

function emptyCampaign(tickNo, seedIn, p, jp){
  return { id:`c${tickNo}-${seedIn}`, tick:tickNo, seed:seedIn, profile:p.profile,
           intent:'sweep', jp, brief:jp, waves:[], steps:[], targets:[], aim:[],
           novel:[], unanswerable:[], ceiling:false, fairness:{ ...FAIRNESS } };
}
function hashSeed(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pickIntent(steps, picked, tickNo){
  const fresh = steps.some(s => s.gen && tickNo - s.since <= 2);
  const blind = picked.some(x => x.ev.cause === 'blind');
  const stale = picked.some(x => x.ev.cause === 'stale');
  const phases = new Set(steps.map(phaseOf));
  if(blind) return intentById('blind-probe');
  if(fresh || stale) return intentById('fresh-exploit');
  if(phases.has('exfil') || phases.has('creds')) return intentById('credential-theft');
  if(phases.has('persist')) return intentById('persistence');
  return intentById('sweep');
}

/* ---------------------------------------------------------------- series
   Production runs by itself: one campaign per tick, each generated against the
   posture as it is at that tick. Pass a function-free posture per tick if the
   player changed something — this module never mutates what it is given. */
function generateSeries(optsIn = {}){
  const opts = obj(optsIn);
  const ticks = Math.max(0, Math.round(num(opts.ticks, 10)));
  const from = Math.round(num(opts.from));
  const out = [];
  for(let t = from; t < from + ticks; t++){
    const postureAt = typeof opts.postureAt === 'function'
                    ? opts.postureAt(t) : opts.posture;
    out.push(generateCampaign({ ...opts, tick:t, posture:postureAt }));
  }
  return out;
}

/* ---------------------------------------------------------------- audit
   THE CHECK THAT KEEPS THIS HONEST.

   `forbidden` names moves this situation does not allow (manufacturing may not
   be able to reach out and follow rule artifacts, for instance). A step whose
   every remedy is forbidden or blocked is UNANSWERABLE, and an unanswerable
   step is not difficulty — it is a generated dead end. The count has to be 0. */
function auditCampaign(campaignIn, postureIn, optsIn = {}){
  const campaign = obj(campaignIn);
  const opts = obj(optsIn);
  const p = normalisePosture(postureIn);
  /* the posture carries what this situation cannot do, so a caller that forgot
     opts.forbidden still gets the honest answer rather than an optimistic one */
  const forbidden = new Set(arr(opts.forbidden).length ? arr(opts.forbidden).map(str)
                                                       : p.forbidden);
  const vulnIndex = new Map(arr(opts.vulns).map(obj).filter(v => !!v.id)
                                           .map(v => [v.id, v]));
  const rows = arr(campaign.steps).map(obj).map(st => {
    const ev = evadesPosture(st, p);
    const all = remediesForStep(st, p, vulnIndex);
    const ok = all.filter(r => !r.blocked && !forbidden.has(r.kind));
    /* TWO DIFFERENT KINDS OF ANSWER, and conflating them would make the
       fairness proof meaningless:
         detection  would have CAUGHT this step. Closing the campaign means
                    doing these, and there has to be a turn's worth of them
         prevention patching would have stopped the step from existing at all.
                    It does not retroactively catch anything, so it never counts
                    towards coverage — but it IS an answer, which is why a
                    blocked patch (製造業) is what makes a step unanswerable */
    const detect = ok.filter(r => r.kind !== 'patch');
    const prevent = ok.filter(r => r.kind === 'patch');
    return { step:st.id, caught:!ev.evades, cause:ev.cause, remedies:all,
             detect:detect.length, prevent:prevent.length,
             usable:detect.length + prevent.length };
  });
  const evading = rows.filter(r => !r.caught);
  const unanswerable = evading.filter(r => r.usable === 0).map(r => r.step);
  const pick = kindTest => [...new Set(evading.flatMap(r => r.remedies)
    .filter(r => !r.blocked && !forbidden.has(r.kind) && kindTest(r.kind))
    .map(r => `${r.kind}:${r.target}`))];
  const moves = pick(k => k !== 'patch');
  /* WHAT F6 ACTUALLY ASKS (GATE-FREEPLAY §1): 「生成された組み合わせに打つ手が必ず
     存在する（理不尽でない）」— a MOVE has to exist, not a perfect score.
     Three conditions, and the middle one is the correction:

       1. closing what can be closed fits in one turn      moves <= maxRemedies
       2. the ceiling stays a ceiling and not the whole     unanswerable <= maxUnanswerable
          campaign
       3. if anything got through, there is something       evading -> moves > 0
          to do about it

     The earlier definition demanded `unanswerable === 0`, which no 製造業 campaign
     can satisfy and no 製造業 campaign SHOULD — its declared ceiling is 4 of 7
     (archetypes.js §industrial-ot goal.detect). Reading F6 as "zero unanswerable"
     would have forced either a fake patch route onto unpatchable OT kit or a fake
     OCI path onto an isolated network. `deadEnd` is the real failure: steps got
     through and the player has nothing to play. */
  const deadEnd = evading.length > 0 && moves.length === 0;
  return {
    steps:rows.length,
    caught:rows.length - evading.length,
    coverage: rows.length ? (rows.length - evading.length) / rows.length : 1,
    rows,
    unanswerable,
    moves,                       /* the closing set: detection */
    options: pick(k => k === 'patch'),   /* the other answer: prevention */
    deadEnd,
    fair: !deadEnd
       && unanswerable.length <= FAIRNESS.maxUnanswerable
       && moves.length <= FAIRNESS.maxRemedies
  };
}

/* Apply moves and hand back a NEW posture. Used by the fairness proof: apply
   everything the audit offered, regenerate the verdict, and every step has to be
   caught. If it is not, this generator produced an attack with no answer. */
function applyRemedies(postureIn, moves){
  const p = normalisePosture(postureIn);
  const built = new Set(p.built);
  const tracedOff = new Set(p.tracedOff);
  const patched = new Set(p.patched);
  let following = p.following;
  let rulesetTick = p.rulesetTick;
  for(const m of arr(moves)){
    const [kind, target] = str(m).split(':');
    if(kind === 'build') built.add(target);
    if(kind === 'follow'){ built.add('falcoctl'); following = true; }
    if(kind === 'update') rulesetTick = null;
    if(kind === 'untrace') tracedOff.delete(target);
    if(kind === 'patch') patched.add(target);
  }
  return { ...p, built:[...built], tracedOff:[...tracedOff],
           patched:[...patched], following, rulesetTick };
}

/* how much of this campaign the posture would catch, without the engine. The
   real number comes from campaign.js evaluate(); this is the same question
   asked cheaply, and the harness cross-checks that they agree. */
const coverageOf = (campaign, postureIn) =>
  auditCampaign(campaign, postureIn).coverage;
/* steps the node does not have a rule for yet */
const staleMisses = (campaign, rulesetTick) =>
  arr(obj(campaign).steps).map(obj)
    .filter(s => s.ruleSince && num(rulesetTick) < s.ruleSince).map(s => s.id);

export {
  PHASES,
  PHASE_OF,
  phaseOf,
  INTENTS,
  intentById,
  POSTURE_DEFAULTS,
  normalisePosture,
  postureErrors,
  WEIGHT,
  FAIRNESS,
  REMEDY_TEXT,
  DISTRICT_ROLE,
  makeRng,
  vulnStep,
  baseStep,
  possibleHere,
  evadesPosture,
  remediesForStep,
  generateCampaign,
  generateSeries,
  auditCampaign,
  applyRemedies,
  coverageOf,
  staleMisses
};
