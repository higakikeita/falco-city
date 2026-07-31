/* SCENARIO SCHEMA — the contract every file in src/scenarios/ is written to.
 *
 * Playtime is made of scenarios, and scenarios are written by sessions working
 * in parallel, so the shape has to be fixed before the content lane opens. This
 * file is that shape: the environment table, the defaults, and the validator.
 *
 * Two constraints are load-bearing, and both are cheap now and expensive later:
 *
 *   1. A scenario is PURE DATA. No functions, no closures, no THREE, no
 *      undefined. It must survive JSON.stringify -> JSON.parse unchanged.
 *      A Unity port can then carry the scenario library across as-is; one
 *      function in one scenario file means rewriting all of them.
 *
 *   2. Player-facing text lives in the scenario, UI chrome lives in ui.js.
 *      Logic holds neither. Nothing here scores, positions or renders anything
 *      — a scenario declares what is true about a situation and the engine
 *      decides what follows from it. So no coordinates, no scores, no special
 *      cases: the same rule as DISTRICTS (README §地区を足す).
 *
 * isPlainData() enforces (1) mechanically. (2) is a review rule, but the field
 * list is arranged so that following it is the path of least resistance: every
 * string field below is player-facing, and there is nowhere to put a sentence
 * that is not.
 *
 * ---------------------------------------------------------------- field list
 *
 *   id         string    stable key. Also the filename.
 *   title      string    what the player sees in the picker. The mission line.
 *   order      number    sort key in the picker. Ties fall back to id.
 *   blurb      string    one or two sentences of setup. Shown on entry.
 *
 *   env.type   string    one of ENVIRONMENTS below.
 *   env.nodes  number    node count. Defaults to the environment's own.
 *
 *   start                the state you inherit. Everything here is something a
 *                        previous person could have left behind, which is what
 *                        a real handover looks like. An empty plot is just the
 *                        case where they left nothing.
 *   start.built  string[]  districts already standing. Dependencies must be
 *                          satisfied within the set (checked by campaign.js).
 *   start.tune   object    falco.yaml levers already set. Keys are TUNE_DEFAULTS,
 *                          which means base_syscalls is expressible as the real
 *                          thing and not only as a preset name:
 *                            syscallSet     all | default | custom
 *                            syscallCustom  custom_set entries; `!x` is negative
 *                            syscallRepair  base_syscalls.repair
 *                          A positive custom_set cannot take away the syscalls
 *                          the enabled rules require, so it cannot create a
 *                          blind spot. A negative entry or repair:false can.
 *                          Phase 0 carries both without scoring them; Phase 1
 *                          scores them, and no scenario file has to change.
 *   start.load   number    NODE LOAD as inherited.
 *   start.driver string    modern_ebpf | ebpf | kmod. Must be one the
 *                          environment allows. null = the environment's first.
 *                          The topology is not listed here: it is the
 *                          environment, one to one (§ENVIRONMENTS).
 *   start.stack  string    oss | sysdig.
 *
 *   player.side     string   defense | offense. Only defense is playable.
 *   player.role     string   platform | sre | detect | soc, or null for 全役.
 *   player.lockRole boolean  true = the scenario fixes the role and the picker
 *                            is closed. This is how a scenario says "you are
 *                            the SRE and you cannot fix the rules yourself".
 *
 *   attack.auto      boolean   defence always faces an automatic attack.
 *   attack.response  boolean   include the containment step.
 *   attack.waves     array     [{ jp, steps:[chain step id] }]. Phase 0 runs
 *                              the flattened list in one go; the boundaries are
 *                              declared now so Day 2 can walk them without
 *                              touching any scenario file.
 *
 *   insight.id     string   stable key for the one misdiagnosis this scenario
 *                           exists to make the player walk into. One per
 *                           scenario: that is the unit of content.
 *   insight.wrong  string   the conclusion the situation invites.
 *   insight.truth  string   what is actually happening.
 *
 *   goal.detect      number|null  detections required (of the non-response steps)
 *   goal.contain     boolean      containment step must land
 *   goal.maxAsks     number|null  how many times you may lean on another team
 *   goal.maxDropPct  number|null  ceiling on ring-buffer loss, in percent
 *
 * Referential checks (step ids, role ids, build dependencies) live in
 * campaign.js, which owns those tables. Keeping them out of here avoids an
 * import cycle and keeps this file honest about what it knows.
 */
import { TUNE_DEFAULTS } from '../state.js';
import { DEPLOYMENTS, nodeCount } from '../districts.data.js';

/* ---------------------------------------------------------------- environments
   The environment axis is declared once, in districts.data.js §DEPLOYMENTS,
   because the geometry needs it too. Deriving the scenario view from that table
   rather than restating it means a fifth environment is one declaration there
   and nothing here. `env` is the environment, `id` is the wire value S.deploy
   carries, and the two are one-to-one.

   The one thing the scenario layer adds is which drivers are available, and only
   one rule survives the sources: where there is no kernel path there is no driver
   to pick.

   There is deliberately NO per-environment kmod restriction. "managed k8s cannot
   load a kernel module" is disproven — the only documented case is GKE's
   Container-Optimized OS, which is a property of the NODE OS and not of who
   manages the cluster (README §環境の因果 / Falco Environments). That axis needs
   an attribute the environment table does not carry yet; until it does, stating
   it here would be inventing causality. */
const ENV_DRIVERS = {};      // per-environment overrides; none are justified yet

const ENVIRONMENTS = DEPLOYMENTS.map(d => ({
  id:d.env,
  jp:d.jp,
  deploy:d.id,                                     /* the topology it is */
  nodes:nodeCount(d),
  drivers:d.kernelPath ? (ENV_DRIVERS[d.env] || ['modern_ebpf','ebpf','kmod']) : [],
  cluster:!!d.cluster, apiServer:!!d.apiServer,
  kernelPath:!!d.kernelPath, k8sMeta:!!d.k8sMeta
}));
const envById = id => ENVIRONMENTS.find(e => e.id === id) || null;

const SIDE_IDS = ['defense','offense'];
const STACK_IDS = ['oss','sysdig'];
const DRIVER_IDS = ['modern_ebpf','ebpf','kmod'];
const TUNE_KEYS = Object.keys(TUNE_DEFAULTS);

/* what a scenario gets if it stays quiet about something */
const SCENARIO_DEFAULTS = {
  order:100,
  blurb:'',
  env:    { type:'self-managed-k8s', nodes:null },
  start:  { built:[], tune:{}, load:1.0, driver:null, stack:'oss' },
  player: { side:'defense', role:null, lockRole:false },
  attack: { auto:true, response:true, waves:[] },
  insight:{ id:null, wrong:'', truth:'' },
  goal:   { detect:null, contain:false, maxAsks:null, maxDropPct:null }
};

/* ---------------------------------------------------------------- purity
   A scenario has to survive a round trip through JSON, because that is the
   promise that makes the library portable. Report the path, not just a bool:
   with several sessions authoring content the message is the whole value. */
function plainDataErrors(v, path, out){
  if(v === null) return out;
  const t = typeof v;
  if(t === 'string' || t === 'boolean') return out;
  if(t === 'number'){
    if(!Number.isFinite(v)) out.push(`${path}: ${v} does not survive JSON`);
    return out;
  }
  if(Array.isArray(v)){
    v.forEach((x,i) => plainDataErrors(x, `${path}[${i}]`, out));
    return out;
  }
  if(t === 'object'){
    if(Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null){
      out.push(`${path}: must be a plain object, got ${v.constructor?.name || 'exotic object'}`);
      return out;
    }
    for(const [k, x] of Object.entries(v)) plainDataErrors(x, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${t} is not data — scenarios must stay portable to JSON`);
  return out;
}

/* ---------------------------------------------------------------- validation */
const KNOWN_TOP = ['id','title','order','blurb','env','start','player','attack','insight','goal'];

function validateShape(s){
  const e = [];
  const bad = (m) => e.push(m);

  if(!s || typeof s !== 'object' || Array.isArray(s)){
    return ['scenario must be an object'];
  }
  plainDataErrors(s, 'scenario', e);
  if(e.length) return e;                     /* nothing below can be trusted */

  /* unknown keys are rejected on purpose: a field that the engine does not
     read is a field that silently does nothing, and the content lane would
     never find out. */
  for(const k of Object.keys(s))
    if(!KNOWN_TOP.includes(k)) bad(`unknown field: ${k}`);

  if(typeof s.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id))
    bad('id must be a lowercase-hyphen string');
  if(typeof s.title !== 'string' || !s.title) bad('title is required');
  if(typeof s.order !== 'number') bad('order must be a number');
  if(typeof s.blurb !== 'string') bad('blurb must be a string');

  const env = s.env;
  if(!envById(env.type))
    bad(`env.type "${env.type}" is not one of ${ENVIRONMENTS.map(x=>x.id).join(' / ')}`);
  if(env.nodes !== null && (typeof env.nodes !== 'number' || env.nodes < 0))
    bad('env.nodes must be a non-negative number or null');
  for(const k of Object.keys(env))
    if(!['type','nodes'].includes(k)) bad(`unknown field: env.${k}`);

  const st = s.start;
  if(!Array.isArray(st.built) || st.built.some(x => typeof x !== 'string'))
    bad('start.built must be an array of district ids');
  if(typeof st.tune !== 'object' || st.tune === null || Array.isArray(st.tune))
    bad('start.tune must be an object');
  else {
    for(const k of Object.keys(st.tune))
      if(!TUNE_KEYS.includes(k)) bad(`unknown tuning lever: start.tune.${k}`);
    const cs = st.tune.syscallCustom;
    if(cs !== undefined && (!Array.isArray(cs) || cs.some(x => typeof x !== 'string')))
      bad('start.tune.syscallCustom must be an array of syscall names (`!name` to exclude)');
    if(st.tune.syscallRepair !== undefined && typeof st.tune.syscallRepair !== 'boolean')
      bad('start.tune.syscallRepair must be a boolean');
  }
  if(typeof st.load !== 'number' || st.load <= 0) bad('start.load must be a positive number');
  if(st.driver !== null && !DRIVER_IDS.includes(st.driver))
    bad(`start.driver must be null or one of ${DRIVER_IDS.join(' / ')}`);
  if(!STACK_IDS.includes(st.stack)) bad(`start.stack must be one of ${STACK_IDS.join(' / ')}`);
  for(const k of Object.keys(st))
    if(!['built','tune','load','driver','stack'].includes(k))
      bad(`unknown field: start.${k}`);

  /* the environment decides what is even possible to have chosen */
  const envDef = envById(env.type);
  if(envDef && st.driver && !envDef.drivers.includes(st.driver))
    bad(`start.driver "${st.driver}" is not available in ${env.type}`);


  const p = s.player;
  if(!SIDE_IDS.includes(p.side)) bad(`player.side must be one of ${SIDE_IDS.join(' / ')}`);
  if(p.role !== null && typeof p.role !== 'string') bad('player.role must be a role id or null');
  if(typeof p.lockRole !== 'boolean') bad('player.lockRole must be a boolean');
  if(p.lockRole && p.role === null) bad('player.lockRole needs a player.role to lock to');
  for(const k of Object.keys(p))
    if(!['side','role','lockRole'].includes(k)) bad(`unknown field: player.${k}`);

  const a = s.attack;
  if(typeof a.auto !== 'boolean') bad('attack.auto must be a boolean');
  if(typeof a.response !== 'boolean') bad('attack.response must be a boolean');
  if(!Array.isArray(a.waves) || !a.waves.length) bad('attack.waves needs at least one wave');
  else a.waves.forEach((w,i)=>{
    if(typeof w !== 'object' || w === null || Array.isArray(w)) return bad(`attack.waves[${i}] must be an object`);
    if(typeof w.jp !== 'string' || !w.jp) bad(`attack.waves[${i}].jp is required`);
    if(!Array.isArray(w.steps) || !w.steps.length) bad(`attack.waves[${i}].steps must be a non-empty array`);
    else if(w.steps.some(x => typeof x !== 'string')) bad(`attack.waves[${i}].steps must be step ids`);
    for(const k of Object.keys(w))
      if(!['jp','steps'].includes(k)) bad(`unknown field: attack.waves[${i}].${k}`);
  });
  for(const k of Object.keys(a))
    if(!['auto','response','waves'].includes(k)) bad(`unknown field: attack.${k}`);

  const ins = s.insight;
  if(typeof ins.id !== 'string' || !ins.id) bad('insight.id is required — one misdiagnosis per scenario');
  if(typeof ins.wrong !== 'string' || !ins.wrong) bad('insight.wrong is required');
  if(typeof ins.truth !== 'string' || !ins.truth) bad('insight.truth is required');
  for(const k of Object.keys(ins))
    if(!['id','wrong','truth'].includes(k)) bad(`unknown field: insight.${k}`);

  const g = s.goal;
  const num = (v) => v === null || (typeof v === 'number' && v >= 0);
  if(!num(g.detect)) bad('goal.detect must be a number or null');
  if(typeof g.contain !== 'boolean') bad('goal.contain must be a boolean');
  if(!num(g.maxAsks)) bad('goal.maxAsks must be a number or null');
  if(!num(g.maxDropPct)) bad('goal.maxDropPct must be a number or null');
  if(g.detect === null && !g.contain && g.maxAsks === null && g.maxDropPct === null)
    bad('goal declares no clear condition');
  for(const k of Object.keys(g))
    if(!['detect','contain','maxAsks','maxDropPct'].includes(k)) bad(`unknown field: goal.${k}`);

  return e;
}

/* fill in the defaults, one level deep, without mutating the source file */
function normalize(s){
  const d = SCENARIO_DEFAULTS;
  return {
    id:s.id, title:s.title,
    order: s.order ?? d.order,
    blurb: s.blurb ?? d.blurb,
    env:    {...d.env,    ...(s.env    || {})},
    start:  {...d.start,  ...(s.start  || {}), tune:{...(s.start?.tune || {})}},
    player: {...d.player, ...(s.player || {})},
    attack: {...d.attack, ...(s.attack || {})},
    insight:{...d.insight,...(s.insight|| {})},
    goal:   {...d.goal,   ...(s.goal   || {})}
  };
}

/* the environment a scenario runs in, with the scenario's overrides applied */
function envOf(s){
  const e = envById(s.env.type);
  if(!e) return null;
  return {...e, nodes: s.env.nodes ?? e.nodes};
}

/* the topology is the environment, and the driver defaults to the best one the
   environment allows */
const deployOf = s => envById(s.env.type).deploy;
const driverOf = s => s.start.driver ?? envById(s.env.type).drivers[0] ?? null;

/* the flattened attack, in order. Day 2 walks attack.waves instead; until then
   a wave boundary is information the engine carries but does not act on. */
const stepsOf = s => s.attack.waves.flatMap(w => w.steps);

export {
  ENVIRONMENTS,
  envById,
  envOf,
  deployOf,
  driverOf,
  stepsOf,
  normalize,
  validateShape,
  plainDataErrors,
  SCENARIO_DEFAULTS,
  DRIVER_IDS,
  STACK_IDS,
  SIDE_IDS
};
