/* CAMPAIGN — rules and state for building the pipeline from an empty plot.
 *
 * This module holds no DOM: no element lookups, no rendering, no ui.js import.
 * Enforced by scripts/check-imports.mjs. It owns what is true about the game;
 * ui.js decides
 * how that looks. Changes are announced through onCampaignChange so the two
 * sides can be worked on independently.
 *
 * The teaching is structural: every stage exists because without it the
 * previous stage is useless. Rather than explaining that, the game runs an
 * attack chain against whatever you actually built, and the steps you cannot
 * possibly catch stay uncaught.
 */
import { DISTRICTS, byId, isFlow, setCampaignView } from './layout.js';
import { S, GAME, model, TUNE_DEFAULTS, hasCap } from './state.js';
import { DEPLOYMENTS } from './districts.data.js';
import { districtObjs } from './city.js';
import { polPoints } from './sim.js';
import { setMode, setDeploy, applyShield, onTuneChange } from './controls.js';
import { SCENARIOS, DEFAULT_SCENARIO_ID, scenarioById, addScenarioError } from './scenarios/index.js';
import { envOf, deployOf, driverOf, stepsOf } from './scenarios/schema.js';

/* ---------------------------------------------------------------- build graph */
const DEPS = {
  workloads:[], driver:['workloads'], ring:['driver'], state:['ring'],
  rules:['state'], outputs:['rules'], plugins:['rules'],
  falcoctl:['rules'], sysdig:['outputs']
};
const BUILD_ORDER = ['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'];

/* what each stage buys you, said in terms of what was impossible before */
const UNLOCK = {
  driver:'カーネルに目がついた。ただし届くのは <b>生の syscall</b> だけ — <code>fd=7 に write した</code> では、まだ何のルールも書けない。',
  ring:  'イベントがユーザ空間に届くようになった。ここが<b>唯一落ちる場所</b>なので、負荷を上げるとドロップする。',
  state: '<b>ここが分水嶺。</b> スレッドテーブルと FD テーブルが載り、はじめて <code>proc.name</code> / <code>fd.name</code> / <code>container.id</code> が使える。ルールが書けるようになった。',
  rules: 'ルールが評価されるようになった。ただしまだ<b>誰にも届いていない</b>。',
  outputs:'アラートが人に届くようになった。ここまでで syscall 由来の検知が成立する。',
  plugins:'syscall 以外の入力が合流した。<b>クラウド側の操作</b>が見えるようになった。',
  falcoctl:'ルールが OCI アーティファクトとして追従するようになった。<b>新しい検知</b>を持てる。',
  sysdig:'相関と<b>止める手</b>が入った。検知して終わり、ではなくなった。'
};

/* ---------------------------------------------------------------- attack chain
   The library of steps an attack can be composed of. A scenario does not invent
   attacks — it names which of these come, and in which wave. `id` is that handle.

   `needsCaps` names what the deployment has to make observable — the attributes
   declared on DEPLOYMENTS (districts.data.js), read through hasCap(). Never the
   name of a topology: pinning `deploy:'k8s'` became wrong the moment `managed`
   was declared, and it would blame the platform role for a miss the model never
   caused. The capability is the actual reason. */
const SYSCALL_PATH = ['driver','ring','state','rules','outputs'];
const CHAIN = [
  { id:'exec', jp:'kubectl exec でコンテナにシェルを取る', rule:'Terminal shell in container',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'] },
  { id:'shadow', jp:'/etc/shadow を読んで資格情報を探す', rule:'Read sensitive file untrusted',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'] },
  { id:'cron', jp:'/etc/cron.d に書き込んで永続化する', rule:'Write below etc',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'] },
  { id:'dropbin', jp:'/tmp に落としたバイナリを実行する', rule:'Drop and execute new binary in container',
    needs:[...SYSCALL_PATH,'falcoctl'], needsCaps:['kernelPath'],
    why:'この検知は既定で同梱されるルールセットには入っていない。falcoctl でルールを追従させていなければ、そもそも持っていない。' },
  { id:'k8sapi', jp:'K8s API サーバに接触して権限を探る', rule:'Contact K8S API Server From Container',
    needs:SYSCALL_PATH, needsCaps:['kernelPath','apiServer'] },
  { id:'cloud', jp:'盗んだ資格情報でクラウドへ（MFA 無しログイン → バケットの暗号化を解除）',
    rule:'Console Login Without MFA / Delete Bucket Encryption',
    needs:['rules','outputs','plugins'],
    why:'クラウド API の操作は<b>別のイベントソース</b>（<code>aws_cloudtrail</code>）で、'+
         '<code>ct.*</code> という別のフィールド空間を持つ。<b>Falco はソース間の相関をしない</b>ので、'+
         'syscall ルールには<b>構造的に</b>マッチし得ない。プラグイン入力を足す以外に道が無い。' }
];
/* Why a missing capability stops a step. Keyed by the capability, so a reason can
   never drift onto the wrong cause — the bug that told a kernel-less environment
   its rules were out of date.

   `k8sMeta` is deliberately absent: no detection here requires it, because
   container and k8s metadata come from the container runtime socket and are
   orthogonal to how Falco was installed (README §環境の因果). Attributing a miss
   to the install form would be restating an error the docs disprove. */
const CAP_WHY = {
  kernelPath:'この環境にはカーネルからユーザ空間へのリングバッファが無い。'+
             '<code>syscall</code> ソース自体が消えるわけではないが、'+
             '<b>カーネル由来のイベントが1件も上がってこない</b>ので、'+
             'ルールエンジンに届くのはプラグイン入力だけ。',
  apiServer:'この環境に <b>Kubernetes の API サーバが無い</b>。'+
            'オーケストレータが居ないので接触する相手が存在せず、この振る舞い自体が起こり得ない。'+
            '（インストール形態の話ではない — <code>k8saudit</code> は host 導入でも動く）'
};

const stepById = id => CHAIN.find(s => s.id === id) || null;
const RESPONSE = { id:'contain', jp:'侵害されたコンテナを止めて封じ込める', rule:'kill / pause container',
  needs:['sysdig'],
  why:'OSS Falco は目。止める手は別のコンポーネント（Sysdig の応答、または Falco Talon）。' };

/* ---------------------------------------------------------------- sides
   You pick which side of the fight you are on. Only defence is playable;
   offence exists so the shape of the game is visible from the start. */
const SIDES = [
  { id:'defense', jp:'守備側', chip:'守備', enabled:true,
    brief:'パイプラインを建てて攻撃を迎え撃つ。攻撃は <b>Auto</b> で流れる。' },
  { id:'offense', jp:'攻撃側', chip:'攻撃', enabled:false,
    brief:'検知をすり抜ける攻撃を組む。まだ実装されていない。' }
];
const sideById = id => SIDES.find(s => s.id === id);

/* ---------------------------------------------------------------- roles
   One team never builds this pipeline. Four do, and most real detection gaps
   sit on the seams between them rather than inside any one stage. So every
   buildable district and every lever is attributed to a role, and a missed
   step names the role whose decision caused it. */
const ROLES = [
  { id:'platform', chip:'基盤', jp:'プラットフォーム', short:'plat', color:'#00A8BC',
    owns:['driver','state'],
    mission:'Falco をどこに載せ、何が見えるかを決める',
    brief:'持ち物は <b>02 ドライバ</b>・<b>04 状態エンジン</b> と <b>DEPLOY</b> / <b>DRIVER</b>。'+
          'ここの構成を間違えると、下流が何をしても検知は成立しない。' },
  { id:'sre', chip:'SRE', jp:'SRE / ノード運用', short:'sre', color:'#E08A2E',
    owns:['ring'],
    mission:'落とさずに回す',
    brief:'持ち物は <b>03 リングバッファ</b> と <b>TUNING</b> 一式。ここが<b>唯一イベントが落ちる場所</b>。'+
          '検知条件を満たした攻撃でも、ここで消える。' },
  { id:'detect', chip:'検知', jp:'検知エンジニア', short:'det', color:'#B15FC4',
    owns:['rules','plugins','falcoctl'],
    mission:'何を検知できるかを決める',
    brief:'持ち物は <b>05 ルールエンジン</b>・<b>07 プラグイン入力</b>・<b>09 ルール配布</b>。'+
          'パイプラインが完璧でも、ルールを持っていなければ1本も鳴らない。' },
  { id:'soc', chip:'SOC', jp:'SOC / 対応', short:'soc', color:'#01353E',
    owns:['outputs','sysdig'],
    mission:'受け取って、止める',
    brief:'持ち物は <b>06 出力チャネル</b>・<b>08 Sysdig Secure</b> と <b>STACK</b>。'+
          '検知は届いて初めて検知で、止める手は目とは別の部品。' }
];
const roleById = id => ROLES.find(r => r.id === id);

/* district -> role. 01 workloads has no owner: it is what the app teams ship. */
const OWNER = {};
ROLES.forEach(r => r.owns.forEach(d => OWNER[d] = r.id));

/* lever group -> role, by name rather than by selector: which CSS node a lever
   lives in is ui.js's business. NODE LOAD is deliberately ownerless — load is
   not a decision anybody makes, it is what the workload happens to be doing. */
const LEVER_OWNER = { deploy:'platform', driver:'platform', tuning:'sre', stack:'soc' };

/* you may touch a lever if you are playing everyone, or you own it */
const canUseLever = group =>
  !(GAME.on && GAME.role && GAME.role !== LEVER_OWNER[group]);

GAME.role = null;      // null = 全役（one player doing every job）
GAME.roleLocked = false;
GAME.side = 'defense';
GAME.asks = 0;
GAME.scenario = null;  // set on entry; there is no play outside a scenario

/* ---------------------------------------------------------------- change feed */
const listeners = new Set();
export function onCampaignChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function notify(ev){ for(const fn of listeners) fn(ev); }

/* ---------------------------------------------------------------- world state */
const canBuild = id => DEPS[id].every(k => GAME.built.has(k));

/* particles evaporate at the edge of what has actually been built */
function frontier(){
  if(!GAME.on) return Infinity;
  let x = byId('workloads').x1;
  for(const d of DISTRICTS)
    if(isFlow(d) && GAME.built.has(d.id)) x = Math.max(x, d.x1);
  return x + 4;
}

/* 3D only — the district labels are DOM and belong to ui.js */
function applyGameVisibility(){
  for(const d of DISTRICTS)
    districtObjs[d.id].group.visible = !GAME.on || GAME.built.has(d.id);
  polPoints.visible = !GAME.on || GAME.built.has('falcoctl') || GAME.built.has('sysdig');
  GAME.frontier = frontier();
}

/* ---------------------------------------------------------------- scenarios
   Playtime is made of scenarios, so the engine reads them and holds no case for
   any particular one — 空き地から建てる is src/scenarios/greenfield.js and gets
   no more from this file than any other. schema.js is the contract.

   Referential checks live here because this is where the tables are. They run
   once per scenario, the first time it is started, and land in the same error
   list the shape check uses. */
const checked = new Set();

function referentialErrors(sc){
  const e = [];
  const ids = stepsOf(sc);
  ids.forEach(id => { if(!stepById(id)) e.push(`unknown attack step: ${id}`); });
  if(new Set(ids).size !== ids.length) e.push('an attack step appears in more than one wave');

  if(sc.player.role !== null && !roleById(sc.player.role))
    e.push(`unknown role: ${sc.player.role}`);

  const built = new Set(['workloads', ...sc.start.built]);
  for(const id of sc.start.built){
    if(!DEPS[id]) e.push(`start.built names a district that cannot be built: ${id}`);
    else for(const dep of DEPS[id])
      if(!built.has(dep))
        e.push(`start.built has ${id} without ${dep} — the dependency has to be met`);
  }
  if(sc.start.stack === 'sysdig' && !built.has('sysdig'))
    e.push('start.stack is sysdig but 08 Sysdig Secure is not in start.built');
  if(sc.goal.detect !== null && sc.goal.detect > ids.length)
    e.push(`goal.detect ${sc.goal.detect} is above the ${ids.length} step(s) that come`);
  return e;
}

function validated(sc){
  if(checked.has(sc.id)) return true;
  const errs = referentialErrors(sc);
  errs.forEach(m => addScenarioError(`${sc.id}: ${m}`));
  checked.add(sc.id);
  return errs.length === 0;
}

const activeScenario = () => GAME.scenario ? scenarioById(GAME.scenario) : null;

/* the resolved environment: the table entry with the scenario's node count
   applied. Carries its own player-facing name, so no layer above has to keep a
   second copy of it. */
function activeEnv(){
  const sc = activeScenario();
  return sc ? envOf(sc) : null;
}

/* the steps that come, in order. Outside a scenario (explore mode, console
   poking) the whole library comes, which is what it did before scenarios. */
function activeChain(){
  const sc = activeScenario();
  if(!sc) return CHAIN.slice();
  return stepsOf(sc).map(stepById).filter(Boolean);
}
const hasResponse = () => { const sc = activeScenario(); return sc ? sc.attack.response : true; };

/* the topology the current environment is. In a scenario there is exactly one —
   the environment is not a lever, it is the place you were given — so the DEPLOY
   buttons for the others are not available while it runs. */
function allowedDeploys(){
  const sc = activeScenario();
  const env = sc && envOf(sc);
  return env ? [env.deploy] : DEPLOYMENTS.map(d => d.id);
}
function allowedDrivers(){
  const sc = activeScenario();
  const env = sc && envOf(sc);
  return env ? env.drivers.slice() : ['modern_ebpf','ebpf','kmod'];
}

/* Enter a scenario. Everything the player is handed comes from the file: the
   environment, what is already standing, what was already tuned, which role
   they are. An empty plot is the case where the file hands over nothing. */
function startScenario(id){
  const sc = scenarioById(id);
  if(!sc){ addScenarioError(`cannot start unknown scenario: ${id}`); return false; }
  if(!validated(sc)) return false;

  const env = envOf(sc);
  GAME.scenario = sc.id;
  GAME.on = true;
  GAME.built = new Set(['workloads', ...sc.start.built]);
  GAME.results = null; GAME.reveal = 0; GAME.revealT = 0; GAME.asks = 0;
  GAME.side = sc.player.side;
  GAME.role = sc.player.role;
  GAME.roleLocked = sc.player.lockRole;

  S.env = sc.env.type;
  S.nodes = env.nodes;
  S.tune = {...TUNE_DEFAULTS, ...sc.start.tune};
  S.load = sc.start.load;
  S.driver = driverOf(sc) || S.driver;
  S.dead = false; S.deadDrops = 0;
  S.counters = {sys:0, ring:0, drop:0, rules:0, alerts:0};
  S.shown    = {sys:0, ring:0, drop:0, rules:0, alerts:0};
  S.alertWindow = [];

  setMode(sc.start.stack);
  setDeploy(deployOf(sc));        /* reroutes the particles and calls onTuneChange */
  applyGameVisibility();
  applyShield();
  notify({type:'scenario', id:sc.id});
  return true;
}

/* ---------------------------------------------------------------- evaluation
   A pure function of what you built, how you tuned it, and where you deployed. */
function evaluate(){
  const M = model();
  const out = [];
  /* a real overload steals one otherwise-detected syscall step */
  let stolen = M.util > 1 && M.dropP > 0.05;

  for(const s of activeChain()){
    const missing = s.needs.filter(k => !GAME.built.has(k));
    const missingCaps = (s.needsCaps || []).filter(c => !hasCap(c));
    let caught = missing.length === 0, why = null;
    if(!caught){
      why = s.why || `まだ建っていない: ${missing.map(m=>byId(m).jp).join(' / ')}`;
    } else if(missingCaps.length){
      caught = false;
      /* the reason belongs to the capability that is missing, not to the step —
         otherwise a kernel-less environment gets told its rules are out of date */
      why = CAP_WHY[missingCaps[0]] || `この構成（${S.deploy}）では検知できない。`;
    } else if(stolen && s.needs.includes('ring')){
      caught = false; stolen = false;
      why = `検知条件は満たしていたのに、<b>リングバッファでドロップした</b>（drain utilisation ${Math.round(M.util*100)}%）。`;
    }
    out.push({...s, caught, why});
  }
  if(hasResponse()){
    const rMissing = RESPONSE.needs.filter(k => !GAME.built.has(k));
    out.push({...RESPONSE, response:true, caught:rMissing.length===0,
              why: rMissing.length ? RESPONSE.why : null});
  }
  return out;
}

/* Whose decision caused this miss. Derived from the result, never annotated
   by hand, so it cannot drift away from what the model actually did. */
function blameOf(r){
  if(!r || r.caught) return null;
  const missing = r.needs.filter(k => !GAME.built.has(k));
  if(missing.length){
    /* the most upstream gap is the one that actually stopped the event */
    const first = BUILD_ORDER.find(k => missing.includes(k)) || missing[0];
    return OWNER[first] || null;
  }
  /* the topology is the platform role's call, so a capability the deployment
     does not have is their miss */
  if((r.needsCaps || []).some(c => !hasCap(c))) return 'platform';
  return 'sre';   /* everything was built and matched — the ring buffer ate it */
}

/* what each role's decisions cost, as data */
function roleReport(){
  const results = GAME.results || [];
  const notes = [];
  /* the sharpest seam in the whole model, and the one it does not score */
  if(S.tune.syscallSet === 'custom')
    notes.push('<b>役割の境目:</b> SRE が <code>base_syscalls</code> を絞ってドロップを止めている。'+
      'その絞り込みが検知エンジニアのルールに必要な syscall まで落としていないかは、'+
      'この模型では判定していない。実機では必ず突き合わせる。');
  if(GAME.asks)
    notes.push(`<b>他チームへの依頼 ${GAME.asks}件。</b>自分の担当だけでは検知は完成しない — `+
      'この回数が、組織側で払っているコストそのもの。');
  return {
    roles: ROLES.map(r => ({
      id:r.id, jp:r.jp, color:r.color, mine: GAME.role === r.id,
      built: r.owns.filter(k => GAME.built.has(k)).length,
      owns: r.owns.length,
      misses: results.filter(x => x.blame === r.id).length
    })),
    notes
  };
}

/* the headline sentence for the current results */
function verdictText(){
  if(!GAME.results || GAME.reveal < GAME.results.length) return null;
  const det = GAME.results.filter(r => !r.response);
  const hit = det.filter(r => r.caught).length;
  const resp = GAME.results.find(r => r.response);
  if(hit === det.length)
    return { good:true, html: !resp
      ? '<b>この環境で成立する全段を検知した。</b>'
      : resp.caught
      ? '<b>全段検知＋封じ込め。</b>目と手が揃った状態がこれ。'
      : '<b>全段検知。ただし止められていない。</b>検知と応答は別の部品。' };
  return { good:false,
    html:`<b>${det.length-hit} 段を見逃した。</b>各行の理由が、その部品が存在する理由。` };
}

/* Did you clear the scenario. The thresholds are the scenario's, the arithmetic
   is here, and the labels are ui.js's — this returns keys and numbers so that
   no player-facing sentence has to live in the rules layer. */
function goalStatus(){
  const sc = activeScenario();
  if(!sc || !GAME.results || GAME.reveal < GAME.results.length) return null;
  const g = sc.goal;
  const det = GAME.results.filter(r => !r.response);
  const hit = det.filter(r => r.caught).length;
  const resp = GAME.results.find(r => r.response);
  const dropPct = model().dropP * 100;
  const items = [];

  if(g.detect !== null)
    items.push({key:'detect', target:g.detect, actual:hit, of:det.length, ok:hit >= g.detect});
  if(g.contain)
    items.push({key:'contain', target:1, actual:resp && resp.caught ? 1 : 0,
                ok:!!(resp && resp.caught)});
  if(g.maxAsks !== null)
    items.push({key:'asks', target:g.maxAsks, actual:GAME.asks, ok:GAME.asks <= g.maxAsks});
  if(g.maxDropPct !== null)
    items.push({key:'drop', target:g.maxDropPct, actual:Math.round(dropPct*100)/100,
                ok:dropPct <= g.maxDropPct});

  return { items, cleared: items.every(i => i.ok) };
}
const score = () => (GAME.results && GAME.reveal)
  ? GAME.results.filter(r => !r.response && r.caught).length : 0;

/* ---------------------------------------------------------------- actions */
function build(id){
  if(!canBuild(id) || GAME.built.has(id)) return false;
  GAME.built.add(id);
  applyGameVisibility();
  GAME.results = null; GAME.reveal = 0;
  if(id === 'sysdig') setMode('sysdig');
  notify({type:'build', id, unlock:UNLOCK[id] || ''});
  return true;
}

/* another team's stage still has to exist, but you can only ask for it.
   The count is the point: it is the coordination cost, made visible. */
function requestBuild(id){
  if(!build(id)) return false;
  GAME.asks++;
  notify({type:'asks'});
  return true;
}

function runAttack(){
  GAME.results = evaluate();
  /* blame is snapshotted at run time so it cannot drift if the tuning is
     changed while the results are still on screen */
  GAME.results.forEach(r => r.blame = blameOf(r));
  GAME.reveal = 0; GAME.revealT = 0;
  notify({type:'run'});
}

/* reveal one step at a time, driven from the frame loop */
function tickReveal(dt){
  if(!GAME.results || GAME.reveal >= GAME.results.length) return;
  GAME.revealT -= dt;
  if(GAME.revealT > 0) return;
  GAME.revealT = 0.62;
  GAME.reveal++;
  notify({type:'reveal', done: GAME.reveal >= GAME.results.length});
}

/* a scenario may fix the role, and then this is not yours to change */
function setRole(id){
  if(GAME.roleLocked) return false;
  GAME.role = id;
  notify({type:'role', id});
  return true;
}

function setSide(id){
  const s = sideById(id);
  if(!s || !s.enabled) return false;
  GAME.side = id;
  notify({type:'side', id});
  return true;
}

function setUiMode(m){
  GAME.on = m === 'campaign';
  setCampaignView(GAME.on);
  if(GAME.on){
    /* whatever the situation is, it comes from a scenario file */
    startScenario(GAME.scenario || DEFAULT_SCENARIO_ID);
  } else {
    GAME.built = new Set(DISTRICTS.map(d => d.id));
    applyGameVisibility();
    applyShield();
  }
  notify({type:'mode', mode:m});
}

export {
  GAME,
  DEPS,
  BUILD_ORDER,
  UNLOCK,
  CHAIN,
  stepById,
  RESPONSE,
  SCENARIOS,
  DEFAULT_SCENARIO_ID,
  scenarioById,
  activeScenario,
  activeEnv,
  activeChain,
  startScenario,
  allowedDeploys,
  allowedDrivers,
  goalStatus,
  SIDES,
  sideById,
  ROLES,
  roleById,
  OWNER,
  LEVER_OWNER,
  canUseLever,
  canBuild,
  evaluate,
  blameOf,
  roleReport,
  verdictText,
  score,
  build,
  requestBuild,
  runAttack,
  tickReveal,
  setRole,
  setSide,
  setUiMode,
  applyGameVisibility,
  frontier
};
